import { Hono } from 'hono';

import type { AdminFilmResponse, OkResponse, VideoCheckResponse } from '../../shared/api.ts';
import { mediaUrl } from '../../shared/constants.ts';
import { getVideoRow, loadAdminFilm, type VideoRow } from '../database/films.ts';
import { loadSettings } from '../database/settings.ts';
import type { AppBindings, AppEnv } from '../env.ts';
import { conflict, storageError } from '../lib/errors.ts';
import { json, nowIso, readJson } from '../lib/http.ts';
import { confirmSchema } from '../lib/schemas.ts';
import { serveMedia } from './media.ts';

const CHECK_RANGE_BYTES = 1024;

async function filmResponse(env: AppEnv, video: VideoRow): Promise<Response> {
  const body: AdminFilmResponse = { film: await loadAdminFilm(env.DB, video.film_slug) };
  return json(body);
}

export const videoRoutes = new Hono<AppBindings>();

videoRoutes.post('/:id/publish', async (c) => {
  const video = await getVideoRow(c.env.DB, c.req.param('id'));
  if (video.status === 'active') return filmResponse(c.env, video);

  const head = await c.env.MEDIA.head(video.object_key);
  if (!head || head.size !== video.size_bytes) {
    throw storageError('Файл этой версии отсутствует в хранилище или повреждён. Загрузите видео заново.');
  }

  const now = nowIso();
  let results: D1Result[];
  try {
    // batch выполняется одной транзакцией: либо меняется всё, либо ничего.
    results = await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE videos SET status = 'archived' WHERE film_id = ? AND status = 'active' AND id <> ?",
      ).bind(video.film_id, video.id),
      c.env.DB.prepare(
        "UPDATE videos SET status = 'active', published_at = ? WHERE id = ? AND status IN ('ready', 'archived')",
      ).bind(now, video.id),
      c.env.DB.prepare(
        `UPDATE films SET active_video_id = (SELECT id FROM videos WHERE film_id = ? AND status = 'active'),
                          updated_at = ?
          WHERE id = ?`,
      ).bind(video.film_id, now, video.film_id),
    ]);
  } catch (error) {
    // Уникальный индекс idx_videos_one_active: одновременно публиковалась другая версия.
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      throw conflict('Одновременно публиковалась другая версия. Обновите страницу и повторите.');
    }
    throw error;
  }
  if (results[1]?.meta.changes !== 1) {
    throw conflict('Версия уже изменена другим действием. Обновите страницу.');
  }
  return filmResponse(c.env, video);
});

videoRoutes.get('/:id/check', async (c) => {
  const video = await getVideoRow(c.env.DB, c.req.param('id'));
  const checks: VideoCheckResponse['checks'] = [];
  const add = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };

  const head = await c.env.MEDIA.head(video.object_key);
  add('Файл в хранилище', head !== null, head ? 'Объект найден.' : 'Объекта нет в хранилище.');
  add(
    'Размер файла',
    head?.size === video.size_bytes,
    head
      ? `В хранилище ${String(head.size)} байт, ожидалось ${String(video.size_bytes)}.`
      : 'Проверить нельзя: файла нет.',
  );

  add(
    'Версия опубликована',
    video.status === 'active',
    video.status === 'active'
      ? 'Это активная версия.'
      : 'Версия не опубликована — посетителям она недоступна.',
  );
  const film = await loadAdminFilm(c.env.DB, video.film_slug);
  add(
    'Уровень опубликован',
    film.isPublished,
    film.isPublished ? 'Уровень показывается на сайте.' : 'Уровень снят с публикации.',
  );
  const { settings } = await loadSettings(c.env.DB);
  add(
    'Сайт открыт',
    settings.siteVisible,
    settings.siteVisible ? 'Сайт открыт для посетителей.' : 'Сайт в режиме «Скоро открытие».',
  );

  // Настоящий запрос к собственной выдаче /media — так же, как его сделает браузер посетителя (без сессии).
  const last = Math.min(CHECK_RANGE_BYTES, video.size_bytes) - 1;
  const mediaRequest = new Request(new URL(mediaUrl(video.object_key) ?? '/', c.req.url), {
    headers: { Range: `bytes=0-${String(last)}` },
  });
  const mediaResponse = await serveMedia(mediaRequest, c.env, { publicOnly: true });
  const received = (await mediaResponse.arrayBuffer()).byteLength;
  const expectedRange = `bytes 0-${String(last)}/${String(video.size_bytes)}`;
  const rangeOk =
    mediaResponse.status === 206 &&
    mediaResponse.headers.get('Content-Range') === expectedRange &&
    received === last + 1;
  add(
    'Публичная выдача по частям (Range)',
    rangeOk,
    rangeOk
      ? `Ответ 206, ${expectedRange}.`
      : `Ответ ${String(mediaResponse.status)}: посетитель не сможет смотреть и перематывать видео.`,
  );

  const body: VideoCheckResponse = { ok: checks.every((check) => check.ok), checks };
  return json(body);
});

videoRoutes.delete('/:id', async (c) => {
  await readJson(c.req.raw, confirmSchema);
  const video = await getVideoRow(c.env.DB, c.req.param('id'));
  if (video.status === 'active') {
    throw conflict('Нельзя удалить опубликованную версию. Сначала опубликуйте другую.');
  }
  // Сначала строка (условно — вдруг версию только что опубликовали), потом объект.
  // RETURNING, а не meta.changes: счётчик изменений включает каскадные правки связанных строк.
  const deleted = await c.env.DB.prepare(
    "DELETE FROM videos WHERE id = ? AND status <> 'active' RETURNING id",
  )
    .bind(video.id)
    .first<{ id: string }>();
  if (!deleted) {
    throw conflict('Версия только что была опубликована. Обновите страницу.');
  }
  await c.env.MEDIA.delete(video.object_key);
  const body: OkResponse = { ok: true };
  return json(body);
});
