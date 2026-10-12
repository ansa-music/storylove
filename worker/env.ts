import type { UploadMode } from '../shared/api.ts';

// В сгенерированном worker-configuration.d.ts переменные имеют литеральные типы из wrangler.jsonc
// ("presign", ""), а секретов нет вовсе — поэтому здесь свой тип окружения.
export type AppEnv = Omit<Env, 'UPLOAD_MODE' | 'R2_BUCKET_NAME' | 'PUBLIC_ORIGIN'> & {
  UPLOAD_MODE: string;
  R2_BUCKET_NAME: string;
  PUBLIC_ORIGIN: string;
  SESSION_PEPPER?: string;
  SETUP_TOKEN?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** Только для режима binding (локальная разработка и тесты): размер части в байтах. */
  UPLOAD_PART_BYTES_OVERRIDE?: string;
};

export interface AdminIdentity {
  id: number;
  email: string;
  /** SHA-256 токена сессии — первичный ключ строки sessions. */
  sessionId: string;
  csrfToken: string;
}

export type AppBindings = {
  Bindings: AppEnv;
  Variables: { admin: AdminIdentity };
};

export function hasR2Credentials(env: AppEnv): boolean {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME);
}

/**
 * Режим загрузки новых сессий. "auto": прямо в R2 по подписанным ссылкам, как только заданы ключи R2;
 * пока их нет — потоком через Worker (части по 16 МиБ укладываются в лимит тела запроса).
 */
export function uploadMode(env: AppEnv): UploadMode {
  if (env.UPLOAD_MODE === 'binding') return 'binding';
  if (env.UPLOAD_MODE === 'auto') return hasR2Credentials(env) ? 'presign' : 'binding';
  return 'presign';
}

/** Origin из PUBLIC_ORIGIN, если он задан и корректен; иначе null. */
export function configuredOrigin(env: AppEnv): string | null {
  if (!env.PUBLIC_ORIGIN) return null;
  return URL.canParse(env.PUBLIC_ORIGIN) ? new URL(env.PUBLIC_ORIGIN).origin : null;
}

/** Origin для абсолютных ссылок (canonical, sitemap, Open Graph). */
export function publicOrigin(env: AppEnv, request: Request): string {
  return configuredOrigin(env) ?? new URL(request.url).origin;
}
