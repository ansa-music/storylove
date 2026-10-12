// Расчёт прогресса, скорости и оставшегося времени. Без DOM.

export const SPEED_WINDOW_MS = 10_000;

/** Скорость как скользящее среднее: сколько байт ушло за последние ~10 секунд. */
export class SpeedMeter {
  private samples: { at: number; bytes: number }[] = [];
  private readonly windowMs: number;

  constructor(windowMs: number = SPEED_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /** Учесть bytes, отправленных к моменту nowMs. */
  add(nowMs: number, bytes: number): void {
    if (bytes <= 0) return;
    this.samples.push({ at: nowMs, bytes });
    this.trim(nowMs);
  }

  /** Байт в секунду. Пока данных меньше секунды — 0, чтобы не показывать случайные числа. */
  rate(nowMs: number): number {
    this.trim(nowMs);
    const first = this.samples[0];
    if (!first) return 0;
    const elapsed = nowMs - first.at;
    if (elapsed < 1000) return 0;
    let total = 0;
    // Первая отметка — начало отсчёта: её байты ушли до измеряемого промежутка.
    for (let i = 1; i < this.samples.length; i++) total += this.samples[i]?.bytes ?? 0;
    return (total * 1000) / elapsed;
  }

  reset(): void {
    this.samples = [];
  }

  private trim(nowMs: number): void {
    const from = nowMs - this.windowMs;
    let drop = 0;
    while (drop < this.samples.length && (this.samples[drop]?.at ?? 0) < from) drop++;
    if (drop > 0) this.samples = this.samples.slice(drop);
  }
}

/** Сколько секунд осталось. null — оценить нельзя (скорость неизвестна). */
export function etaSeconds(remainingBytes: number, bytesPerSecond: number): number | null {
  if (remainingBytes <= 0) return 0;
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  return Math.ceil(remainingBytes / bytesPerSecond);
}

export interface ProgressNumbers {
  /** Подтверждено сервером + уже отправлено по текущим частям. */
  uploadedBytes: number;
  /** 0–100 с одним знаком после запятой. */
  percent: number;
}

/**
 * Честный прогресс: подтверждённые сервером байты плюс байты текущих частей.
 * 100% здесь значит только «все байты ушли», а не «файл принят».
 */
export function computeProgress(
  confirmedBytes: number,
  inFlightLoaded: readonly number[],
  fileSize: number,
): ProgressNumbers {
  if (fileSize <= 0) return { uploadedBytes: 0, percent: 0 };
  const inFlight = inFlightLoaded.reduce((sum, loaded) => sum + Math.max(0, loaded), 0);
  const uploadedBytes = Math.min(fileSize, Math.max(0, confirmedBytes) + inFlight);
  const percent = Math.floor((uploadedBytes / fileSize) * 1000) / 10;
  return { uploadedBytes, percent };
}
