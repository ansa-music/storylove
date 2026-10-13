// Контракт API между клиентом (src/) и Worker (worker/).
// Все ответы — JSON. Ошибка: HTTP-статус 4xx/5xx и тело ApiErrorBody.
// Мутации админки требуют cookie-сессию и заголовок X-CSRF-Token.

import type { FilmImageKind, SiteImageKind, TierSlug } from './constants.ts';

// ───────────────────────── Ошибки ─────────────────────────

export type ApiErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'csrf_failed'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'setup_closed'
  | 'storage_error'
  | 'internal_error';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    /** Понятный текст по-русски, который можно показать администратору. */
    message: string;
    /** Для rate_limited: через сколько секунд можно повторить. */
    retryAfterSeconds?: number;
  };
}

// ───────────────────────── Настройки сайта ─────────────────────────

/** Редактируемые тексты и параметры. Хранятся в site_settings (key → JSON-значение). */
export interface SiteSettings {
  studioName: string;
  logoTagline: string;
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  heroPrimaryCta: string;
  heroSecondaryCta: string;
  aboutEyebrow: string;
  aboutTitle: string;
  aboutText: string;
  /** Строка рядом с двумя фото («он» и «она») над блоком форматов. Пустая — фото и строка скрыты. */
  photosText: string;
  /** Подписи под двумя фото. */
  photoHimLabel: string;
  photoHerLabel: string;
  tiersEyebrow: string;
  tiersTitle: string;
  ultimaEyebrow: string;
  ultimaTitle: string;
  ultimaDescription: string;
  compareTitle: string;
  compareIntro: string;
  finalTitle: string;
  finalText: string;
  finalCta: string;
  footerText: string;
  footerNote: string;
  metaTitle: string;
  metaDescription: string;
  /** false — публичный сайт показывает экран «Скоро открытие». */
  siteVisible: boolean;
  /** Бюджет хранилища в ГБ для предупреждений в админке. */
  storageBudgetGb: number;
}

export type SiteSettingKey = keyof SiteSettings;

/** Изображения сайта. null — используется встроенное изображение из сборки. */
export type SiteImages = Record<SiteImageKind, string | null>;

// ───────────────────────── Публичное API ─────────────────────────

export interface PublicVideo {
  /** Путь вида /media/videos/<slug>/<uuid>.mp4 — поддерживает HTTP Range. */
  url: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  /** Меняется при каждой публикации; ключ сохранения позиции просмотра. */
  version: string;
}

export interface PublicFilm {
  slug: TierSlug;
  /** Порядок 1–4. */
  tierOrder: number;
  title: string;
  /** Короткая фраза уровня («Простое начало вашей истории»). */
  tagline: string;
  /** Описание на странице просмотра. */
  description: string;
  /** Нейтральное описание для секции сравнения. */
  compareText: string;
  buttonLabel: string;
  posterUrl: string | null;
  carImageUrl: string | null;
  /** null — видео нет или уровень снят с публикации: показываем «Мультфильм скоро появится». */
  video: PublicVideo | null;
}

/** GET /api/public/site */
export interface PublicSiteResponse {
  settings: Omit<SiteSettings, 'storageBudgetGb'>;
  images: SiteImages;
  films: PublicFilm[];
}

// ───────────────────────── Авторизация ─────────────────────────

/** GET /api/auth/session */
export interface SessionResponse {
  authenticated: boolean;
  email: string | null;
  csrfToken: string | null;
  /** true — администраторов ещё нет, доступна первичная настройка по SETUP_TOKEN. */
  setupRequired: boolean;
}

/** POST /api/auth/login */
export interface LoginRequest {
  email: string;
  password: string;
}
/** Ответ login и setup. */
export interface LoginResponse {
  email: string;
  csrfToken: string;
}

/** POST /api/auth/setup — работает только пока таблица admins пуста. */
export interface SetupRequest {
  setupToken: string;
  email: string;
  password: string;
}

