import { SESSION_COOKIE, SESSION_COOKIE_DEV, SESSION_TTL_SECONDS } from '../../shared/constants.ts';
import type { AdminIdentity } from '../env.ts';
import { randomToken, sha256Hex } from '../lib/crypto.ts';
import { isoAfterSeconds, nowIso } from '../lib/http.ts';

function isHttps(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

/** По http (локальная разработка) префикс __Host- и флаг Secure недоступны. */
function cookieName(request: Request): string {
  return isHttps(request) ? SESSION_COOKIE : SESSION_COOKIE_DEV;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function buildCookie(request: Request, value: string, maxAge: number): string {
  const attributes = [
    `${cookieName(request)}=${value}`,
    'Path=/',
    `Max-Age=${String(maxAge)}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (isHttps(request)) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearSessionCookie(request: Request): string {
  return buildCookie(request, '', 0);
}

/** Создаёт сессию: в cookie уходит сам токен, в базу — только его SHA-256. */
export async function createSession(
  db: D1Database,
  request: Request,
  adminId: number,
): Promise<{ cookie: string; csrfToken: string }> {
  const token = randomToken(32);
  const csrfToken = randomToken(32);
  const userAgent = (request.headers.get('User-Agent') ?? '').slice(0, 300);
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(nowIso()),
    db
      .prepare(
        'INSERT INTO sessions (id, admin_id, csrf_token, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(await sha256Hex(token), adminId, csrfToken, userAgent, isoAfterSeconds(SESSION_TTL_SECONDS)),
  ]);
  return { cookie: buildCookie(request, token, SESSION_TTL_SECONDS), csrfToken };
}

export async function readSession(db: D1Database, request: Request): Promise<AdminIdentity | null> {
  const token = readCookie(request, cookieName(request));
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const sessionId = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.csrf_token AS csrfToken, a.id AS adminId, a.email AS email
         FROM sessions s JOIN admins a ON a.id = s.admin_id
        WHERE s.id = ? AND s.expires_at > ?`,
    )
    .bind(sessionId, nowIso())
    .first<{ csrfToken: string; adminId: number; email: string }>();
  if (!row) return null;
  return { id: row.adminId, email: row.email, sessionId, csrfToken: row.csrfToken };
}

export async function destroySession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}
