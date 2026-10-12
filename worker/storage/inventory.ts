import type {
  DashboardWarning,
  StorageObject,
  StorageObjectKind,
  StorageObjectStatus,
  StorageSummary,
} from '../../shared/api.ts';
import { isTierSlug, type TierSlug } from '../../shared/constants.ts';
import { listFilmRows, listVideoRows, type FilmRow, type VideoRow } from '../database/films.ts';
import { loadSettings } from '../database/settings.ts';
import { findSessionRows, toSessionInfos } from '../database/uploads.ts';
import { hasR2Credentials, uploadMode, type AppEnv } from '../env.ts';
import { nowIso } from '../lib/http.ts';

const GIB = 1024 * 1024 * 1024;
// Только что записанный объект, на который база ещё не ссылается, — это идущая операция
// (замена изображения, завершение загрузки), а не «сирота»: удалять его рано.
const FRESH_OBJECT_MS = 10 * 60 * 1000;

/** Условие для сессий, которые занимают место и ждут прерывания: просроченные и «зависшие». */
export const STALE_SESSIONS_SQL =
  "((u.state IN ('active', 'completing') AND u.expires_at <= ?) OR u.state = 'expired')";

export interface Inventory {
  objects: StorageObject[];
  summary: StorageSummary;
  films: FilmRow[];
  videos: VideoRow[];
  staleUploads: number;
}

async function listAllObjects(bucket: R2Bucket): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page: R2Objects = await bucket.list(
      cursor === undefined ? { limit: 1000 } : { limit: 1000, cursor },
    );
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return objects;
}

function slugFromKey(key: string): TierSlug | null {
  const segment = key.split('/')[1];
  return isTierSlug(segment) ? segment : null;
}

/** Обходит R2 с пагинацией и сверяет каждый объект с базой. */
export async function buildInventory(env: AppEnv): Promise<Inventory> {
  const now = nowIso();
  const [r2Objects, films, videos, { settings, imageKeys }, openSessions, staleSessions] = await Promise.all([
    listAllObjects(env.MEDIA),
    listFilmRows(env.DB),
    listVideoRows(env.DB),
    loadSettings(env.DB),
    findSessionRows(env.DB, "u.state IN ('active', 'completing', 'expired')", []),
    findSessionRows(env.DB, STALE_SESSIONS_SQL, [now]),
  ]);

  const videoByKey = new Map(videos.map((video) => [video.object_key, video]));
  const uploadingKeys = new Map(
    openSessions
      .filter((session) => session.state !== 'expired')
      .map((session) => [session.object_key, session.film_slug]),
  );
  const usedImageKeys = new Set<string>();
  for (const film of films) {
    if (film.poster_key) usedImageKeys.add(film.poster_key);
    if (film.car_image_key) usedImageKeys.add(film.car_image_key);
  }
  for (const key of Object.values(imageKeys)) {
    if (key) usedImageKeys.add(key);
  }

  const objects = r2Objects.map((object): StorageObject => {
    const isFresh = Date.now() - object.uploaded.getTime() < FRESH_OBJECT_MS;
    let kind: StorageObjectKind = 'other';
    let status: StorageObjectStatus = isFresh ? 'uploading' : 'orphan';
    let filmSlug: TierSlug | null = null;

    if (object.key.startsWith('videos/')) {
      kind = 'video';
      const video = videoByKey.get(object.key);
      const uploadingSlug = uploadingKeys.get(object.key);
      filmSlug = video?.film_slug ?? uploadingSlug ?? slugFromKey(object.key);
      if (video) status = video.status;
      else if (uploadingSlug) status = 'uploading';
    } else if (object.key.startsWith('images/')) {
      kind = 'image';
      if (usedImageKeys.has(object.key)) status = 'active';
    }
    return {
      key: object.key,
      sizeBytes: object.size,
      uploadedAt: object.uploaded.toISOString(),
      kind,
      status,
      filmSlug,
    };
  });

  const sum = (predicate: (object: StorageObject) => boolean): number =>
    objects.filter(predicate).reduce((total, object) => total + object.sizeBytes, 0);
  const totalBytes = sum(() => true);
  const budgetBytes = settings.storageBudgetGb * GIB;

  const summary: StorageSummary = {
    budgetBytes,
    totalBytes,
    activeVideoBytes: sum((object) => object.kind === 'video' && object.status === 'active'),
    readyVideoBytes: sum((object) => object.kind === 'video' && object.status === 'ready'),
    archivedVideoBytes: sum((object) => object.kind === 'video' && object.status === 'archived'),
    imageBytes: sum((object) => object.kind === 'image'),
    orphanBytes: sum((object) => object.status === 'orphan'),
    objectCount: objects.length,
    incompleteUploads: await toSessionInfos(
      env.DB,
      openSessions.filter((session) => session.state !== 'completing'),
    ),
    usedRatio: budgetBytes > 0 ? totalBytes / budgetBytes : 0,
  };

  return { objects, summary, films, videos, staleUploads: staleSessions.length };
}

/** Предупреждения для дашборда: то, что администратору стоит увидеть и исправить. */
export function buildWarnings(env: AppEnv, inventory: Inventory): DashboardWarning[] {
  const warnings: DashboardWarning[] = [];
  const { summary, films, videos, objects } = inventory;

  if (!env.SESSION_PEPPER) {
    warnings.push({
      level: 'error',
      message: 'Не задан секрет SESSION_PEPPER: вход в админку и смена пароля работать не будут.',
    });
  }
  if (uploadMode(env) === 'presign' && !hasR2Credentials(env)) {
    warnings.push({
      level: 'error',
      message:
        'Не настроены ключи R2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY): загрузка видео недоступна.',
    });
  }

  const percent = Math.round(summary.usedRatio * 100);
  if (summary.usedRatio >= 1) {
    warnings.push({
      level: 'error',
      message: `Хранилище заполнено на ${String(percent)}% от заданного бюджета. Удалите прежние версии видео или увеличьте бюджет.`,
    });
  } else if (summary.usedRatio >= 0.8) {
    warnings.push({
      level: 'warning',
      message: `Хранилище заполнено на ${String(percent)}% от заданного бюджета.`,
    });
  }

  const existingKeys = new Set(objects.map((object) => object.key));
  for (const film of films) {
    const active = videos.find((video) => video.film_id === film.id && video.status === 'active');
    if (active && !existingKeys.has(active.object_key)) {
      warnings.push({
        level: 'error',
        message: `Опубликованное видео уровня «${film.title}» отсутствует в хранилище. Загрузите и опубликуйте его заново.`,
      });
    }
    if (!active && film.is_published === 1) {
      warnings.push({
        level: 'info',
        message: `У опубликованного уровня «${film.title}» нет видео: посетители видят «Мультфильм скоро появится».`,
      });
    }
  }

  if (inventory.staleUploads > 0) {
    warnings.push({
      level: 'warning',
      message: `Есть просроченные незавершённые загрузки (${String(inventory.staleUploads)}). Прервите их в разделе «Хранилище», чтобы освободить место.`,
    });
  }
  return warnings;
}