/** POST /api/auth/logout → { ok: true } */
export interface OkResponse {
  ok: true;
}

/** POST /api/admin/account/password */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

// ───────────────────────── Админка: фильмы ─────────────────────────

export type VideoStatus =
  | 'ready' // загружено и проверено, не опубликовано
  | 'active' // опубликовано сейчас
  | 'archived'; // предыдущая версия, хранится до ручного удаления

export interface AdminVideo {
  id: string;
  filmSlug: TierSlug;
  objectKey: string;
  url: string;
  originalFilename: string;
  sizeBytes: number;
  mimeType: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  status: VideoStatus;
  createdAt: string;
  publishedAt: string | null;
}

export interface AdminFilm {
  slug: TierSlug;
  tierOrder: number;
  title: string;
  tagline: string;
  description: string;
  compareText: string;
  buttonLabel: string;
  posterUrl: string | null;
  carImageUrl: string | null;
  isPublished: boolean;
  updatedAt: string;
  activeVideo: AdminVideo | null;
  /** Все версии, новые сверху (включая активную). */
  videos: AdminVideo[];
}

/** GET /api/admin/films → { films } ; GET /api/admin/films/:slug → { film } */
export interface AdminFilmsResponse {
  films: AdminFilm[];
}
export interface AdminFilmResponse {
  film: AdminFilm;
}

/** PATCH /api/admin/films/:slug — частичное обновление. */
export interface UpdateFilmRequest {
  title?: string;
  tagline?: string;
  description?: string;
  compareText?: string;
  buttonLabel?: string;
  isPublished?: boolean;
}

/**
 * PUT /api/admin/films/:slug/image/:kind — тело запроса: сам файл изображения,
 * заголовок Content-Type из IMAGE_MIME_TYPES. Ответ: AdminFilmResponse.
 * DELETE /api/admin/films/:slug/image/:kind — вернуть встроенное изображение.
 */
export type FilmImageRoute = `/api/admin/films/${TierSlug}/image/${FilmImageKind}`;

// ───────────────────────── Админка: настройки ─────────────────────────

/** GET /api/admin/settings ; PATCH /api/admin/settings (тело: Partial<SiteSettings>) */
export interface AdminSettingsResponse {
  settings: SiteSettings;
  images: SiteImages;
}

/**
 * PUT /api/admin/settings/image/:kind — тело: файл (logo и favicon допускают image/svg+xml).
 * DELETE /api/admin/settings/image/:kind. Ответ: AdminSettingsResponse.
 */
export type SiteImageRoute = `/api/admin/settings/image/${SiteImageKind}`;

// ───────────────────────── Админка: загрузка видео ─────────────────────────

export type UploadMode = 'presign' | 'binding';
export type UploadState = 'active' | 'completing' | 'completed' | 'aborted' | 'expired';

export interface UploadedPart {
  partNumber: number;
  etag: string;
  sizeBytes: number;
}

export interface UploadSessionInfo {
  id: string;
  filmSlug: TierSlug;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  mimeType: string;
  partSize: number;
  totalParts: number;
  state: UploadState;
  mode: UploadMode;
  /** Уже принятые части — по ним клиент возобновляет загрузку. */
  uploadedParts: UploadedPart[];
  createdAt: string;
  expiresAt: string;
}

/** POST /api/admin/uploads → { session } */
export interface CreateUploadRequest {
  slug: TierSlug;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** File.lastModified — вместе с именем и размером опознаёт тот же файл при возобновлении. */
  fileLastModified: number;
}
export interface UploadSessionResponse {
  session: UploadSessionInfo;
}

/** GET /api/admin/uploads?slug=… → незавершённые сессии текущего администратора. */
export interface UploadSessionsResponse {
  sessions: UploadSessionInfo[];
}

