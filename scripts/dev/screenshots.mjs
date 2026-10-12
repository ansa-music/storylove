// Снимки страниц на разных размерах экрана — для визуальной проверки вёрстки.
// Использование: node scripts/dev/screenshots.mjs [--base http://localhost:5173] [--out tmp/shots] /  /watch/ultima …
// Берёт установленный в системе Edge (channel msedge), чтобы не скачивать отдельный браузер.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { chromium } from '@playwright/test';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string', default: 'http://localhost:5173' },
    out: { type: 'string', default: 'tmp/shots' },
    sizes: { type: 'string', default: '1440x900,390x844' },
    channel: { type: 'string', default: 'msedge' },
    routes: { type: 'string' },
  },
});

// Маршруты можно передать и одной строкой через запятую без ведущего слэша
// (--routes "home,watch/ultima"): так их не искажают Git Bash и PowerShell.
const fromOption = (values.routes ?? '')
  .split(',')
  .filter(Boolean)
  .map((item) => (item === 'home' ? '/' : `/${item}`));
const routes = fromOption.length > 0 ? fromOption : positionals.length > 0 ? positionals : ['/'];
const sizes = values.sizes.split(',').map((item) => {
  const [width, height] = item.split('x').map(Number);
  return { width, height };
});

await mkdir(values.out, { recursive: true });
const browser = await chromium.launch({ channel: values.channel });
let failed = false;

for (const size of sizes) {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    isMobile: size.width < 768,
    hasTouch: size.width < 768,
  });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 240)}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
  });

  for (const route of routes) {
    problems.length = 0;
    await page.goto(values.base + route, { waitUntil: 'networkidle' });
    // Прокрутка по шагам запускает появление секций и ленивую загрузку изображений.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    // Колесом, а не scrollTo: при мгновенных прыжках в headless-браузере секции не успевают появиться.
    await page.mouse.move(size.width / 2, size.height / 2);
    for (let y = 0; y < height; y += 200) {
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(900);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(600);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) problems.push(`горизонтальный скролл: +${overflow}px`);

    const name = `${route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}-${size.width}.png`;
    await page.screenshot({ path: path.join(values.out, name), fullPage: true });
    const status = problems.length === 0 ? 'ok' : `ПРОБЛЕМЫ: ${problems.join(' | ')}`;
    if (problems.length > 0) failed = true;
    console.log(`${size.width}x${size.height} ${route} → ${name} (${height}px) ${status}`);
  }
  await context.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
