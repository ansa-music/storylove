import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

// Сквозной сценарий владельца: первичная настройка → загрузка видео по частям → публикация →
// просмотр в окне на главной → правка текста. Идёт по порядку, одним браузером.
test.describe.configure({ mode: 'serial' });

const ROOT = process.cwd();
const CREDENTIALS_FILE = path.join(ROOT, 'tmp', 'e2e-admin.json');
// ~40 МБ: при части 16 МиБ это три части — настоящий multipart, а не одна загрузка.
const VIDEO_FILE = path.join(ROOT, 'tmp', 'e2e-video-40mb.mp4');

interface Credentials {
  email: string;
  password: string;
}

/** Локальный SETUP_TOKEN из .dev.vars; значение никуда не выводится. */
function readSetupToken(): string {
  const text = readFileSync(path.join(ROOT, '.dev.vars'), 'utf8');
  const match = /^SETUP_TOKEN\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(text);
  if (!match?.[1]) throw new Error('В .dev.vars нет SETUP_TOKEN — выполните npm run setup:local');
  return match[1];
}

function loadCredentials(): Credentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  const data: unknown = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8'));
  if (
    typeof data === 'object' &&
    data !== null &&
    'email' in data &&
    'password' in data &&
    typeof data.email === 'string' &&
    typeof data.password === 'string'
  ) {
    return { email: data.email, password: data.password };
  }
  return null;
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/admin/login');
  const setupHeading = page.getByRole('heading', { name: 'Первичная настройка' });
  const loginButton = page.getByRole('button', { name: 'Войти' });
  await expect(setupHeading.or(loginButton)).toBeVisible();

  if (await setupHeading.isVisible()) {
    const credentials: Credentials = {
      email: 'e2e-admin@storylove.test',
      password: randomBytes(18).toString('base64url'),
    };
    mkdirSync(path.dirname(CREDENTIALS_FILE), { recursive: true });
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials), 'utf8');
    await page.getByLabel('Setup-токен').fill(readSetupToken());
    await page.getByLabel('Email администратора').fill(credentials.email);
    await page.getByLabel('Пароль', { exact: true }).fill(credentials.password);
    await page.getByLabel('Пароль ещё раз').fill(credentials.password);
    await page.getByRole('button', { name: 'Создать администратора' }).click();
  } else {
    const credentials = loadCredentials();
    if (!credentials) {
      throw new Error(
        'Администратор в локальной базе уже есть, а tmp/e2e-admin.json отсутствует. ' +
          'Удалите .wrangler/state и выполните npm run setup:local.',
      );
    }
    await page.getByLabel('Email').fill(credentials.email);
    await page.getByLabel('Пароль', { exact: true }).fill(credentials.password);
    await loginButton.click();
  }
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.getByRole('navigation', { name: 'Разделы панели' }).first()).toBeVisible();
}

test.beforeAll(() => {
  if (!existsSync(VIDEO_FILE)) {
    execFileSync(process.execPath, ['scripts/make-test-video.mjs', '--size', '40MB', '--out', VIDEO_FILE], {
      cwd: ROOT,
      stdio: 'ignore',
    });
  }
});

test('публичный сайт: главная, четыре уровня, страницы просмотра', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('история любви');
  for (const slug of ['econom', 'basic', 'premium', 'ultima']) {
    await expect(page.locator(`a[href="/watch/${slug}"]`).first()).toBeAttached();
  }
  // Ссылки на админку на публичном сайте быть не должно.
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);

  // Нажатие на карточку открывает окно просмотра на той же странице.
  await page.locator('a[href="/watch/premium"]').first().click();
  await expect(page).toHaveURL(/\/watch\/premium$/);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { level: 2 })).toContainText('ПРЕМИУМ');
  await expect(dialog.getByText('Мультфильм скоро появится')).toBeVisible();

  // Переключение формата внутри окна и закрытие по Esc.
  await dialog.getByRole('link', { name: /УЛЬТИМА/ }).click();
  await expect(page).toHaveURL(/\/watch\/ultima$/);
  await expect(dialog.getByRole('heading', { level: 2 })).toContainText('УЛЬТИМА');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/localhost:5173\/$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Прямая ссылка на формат открывает то же окно.
  await page.goto('/watch/basic');
  await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toContainText('БАЗОВЫЙ');

  await page.goto('/watch/unknown-tier');
  await expect(page.getByRole('link', { name: /главн/i }).first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('админка закрыта без входа', async ({ page, request }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/);

  for (const url of [
    '/api/admin/dashboard',
    '/api/admin/films',
    '/api/admin/storage',
    '/api/admin/settings',
  ]) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(401);
  }
  const mutation = await request.patch('/api/admin/films/econom', { data: { title: 'взлом' } });
  expect([401, 403]).toContain(mutation.status());
});