/** POST /api/admin/uploads/:id/parts/sign */
export interface SignPartsRequest {
  partNumbers: number[];
}
export interface SignedPart {
  partNumber: number;
  /** PUT сюда тело части. presign — адрес R2, binding — адрес этого же сайта. */
  url: string;
  /** В режиме binding клиент обязан добавить X-CSRF-Token и credentials: 'include'. */
  viaApi: boolean;
}
export interface SignPartsResponse {
  parts: SignedPart[];
  expiresInSeconds: number;
}

/**
 * POST /api/admin/uploads/:id/parts/:partNumber — сообщить ETag принятой части (режим presign).
 * В режиме binding часть записывает сам Worker при PUT …/parts/:partNumber/data и возвращает PartResponse.
 */
export interface ReportPartRequest {
  etag: string;
  sizeBytes: number;
}
export interface PartResponse {
  part: UploadedPart;
}

/** POST /api/admin/uploads/:id/complete */
export interface CompleteUploadRequest {
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
}
/** Видео получает статус ready. Публикация — отдельным явным действием. */
export interface CompleteUploadResponse {
  video: AdminVideo;
}

/** DELETE /api/admin/uploads/:id → OkResponse (прервать и очистить части). */

// ───────────────────────── Админка: версии видео ─────────────────────────

/** POST /api/admin/videos/:id/publish → AdminFilmResponse. Прежняя активная версия становится archived. */

/** GET /api/admin/videos/:id/check — проверка публичной выдачи опубликованного файла. */
export interface VideoCheckResponse {
  ok: boolean;
  /** Что именно проверено, по пунктам. */
  checks: { name: string; ok: boolean; detail: string }[];
}

/** DELETE /api/admin/videos/:id — тело { confirm: true }. Активную версию удалить нельзя (conflict). */
export interface DeleteVideoRequest {
  confirm: true;
}

// ───────────────────────── Админка: хранилище и дашборд ─────────────────────────

export type StorageObjectKind = 'video' | 'image' | 'other';
export type StorageObjectStatus =
  | 'active' // используется опубликованным сайтом
  | 'ready' // загруженное, но не опубликованное видео
  | 'archived' // прежняя версия видео
  | 'uploading' // объект незавершённой загрузки
  | 'orphan'; // не упоминается в базе — можно безопасно удалить

export interface StorageObject {
  key: string;
  sizeBytes: number;
  uploadedAt: string;
  kind: StorageObjectKind;
  status: StorageObjectStatus;
  filmSlug: TierSlug | null;
}

export interface StorageSummary {
  budgetBytes: number;
  totalBytes: number;
  activeVideoBytes: number;
  readyVideoBytes: number;
  archivedVideoBytes: number;
  imageBytes: number;
  orphanBytes: number;
  objectCount: number;
  /** Незавершённые сессии загрузки (их части занимают место до abort). */
  incompleteUploads: UploadSessionInfo[];
  /** totalBytes / budgetBytes, 0–1+. */
  usedRatio: number;
}

/** GET /api/admin/storage */
export interface StorageResponse {
  summary: StorageSummary;
  objects: StorageObject[];
}

/**
 * POST /api/admin/storage/cleanup — удалить перечисленные объекты.
 * Разрешены только статусы orphan и archived; иначе conflict и ничего не удаляется.
 */
export interface StorageCleanupRequest {
  keys: string[];
  confirm: true;
}
export interface StorageCleanupResponse {
  deletedKeys: string[];
  freedBytes: number;
}

/** POST /api/admin/storage/abort-stale — прервать просроченные незавершённые загрузки. */
export interface AbortStaleResponse {
  abortedSessions: number;
}

export type WarningLevel = 'info' | 'warning' | 'error';
export interface DashboardWarning {
  level: WarningLevel;
  message: string;
}

/** GET /api/admin/dashboard */
export interface DashboardResponse {
  films: AdminFilm[];
  storage: StorageSummary;
  warnings: DashboardWarning[];
  uploadMode: UploadMode;
}
