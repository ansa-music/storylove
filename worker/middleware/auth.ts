import type { MiddlewareHandler } from 'hono';

import { CSRF_HEADER } from '../../shared/constants.ts';
import { readSession } from '../auth/session.ts';
import { configuredOrigin, type AppBindings, type AppEnv } from '../env.ts';
import { timingSafeEqualStrings } from '../lib/crypto.ts';
import { ApiError, unauthorized } from '../lib/errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Origin запроса должен совпадать с адресом самого сайта либо с PUBLIC_ORIGIN. */
export function isSameOrigin(request: Request, env: AppEnv, options: { required: boolean }): boolean {
  const origin = request.headers.get('Origin');
  if (origin === null) return !options.required;
  return origin === new URL(request.url).origin || origin === configuredOrigin(env);
}

/** Сессия обязательна на каждом маршруте админки, включая GET. */
export const requireAdmin: MiddlewareHandler<AppBindings> = async (c, next) => {
  const admin = await readSession(c.env.DB, c.req.raw);
  if (!admin) throw unauthorized();
  c.set('admin', admin);
  await next();
};

/** Для изменяющих запросов: проверка Origin и заголовка X-CSRF-Token. Ставится после requireAdmin. */
export const requireCsrf: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const token = c.req.header(CSRF_HEADER) ?? '';
    const originOk = isSameOrigin(c.req.raw, c.env, { required: true });
    const tokenOk = await timingSafeEqualStrings(token, c.get('admin').csrfToken);
    if (!originOk || !tokenOk) {
      throw new ApiError(
        403,
        'csrf_failed',
        'Запрос отклонён проверкой безопасности. Обновите страницу и повторите.',
      );
    }
  }
  await next();
};

export const noStore: MiddlewareHandler<AppBindings> = async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
};
