import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Миграции применяются штатным способом плагина: список читается в vitest.config.ts (readD1Migrations).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
