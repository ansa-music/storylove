// Чистые функции плеера: без DOM и без React, покрыты тестами в tests/unit/player-math.test.ts.

/** Позицию меньше этого значения не запоминаем и не предлагаем. */
export const RESUME_MIN_SECONDS = 5;
/** Если до конца осталось меньше — считаем, что фильм досмотрен. */
export const RESUME_TAIL_SECONDS = 5;
/** Как часто пишем позицию в хранилище во время просмотра. */
export const SAVE_INTERVAL_SECONDS = 5;
/** Шаг перемотки стрелками. */
export const SEEK_STEP_SECONDS = 5;
export const VOLUME_STEP = 0.1;

export interface BufferedRange {
  start: number;
  end: number;
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 75 → «1:15», 3675 → «1:01:15». Некорректное значение → «0:00». */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const ss = String(secs).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

/** Текст для скринридера: «1 час 2 минуты 5 секунд» в краткой форме. */
export function describeTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0 с';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ч`);
  if (hours > 0 || minutes > 0) parts.push(`${minutes} мин`);
  parts.push(`${secs} с`);
  return parts.join(' ');
}

/** Доля 0…1; при неизвестной длительности — 0. */
export function ratio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return clamp(value / total, 0, 1);
}

/**
 * Докуда загружено видео вперёд от текущей позиции.
 * Берём конец того диапазона, в котором находится позиция; если такого нет — саму позицию.
 */
export function bufferedEndAt(ranges: readonly BufferedRange[], currentTime: number): number {
  const tolerance = 0.25;
  let end = currentTime;
  for (const range of ranges) {
    if (range.start <= currentTime + tolerance && range.end >= currentTime && range.end > end) {
      end = range.end;
    }
  }
  return end;
}

/** Новая позиция при перемотке на delta секунд. */
export function seekTarget(currentTime: number, delta: number, duration: number): number {
  const max = Number.isFinite(duration) && duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
  return clamp(currentTime + delta, 0, max);
}

/** Ключ хранилища: новая версия видео — новая позиция. */
export function progressKey(slug: string, version: string): string {
  return `storylove:progress:${slug}:${version}`;
}

/**
 * Позиция, которую стоит запомнить / предложить, или null.
 * Не возвращаем начало (< 5 с) и самый конец (осталось < 5 с).
 */
export function resumablePosition(position: number, duration: number | null): number | null {
  if (!Number.isFinite(position) || position < RESUME_MIN_SECONDS) return null;
  if (duration !== null && Number.isFinite(duration) && duration > 0) {
    if (duration - position < RESUME_TAIL_SECONDS) return null;
  }
  return position;
}

/** Пора ли записать позицию: прошло не меньше интервала в любую сторону. */
export function shouldSaveProgress(currentTime: number, lastSavedTime: number | null): boolean {
  if (lastSavedTime === null) return currentTime >= RESUME_MIN_SECONDS;
  return Math.abs(currentTime - lastSavedTime) >= SAVE_INTERVAL_SECONDS;
}

export function serializeProgress(position: number, savedAtMs: number): string {
  return JSON.stringify({ t: Math.round(position * 10) / 10, at: savedAtMs });
}

/** Разбор сохранённой записи. Повреждённая или чужая запись → null. */
export function parseStoredProgress(raw: string | null): number | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || !('t' in data)) return null;
  const position = data.t;
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) return null;
  return position;
}

/** Понятный текст по MediaError.code (1–4). */
export function mediaErrorMessage(code: number | null | undefined): string {
  switch (code) {
    case 1:
      return 'Загрузка видео была прервана. Нажмите «Повторить», чтобы продолжить.';
    case 2:
      return 'Видео не загрузилось из-за проблем с сетью. Проверьте интернет и повторите.';
    case 3:
      return 'Не удалось воспроизвести видео: файл повреждён или устройство не поддерживает его формат.';
    case 4:
      return 'Видео недоступно или его формат не поддерживается этим браузером.';
    default:
      return 'Не удалось воспроизвести видео. Попробуйте ещё раз.';
  }
}
