import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PublicSiteResponse } from '../../shared/api.ts';
import { DEFAULT_SETTINGS } from '../../shared/defaults.ts';
import { adminJson, call, expectError, readBody, resetAll, setupAdmin } from './helpers.ts';

beforeEach(resetAll);

describe('GET /api/public/site', () => {
  it('отдаёт четыре фильма без видео и тексты по умолчанию', async () => {
    const response = await call('/api/public/site');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=30');
    const body = await readBody<PublicSiteResponse>(response);
    expect(body.films.map((film) => film.slug)).toEqual(['econom', 'basic', 'premium', 'ultima']);
    expect(body.films.every((film) => film.video === null)).toBe(true);
    expect(body.settings.heroTitle).toBe(DEFAULT_SETTINGS.heroTitle);
    expect(body.settings).not.toHaveProperty('storageBudgetGb');
    expect(body.images).toEqual({
      hero: null,
      og: null,
      logo: null,
      favicon: null,
      photoHim: null,
      photoHer: null,
    });
    expect(body.settings.photosText).toBe(DEFAULT_SETTINGS.photosText);
  });

  it('показывает изменённые настройки и игнорирует повреждённые значения в базе', async () => {
    const admin = await setupAdmin();
    const patched = await adminJson(admin, 'PATCH', '/api/admin/settings', { heroTitle: 'Новый заголовок' });
    expect(patched.status).toBe(200);
    await env.DB.prepare("INSERT INTO site_settings (key, value) VALUES ('aboutTitle', '{не json')").run();

    const body = await readBody<PublicSiteResponse>(await call('/api/public/site'));
    expect(body.settings.heroTitle).toBe('Новый заголовок');
    expect(body.settings.aboutTitle).toBe(DEFAULT_SETTINGS.aboutTitle);
  });
});

describe('общее поведение API', () => {
  it('неизвестный адрес /api/* — 404 в формате JSON', async () => {
    await expectError(await call('/api/nope'), 404, 'not_found');
  });

  it('robots.txt и sitemap.xml', async () => {
    const robots = await (await call('/robots.txt')).text();
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('Disallow: /api');
    expect(robots).toContain('Sitemap: https://storylove.test/sitemap.xml');

    const sitemap = await (await call('/sitemap.xml')).text();
    for (const path of ['/', '/watch/econom', '/watch/basic', '/watch/premium', '/watch/ultima']) {
      expect(sitemap).toContain(`<loc>https://storylove.test${path}</loc>`);
    }
  });
});

describe('HTML: заголовки безопасности и метаданные', () => {
  it('главная: CSP, запрет встраивания, Open Graph', async () => {
    const response = await call('/');
    expect(response.status).toBe(200);
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(response.headers.get('X-Robots-Tag')).toBeNull();

    const html = await response.text();
    expect(html).toContain(`<title>${DEFAULT_SETTINGS.metaTitle}</title>`);
    expect(html).toContain('<link rel="canonical" href="https://storylove.test/">');
    expect(html).toContain(`<meta property="og:title" content="${DEFAULT_SETTINGS.metaTitle}">`);
    expect(html).toContain('<meta property="og:image" content="https://storylove.test/og-image.jpg">');
    expect(html).toContain('<meta property="og:locale" content="ru_RU">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html.match(/name="description"/g)).toHaveLength(1);
  });

  it('страница просмотра: данные фильма, подставляемые значения экранируются', async () => {
    const admin = await setupAdmin();
    const patched = await adminJson(admin, 'PATCH', '/api/admin/films/ultima', {
      title: 'УЛЬТИМА "<script>alert(1)</script>',
    });
    expect(patched.status).toBe(200);

    const html = await (await call('/watch/ultima')).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<meta property="og:type" content="video.other">');
    expect(html).toContain('<meta property="og:url" content="https://storylove.test/watch/ultima">');
  });

  it('админка: noindex в заголовке и в разметке, без Open Graph', async () => {
    const response = await call('/admin/login');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
    const html = await response.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).not.toContain('og:title');
  });
});
