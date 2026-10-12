// Оптимизация изображения в браузере перед отправкой: уменьшить и перекодировать в WebP.

import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, MAX_SVG_BYTES, SVG_MIME_TYPE } from '@shared/constants';

export const WEBP_QUALITY = 0.86;

/** Размеры после вписывания в квадрат maxSide по длинной стороне. Маленькие картинки не увеличиваются. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide || longest <= 0) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface ImageRules {
  /** Разрешённые типы растровых изображений. */
  mimeTypes: readonly string[];
  allowSvg: boolean;
}

export const RASTER_RULES: ImageRules = { mimeTypes: IMAGE_MIME_TYPES, allowSvg: false };
export const BRAND_RULES: ImageRules = { mimeTypes: ['image/png', 'image/webp'], allowSvg: true };

const MIME_NAMES: Readonly<Record<string, string>> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/avif': 'AVIF',
  [SVG_MIME_TYPE]: 'SVG',
};

export function describeFormats(rules: ImageRules): string {
  const types = rules.allowSvg ? [...rules.mimeTypes, SVG_MIME_TYPE] : rules.mimeTypes;
  return types.map((type) => MIME_NAMES[type] ?? type).join(', ');
}

export function acceptAttribute(rules: ImageRules): string {
  return (rules.allowSvg ? [...rules.mimeTypes, SVG_MIME_TYPE] : rules.mimeTypes).join(',');
}

/** Причина отказа или null. Проверяется исходный файл до оптимизации. */
export function checkImageFile(file: { type: string; size: number }, rules: ImageRules): string | null {
  if (file.type === SVG_MIME_TYPE) {
    if (!rules.allowSvg) return `SVG здесь не подходит. Нужен файл: ${describeFormats(rules)}.`;
    if (file.size > MAX_SVG_BYTES) return `SVG слишком большой: максимум ${Math.round(MAX_SVG_BYTES / 1024)} КБ.`;
    return null;
  }
  if (!rules.mimeTypes.includes(file.type)) return `Этот формат не подходит. Нужен файл: ${describeFormats(rules)}.`;
  return null;
}

export interface PreparedImage {
  blob: Blob;
  contentType: string;
  /** true — изображение уменьшено или перекодировано; false — уйдёт исходный файл. */
  optimized: boolean;
  originalBytes: number;
  width: number | null;
  height: number | null;
}

function encodeWebp(bitmap: ImageBitmap, width: number, height: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
}

/**
 * Готовит изображение к отправке. maxSide: null — отправить как есть (SVG, favicon, соц-превью).
 * Если браузер не умеет WebP или результат не меньше исходника — уходит оригинал.
 * Бросает Error с понятным текстом, если итог больше лимита.
 */
export async function prepareImage(file: File, maxSide: number | null): Promise<PreparedImage> {
  const original: PreparedImage = {
    blob: file,
    contentType: file.type,
    optimized: false,
    originalBytes: file.size,
    width: null,
    height: null,
  };
  let result = original;

  if (maxSide !== null && file.type !== SVG_MIME_TYPE && typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      // Браузер не смог декодировать файл (например, AVIF в старой версии) — отправим оригинал.
      bitmap = null;
    }
    if (bitmap) {
      try {
        const size = fitWithin(bitmap.width, bitmap.height, maxSide);
        const blob = await encodeWebp(bitmap, size.width, size.height);
        // toBlob молча возвращает PNG, если WebP не поддерживается.
        if (blob && blob.type === 'image/webp' && blob.size < file.size) {
          result = { ...original, blob, contentType: 'image/webp', optimized: true, ...size };
        } else {
          result = { ...original, width: bitmap.width, height: bitmap.height };
        }
      } finally {
        bitmap.close();
      }
    }
  }

  const limit = file.type === SVG_MIME_TYPE ? MAX_SVG_BYTES : MAX_IMAGE_BYTES;
  if (result.blob.size > limit) {
    const megabytes = (limit / 1024 ** 2).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
    throw new Error(`Изображение слишком большое даже после сжатия. Максимум — ${megabytes} МБ.`);
  }
  return result;
}
