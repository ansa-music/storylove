import type { z } from 'zod';

import { ApiError, badRequest, validationFailed } from './errors.ts';

const MAX_JSON_BYTES = 64 * 1024;

export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoAfterSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function issueMessage(issue: z.core.$ZodIssue): string {
  const field = issue.path.join('.');
  const where = field ? `Поле «${field}»: ` : '';
  switch (issue.code) {
    case 'unrecognized_keys':
      return `Неизвестные поля: ${issue.keys.join(', ')}.`;
    case 'too_big':
      return `${where}значение слишком большое или длинное (максимум ${String(issue.maximum)}).`;
    case 'too_small':
      return `${where}значение слишком маленькое или короткое (минимум ${String(issue.minimum)}).`;
    case 'invalid_type':
      return `${where}неверный тип значения или поле не заполнено.`;
    default:
      return `${where}недопустимое значение.`;
  }
}

export function parseWith<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  throw validationFailed(first ? issueMessage(first) : 'Проверьте заполнение полей.');
}

/** Читает JSON-тело запроса с ограничением размера и проверяет его схемой. */
export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  options: { allowEmpty?: boolean } = {},
): Promise<T> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_JSON_BYTES) {
    throw new ApiError(413, 'payload_too_large', 'Слишком большое тело запроса.');
  }
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) {
    throw new ApiError(413, 'payload_too_large', 'Слишком большое тело запроса.');
  }
  if (text.trim() === '') {
    if (options.allowEmpty) return parseWith(schema, {});
    throw badRequest('Ожидается тело запроса в формате JSON.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw badRequest('Тело запроса — некорректный JSON.');
    throw error;
  }
  return parseWith(schema, parsed);
}
