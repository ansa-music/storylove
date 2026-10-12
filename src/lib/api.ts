// Клиент API. Один способ ходить на сервер для публичной части и админки.

import type { ApiErrorBody, ApiErrorCode } from '@shared/api';
import { CSRF_HEADER } from '@shared/constants';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, code: ApiErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

let csrfToken: string | null = null;

/** Токен приходит из /api/auth/session, login и setup; хранится только в памяти вкладки. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}
export function getCsrfToken(): string | null {
  return csrfToken;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Объект уйдёт как JSON; Blob/ArrayBuffer — как есть (нужен contentType). */
  body?: unknown;
  contentType?: string;
  signal?: AbortSignal;
}

/**
 * Запрос к API. Возвращает разобранный JSON, бросает ApiError с понятным текстом.
 * Тип T — контракт из shared/api.ts; сервер отвечает за его соблюдение.
 */
export async function api<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers = new Headers({ Accept: 'application/json' });
  let body: BodyInit | undefined;

  if (options.body instanceof Blob || options.body instanceof ArrayBuffer) {
    body = options.body;
    if (options.contentType) headers.set('Content-Type', options.contentType);
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers.set('Content-Type', 'application/json');
  }
  if (method !== 'GET' && csrfToken) headers.set(CSRF_HEADER, csrfToken);

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'internal_error', 'Нет связи с сервером. Проверьте интернет и повторите.');
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (isErrorBody(data)) {
      throw new ApiError(response.status, data.error.code, data.error.message, data.error.retryAfterSeconds);
    }
    throw new ApiError(response.status, 'internal_error', `Сервер ответил ошибкой ${response.status}.`);
  }
  return data as T;
}

/** Текст ошибки для показа человеку. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Неизвестная ошибка.';
}
