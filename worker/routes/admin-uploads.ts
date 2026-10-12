import { Hono } from 'hono';

import type {
  CompleteUploadResponse,
  OkResponse,
  PartResponse,
  SignPartsResponse,
  UploadSessionResponse,
  UploadSessionsResponse,
} from '../../shared/api.ts';
import {
  MAX_VIDEO_BYTES,
  MIN_PART_BYTES,
  MIN_VIDEO_BYTES,
  PART_URL_TTL_SECONDS,
  UPLOAD_PART_BYTES,
  UPLOAD_SESSION_TTL_SECONDS,
  VIDEO_EXTENSIONS,
  VIDEO_MIME_TYPES,
  isTierSlug,
} from '../../shared/constants.ts';
import { getFilmRow, getVideoRow, toAdminVideo } from '../database/films.ts';
import {
  expectedPartSize,
  findSessionRows,
  listPartRows,
  markAborted,
  toSessionInfo,
  toSessionInfos,
  transitionState,
  upsertPart,
  type UploadSessionRow,
} from '../database/uploads.ts';
import { uploadMode, type AppBindings, type AppEnv } from '../env.ts';
import { ApiError, badRequest, conflict, notFound, storageError, validationFailed } from '../lib/errors.ts';
import { logError } from '../lib/log.ts';
import { isoAfterSeconds, json, nowIso, readJson } from '../lib/http.ts';
import {
  completeUploadSchema,
  createUploadSchema,
  reportPartSchema,
  signPartsSchema,
} from '../lib/schemas.ts';
import { looksLikeMp4 } from '../storage/mp4.ts';
import { getMultipartStorage, type StoredPart } from '../storage/multipart.ts';

const MP4_PROBE_BYTES = 64 * 1024;
const MAX_PARTS = 10_000;

/** Размер части. Переопределение действует только в режиме binding (локальная разработка и тесты). */
function partSizeFor(env: AppEnv): number {
  if (uploadMode(env) === 'binding' && env.UPLOAD_PART_BYTES_OVERRIDE) {
    const override = Number(env.UPLOAD_PART_BYTES_OVERRIDE);
    if (Number.isInteger(override) && override >= MIN_PART_BYTES) return override;
  }
  return UPLOAD_PART_BYTES;
}

function assertFileName(fileName: string): void {
  // Управляющие символы и разделители пути в имени файла не допускаются.
  if (/[\u0000-\u001f\u007f/\\]/.test(fileName)) {
    throw validationFailed('Имя файла содержит недопустимые символы.');
  }
  const lower = fileName.toLowerCase();
  if (!VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension) && lower.length > extension.length)) {
    throw validationFailed(`Подходят только файлы ${VIDEO_EXTENSIONS.join(', ')}.`);
  }
}

/**
 * Сессия текущего администратора. Чужая или несуществующая — 404.
 * Требует состояние active; истёкшая сессия помечается expired.
 */
async function loadActiveSession(
  db: D1Database,
  adminId: number,
  sessionId: string,
): Promise<UploadSessionRow> {
  const [row] = await findSessionRows(db, 'u.id = ? AND u.admin_id = ?', [sessionId, adminId]);
  if (!row) throw notFound('Сессия загрузки не найдена.');
  if (row.state === 'active' && row.expires_at <= nowIso()) {
    await transitionState(db, row.id, 'active', 'expired');
    throw conflict('Срок сессии загрузки истёк. Начните загрузку заново.');
  }
  if (row.state !== 'active') {
    throw conflict(
      row.state === 'completing' || row.state === 'completed'
        ? 'Эта загрузка уже завершена или завершается.'
        : 'Эта загрузка прервана или её срок истёк. Начните загрузку заново.',
    );
  }
  return row;
}

function parsePartNumber(value: string, session: UploadSessionRow): number {
  const partNumber = Number(value);
  if (!/^\d{1,5}$/.test(value) || partNumber < 1 || partNumber > session.total_parts) {
    throw validationFailed(`Номер части должен быть от 1 до ${String(session.total_parts)}.`);
  }
  return partNumber;
}

