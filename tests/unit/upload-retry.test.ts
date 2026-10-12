import { describe, expect, it } from 'vitest';

import { backoffDelay, decideRetry, MAX_PART_ATTEMPTS } from '@/features/uploads/lib/retry';

describe('пауза перед повтором', () => {
  it('растёт экспоненциально и ограничена сверху', () => {
    expect(backoffDelay(1, 1)).toBe(1000);
    expect(backoffDelay(2, 1)).toBe(2000);
    expect(backoffDelay(3, 1)).toBe(4000);
    expect(backoffDelay(20, 1)).toBe(30_000);
  });

  it('джиттер держит паузу в пределах 50–100%', () => {
    expect(backoffDelay(3, 0)).toBe(2000);
    expect(backoffDelay(3, 0.5)).toBe(3000);
    expect(backoffDelay(3, 5)).toBe(4000);
  });
});

describe('решение о повторе', () => {
  it('повторяет обрыв сети', () => {
    expect(decideRetry({ kind: 'network' }, 1, 1)).toEqual({ action: 'retry', delayMs: 1000, resign: false });
  });

  it.each([500, 502, 503, 408, 429])('повторяет ответ %i от хранилища и от сервера', (status) => {
    expect(decideRetry({ kind: 'http', status, viaApi: false }, 2, 1).action).toBe('retry');
    expect(decideRetry({ kind: 'http', status, viaApi: true }, 2, 1).action).toBe('retry');
    expect(decideRetry({ kind: 'api', status, message: 'x' }, 2, 1).action).toBe('retry');
  });

  it('403 от хранилища — истёкшая подпись: новая ссылка без ожидания', () => {
    expect(decideRetry({ kind: 'http', status: 403, viaApi: false }, 1, 0.7)).toEqual({
      action: 'retry',
      delayMs: 0,
      resign: true,
    });
  });

  it('403 от самого сайта не повторяется', () => {
    const decision = decideRetry({ kind: 'http', status: 403, viaApi: true, message: 'Нет доступа.' }, 1, 0);
    expect(decision).toEqual({ action: 'fail', message: 'Нет доступа.', unauthorized: false });
  });

  it.each([400, 404, 409, 413])('не повторяет ответ %i', (status) => {
    expect(decideRetry({ kind: 'http', status, viaApi: false }, 1, 0).action).toBe('fail');
    expect(decideRetry({ kind: 'api', status, message: 'Отказано.' }, 1, 0)).toEqual({
      action: 'fail',
      message: 'Отказано.',
      unauthorized: false,
    });
  });

  it('401 от сайта помечается как истёкшая сессия', () => {
    const fromApi = decideRetry({ kind: 'api', status: 401, message: 'x' }, 1, 0);
    const fromPut = decideRetry({ kind: 'http', status: 401, viaApi: true }, 1, 0);
    expect(fromApi).toMatchObject({ action: 'fail', unauthorized: true });
    expect(fromPut).toMatchObject({ action: 'fail', unauthorized: true });
  });

  it('сдаётся после последней попытки, даже если ошибка повторяемая', () => {
    expect(decideRetry({ kind: 'network' }, MAX_PART_ATTEMPTS - 1, 0).action).toBe('retry');
    expect(decideRetry({ kind: 'network' }, MAX_PART_ATTEMPTS, 0).action).toBe('fail');
    expect(decideRetry({ kind: 'http', status: 403, viaApi: false }, MAX_PART_ATTEMPTS, 0).action).toBe(
      'fail',
    );
    expect(decideRetry({ kind: 'http', status: 503, viaApi: false }, MAX_PART_ATTEMPTS, 0).action).toBe(
      'fail',
    );
  });

  it('скрытый ETag объясняется как настройка CORS и не повторяется', () => {
    const decision = decideRetry({ kind: 'missing_etag' }, 1, 0);
    expect(decision.action).toBe('fail');
    if (decision.action === 'fail')
      expect(decision.message).toContain('в CORS бакета не открыт заголовок ETag');
  });
});
