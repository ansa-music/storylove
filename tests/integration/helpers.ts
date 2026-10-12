import { env, exports } from 'cloudflare:workers';
import { expect } from 'vitest';

import type {
  AdminVideo,
  ApiErrorBody,
  CompleteUploadResponse,
  LoginResponse,
  PartResponse,
  SignPartsResponse,
  UploadSessionInfo,
  UploadSessionResponse,
} from '../../shared/api.ts';
import type { TierSlug } from '../../shared/constants.ts';

export const ORIGIN = 'https://storylove.test';
export const ADMIN_EMAIL = 'admin@storylove.test';
export const ADMIN_PASSWORD = 'correct-horse-battery';
export const SETUP_TOKEN = 'test-setup-token';
/** Размер части в тестах (UPLOAD_PART_BYTES_OVERRIDE в vitest.config.ts). */
export const PART_BYTES = 5 * 1024 * 1024;

export interface AdminSession {
  cookie: string;
  csrfToken: string;
}

export function call(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(ORIGIN + path, init));
}

export async function readBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function expectError(
  response: Response,
  status: number,
  code: ApiErrorBody['error']['code'],
): Promise<ApiErrorBody['error']> {
  const body = await readBody<ApiErrorBody>(response);
  expect({ status: response.status, code: body.error.code }).toEqual({ status, code });
  expect(body.error.message.length).toBeGreaterThan(0);
  return body.error;
}

function sessionCookie(response: Response): string {
  const header = response.headers.get('Set-Cookie') ?? '';
  const pair = header.split(';')[0] ?? '';
  expect(pair).toMatch(/^__Host-sl_session=[0-9a-f]{64}$/);
  return pair;
}

export function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

/** Очищает базу и хранилище, чтобы тесты не зависели друг от друга. */
export async function resetAll(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE films SET active_video_id = NULL, poster_key = NULL, car_image_key = NULL, is_published = 1',
    ),
    env.DB.prepare('DELETE FROM upload_parts'),
    env.DB.prepare('DELETE FROM upload_sessions'),
    env.DB.prepare('DELETE FROM videos'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM admins'),
    env.DB.prepare('DELETE FROM login_attempts'),
    env.DB.prepare('DELETE FROM site_settings'),
  ]);
  const listed = await env.MEDIA.list();
  if (listed.objects.length > 0) await env.MEDIA.delete(listed.objects.map((object) => object.key));
}

export async function setupAdmin(email = ADMIN_EMAIL, password = ADMIN_PASSWORD): Promise<AdminSession> {
  const response = await postJson('/api/auth/setup', { setupToken: SETUP_TOKEN, email, password });
  expect(response.status).toBe(200);
  const body = await readBody<LoginResponse>(response);
  return { cookie: sessionCookie(response), csrfToken: body.csrfToken };
}

export async function login(email = ADMIN_EMAIL, password = ADMIN_PASSWORD): Promise<AdminSession> {
  const response = await postJson('/api/auth/login', { email, password });
  expect(response.status).toBe(200);
  const body = await readBody<LoginResponse>(response);
  return { cookie: sessionCookie(response), csrfToken: body.csrfToken };
}

/** Второй администратор создаётся напрямую в базе: копируется хеш пароля первого. */
export async function addSecondAdmin(email: string): Promise<AdminSession> {
  await env.DB.prepare(
    'INSERT INTO admins (email, password_hash) SELECT ?, password_hash FROM admins LIMIT 1',
  )
    .bind(email)
    .run();
  return login(email);
}

export function adminCall(session: AdminSession, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Cookie', session.cookie);
  if (init.method && init.method !== 'GET' && init.method !== 'HEAD') {
    headers.set('X-CSRF-Token', session.csrfToken);
    headers.set('Origin', ORIGIN);
  }
  return call(path, { ...init, headers });
}

export function adminJson(
  session: AdminSession,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return adminCall(session, path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Файл заданного размера с настоящим началом MP4 (ftyp + moov) и предсказуемым содержимым. */
export function makeMp4(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + (i >>> 8)) & 0xff;
  const header = [
    [0, 0, 0, 24],
    'ftyp',
    'isom',
    [0, 0, 2, 0],
    'isom',
    'mp42',
    [0, 0, 0, 16],
    'moov',
    [0, 0, 0, 8],
    'free',
  ].flatMap((item) => (typeof item === 'string' ? [...item].map((char) => char.charCodeAt(0)) : item));
  bytes.set(header, 0);
  return bytes;
}

export interface CreateInput {
  slug: TierSlug;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileLastModified: number;
}

export function createInput(slug: TierSlug, fileSize: number, fileName = 'love-story.mp4'): CreateInput {
  return { slug, fileName, fileSize, mimeType: 'video/mp4', fileLastModified: 1_760_000_000_000 };
}

export async function createUpload(session: AdminSession, input: CreateInput): Promise<UploadSessionInfo> {
  const response = await adminJson(session, 'POST', '/api/admin/uploads', input);
  expect([200, 201]).toContain(response.status);
  return (await readBody<UploadSessionResponse>(response)).session;
}

export async function uploadPart(
  session: AdminSession,
  upload: UploadSessionInfo,
  bytes: Uint8Array<ArrayBuffer>,
  partNumber: number,
): Promise<Response> {
  const signed = await adminJson(session, 'POST', `/api/admin/uploads/${upload.id}/parts/sign`, {
    partNumbers: [partNumber],
  });
  expect(signed.status).toBe(200);
  const part = (await readBody<SignPartsResponse>(signed)).parts[0];
  expect(part).toMatchObject({ partNumber, viaApi: true });
  const start = (partNumber - 1) * upload.partSize;
  const chunk = bytes.slice(start, Math.min(start + upload.partSize, bytes.byteLength));
  return adminCall(session, part?.url ?? '', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: chunk,
  });
}

/** Полный цикл: создать сессию, отправить все части, завершить. Возвращает видео в статусе ready. */
export async function uploadVideo(
  session: AdminSession,
  slug: TierSlug,
  bytes: Uint8Array<ArrayBuffer>,
  fileName = 'love-story.mp4',
): Promise<AdminVideo> {
  const upload = await createUpload(session, createInput(slug, bytes.byteLength, fileName));
  for (let partNumber = 1; partNumber <= upload.totalParts; partNumber += 1) {
    const response = await uploadPart(session, upload, bytes, partNumber);
    expect(response.status).toBe(200);
    expect((await readBody<PartResponse>(response)).part.partNumber).toBe(partNumber);
  }
  const completed = await adminJson(session, 'POST', `/api/admin/uploads/${upload.id}/complete`, {
    durationSeconds: 12.5,
    width: 1920,
    height: 1080,
  });
  expect(completed.status).toBe(201);
  return (await readBody<CompleteUploadResponse>(completed)).video;
}