test('загрузка видео по частям, публикация и просмотр с перемоткой', async ({ page, request }) => {
  await signIn(page);
  await page.goto('/admin/films/econom');

  await page.getByLabel('Файл мультфильма').setInputFiles(VIDEO_FILE);
  await page.getByRole('button', { name: /Начать загрузку|Продолжить загрузку/ }).click();
  await expect(page.getByText('Загружено и проверено').first()).toBeVisible({ timeout: 180_000 });

  await page.getByRole('button', { name: 'Опубликовать эту версию' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click();
  await expect(page.getByRole('button', { name: 'Проверить ещё раз' })).toBeVisible({ timeout: 30_000 });

  // Публичные данные: у уровня появилось видео.
  const site = await request.get('/api/public/site');
  expect(site.ok()).toBe(true);
  const body = (await site.json()) as {
    films: { slug: string; video: { url: string; sizeBytes: number } | null }[];
  };
  const video = body.films.find((film) => film.slug === 'econom')?.video;
  expect(video, 'у ЭКОНОМ должно быть опубликованное видео').toBeTruthy();
  if (!video) return;

  // Range: сервер отдаёт ровно запрошенные байты с 206.
  const middle = Math.floor(video.sizeBytes / 2);
  const range = await request.get(video.url, { headers: { Range: `bytes=${middle}-${middle + 999}` } });
  expect(range.status()).toBe(206);
  expect(range.headers()['content-range']).toBe(`bytes ${middle}-${middle + 999}/${video.sizeBytes}`);
  expect((await range.body()).byteLength).toBe(1000);
  expect(range.headers()['accept-ranges']).toBe('bytes');

  // Публичная страница: видео играет и перематывается, не скачиваясь целиком.
  const mediaStatuses: number[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/media/videos/')) mediaStatuses.push(response.status());
  });
  // Посетитель нажимает на карточку — ролик начинает играть сам.
  await page.goto('/');
  await page.locator('a[href="/watch/econom"]').first().click();
  const element = page.locator('video');
  await expect(element).toHaveAttribute('preload', 'metadata');
  await expect
    .poll(() => element.evaluate((node: HTMLVideoElement) => node.currentTime), { timeout: 30_000 })
    .toBeGreaterThan(0.5);

  await element.evaluate((node: HTMLVideoElement) => {
    node.currentTime = Math.max(1, node.duration - 8);
  });
  await expect
    .poll(
      () =>
        element.evaluate(
          (node: HTMLVideoElement) => !node.seeking && node.readyState >= 2 && node.currentTime > 5,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  expect(mediaStatuses.length).toBeGreaterThan(0);
  expect(mediaStatuses.every((status) => status === 206 || status === 304)).toBe(true);

  // Владелец удаляет опубликованное видео: оно пропадает и из админки, и с сайта.
  await page.goto('/admin/films/econom');
  const activeRow = page.getByRole('row').filter({ hasText: 'Показывается на сайте' });
  await activeRow.getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить навсегда' }).click();
  await expect(activeRow).toHaveCount(0);
  const after = await request.get('/api/public/site');
  const afterBody = (await after.json()) as { films: { slug: string; video: unknown }[] };
  expect(afterBody.films.find((film) => film.slug === 'econom')?.video).toBeNull();
  expect((await request.get(video.url)).status()).toBe(404);
});

test('разделы админки открываются без ошибок и без горизонтального скролла', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await signIn(page);

  const sections = ['', '/films', '/films/econom', '/content', '/settings', '/storage'];
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    for (const section of sections) {
      await page.goto(`/admin${section}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `горизонтальный скролл на /admin${section} при ${size.width}px`).toBeLessThanOrEqual(
        0,
      );
      mkdirSync(path.join(ROOT, 'tmp', 'shots'), { recursive: true });
      await page.screenshot({
        path: path.join(ROOT, 'tmp', 'shots', `admin${section.replaceAll('/', '_')}-${size.width}.png`),
        fullPage: true,
      });
    }
  }
  expect(errors).toEqual([]);
});

test('правка текста уровня видна на публичном сайте', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/films/basic');

  const field = page.getByLabel('Короткая фраза');
  const original = await field.inputValue();
  const changed = `Проверка правки ${Date.now()}`;

  await field.fill(changed);
  await page.getByRole('button', { name: 'Сохранить' }).first().click();
  await expect
    .poll(async () => {
      const response = await page.request.get('/api/public/site');
      const data = (await response.json()) as { films: { slug: string; tagline: string }[] };
      return data.films.find((film) => film.slug === 'basic')?.tagline;
    })
    .toBe(changed);

  await page.goto('/');
  await expect(page.getByText(changed).first()).toBeAttached();

  // Возвращаем исходный текст.
  await page.goto('/admin/films/basic');
  await page.getByLabel('Короткая фраза').fill(original);
  await page.getByRole('button', { name: 'Сохранить' }).first().click();
  await expect
    .poll(async () => {
      const response = await page.request.get('/api/public/site');
      const data = (await response.json()) as { films: { slug: string; tagline: string }[] };
      return data.films.find((film) => film.slug === 'basic')?.tagline;
    })
    .toBe(original);
});
