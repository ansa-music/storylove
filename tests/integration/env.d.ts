import type { D1Migration } from '@cloudflare/vitest-plugin';

import type * as WorkerModule from '../../worker/index.ts';

declare global {
  namespace Cloudflare {
    // Биндинг, который добавляет только тестовая конфигурация (vitest.config.ts).
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
    // Тип `exports.default` из "cloudflare:workers" — точка входа Worker.
    interface GlobalProps {
      mainModule: typeof WorkerModule;
    }
  }
}
