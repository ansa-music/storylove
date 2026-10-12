import { Hono } from 'hono';

import type {
  AbortStaleResponse,
  DashboardResponse,
  StorageCleanupResponse,
  StorageResponse,
} from '../../shared/api.ts';
import { loadAdminFilms } from '../database/films.ts';
import { findSessionRows, markAborted } from '../database/uploads.ts';
import { uploadMode, type AppBindings } from '../env.ts';
import { conflict, storageError } from '../lib/errors.ts';
import { logError } from '../lib/log.ts';
import { json, nowIso, readJson } from '../lib/http.ts';
import { cleanupSchema } from '../lib/schemas.ts';
import { STALE_SESSIONS_SQL, buildInventory, buildWarnings } from '../storage/inventory.ts';
import { getMultipartStorage } from '../storage/multipart.ts';

export const storageRoutes = new Hono<AppBindings>();

storageRoutes.get('/', async (c) => {
  const inventory = await buildInventory(c.env);
  const body: StorageResponse = { summary: inventory.summary, objects: inventory.objects };
  return json(body);
});

storageRoutes.post('/cleanup', async (c) => {
  const input = await readJson(c.req.raw, cleanupSchema);
  const keys = [...new Set(input.keys)];
  const inventory = await buildInventory(c.env);
  const byKey = new Map(inventory.objects.map((object) => [object.key, object]));

  // Сначала проверяется весь список: если хоть один объект удалять нельзя, не удаляется ничего.
  const targets = keys.map((key) => {
    const object = byKey.get(key);
    if (!object) throw conflict('В списке есть объект, которого нет в хранилище. Обновите страницу.');
    if (object.status !== 'orphan' && object.status !== 'archived') {
      throw conflict(
        'В списке есть используемый объект (опубликованный, готовый к публикации или загружаемый). Ничего не удалено.',
      );
    }
    return object;
  });

  const deletedKeys: string[] = [];
  let freedBytes = 0;
  for (const object of targets) {
    if (object.status === 'archived') {
      // Условное удаление строки: если версию успели опубликовать снова, объект не трогаем.
      // RETURNING, а не meta.changes: счётчик изменений включает каскадные правки связанных строк.
      const removed = await c.env.DB.prepare(
        "DELETE FROM videos WHERE object_key = ? AND status = 'archived' RETURNING id",
      )
        .bind(object.key)
        .first<{ id: string }>();
      if (!removed) continue;
    }
    await c.env.MEDIA.delete(object.key);
    deletedKeys.push(object.key);
    freedBytes += object.sizeBytes;
  }
  const body: StorageCleanupResponse = { deletedKeys, freedBytes };
  return json(body);
});

storageRoutes.post('/abort-stale', async (c) => {
  const sessions = await findSessionRows(c.env.DB, STALE_SESSIONS_SQL, [nowIso()]);
  let abortedSessions = 0;
  let failures = 0;
  for (const session of sessions) {
    try {
      await getMultipartStorage(c.env, session.mode).abort(session.object_key, session.multipart_upload_id);
      if (session.state === 'completing') {
        // «Зависшее» завершение: файл мог успеть собраться, но в базу не попал.
        await c.env.MEDIA.delete(session.object_key);
      }
      await markAborted(c.env.DB, session.id);
      abortedSessions += 1;
    } catch (error) {
      failures += 1;
      logError(`Не удалось прервать просроченную загрузку`, error);
    }
  }
  if (failures > 0 && abortedSessions === 0) {
    throw storageError('Не удалось прервать просроченные загрузки. Проверьте настройки хранилища.');
  }
  const body: AbortStaleResponse = { abortedSessions };
  return json(body);
});

export const dashboardRoutes = new Hono<AppBindings>();

dashboardRoutes.get('/', async (c) => {
  const [inventory, films] = await Promise.all([buildInventory(c.env), loadAdminFilms(c.env.DB)]);
  const body: DashboardResponse = {
    films,
    storage: inventory.summary,
    warnings: buildWarnings(c.env, inventory),
    uploadMode: uploadMode(c.env),
  };
  return json(body);
});
