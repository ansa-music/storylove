import { Hono } from 'hono';

import type { LoginResponse, OkResponse, SessionResponse } from '../../shared/api.ts';
import { CSRF_HEADER } from '../../shared/constants.ts';
import { assertPasswordPolicy, burnPasswordCheck, hashPassword, verifyPassword } from '../auth/password.ts';
import {
  MAX_FAILURES_PER_EMAIL,
  MAX_FAILURES_PER_IP,
  assertNotRateLimited,
  clearFailures,
  clientIp,
  recordFailure,
} from '../auth/rate-limit.ts';
import { clearSessionCookie, createSession, destroySession, readSession } from '../auth/session.ts';
import type { AppBindings, AppEnv } from '../env.ts';
import { timingSafeEqualStrings } from '../lib/crypto.ts';
import { ApiError, unauthorized } from '../lib/errors.ts';
import { json, nowIso, readJson } from '../lib/http.ts';
import { changePasswordSchema, loginSchema, setupSchema } from '../lib/schemas.ts';
import { isSameOrigin } from '../middleware/auth.ts';

function requirePepper(env: AppEnv): string {
  if (!env.SESSION_PEPPER) {
    throw new ApiError(
      500,
      'internal_error',
      'Сервер не настроен: не задан секрет SESSION_PEPPER. Вход в админку невозможен.',
    );
  }
  return env.SESSION_PEPPER;
}

function assertOrigin(request: Request, env: AppEnv): void {
  if (!isSameOrigin(request, env, { required: false })) {
    throw new ApiError(403, 'forbidden', 'Запрос с другого сайта отклонён.');
  }
}

async function adminsExist(db: D1Database): Promise<boolean> {
  const row = await db.prepare('SELECT COUNT(*) AS total FROM admins').first<{ total: number }>();
  return (row?.total ?? 0) > 0;
}

export const authRoutes = new Hono<AppBindings>();

authRoutes.get('/session', async (c) => {
  const [admin, hasAdmins] = await Promise.all([readSession(c.env.DB, c.req.raw), adminsExist(c.env.DB)]);
  const body: SessionResponse = {
    authenticated: admin !== null,
    email: admin?.email ?? null,
    csrfToken: admin?.csrfToken ?? null,
    setupRequired: !hasAdmins,
  };
  return json(body);
});

authRoutes.post('/login', async (c) => {
  const pepper = requirePepper(c.env);
  assertOrigin(c.req.raw, c.env);
  const input = await readJson(c.req.raw, loginSchema);
  const emailBucket = `email:${input.email}`;
  const ipBucket = `ip:${clientIp(c.req.raw)}`;
  await assertNotRateLimited(c.env.DB, [
    { bucket: emailBucket, max: MAX_FAILURES_PER_EMAIL },
    { bucket: ipBucket, max: MAX_FAILURES_PER_IP },
  ]);

  const admin = await c.env.DB.prepare('SELECT id, email, password_hash FROM admins WHERE email = ?')
    .bind(input.email)
    .first<{ id: number; email: string; password_hash: string }>();

  let valid = false;
  if (admin) {
    valid = await verifyPassword(input.password, admin.password_hash, pepper);
  } else {
    await burnPasswordCheck(input.password, pepper);
  }
  if (!admin || !valid) {
    await recordFailure(c.env.DB, [emailBucket, ipBucket]);
    // Один и тот же ответ для «нет такой почты» и «неверный пароль».
    throw unauthorized('Неверная почта или пароль.');
  }

  await clearFailures(c.env.DB, emailBucket);
  const session = await createSession(c.env.DB, c.req.raw, admin.id);
  const body: LoginResponse = { email: admin.email, csrfToken: session.csrfToken };
  return json(body, 200, { 'Set-Cookie': session.cookie });
});

authRoutes.post('/setup', async (c) => {
  const pepper = requirePepper(c.env);
  assertOrigin(c.req.raw, c.env);
  const input = await readJson(c.req.raw, setupSchema);
  const ip = clientIp(c.req.raw);
  const buckets = [`setup:${ip}`, `ip:${ip}`];
  await assertNotRateLimited(c.env.DB, [
    { bucket: `setup:${ip}`, max: MAX_FAILURES_PER_EMAIL },
    { bucket: `ip:${ip}`, max: MAX_FAILURES_PER_IP },
  ]);

  const closed = new ApiError(
    403,
    'setup_closed',
    'Первичная настройка недоступна: администратор уже создан или код настройки неверный.',
  );
  // Сравнение выполняется всегда, чтобы время ответа не зависело от состояния базы.
  const tokenOk = await timingSafeEqualStrings(input.setupToken, c.env.SETUP_TOKEN ?? '');
  if (!c.env.SETUP_TOKEN || !tokenOk || (await adminsExist(c.env.DB))) {
    await recordFailure(c.env.DB, buckets);
    throw closed;
  }
  assertPasswordPolicy(input.password);

  // Условная вставка: два одновременных запроса не создадут двух первых администраторов.
  const inserted = await c.env.DB.prepare(
    `INSERT INTO admins (email, password_hash)
     SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM admins)`,
  )
    .bind(input.email, await hashPassword(input.password, pepper))
    .run();
  if (inserted.meta.changes !== 1) throw closed;

  const session = await createSession(c.env.DB, c.req.raw, inserted.meta.last_row_id);
  const body: LoginResponse = { email: input.email, csrfToken: session.csrfToken };
  return json(body, 200, { 'Set-Cookie': session.cookie });
});

authRoutes.post('/logout', async (c) => {
  const admin = await readSession(c.env.DB, c.req.raw);
  if (!admin) throw unauthorized();
  const tokenOk = await timingSafeEqualStrings(c.req.header(CSRF_HEADER) ?? '', admin.csrfToken);
  if (!tokenOk || !isSameOrigin(c.req.raw, c.env, { required: true })) {
    throw new ApiError(
      403,
      'csrf_failed',
      'Запрос отклонён проверкой безопасности. Обновите страницу и повторите.',
    );
  }
  await destroySession(c.env.DB, admin.sessionId);
  const body: OkResponse = { ok: true };
  return json(body, 200, { 'Set-Cookie': clearSessionCookie(c.req.raw) });
});

/** Маршруты /api/admin/account — уже за проверкой сессии и CSRF. */
export const accountRoutes = new Hono<AppBindings>();

accountRoutes.post('/password', async (c) => {
  const pepper = requirePepper(c.env);
  const admin = c.get('admin');
  const input = await readJson(c.req.raw, changePasswordSchema);
  const bucket = `password:${String(admin.id)}`;
  await assertNotRateLimited(c.env.DB, [{ bucket, max: MAX_FAILURES_PER_EMAIL }]);

  const row = await c.env.DB.prepare('SELECT password_hash FROM admins WHERE id = ?')
    .bind(admin.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(input.currentPassword, row.password_hash, pepper))) {
    await recordFailure(c.env.DB, [bucket]);
    throw new ApiError(403, 'forbidden', 'Текущий пароль указан неверно.');
  }
  assertPasswordPolicy(input.newPassword);

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?').bind(
      await hashPassword(input.newPassword, pepper),
      nowIso(),
      admin.id,
    ),
    // Остальные сессии этого администратора закрываются; текущая остаётся.
    c.env.DB.prepare('DELETE FROM sessions WHERE admin_id = ? AND id <> ?').bind(admin.id, admin.sessionId),
    c.env.DB.prepare('DELETE FROM login_attempts WHERE bucket = ?').bind(bucket),
  ]);
  const body: OkResponse = { ok: true };
  return json(body);
});
