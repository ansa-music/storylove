// Общие константы для клиента и Worker. Единый источник правды для лимитов и имён.

export const TIER_SLUGS = ['econom', 'basic', 'premium', 'ultima'] as const;
export type TierSlug = (typeof TIER_SLUGS)[number];

export function isTierSlug(value: unknown): value is TierSlug {
  return typeof value === 'string' && (TIER_SLUGS as readonly string[]).includes(value);
}

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** Проектный максимум одного видео. */
export const MAX_VIDEO_BYTES = 5 * GIB;
/** Меньше этого размера файл не может быть мультфильмом — защита от случайного выбора. */
export const MIN_VIDEO_BYTES = 64 * 1024;
/** Размер части multipart. Все части, кроме последней, одинаковые (требование R2). */
export const UPLOAD_PART_BYTES = 16 * MIB;
/** Минимальный размер части в R2/S3 (кроме последней). */
export const MIN_PART_BYTES = 5 * MIB;
/** Сколько частей грузим одновременно. */
export const UPLOAD_CONCURRENCY = 4;
/** Срок жизни ссылки на загрузку одной части, секунды. */
export const PART_URL_TTL_SECONDS = 15 * 60;
/** Сколько ссылок можно запросить одним вызовом. */
export const MAX_SIGN_BATCH = 16;
/** Срок жизни сессии загрузки. По истечении незавершённая загрузка прерывается. */
export const UPLOAD_SESSION_TTL_SECONDS = 3 * 24 * 60 * 60;

export const VIDEO_MIME_TYPES = ['video/mp4'] as const;
export const VIDEO_EXTENSIONS = ['.mp4', '.m4v'] as const;

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];
export const IMAGE_EXTENSION_BY_MIME: Readonly<Record<ImageMimeType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};
/** Максимум для изображения после оптимизации в браузере. */
export const MAX_IMAGE_BYTES = 8 * MIB;
/** SVG разрешён только для логотипа и favicon и отдаётся с жёстким CSP. */
export const SVG_MIME_TYPE = 'image/svg+xml';
export const MAX_SVG_BYTES = 256 * 1024;

export const FILM_IMAGE_KINDS = ['poster', 'car'] as const;
export type FilmImageKind = (typeof FILM_IMAGE_KINDS)[number];

// photoHim / photoHer — два исходных фото («он» и «она») над блоком форматов.
export const SITE_IMAGE_KINDS = ['hero', 'og', 'logo', 'favicon', 'photoHim', 'photoHer'] as const;
export type SiteImageKind = (typeof SITE_IMAGE_KINDS)[number];

/** Бесплатный объём R2 по умолчанию, ГБ. Настраивается в админке. */
export const DEFAULT_STORAGE_BUDGET_GB = 10;

export const SESSION_COOKIE = '__Host-sl_session';
/** В локальной разработке по http префикс __Host- недоступен. */
export const SESSION_COOKIE_DEV = 'sl_session';
export const CSRF_HEADER = 'X-CSRF-Token';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/** Префикс публичной выдачи объектов R2 через Worker. */
export const MEDIA_PREFIX = '/media/';

export function mediaUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return MEDIA_PREFIX + key.split('/').map(encodeURIComponent).join('/');
}
