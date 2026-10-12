import { describeError } from './errors.ts';

/**
 * Единственная точка записи в журнал Worker (виден в Cloudflare Observability).
 * Пишется только описание места и имя/текст ошибки — без стека, тел запросов и секретов.
 */
export function logError(context: string, error: unknown): void {
  // eslint-disable-next-line no-console -- серверный журнал: другого канала у Worker нет
  console.error(`${context}: ${describeError(error)}`);
}
