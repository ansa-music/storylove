import { ApiError } from '../lib/errors.ts';

const WINDOW_SECONDS = 15 * 60;
export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 20;

export interface RateLimit {
  bucket: string;
  max: number;
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

function windowStart(): string {
  return new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString();
}

/** Бросает 429 rate_limited, если в каком-то из bucket уже исчерпан лимит неудач за 15 минут. */
export async function assertNotRateLimited(db: D1Database, limits: RateLimit[]): Promise<void> {
  const since = windowStart();
  const statement = db.prepare(
    'SELECT COUNT(*) AS failures, MIN(created_at) AS oldest FROM login_attempts WHERE bucket = ? AND created_at > ?',
  );
  const results = await db.batch<{ failures: number; oldest: string | null }>(
    limits.map((limit) => statement.bind(limit.bucket, since)),
  );
  let retryAfter = 0;
  limits.forEach((limit, index) => {
    const row = results[index]?.results[0];
    if (!row || row.failures < limit.max || !row.oldest) return;
    const freeAt = Date.parse(row.oldest) + WINDOW_SECONDS * 1000;
    retryAfter = Math.max(retryAfter, Math.ceil((freeAt - Date.now()) / 1000), 1);
  });
  if (retryAfter > 0) {
    throw new ApiError(
      429,
      'rate_limited',
      'Слишком много неудачных попыток. Подождите и попробуйте снова.',
      retryAfter,
    );
  }
}

export async function recordFailure(db: D1Database, buckets: string[]): Promise<void> {
  const insert = db.prepare('INSERT INTO login_attempts (bucket) VALUES (?)');
  await db.batch([
    ...buckets.map((bucket) => insert.bind(bucket)),
    // Заодно чистим устаревшие записи, чтобы таблица не росла.
    db.prepare('DELETE FROM login_attempts WHERE created_at <= ?').bind(windowStart()),
  ]);
}

export async function clearFailures(db: D1Database, bucket: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE bucket = ?').bind(bucket).run();
}
