import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fromRoot('./db/migrations'));

  return {
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: fromRoot('./wrangler.jsonc') },
              miniflare: {
                // В wrangler.jsonc каталога assets нет (его подставляет сборка Vite), поэтому в тестах
                // биндинг ASSETS указывает на заглушку index.html.
                assets: {
                  directory: fromRoot('./tests/integration/fixtures/assets'),
                  binding: 'ASSETS',
                  routerConfig: {},
                  assetConfig: { not_found_handling: 'single-page-application' },
                },
                // Значения только для тестов: настоящие секреты задаются через `wrangler secret put`.
                bindings: {
                  UPLOAD_MODE: 'binding',
                  UPLOAD_PART_BYTES_OVERRIDE: String(5 * 1024 * 1024),
                  SESSION_PEPPER: 'test-pepper-not-a-real-secret',
                  SETUP_TOKEN: 'test-setup-token',
                  TEST_MIGRATIONS: migrations,
                },
              },
            }),
          ],
          test: {
            name: 'worker',
            include: ['tests/integration/**/*.test.ts'],
            setupFiles: ['tests/integration/setup.ts'],
            testTimeout: 60_000,
            hookTimeout: 60_000,
          },
        },
        {
          resolve: {
            alias: {
              '@': fromRoot('./src'),
              '@shared': fromRoot('./shared'),
            },
          },
          test: {
            name: 'unit',
            include: ['tests/unit/**/*.test.ts'],
            environment: 'node',
          },
        },
      ],
    },
  };
});
