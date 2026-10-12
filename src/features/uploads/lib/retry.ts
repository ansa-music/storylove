// Решение о повторе неудачной части. Без DOM.

export const MAX_PART_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

export type PartFailure =
  /** Обрыв связи, зависшее соединение. */
  | { kind: 'network' }
  /** Ответ на PUT части. viaApi: false — отвечало хранилище, true — сам сайт. */
  | { kind: 'http'; status: number; viaApi: boolean; message?: string }
  /** Ответ API сайта (подпись ссылок, сообщение о принятой части). */
  | { kind: 'api'; status: number; message: string }
  /** Хранилище приняло часть, но браузеру не виден заголовок ETag. */
  | { kind: 'missing_etag' }
  | { kind: 'unknown'; message: string };

export type RetryDecision =
  | { action: 'retry'; delayMs: number; /** Запросить новую ссылку перед повтором. */ resign: boolean }
  | { action: 'fail'; message: string; unauthorized: boolean };

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Пауза перед повтором: 1, 2, 4, 8… секунд (не больше 30) с джиттером 50–100%,
 * чтобы четыре потока не повторяли запросы одновременно.
 * attempt — номер только что неудавшейся попытки (с 1), random — число из [0, 1).
 */
export function backoffDelay(attempt: number, random: number): number {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential * (0.5 + 0.5 * Math.min(Math.max(random, 0), 1)));
}

function fail(message: string, unauthorized = false): RetryDecision {
  return { action: 'fail', message, unauthorized };
}

/**
 * Что делать после неудачи: повторяем сеть и 5xx/408/429, обычные 4xx — нет.
 * Исключение — 403 от хранилища: это истёкшая подпись, берём новую ссылку и повторяем.
 */
export function decideRetry(
  failure: PartFailure,
  attempt: number,
  random: number,
  maxAttempts: number = MAX_PART_ATTEMPTS,
): RetryDecision {
  if (failure.kind === 'missing_etag') {
    return fail(
      'Хранилище приняло часть файла, но не показало браузеру её подпись: в CORS бакета не открыт заголовок ETag. Добавьте ETag в ExposeHeaders настроек CORS бакета R2 и повторите.',
    );
  }
  if (failure.kind === 'unknown') return fail(failure.message);

  const unauthorized = (failure.kind === 'api' || (failure.kind === 'http' && failure.viaApi)) && failure.status === 401;
  if (unauthorized) return fail('Сессия истекла. Войдите заново — загрузку можно будет продолжить.', true);

  const expiredSignature = failure.kind === 'http' && !failure.viaApi && failure.status === 403;
  const retryable =
    failure.kind === 'network' || expiredSignature || isRetryableStatus(failure.status);

  if (!retryable) {
    if (failure.kind === 'api') return fail(failure.message);
    if (failure.kind === 'http') {
      return fail(
        failure.message ??
          `${failure.viaApi ? 'Сервер' : 'Хранилище'} отклонил${failure.viaApi ? '' : 'о'} часть файла (код ${failure.status}).`,
      );
    }
    return fail('Не удалось отправить часть файла.');
  }

  if (attempt >= maxAttempts) {
    if (failure.kind === 'network') {
      return fail(`Связь обрывается: часть файла не ушла за ${maxAttempts} попыток. Проверьте интернет и нажмите «Повторить».`);
    }
    if (expiredSignature) {
      return fail(
        `Хранилище отклоняет ссылку для загрузки (код 403) ${maxAttempts} раз подряд. Проверьте ключи доступа R2 и время на компьютере.`,
      );
    }
    return fail(`Сервер не принял часть файла за ${maxAttempts} попыток (код ${failure.status}). Попробуйте позже.`);
  }

  // Новая ссылка нужна сразу, ждать незачем.
  if (expiredSignature) return { action: 'retry', delayMs: 0, resign: true };
  return { action: 'retry', delayMs: backoffDelay(attempt, random), resign: false };
}