/** Сверяет список частей с ожидаемым: все номера по порядку и точные размеры. */
function findPartsProblem(session: UploadSessionRow, parts: StoredPart[]): string | null {
  const byNumber = new Map(parts.map((part) => [part.partNumber, part]));
  if (byNumber.size !== parts.length || parts.length > session.total_parts) {
    return 'В хранилище оказались лишние части.';
  }
  for (let partNumber = 1; partNumber <= session.total_parts; partNumber += 1) {
    const part = byNumber.get(partNumber);
    if (!part) return `Не загружена часть ${String(partNumber)} из ${String(session.total_parts)}.`;
    if (part.sizeBytes !== expectedPartSize(session, partNumber)) {
      return `Часть ${String(partNumber)} имеет неверный размер.`;
    }
  }
  return null;
}

async function discardObject(env: AppEnv, session: UploadSessionRow): Promise<void> {
  // Если очистка не удалась, остаток будет виден в разделе «Хранилище» как «сирота» и удаляется оттуда.
  try {
    await getMultipartStorage(env, session.mode).abort(session.object_key, session.multipart_upload_id);
  } catch (error) {
    logError(`Не удалось прервать multipart-загрузку`, error);
  }
  try {
    await env.MEDIA.delete(session.object_key);
  } catch (error) {
    logError(`Не удалось удалить объект после неудачной загрузки`, error);
  }
  await markAborted(env.DB, session.id);
}

export const uploadRoutes = new Hono<AppBindings>();

uploadRoutes.get('/', async (c) => {
  const slug = c.req.query('slug');
  if (slug !== undefined && !isTierSlug(slug)) throw validationFailed('Неизвестный уровень фильма.');
  const conditions = ["u.admin_id = ? AND u.state = 'active' AND u.expires_at > ?"];
  const values: (string | number)[] = [c.get('admin').id, nowIso()];
  if (slug !== undefined) {
    conditions.push('f.slug = ?');
    values.push(slug);
  }
  const rows = await findSessionRows(c.env.DB, conditions.join(' AND '), values);
  const body: UploadSessionsResponse = { sessions: await toSessionInfos(c.env.DB, rows) };
  return json(body);
});

