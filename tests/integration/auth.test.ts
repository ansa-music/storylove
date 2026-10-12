import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ApiErrorBody, OkResponse, SessionResponse } from '../../shared/api.ts';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ORIGIN,
  SETUP_TOKEN,
  adminCall,
  adminJson,
  call,
  expectError,
  login,
  postJson,
  readBody,
  resetAll,
  setupAdmin,
} from './helpers.ts';

beforeEach(resetAll);

describe('первичная настройка', () => {
  it('неверный код настройки — 403 setup_closed, администратор не создаётся', async () => {
    const response = await postJson('/api/auth/setup', {
      setupToken: 'wrong-token',
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    await expectError(response, 403, 'setup_closed');
    const session = await readBody<SessionResponse>(await call('/api/auth/session'));
    expect(session).toEqual({ authenticated: false, email: null, csrfToken: null, setupRequired: true });
  });

  it('верный код создаёт администратора и сессию; повторная настройка закрыта', async () => {
    const response = await postJson('/api/auth/setup', {
      setupToken: SETUP_TOKEN,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const cookie = response.headers.get('Set-Cookie') ?? '';
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=604800']) {
      expect(cookie).toContain(attribute);
    }

    // В базе нет ни пароля, ни токена сессии в открытом виде.
    const token = cookie.split(';')[0]?.split('=')[1] ?? '';
    const admin = await env.DB.prepare('SELECT password_hash FROM admins').first<{ password_hash: string }>();
    expect(admin?.password_hash).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    const stored = await env.DB.prepare('SELECT id FROM sessions').first<{ id: string }>();
    expect(stored?.id).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.id).not.toBe(token);

    const again = await postJson('/api/auth/setup', {
      setupToken: SETUP_TOKEN,
      email: 'second@storylove.test',
      password: ADMIN_PASSWORD,
    });
    await expectError(again, 403, 'setup_closed');
  });

  it('слишком короткий пароль отклоняется', async () => {
    const response = await postJson('/api/auth/setup', {
      setupToken: SETUP_TOKEN,
      email: ADMIN_EMAIL,
      password: 'short',
    });
    await expectError(response, 400, 'validation_failed');
  });
});

describe('вход', () => {
  it('успешный вход, сессия и выход', async () => {
    await setupAdmin();
    const session = await login();

    const state = await readBody<SessionResponse>(
      await call('/api/auth/session', { headers: { Cookie: session.cookie } }),
    );
    expect(state).toEqual({
      authenticated: true,
      email: ADMIN_EMAIL,
      csrfToken: session.csrfToken,
      setupRequired: false,
    });

    const noCsrf = await call('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: session.cookie, Origin: ORIGIN },
    });
    await expectError(noCsrf, 403, 'csrf_failed');

    const out = await adminCall(session, '/api/auth/logout', { method: 'POST' });
    expect(await readBody<OkResponse>(out)).toEqual({ ok: true });
    expect(out.headers.get('Set-Cookie')).toContain('Max-Age=0');
    await expectError(await adminCall(session, '/api/admin/dashboard'), 401, 'unauthorized');
  });

  it('неверный пароль и неизвестная почта дают одинаковый ответ', async () => {
    await setupAdmin();
    const wrongPassword = await postJson('/api/auth/login', {
      email: ADMIN_EMAIL,
      password: 'wrong-password-123',
    });
    const unknownEmail = await postJson('/api/auth/login', {
      email: 'nobody@storylove.test',
      password: ADMIN_PASSWORD,
    });
    const first = await expectError(wrongPassword, 401, 'unauthorized');
    const second = await expectError(unknownEmail, 401, 'unauthorized');
    expect(first).toEqual(second);
    expect(wrongPassword.headers.get('Set-Cookie')).toBeNull();
  });

  it('после пяти неудач вход блокируется даже с верным паролем', async () => {
    await setupAdmin();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await postJson('/api/auth/login', {
        email: ADMIN_EMAIL,
        password: 'wrong-password-123',
      });
      expect(response.status).toBe(401);
    }
    const blocked = await postJson('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const error = await expectError(blocked, 429, 'rate_limited');
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    expect(blocked.headers.get('Retry-After')).toBe(String(error.retryAfterSeconds));
  });

  it('смена пароля проверяет текущий и закрывает остальные сессии', async () => {
    const current = await setupAdmin();
    const other = await login();
    const newPassword = 'brand-new-password-42';

    const wrong = await adminJson(current, 'POST', '/api/admin/account/password', {
      currentPassword: 'wrong-password-123',
      newPassword,
    });
    await expectError(wrong, 403, 'forbidden');

    const changed = await adminJson(current, 'POST', '/api/admin/account/password', {
      currentPassword: ADMIN_PASSWORD,
      newPassword,
    });
    expect(changed.status).toBe(200);
    expect((await adminCall(current, '/api/admin/films')).status).toBe(200);
    await expectError(await adminCall(other, '/api/admin/films'), 401, 'unauthorized');
    await expectError(
      await postJson('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      401,
      'unauthorized',
    );
    await login(ADMIN_EMAIL, newPassword);
  });
});

describe('защита админки', () => {
  const routes: [string, string][] = [
    ['GET', '/api/admin/dashboard'],
    ['GET', '/api/admin/films'],
    ['GET', '/api/admin/films/econom'],
    ['PATCH', '/api/admin/films/econom'],
    ['PUT', '/api/admin/films/econom/image/poster'],
    ['DELETE', '/api/admin/films/econom/image/poster'],
    ['GET', '/api/admin/settings'],
    ['PATCH', '/api/admin/settings'],
    ['PUT', '/api/admin/settings/image/hero'],
    ['GET', '/api/admin/uploads'],
    ['POST', '/api/admin/uploads'],
    ['POST', '/api/admin/uploads/x/parts/sign'],
    ['PUT', '/api/admin/uploads/x/parts/1/data'],
    ['POST', '/api/admin/uploads/x/parts/1'],
    ['POST', '/api/admin/uploads/x/complete'],
    ['DELETE', '/api/admin/uploads/x'],
    ['POST', '/api/admin/videos/x/publish'],
    ['GET', '/api/admin/videos/x/check'],
    ['DELETE', '/api/admin/videos/x'],
    ['GET', '/api/admin/storage'],
    ['POST', '/api/admin/storage/cleanup'],
    ['POST', '/api/admin/storage/abort-stale'],
    ['POST', '/api/admin/account/password'],
    ['GET', '/api/admin/unknown'],
  ];

  it.each(routes)('%s %s без сессии — 401', async (method, path) => {
    const response = await call(path, { method, headers: { Origin: ORIGIN, 'X-CSRF-Token': 'x' } });
    await expectError(response, 401, 'unauthorized');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('изменяющий запрос без CSRF-токена, с чужим токеном или чужим Origin — 403', async () => {
    const session = await setupAdmin();
    const send = (headers: Record<string, string>): Promise<Response> =>
      call('/api/admin/films/econom', {
        method: 'PATCH',
        headers: { Cookie: session.cookie, 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ title: 'Взлом' }),
      });

    await expectError(await send({ Origin: ORIGIN }), 403, 'csrf_failed');
    await expectError(await send({ Origin: ORIGIN, 'X-CSRF-Token': 'f'.repeat(64) }), 403, 'csrf_failed');
    await expectError(
      await send({ Origin: 'https://evil.example', 'X-CSRF-Token': session.csrfToken }),
      403,
      'csrf_failed',
    );
    await expectError(await send({ 'X-CSRF-Token': session.csrfToken }), 403, 'csrf_failed');

    const film = await env.DB.prepare("SELECT title FROM films WHERE slug = 'econom'").first<{
      title: string;
    }>();
    expect(film?.title).toBe('ЭКОНОМ');
    expect((await send({ Origin: ORIGIN, 'X-CSRF-Token': session.csrfToken })).status).toBe(200);
  });

  it('входные данные проверяются: неизвестные ключи и длины', async () => {
    const session = await setupAdmin();
    await expectError(
      await adminJson(session, 'PATCH', '/api/admin/settings', { unknownKey: 'x' }),
      400,
      'validation_failed',
    );
    await expectError(
      await adminJson(session, 'PATCH', '/api/admin/films/econom', { title: 'я'.repeat(81) }),
      400,
      'validation_failed',
    );
    await expectError(
      await adminJson(session, 'PATCH', '/api/admin/films/nope', { title: 'x' }),
      404,
      'not_found',
    );
    const broken = await adminCall(session, '/api/admin/settings', { method: 'PATCH', body: '{oops' });
    const error = (await readBody<ApiErrorBody>(broken)).error;
    expect({ status: broken.status, code: error.code }).toEqual({ status: 400, code: 'bad_request' });
  });
});
