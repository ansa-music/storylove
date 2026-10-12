import type { AdminFilm, AdminVideo, PublicFilm, VideoStatus } from '../../shared/api.ts';
import { mediaUrl, type FilmImageKind, type TierSlug } from '../../shared/constants.ts';
import { notFound } from '../lib/errors.ts';
import { nowIso } from '../lib/http.ts';

export interface FilmRow {
  id: number;
  slug: TierSlug;
  tier_order: number;
  title: string;
  short_description: string;
  long_description: string;
  compare_text: string;
  button_label: string;
  poster_key: string | null;
  car_image_key: string | null;
  active_video_id: string | null;
  is_published: number;
  updated_at: string;
}

export interface VideoRow {
  id: string;
  film_id: number;
  film_slug: TierSlug;
  object_key: string;
  original_filename: string;
  size_bytes: number;
  mime_type: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  status: VideoStatus;
  created_at: string;
  published_at: string | null;
}

const VIDEO_SELECT = `SELECT v.id, v.film_id, f.slug AS film_slug, v.object_key, v.original_filename,
  v.size_bytes, v.mime_type, v.duration_seconds, v.width, v.height, v.status, v.created_at, v.published_at
  FROM videos v JOIN films f ON f.id = v.film_id`;

export async function listFilmRows(db: D1Database): Promise<FilmRow[]> {
  const { results } = await db.prepare('SELECT * FROM films ORDER BY tier_order').all<FilmRow>();
  return results;
}

export async function getFilmRow(db: D1Database, slug: TierSlug): Promise<FilmRow> {
  const row = await db.prepare('SELECT * FROM films WHERE slug = ?').bind(slug).first<FilmRow>();
  if (!row) throw notFound('Фильм не найден.');
  return row;
}

export async function listVideoRows(db: D1Database): Promise<VideoRow[]> {
  const { results } = await db
    .prepare(`${VIDEO_SELECT} ORDER BY v.created_at DESC, v.rowid DESC`)
    .all<VideoRow>();
  return results;
}

export async function getVideoRow(db: D1Database, id: string): Promise<VideoRow> {
  const row = await db.prepare(`${VIDEO_SELECT} WHERE v.id = ?`).bind(id).first<VideoRow>();
  if (!row) throw notFound('Видео не найдено.');
  return row;
}

export function toAdminVideo(row: VideoRow): AdminVideo {
  return {
    id: row.id,
    filmSlug: row.film_slug,
    objectKey: row.object_key,
    url: mediaUrl(row.object_key) ?? '',
    originalFilename: row.original_filename,
    sizeBytes: row.size_bytes,
    mimeType: row.mime_type,
    durationSeconds: row.duration_seconds,
    width: row.width,
    height: row.height,
    status: row.status,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

function toAdminFilm(film: FilmRow, videoRows: VideoRow[]): AdminFilm {
  const videos = videoRows.filter((video) => video.film_id === film.id).map(toAdminVideo);
  return {
    slug: film.slug,
    tierOrder: film.tier_order,
    title: film.title,
    tagline: film.short_description,
    description: film.long_description,
    compareText: film.compare_text,
    buttonLabel: film.button_label,
    posterUrl: mediaUrl(film.poster_key),
    carImageUrl: mediaUrl(film.car_image_key),
    isPublished: film.is_published === 1,
    updatedAt: film.updated_at,
    activeVideo: videos.find((video) => video.status === 'active') ?? null,
    videos,
  };
}

export async function loadAdminFilms(db: D1Database): Promise<AdminFilm[]> {
  const [films, videos] = await Promise.all([listFilmRows(db), listVideoRows(db)]);
  return films.map((film) => toAdminFilm(film, videos));
}

export async function loadAdminFilm(db: D1Database, slug: TierSlug): Promise<AdminFilm> {
  const film = (await loadAdminFilms(db)).find((item) => item.slug === slug);
  if (!film) throw notFound('Фильм не найден.');
  return film;
}

/** Публичное представление: видео отдаётся, только если сайт открыт, фильм опубликован и есть активная версия. */
export function toPublicFilm(film: FilmRow, videos: VideoRow[], siteVisible: boolean): PublicFilm {
  const active =
    siteVisible && film.is_published === 1
      ? videos.find((video) => video.film_id === film.id && video.status === 'active')
      : undefined;
  return {
    slug: film.slug,
    tierOrder: film.tier_order,
    title: film.title,
    tagline: film.short_description,
    description: film.long_description,
    compareText: film.compare_text,
    buttonLabel: film.button_label,
    posterUrl: mediaUrl(film.poster_key),
    carImageUrl: mediaUrl(film.car_image_key),
    video: active
      ? {
          url: mediaUrl(active.object_key) ?? '',
          mimeType: active.mime_type,
          sizeBytes: active.size_bytes,
          durationSeconds: active.duration_seconds,
          width: active.width,
          height: active.height,
          version: `${active.id}-${String(Date.parse(active.published_at ?? active.created_at))}`,
        }
      : null,
  };
}

const FILM_TEXT_COLUMNS = [
  ['title', 'title'],
  ['tagline', 'short_description'],
  ['description', 'long_description'],
  ['compareText', 'compare_text'],
  ['buttonLabel', 'button_label'],
] as const;

export interface FilmPatch {
  title?: string | undefined;
  tagline?: string | undefined;
  description?: string | undefined;
  compareText?: string | undefined;
  buttonLabel?: string | undefined;
  isPublished?: boolean | undefined;
}

export async function updateFilm(db: D1Database, slug: TierSlug, patch: FilmPatch): Promise<void> {
  const assignments: string[] = [];
  const values: (string | number)[] = [];
  for (const [field, column] of FILM_TEXT_COLUMNS) {
    const value = patch[field];
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(value);
  }
  if (patch.isPublished !== undefined) {
    assignments.push('is_published = ?');
    values.push(patch.isPublished ? 1 : 0);
  }
  if (assignments.length === 0) return;
  await db
    .prepare(`UPDATE films SET ${assignments.join(', ')}, updated_at = ? WHERE slug = ?`)
    .bind(...values, nowIso(), slug)
    .run();
}

const IMAGE_COLUMNS: Readonly<Record<FilmImageKind, 'poster_key' | 'car_image_key'>> = {
  poster: 'poster_key',
  car: 'car_image_key',
};

export function filmImageKey(film: FilmRow, kind: FilmImageKind): string | null {
  return film[IMAGE_COLUMNS[kind]];
}

export async function setFilmImageKey(
  db: D1Database,
  slug: TierSlug,
  kind: FilmImageKind,
  key: string | null,
): Promise<void> {
  await db
    .prepare(`UPDATE films SET ${IMAGE_COLUMNS[kind]} = ?, updated_at = ? WHERE slug = ?`)
    .bind(key, nowIso(), slug)
    .run();
}
