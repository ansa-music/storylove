import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Правила без информации о типах (не type-aware) — линт остаётся быстрым.
export default defineConfig(
  globalIgnores([
    'dist',
    '.wrangler',
    'node_modules',
    'worker-configuration.d.ts',
    'tmp',
    'playwright-report',
    'test-results',
    'blob-report',
    'coverage',
  ]),
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    // В приложении и в Worker вывод в консоль запрещён; в scripts/** он разрешён.
    files: ['src/**', 'worker/**'],
    rules: {
      'no-console': 'error',
    },
  },
);
