#!/usr/bin/env node
// Подготовка локальной разработки: создаёт .dev.vars со случайными секретами (если файла нет)
// и применяет миграции к локальной базе D1. Запуск: npm run setup:local

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_VARS = path.join(ROOT, '.dev.vars');
const WRANGLER_BIN = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function secret(bytes) {
  return randomBytes(bytes).toString('base64url');
}

/** Создаёт .dev.vars. Возвращает SETUP_TOKEN, если файл создан, и null, если он уже был. */
function createDevVars() {
  const setupToken = secret(24);
  const content = [
    '# Локальные секреты разработки. Создано scripts/setup-local.mjs. В git не попадает.',
    `SESSION_PEPPER=${secret(32)}`,
    `SETUP_TOKEN=${setupToken}`,
    'UPLOAD_MODE=binding',
    '',
  ].join('\n');
  try {
    // Флаг wx: не перезаписывать существующий файл ни при каких условиях.
    fs.writeFileSync(DEV_VARS, content, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') return null;
    throw error;
  }
  return setupToken;
}

function applyMigrations() {
  return new Promise((resolve, reject) => {
    // Запускаем wrangler напрямую через node: spawn для npx.cmd на Windows требует оболочку.
    const child = spawn(process.execPath, [WRANGLER_BIN, 'd1', 'migrations', 'apply', 'DB', '--local'], {
      cwd: ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log('Шаг 1 из 2. Файл .dev.vars');
  const setupToken = createDevVars();
  if (setupToken === null) {
    console.log('  Уже существует — оставлен без изменений.');
    console.log('  Токен первичной настройки смотрите в нём, в строке SETUP_TOKEN.');
  } else {
    console.log('  Создан со случайными значениями SESSION_PEPPER и SETUP_TOKEN, UPLOAD_MODE=binding.');
    console.log('');
    console.log(`  SETUP_TOKEN: ${setupToken}`);
    console.log('  Это локальный токен для разработки. Он нужен один раз — на странице первичной');
    console.log('  настройки /admin/login, чтобы создать первого администратора. Показан только сейчас;');
    console.log('  позже его можно посмотреть в файле .dev.vars. Для боевого сайта он не подходит.');
  }
  console.log('');

  console.log('Шаг 2 из 2. Миграции локальной базы D1');
  if (!fs.existsSync(WRANGLER_BIN)) {
    console.error('  Ошибка: не найден wrangler (node_modules/wrangler). Сначала выполните: npm install');
    return 1;
  }
  const code = await applyMigrations();
  if (code !== 0) {
    console.error(`  Ошибка: wrangler завершился с кодом ${code}. Миграции не применены.`);
    return 1;
  }
  console.log('');

  console.log('Готово. Дальше:');
  console.log('  npm run dev');
  console.log('  затем откройте http://localhost:5173/admin/login');
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`Ошибка: ${error.message}`);
    process.exitCode = 1;
  },
);
