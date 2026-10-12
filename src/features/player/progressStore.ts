// Позиция просмотра в localStorage. В приватном режиме и при запрете хранилища
// доступ бросает исключение — тогда запоминание тихо отключается до перезагрузки страницы.

import { parseStoredProgress, serializeProgress } from './playerMath';

let storageDisabled = false;

function withStorage<T>(action: (storage: Storage) => T, fallback: T): T {
  if (storageDisabled) return fallback;
  try {
    return action(window.localStorage);
  } catch {
    // SecurityError / QuotaExceededError: хранилище недоступно, дальше не пытаемся.
    storageDisabled = true;
    return fallback;
  }
}

export function readProgress(key: string): number | null {
  return withStorage((storage) => parseStoredProgress(storage.getItem(key)), null);
}

/** true — позиция записана. */
export function writeProgress(key: string, position: number): boolean {
  return withStorage((storage) => {
    storage.setItem(key, serializeProgress(position, Date.now()));
    return true;
  }, false);
}

export function clearProgress(key: string): void {
  withStorage((storage) => {
    storage.removeItem(key);
    return true;
  }, false);
}
