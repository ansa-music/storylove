import type { ApiErrorBody, ApiErrorCode } from '../../shared/api.ts';

/** Ошибка, которую можно показать клиенту: статус, код из контракта и русский текст. */
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

export const badRequest = (message: string): ApiError => new ApiError(400, 'bad_request', message);
export const validationFailed = (message: string): ApiError =>
  new ApiError(400, 'validation_failed', message);
export const unauthorized = (message = 'Требуется вход в админку.'): ApiError =>
  new ApiError(401, 'unauthorized', message);
export const notFound = (message = 'Не найдено.'): ApiError => new ApiError(404, 'not_found', message);
export const conflict = (message: string): ApiError => new ApiError(409, 'conflict', message);
export const storageError = (message: string): ApiError => new ApiError(500, 'storage_error', message);

export function errorResponse(error: ApiError): Response {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
    },
  };
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (error.retryAfterSeconds !== undefined) {
    headers.set('Retry-After', String(error.retryAfterSeconds));
  }
  return new Response(JSON.stringify(body), { status: error.status, headers });
}

/** Короткое описание ошибки для журнала: без стека и без данных запроса. */
export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'неизвестная ошибка';
}
