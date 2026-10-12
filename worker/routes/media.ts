import { MEDIA_PREFIX } from '../../shared/constants.ts';
import { readSession } from '../auth/session.ts';
import type { AppEnv } from '../env.ts';
import { badRequest, errorResponse, notFound } from '../lib/errors.ts';

const PUBLIC_CACHE = 'public, max-age=31536000, immutable';
const PRIVATE_CACHE = 'private, no-store';
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const MAX_KEY_LENGTH = 512;

// Тип содержимого определяется только расширением ключа: ключи генерирует сервер,
// а метаданным объекта, которые мог задать кто-то ещё, здесь не доверяем.
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

/** Ключ объекта из пути /media/…; null — путь недопустим (защита от path traversal). */
export function parseMediaKey(pathname: string): string | null {
  if (!pathname.startsWith(MEDIA_PREFIX)) return null;
  let key: string;
  try {
    key = decodeURIComponent(pathname.slice(MEDIA_PREFIX.length));
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return null;
  if (!key.startsWith('videos/') && !key.startsWith('images/')) return null;
  if (key.includes('..') || key.includes('\\') || key.includes('//') || key.endsWith('/')) return null;
  // Управляющие символы (в том числе NUL и переводы строк) в ключах не допускаются.
  if (/[\u0000-\u001f\u007f]/.test(key)) return null;
  return key;
}

export type ByteRange = { start: number; end: number };

/**
 * Разбор заголовка Range для объекта известного размера.
 * null — диапазона нет или он записан с ошибкой (отдаём файл целиком);
 * 'unsatisfiable' — диапазон вне файла (ответ 416).
 */
export function parseRange(header: string | null, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText = '', endText = ''] = match;
  if (startText === '' && endText === '') return null;

  if (startText === '') {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix)) return null;
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startText);
  if (!Number.isSafeInteger(start)) return null;
  if (start >= size) return 'unsatisfiable';
  if (endText === '') return { start, end: size - 1 };
  const end = Number(endText);
  if (!Number.isSafeInteger(end) || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const normalize = (value: string): string => value.trim().replace(/^W\//, '');
  return header.split(',').some((candidate) => normalize(candidate) === normalize(etag));
}

interface VideoAccess {
  sizeBytes: number;
  cacheControl: string;
}

/**
 * Видео отдаётся публично, только если его версия активна, фильм опубликован и сайт открыт.
 * Администратору (по cookie сессии) доступен предпросмотр любой версии из базы.
 */
async function resolveVideoAccess(
  env: AppEnv,
  request: Request,
  key: string,
  options: { publicOnly: boolean },
): Promise<VideoAccess | null> {
  const [videoResult, settingResult] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      `SELECT v.status AS status, v.size_bytes AS sizeBytes, f.is_published AS isPublished
         FROM videos v JOIN films f ON f.id = v.film_id WHERE v.object_key = ?`,
    ).bind(key),
    env.DB.prepare("SELECT value FROM site_settings WHERE key = 'siteVisible'"),
  ]);
  const video = videoResult?.results[0];
  if (!video || typeof video['sizeBytes'] !== 'number') return null;

  const siteVisible = settingResult?.results[0]?.['value'] !== 'false';
  if (video['status'] === 'active' && video['isPublished'] === 1 && siteVisible) {
    return { sizeBytes: video['sizeBytes'], cacheControl: PUBLIC_CACHE };
  }
  if (options.publicOnly) return null;
  const admin = await readSession(env.DB, request);
  return admin ? { sizeBytes: video['sizeBytes'], cacheControl: PRIVATE_CACHE } : null;
}

/**
 * Выдача объекта R2 по GET/HEAD /media/<key> с поддержкой Range. Тело передаётся потоком.
 * publicOnly — игнорировать сессию администратора (используется проверкой публичной выдачи).
 */
export async function serveMedia(
  request: Request,
  env: AppEnv,
  options: { publicOnly: boolean } = { publicOnly: false },
): Promise<Response> {
  const key = parseMediaKey(new URL(request.url).pathname);
  if (!key) return errorResponse(badRequest('Недопустимый адрес файла.'));
  const contentType = CONTENT_TYPES[key.slice(key.lastIndexOf('.') + 1).toLowerCase()];
  if (!contentType) return errorResponse(notFound('Файл не найден.'));

  let cacheControl = PUBLIC_CACHE;
  let knownSize: number | undefined;
  if (key.startsWith('videos/')) {
    const access = await resolveVideoAccess(env, request, key, options);
    if (!access) return errorResponse(notFound('Файл не найден.'));
    cacheControl = access.cacheControl;
    knownSize = access.sizeBytes;
  }

  const isHead = request.method === 'HEAD';
  const rangeHeader = isHead ? null : request.headers.get('Range');
  const ifRange = request.headers.get('If-Range');

  // Размер нужен до чтения, чтобы проверить диапазон. Для видео он есть в базе,
  // для остальных случаев спрашиваем у R2 метаданные (без тела).
  let head: R2Object | null = null;
  if (isHead || (rangeHeader !== null && (knownSize === undefined || ifRange !== null))) {
    head = await env.MEDIA.head(key);
    if (!head) return errorResponse(notFound('Файл не найден.'));
    knownSize = head.size;
  }

  let range: ByteRange | null = null;
  if (rangeHeader !== null && knownSize !== undefined) {
    const ifRangeOk = ifRange === null || (head !== null && ifRange.trim() === head.httpEtag);
    const parsed = ifRangeOk ? parseRange(rangeHeader, knownSize) : null;
    if (parsed === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${String(knownSize)}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    range = parsed;
  }

  const headers = new Headers({
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  });
  if (contentType === 'image/svg+xml') headers.set('Content-Security-Policy', SVG_CSP);

  if (isHead && head) {
    headers.set('ETag', head.httpEtag);
    if (etagMatches(request.headers.get('If-None-Match'), head.httpEtag)) {
      return new Response(null, { status: 304, headers });
    }
    headers.set('Content-Length', String(head.size));
    return new Response(null, { status: 200, headers });
  }

  const object = await env.MEDIA.get(
    key,
    range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined,
  );
  if (!object) return errorResponse(notFound('Файл не найден.'));

  headers.set('ETag', object.httpEtag);
  if (etagMatches(request.headers.get('If-None-Match'), object.httpEtag)) {
    await object.body.cancel();
    return new Response(null, { status: 304, headers });
  }

  if (range) {
    headers.set('Content-Range', `bytes ${String(range.start)}-${String(range.end)}/${String(object.size)}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}
