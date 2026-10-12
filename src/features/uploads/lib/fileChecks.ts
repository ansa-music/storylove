// Проверки видеофайла до начала загрузки.

import { MAX_VIDEO_BYTES, MIN_VIDEO_BYTES, VIDEO_EXTENSIONS, VIDEO_MIME_TYPES } from '@shared/constants';

import { blobReader, scanMp4, type Mp4Structure } from './mp4';

export interface VideoFileInfo {
  name: string;
  size: number;
  type: string;
}

/** Браузеры называют .m4v по-разному, а на Windows тип иногда пустой — это не повод отказывать. */
const TOLERATED_MIME_TYPES: readonly string[] = [...VIDEO_MIME_TYPES, 'video/x-m4v', ''];

function gigabytes(bytes: number): string {
  return (bytes / 1024 ** 3).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

/** Быстрые проверки по имени, типу и размеру. Возвращает список причин отказа (пустой — всё в порядке). */
export function checkVideoFile(file: VideoFileInfo): string[] {
  const errors: string[] = [];
  const name = file.name.toLowerCase();
  const extensionOk = VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!extensionOk || !TOLERATED_MIME_TYPES.includes(file.type)) {
    errors.push(`Нужен файл MP4 (${VIDEO_EXTENSIONS.join(', ')}). Выбран файл другого формата.`);
  }
  if (file.size > MAX_VIDEO_BYTES) {
    errors.push(
      `Файл слишком большой: ${gigabytes(file.size)} ГБ. Максимум — ${gigabytes(MAX_VIDEO_BYTES)} ГБ.`,
    );
  } else if (file.size < MIN_VIDEO_BYTES) {
    errors.push('Файл слишком маленький для мультфильма — возможно, выбран не тот файл.');
  }
  return errors;
}

export interface VideoMetadata {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

export interface VideoInspection {
  errors: string[];
  warnings: string[];
  metadata: VideoMetadata | null;
  structure: Mp4Structure | null;
}

/** Выводы из структуры MP4: ошибка, если это не MP4, предупреждение, если moov в конце. */
export function assessStructure(structure: Mp4Structure): { errors: string[]; warnings: string[] } {
  if (!structure.hasFtyp) {
    return { errors: ['Содержимое файла не похоже на MP4: в начале нет блока ftyp.'], warnings: [] };
  }
  if (structure.fastStart === 'no') {
    return {
      errors: [],
      warnings: [
        'Файл не оптимизирован для потокового просмотра: посетителю придётся ждать, пока он скачается. Подготовьте его скриптом npm run video:prepare и загрузите результат.',
      ],
    };
  }
  if (structure.fastStart === 'unknown') {
    return {
      errors: [],
      warnings: [
        'Не удалось проверить, оптимизирован ли файл для потокового просмотра. Надёжнее подготовить его скриптом npm run video:prepare.',
      ],
    };
  }
  return { errors: [], warnings: [] };
}

const METADATA_TIMEOUT_MS = 20_000;

/**
 * Длительность и размер кадра через скрытый <video>. null — браузер не смог прочитать файл
 * (обычно неподдерживаемый кодек).
 */
export function probeVideoMetadata(file: Blob): Promise<VideoMetadata | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let settled = false;

    const finish = (result: VideoMetadata | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = window.setTimeout(() => finish(null), METADATA_TIMEOUT_MS);

    video.preload = 'metadata';
    video.muted = true;
    video.addEventListener('loadedmetadata', () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      finish({
        durationSeconds: duration,
        width: video.videoWidth > 0 ? video.videoWidth : null,
        height: video.videoHeight > 0 ? video.videoHeight : null,
      });
    });
    video.addEventListener('error', () => finish(null));
    video.src = url;
  });
}

/** Все проверки перед загрузкой. Ошибки блокируют старт, предупреждения — нет. */
export async function inspectVideoFile(file: File): Promise<VideoInspection> {
  const errors = checkVideoFile(file);
  if (errors.length > 0) return { errors, warnings: [], metadata: null, structure: null };

  let structure: Mp4Structure;
  try {
    structure = await scanMp4(blobReader(file), file.size);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'неизвестная ошибка';
    return {
      errors: [
        `Не удалось прочитать файл: ${reason}. Проверьте, что он доступен и не открыт в другой программе.`,
      ],
      warnings: [],
      metadata: null,
      structure: null,
    };
  }
  const assessed = assessStructure(structure);
  if (assessed.errors.length > 0) return { errors: assessed.errors, warnings: [], metadata: null, structure };

  const warnings = [...assessed.warnings];
  const metadata = await probeVideoMetadata(file);
  if (!metadata || metadata.width === null || metadata.height === null) {
    warnings.push(
      'Браузер не смог открыть видео. Возможно, кодек не подходит: для сайта нужен H.264 (видео) и AAC (звук). Файл можно загрузить, но посетители могут его не увидеть.',
    );
  }
  return { errors: [], warnings, metadata, structure };
}
