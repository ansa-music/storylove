import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AdminFilmResponse, AdminSettingsResponse, PublicSiteResponse } from '../../shared/api.ts';
import { MAX_IMAGE_BYTES } from '../../shared/constants.ts';
import {
  adminCall,
  call,
  expectError,
  readBody,
  resetAll,
  setupAdmin,
  type AdminSession,
} from './helpers.ts';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBytes(size = 256): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes.set(PNG_SIGNATURE, 0);
  return bytes;
}

function putImage(session: AdminSession, path: string, type: string, body: BodyInit): Promise<Response> {
  return adminCall(session, path, { method: 'PUT', headers: { 'Content-Type': type }, body });
}

beforeEach(resetAll);

describe('GET /media/*: защита пути', () => {
  it('отклоняет обход каталога, чужие префиксы и листинг', async () => {
    await env.MEDIA.put('secret/keys.txt', 'секрет');
    await env.MEDIA.put('videos/econom/orphan.mp4', 'не из базы');

    for (const path of [
      '/media/videos/..%2F..%2Fsecret/keys.txt',
      '/media/videos/%2e%2e/secret/keys.txt',
      '/media/images/..%5Csecret',
      '/media/images//double.png',
      '/media/images/a%00b.png',
      '/media/images/%E0%A4%A.png',
      '/media/secret/keys.txt',
      '/media/',
      '/media/videos/',
      '/media/images/',
    ]) {
      const response = await call(path);
      expect([400, 404], path).toContain(response.status);
      expect(await response.text(), path).not.toContain('секрет');
    }
    // Объект, которого нет в таблице videos, не отдаётся, даже если лежит под videos/.
    await expectError(await call('/media/videos/econom/orphan.mp4'), 404, 'not_found');
    expect((await call('/media/images/poster/x.png', { method: 'POST' })).status).toBe(405);
  });
});

describe('изображения', () => {
  it('принимает PNG, отдаёт его публично и удаляет старый объект при замене', async () => {
    const admin = await setupAdmin();
    const uploaded = await putImage(admin, '/api/admin/films/econom/image/poster', 'image/png', pngBytes());
    expect(uploaded.status).toBe(200);
    const posterUrl = (await readBody<AdminFilmResponse>(uploaded)).film.posterUrl ?? '';
    expect(posterUrl).toMatch(/^\/media\/images\/poster\/[0-9a-f-]{36}\.png$/);

    const image = await call(posterUrl);
    expect(image.status).toBe(200);
    expect(image.headers.get('Content-Type')).toBe('image/png');
    expect(image.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(image.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(pngBytes());
    const ranged = await call(posterUrl, { headers: { Range: 'bytes=1-3' } });
    expect(ranged.status).toBe(206);
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));

    const site = await readBody<PublicSiteResponse>(await call('/api/public/site'));
    expect(site.films.find((film) => film.slug === 'econom')?.posterUrl).toBe(posterUrl);

    const replaced = await putImage(
      admin,
      '/api/admin/films/econom/image/poster',
      'image/png',
      pngBytes(512),
    );
    const newUrl = (await readBody<AdminFilmResponse>(replaced)).film.posterUrl ?? '';
    expect(newUrl).not.toBe(posterUrl);
    expect((await call(posterUrl)).status).toBe(404);
    expect((await env.MEDIA.list()).objects).toHaveLength(1);

    const removed = await adminCall(admin, '/api/admin/films/econom/image/poster', { method: 'DELETE' });
    expect((await readBody<AdminFilmResponse>(removed)).film.posterUrl).toBeNull();
    expect((await env.MEDIA.list()).objects).toEqual([]);
  });

  it('отклоняет неверную сигнатуру, неподдерживаемый тип и слишком большой файл', async () => {
    const admin = await setupAdmin();
    const path = '/api/admin/films/basic/image/car';
    const fake = new TextEncoder().encode('<html><script>alert(1)</script></html>');

    await expectError(await putImage(admin, path, 'image/png', fake), 400, 'validation_failed');
    await expectError(await putImage(admin, path, 'image/jpeg', pngBytes()), 400, 'validation_failed');
    await expectError(await putImage(admin, path, 'image/gif', pngBytes()), 415, 'unsupported_media_type');
    await expectError(
      await putImage(admin, path, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>'),
      415,
      'unsupported_media_type',
    );
    await expectError(
      await putImage(admin, path, 'image/png', pngBytes(MAX_IMAGE_BYTES + 1)),
      413,
      'payload_too_large',
    );
    await expectError(
      await putImage(admin, '/api/admin/films/basic/image/banner', 'image/png', pngBytes()),
      404,
      'not_found',
    );
    expect((await env.MEDIA.list()).objects).toEqual([]);
  });

  it('SVG: только для логотипа и favicon, без активного содержимого, с жёстким CSP', async () => {
    const admin = await setupAdmin();
    const safe =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

    await expectError(
      await putImage(admin, '/api/admin/settings/image/hero', 'image/svg+xml', safe),
      415,
      'unsupported_media_type',
    );
    for (const dangerous of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)">x</a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><p>x</p></foreignObject></svg>',
      'просто текст',
    ]) {
      await expectError(
        await putImage(admin, '/api/admin/settings/image/logo', 'image/svg+xml', dangerous),
        400,
        'validation_failed',
      );
    }

    const uploaded = await putImage(admin, '/api/admin/settings/image/logo', 'image/svg+xml', safe);
    expect(uploaded.status).toBe(200);
    const logoUrl = (await readBody<AdminSettingsResponse>(uploaded)).images.logo ?? '';
    expect(logoUrl).toMatch(/^\/media\/images\/logo\/[0-9a-f-]{36}\.svg$/);

    const response = await call(logoUrl);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(await response.text()).toBe(safe);
  });

  it('изображение og подставляется в Open Graph', async () => {
    const admin = await setupAdmin();
    const uploaded = await putImage(admin, '/api/admin/settings/image/og', 'image/png', pngBytes());
    const ogUrl = (await readBody<AdminSettingsResponse>(uploaded)).images.og ?? '';
    const html = await (await call('/about')).text();
    expect(html).toContain(`<meta property="og:image" content="https://storylove.test${ogUrl}">`);
  });
});
