import {
  IMAGE_EXTENSION_BY_MIME,
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_SVG_BYTES,
  SVG_MIME_TYPE,
  type ImageMimeType,
} from '../../shared/constants.ts';
import type { AppEnv } from '../env.ts';
import { ApiError, validationFailed } from '../lib/errors.ts';
import { logError } from '../lib/log.ts';

function tooLarge(limit: number): ApiError {
  return new ApiError(
    413,
    'payload_too_large',
    `Файл слишком большой: максимум ${String(Math.round(limit / 1024))} КБ.`,
  );
}

/** Читает тело запроса, обрывая чтение, как только превышен лимит. */
async function readLimited(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && Number(declared) > limit) throw tooLarge(limit);
  if (!request.body) throw validationFailed('Файл изображения не передан.');

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw tooLarge(limit);
    }
    chunks.push(value);
  }
  if (total === 0) throw validationFailed('Файл изображения пустой.');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Проверка сигнатуры файла (magic bytes): заявленному Content-Type верить нельзя. */
export function matchesImageSignature(bytes: Uint8Array, mime: ImageMimeType): boolean {
  switch (mime) {
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
    case 'image/avif': {
      if (ascii(bytes, 4, 8) !== 'ftyp') return false;
      const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
      const end = Math.min(boxSize, bytes.byteLength, 256);
      // major brand (8..12), затем после minor version — список совместимых брендов.
      for (let offset = 8; offset + 4 <= end; offset += offset === 8 ? 8 : 4) {
        const brand = ascii(bytes, offset, offset + 4);
        if (brand === 'avif' || brand === 'avis') return true;
      }
      return false;
    }
  }
}

const SVG_FORBIDDEN: readonly RegExp[] = [
  /<\s*script/i,
  /<\s*foreignObject/i,
  /<\s*(iframe|embed|object)[\s>/]/i,
  /href\s*=\s*["']?\s*(https?:|\/\/)/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /<!ENTITY/i,
  /<!DOCTYPE[^>]*\[/i,
];

/** SVG принимается только без активного содержимого; отдаётся он вдобавок с CSP sandbox. */
export function isSafeSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
  if (!/<svg[\s>]/i.test(text)) return false;
  return !SVG_FORBIDDEN.some((pattern) => pattern.test(text));
}

function isImageMime(value: string): value is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Проверяет и сохраняет изображение из тела запроса. Возвращает ключ объекта images/<kind>/<uuid>.<ext>.
 * Ключ генерирует только сервер.
 */
export async function storeImage(
  env: AppEnv,
  request: Request,
  kind: string,
  options: { allowSvg: boolean },
): Promise<string> {
  const mime = (request.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const isSvg = mime === SVG_MIME_TYPE;
  if (!isImageMime(mime) && !(isSvg && options.allowSvg)) {
    throw new ApiError(
      415,
      'unsupported_media_type',
      options.allowSvg
        ? 'Подходят изображения JPEG, PNG, WebP, AVIF или SVG.'
        : 'Подходят изображения JPEG, PNG, WebP или AVIF.',
    );
  }

  const bytes = await readLimited(request, isSvg ? MAX_SVG_BYTES : MAX_IMAGE_BYTES);
  let extension: string;
  if (isImageMime(mime)) {
    if (!matchesImageSignature(bytes, mime)) {
      throw validationFailed('Содержимое файла не соответствует заявленному типу изображения.');
    }
    extension = IMAGE_EXTENSION_BY_MIME[mime];
  } else {
    if (!isSafeSvg(bytes)) {
      throw validationFailed('SVG отклонён: в нём есть скрипты, обработчики событий или внешнее содержимое.');
    }
    extension = 'svg';
  }

  const key = `images/${kind}/${crypto.randomUUID()}.${extension}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
  return key;
}

/** Удаление заменённого изображения: неудача не должна ломать уже выполненную замену. */
export async function deleteImageQuietly(env: AppEnv, key: string | null): Promise<void> {
  if (!key) return;
  try {
    await env.MEDIA.delete(key);
  } catch (error) {
    // Объект останется «сиротой» и будет виден в разделе «Хранилище».
    logError(`Не удалось удалить старое изображение`, error);
  }
}