uploadRoutes.post('/', async (c) => {
  const input = await readJson(c.req.raw, createUploadSchema);
  assertFileName(input.fileName);
  if (!(VIDEO_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new ApiError(415, 'unsupported_media_type', 'Подходит только видео в формате MP4 (video/mp4).');
  }
  if (input.fileSize > MAX_VIDEO_BYTES) {
    throw new ApiError(413, 'payload_too_large', 'Файл больше допустимых 5 ГБ.');
  }
  if (input.fileSize < MIN_VIDEO_BYTES) {
    throw validationFailed('Файл слишком мал, чтобы быть мультфильмом.');
  }

  const admin = c.get('admin');
  const mode = uploadMode(c.env);
  const film = await getFilmRow(c.env.DB, input.slug);
  const partSize = partSizeFor(c.env);

  // Возобновление: тот же администратор, фильм и файл (имя, размер, дата изменения).
  const [existing] = await findSessionRows(
    c.env.DB,
    `u.admin_id = ? AND u.film_id = ? AND u.state = 'active' AND u.expires_at > ?
       AND u.file_name = ? AND u.expected_size = ? AND u.file_last_modified = ? AND u.mode = ? AND u.part_size = ?`,
    [admin.id, film.id, nowIso(), input.fileName, input.fileSize, input.fileLastModified, mode, partSize],
  );
  if (existing) {
    const body: UploadSessionResponse = {
      session: toSessionInfo(existing, await listPartRows(c.env.DB, existing.id)),
    };
    return json(body);
  }

  const totalParts = Math.ceil(input.fileSize / partSize);
  if (totalParts > MAX_PARTS) throw validationFailed('Файл слишком велик для загрузки частями.');

  const storage = getMultipartStorage(c.env, mode);
  const sessionId = crypto.randomUUID();
  // Ключ объекта генерирует только сервер; имя файла от клиента в него не попадает.
  const objectKey = `videos/${input.slug}/${crypto.randomUUID()}.mp4`;
  const uploadId = await storage.create(objectKey, 'video/mp4');
  try {
    await c.env.DB.prepare(
      `INSERT INTO upload_sessions (id, admin_id, film_id, object_key, multipart_upload_id, mode, file_name,
         file_last_modified, mime_type, expected_size, part_size, total_parts, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        sessionId,
        admin.id,
        film.id,
        objectKey,
        uploadId,
        mode,
        input.fileName,
        input.fileLastModified,
        input.mimeType,
        input.fileSize,
        partSize,
        totalParts,
        isoAfterSeconds(UPLOAD_SESSION_TTL_SECONDS),
      )
      .run();
  } catch (error) {
    await storage.abort(objectKey, uploadId);
    throw error;
  }

  const [created] = await findSessionRows(c.env.DB, 'u.id = ?', [sessionId]);
  if (!created) throw storageError('Не удалось создать сессию загрузки.');
  const body: UploadSessionResponse = { session: toSessionInfo(created, []) };
  return json(body, 201);
});

uploadRoutes.post('/:id/parts/sign', async (c) => {
  const session = await loadActiveSession(c.env.DB, c.get('admin').id, c.req.param('id'));
  const input = await readJson(c.req.raw, signPartsSchema);
  const partNumbers = [...new Set(input.partNumbers)];
  if (partNumbers.some((partNumber) => partNumber > session.total_parts)) {
    throw validationFailed(`Номер части должен быть от 1 до ${String(session.total_parts)}.`);
  }
  const storage = getMultipartStorage(c.env, session.mode);
  const parts = await Promise.all(
    partNumbers.map((partNumber) =>
      storage.signPart({
        sessionId: session.id,
        key: session.object_key,
        uploadId: session.multipart_upload_id,
        partNumber,
      }),
    ),
  );
  const body: SignPartsResponse = { parts, expiresInSeconds: PART_URL_TTL_SECONDS };
  return json(body);
});

// Режим binding: тело части идёт потоком через Worker прямо в R2.
uploadRoutes.put('/:id/parts/:partNumber/data', async (c) => {
  const session = await loadActiveSession(c.env.DB, c.get('admin').id, c.req.param('id'));
  const partNumber = parsePartNumber(c.req.param('partNumber'), session);
  const expected = expectedPartSize(session, partNumber);
  const declared = c.req.header('Content-Length');
  if (declared !== undefined && Number(declared) !== expected) {
    throw validationFailed(`Часть ${String(partNumber)} должна быть размером ${String(expected)} байт.`);
  }
  if (!c.req.raw.body) throw badRequest('Тело части не передано.');

  const storage = getMultipartStorage(c.env, session.mode);
  let etag: string;
  try {
    etag = await storage.putPart(
      { sessionId: session.id, key: session.object_key, uploadId: session.multipart_upload_id, partNumber },
      c.req.raw.body,
      expected,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logError(`Часть не записана в хранилище`, error);
    throw validationFailed(
      `Часть ${String(partNumber)} не принята: размер тела не совпал с ожидаемым (${String(expected)} байт) или хранилище отклонило запись.`,
    );
  }
  const part = { partNumber, etag, sizeBytes: expected };
  await upsertPart(c.env.DB, session.id, part);
  const body: PartResponse = { part };
  return json(body);
});

// Режим presign: клиент сам отправил часть в R2 и сообщает её ETag.
uploadRoutes.post('/:id/parts/:partNumber', async (c) => {
  const session = await loadActiveSession(c.env.DB, c.get('admin').id, c.req.param('id'));
  const partNumber = parsePartNumber(c.req.param('partNumber'), session);
  const input = await readJson(c.req.raw, reportPartSchema);
  if (/[\u0000-\u001f\u007f]/.test(input.etag)) throw validationFailed('Некорректный ETag части.');
  if (input.sizeBytes !== expectedPartSize(session, partNumber)) {
    throw validationFailed(
      `Часть ${String(partNumber)} должна быть размером ${String(expectedPartSize(session, partNumber))} байт.`,
    );
  }
  if (session.mode === 'binding') {
    // В этом режиме часть записывает сам Worker; принять можно только уже записанную им часть.
    const stored = (await listPartRows(c.env.DB, session.id)).find((item) => item.partNumber === partNumber);
    if (!stored) throw badRequest('В этом режиме часть отправляется через PUT …/parts/:partNumber/data.');
    const body: PartResponse = { part: stored };
    return json(body);
  }
  const part = { partNumber, etag: input.etag, sizeBytes: input.sizeBytes };
  await upsertPart(c.env.DB, session.id, part);
  const body: PartResponse = { part };
  return json(body);
});

uploadRoutes.post('/:id/complete', async (c) => {
  const session = await loadActiveSession(c.env.DB, c.get('admin').id, c.req.param('id'));
  const input = await readJson(c.req.raw, completeUploadSchema, { allowEmpty: true });
  const storage = getMultipartStorage(c.env, session.mode);

  // Атомарный переход active → completing: второй одновременный запрос получит 409.
  if (!(await transitionState(c.env.DB, session.id, 'active', 'completing'))) {
    throw conflict('Эта загрузка уже завершена или завершается.');
  }

  let parts: StoredPart[];
  try {
    // В режиме presign авторитетен список частей из хранилища, а не то, что сообщил клиент.
    parts =
      (await storage.listParts(session.object_key, session.multipart_upload_id)) ??
      (await listPartRows(c.env.DB, session.id));
  } catch (error) {
    await transitionState(c.env.DB, session.id, 'completing', 'active');
    throw error;
  }
  const problem = findPartsProblem(session, parts);
  if (problem) {
    // Файл ещё не собран и ничего не потеряно: сессия остаётся активной, недостающее можно дозагрузить.
    await transitionState(c.env.DB, session.id, 'completing', 'active');
    throw conflict(`Загрузка не завершена. ${problem}`);
  }

  const videoId = crypto.randomUUID();
  try {
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    await storage.complete(session.object_key, session.multipart_upload_id, ordered);

    const head = await c.env.MEDIA.head(session.object_key);
    if (!head || head.size !== session.expected_size) {
      throw validationFailed('Размер загруженного файла не совпал с исходным. Загрузите файл заново.');
    }
    const probe = await c.env.MEDIA.get(session.object_key, {
      range: { offset: 0, length: Math.min(MP4_PROBE_BYTES, head.size) },
    });
    if (!probe || !looksLikeMp4(new Uint8Array(await probe.arrayBuffer()))) {
      throw validationFailed('Файл не является видео MP4. Загрузите файл в формате MP4 (H.264 + AAC).');
    }

    // Видео получает статус ready: публикация — отдельное явное действие.
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO videos (id, film_id, object_key, original_filename, size_bytes, mime_type,
           duration_seconds, width, height, status)
         VALUES (?, ?, ?, ?, ?, 'video/mp4', ?, ?, ?, 'ready')`,
      ).bind(
        videoId,
        session.film_id,
        session.object_key,
        session.file_name,
        session.expected_size,
        input.durationSeconds ?? null,
        input.width ?? null,
        input.height ?? null,
      ),
      c.env.DB.prepare(
        "UPDATE upload_sessions SET state = 'completed', video_id = ? WHERE id = ? AND state = 'completing'",
      ).bind(videoId, session.id),
      c.env.DB.prepare('DELETE FROM upload_parts WHERE session_id = ?').bind(session.id),
    ]);
  } catch (error) {
    await discardObject(c.env, session);
    if (error instanceof ApiError) throw error;
    logError(`Завершение загрузки не удалось`, error);
    throw storageError('Не удалось завершить загрузку. Файл удалён, загрузите его заново.');
  }

  const body: CompleteUploadResponse = { video: toAdminVideo(await getVideoRow(c.env.DB, videoId)) };
  return json(body, 201);
});

uploadRoutes.delete('/:id', async (c) => {
  const [session] = await findSessionRows(c.env.DB, 'u.id = ? AND u.admin_id = ?', [
    c.req.param('id'),
    c.get('admin').id,
  ]);
  if (!session) throw notFound('Сессия загрузки не найдена.');
  if (session.state === 'completed' || session.state === 'completing') {
    throw conflict('Эта загрузка уже завершена — удалить видео можно в списке версий.');
  }
  if (session.state !== 'aborted') {
    await getMultipartStorage(c.env, session.mode).abort(session.object_key, session.multipart_upload_id);
    await markAborted(c.env.DB, session.id);
  }
  const body: OkResponse = { ok: true };
  return json(body);
});
