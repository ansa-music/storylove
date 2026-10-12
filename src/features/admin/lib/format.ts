// Общие форматтеры админки: размеры, даты, длительность, скорость.

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

function decimal(value: number, digits: number): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** 1536 → «1,5 КБ»; 3 221 225 472 → «3 ГБ». Единицы двоичные, как считает хранилище. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < KIB) return `${Math.round(bytes)} Б`;
  if (bytes < MIB) return `${decimal(bytes / KIB, 1)} КБ`;
  if (bytes < GIB) return `${decimal(bytes / MIB, 1)} МБ`;
  return `${decimal(bytes / GIB, 2)} ГБ`;
}

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Дата и время по-русски: «12.10.2026, 14:05». Пустое или непонятное значение — «—». */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  // SQLite отдаёт «2026-10-12 14:05:00» в UTC без указания пояса — дополняем до ISO.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormat.format(date);
}

/** Длительность видео: 75 → «1:15», 3725 → «1:02:05». */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Оставшееся время словами: «меньше минуты», «около 12 мин», «около 1 ч 20 мин». */
export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return 'считаем…';
  if (seconds < 60) return 'меньше минуты';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `около ${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `около ${h} ч` : `около ${h} ч ${m} мин`;
}

/** Скорость: «4,2 МБ/с». Ноль и неизвестное — «—». */
export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—';
  return `${formatBytes(bytesPerSecond)}/с`;
}

/** Доля 0–1+ в процентах: 0.756 → «76%». */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio < 0) return '0%';
  return `${Math.round(ratio * 100)}%`;
}

export function formatResolution(width: number | null | undefined, height: number | null | undefined): string {
  return width && height ? `${width}×${height}` : '—';
}

/** «1 объект», «3 объекта», «5 объектов». */
export function plural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 === 1) return one;
  if (n1 >= 2 && n1 <= 4) return few;
  return many;
}
