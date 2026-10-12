import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  AdminFilmResponse,
  DashboardResponse,
  PublicSiteResponse,
  StorageCleanupResponse,
  StorageResponse,
  UploadSessionsResponse,
  VideoCheckResponse,
} from '../../shared/api.ts';
import { MAX_VIDEO_BYTES } from '../../shared/constants.ts';
import {
  PART_BYTES,
  addSecondAdmin,
  adminCall,
  adminJson,
  call,
  createInput,
  createUpload,
  expectError,
  makeMp4,
  readBody,
  resetAll,
  setupAdmin,
  uploadPart,
  uploadVideo,
} from './helpers.ts';

const SMALL = 70_000;

beforeEach(resetAll);

describe('создание сессии загрузки', () => {
  it('отклоняет недопустимые имя, тип и размер файла', async () => {
    const admin = await setupAdmin();
    const create = (patch: Record<string, unknown>): Promise<Response> =>
      adminJson(admin, 'POST', '/api/admin/uploads', { ...createInput('econom', SMALL), ...patch });

    await expectError(await create({ fileName: 'movie.exe' }), 400, 'validation_failed');
    await expectError(await create({ fileName: '../evil.mp4' }), 400, 'validation_failed');
    await expectError(await create({ fileName: 'bad\u0000name.mp4' }), 400, 'validation_failed');
    await expectError(await create({ fileName: `${'a'.repeat(252)}.mp4` }), 400, 'validation_failed');
    await expectError(await create({ mimeType: 'video/quicktime' }), 415, 'unsupported_media_type');
    await expectError(await create({ fileSize: 1000 }), 400, 'validation_failed');
    await expectError(await create({ fileSize: MAX_VIDEO_BYTES + 1 }), 413, 'payload_too_large');
    await expectError(await create({ slug: 'vip' }), 400, 'validation_failed');
    await expectError(await create({ objectKey: 'videos/econom/mine.mp4' }), 400, 'validation_failed');

    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM upload_sessions').first<{
      total: number;
    }>();
    expect(count?.total).toBe(0);
  });

  it('чужая сессия загрузки недоступна — 404', async () => {
    const owner = await setupAdmin();
    const stranger = await addSecondAdmin('second@storylove.test');
    const upload = await createUpload(owner, createInput('econom', SMALL));
    const base = `/api/admin/uploads/${upload.id}`;

    await expectError(
      await adminJson(stranger, 'POST', `${base}/parts/sign`, { partNumbers: [1] }),
      404,
      'not_found',
    );
    await expectError(await uploadPartAs(stranger), 404, 'not_found');
    await expectError(await adminJson(stranger, 'POST', `${base}/complete`, {}), 404, 'not_found');
    await expectError(await adminJson(stranger, 'DELETE', base), 404, 'not_found');
    const list = await readBody<UploadSessionsResponse>(await adminCall(stranger, '/api/admin/uploads'));
    expect(list.sessions).toEqual([]);

    function uploadPartAs(session: typeof stranger): Promise<Response> {
      return adminCall(session, `${base}/parts/1/data`, { method: 'PUT', body: makeMp4(SMALL) });
    }
  });

  it('проверяет номера и размеры частей, прерывание очищает сессию', async () => {
    const admin = await setupAdmin();
    const upload = await createUpload(admin, createInput('basic', SMALL));
    const base = `/api/admin/uploads/${upload.id}`;
    expect(upload).toMatchObject({ totalParts: 1, partSize: PART_BYTES, mode: 'binding', state: 'active' });

    await expectError(
      await adminJson(admin, 'POST', `${base}/parts/sign`, { partNumbers: [2] }),
      400,
      'validation_failed',
    );
    await expectError(
      await adminJson(admin, 'POST', `${base}/parts/sign`, {
        partNumbers: Array.from({ length: 17 }, (_, i) => i + 1),
      }),
      400,
      'validation_failed',
    );
    const wrongSize = await adminCall(admin, `${base}/parts/1/data`, {
      method: 'PUT',
      body: makeMp4(SMALL - 1),
    });
    await expectError(wrongSize, 400, 'validation_failed');
    await expectError(
      await adminJson(admin, 'POST', `${base}/parts/1`, { etag: '', sizeBytes: SMALL }),
      400,
      'validation_failed',
    );

    // Завершение без частей: сессия остаётся активной, её можно дозагрузить.
    await expectError(await adminJson(admin, 'POST', `${base}/complete`, {}), 409, 'conflict');
    expect((await uploadPart(admin, upload, makeMp4(SMALL), 1)).status).toBe(200);

    expect((await adminJson(admin, 'DELETE', base)).status).toBe(200);
    await expectError(await adminJson(admin, 'POST', `${base}/complete`, {}), 409, 'conflict');
    const parts = await env.DB.prepare('SELECT COUNT(*) AS total FROM upload_parts').first<{
      total: number;
    }>();
    expect(parts?.total).toBe(0);
    expect((await env.MEDIA.list()).objects).toEqual([]);
  });

  it('содержимое, которое не является MP4, отклоняется при завершении и удаляется', async () => {
    const admin = await setupAdmin();
    const bytes = new Uint8Array(SMALL).fill(0x41);
    const upload = await createUpload(admin, createInput('premium', SMALL));
    expect((await uploadPart(admin, upload, bytes, 1)).status).toBe(200);

    const completed = await adminJson(admin, 'POST', `/api/admin/uploads/${upload.id}/complete`, {});
    const error = await expectError(completed, 400, 'validation_failed');
    expect(error.message).toContain('MP4');

    expect((await env.MEDIA.list()).objects).toEqual([]);
    const videos = await env.DB.prepare('SELECT COUNT(*) AS total FROM videos').first<{ total: number }>();
    expect(videos?.total).toBe(0);
    const state = await env.DB.prepare('SELECT state FROM upload_sessions WHERE id = ?')
      .bind(upload.id)
      .first<{ state: string }>();
    expect(state?.state).toBe('aborted');
  });
});

describe('полный цикл: загрузка тремя частями, публикация, замена', () => {
  it('загружает, возобновляет, публикует, отдаёт по Range и заменяет версию', async () => {
    const admin = await setupAdmin();
    const bytes = makeMp4(PART_BYTES * 2 + 70_001);
    const input = createInput('ultima', bytes.byteLength);

    // Создание и первая часть.
    const upload = await createUpload(admin, input);
    expect(upload).toMatchObject({
      totalParts: 3,
      partSize: PART_BYTES,
      fileSize: bytes.byteLength,
      uploadedParts: [],
    });
    expect((await uploadPart(admin, upload, bytes, 1)).status).toBe(200);

    // Возобновление: повторное создание возвращает ту же сессию и список принятых частей.
    const resumed = await createUpload(admin, input);
    expect(resumed.id).toBe(upload.id);
    expect(resumed.uploadedParts).toEqual([
      { partNumber: 1, etag: expect.any(String) as string, sizeBytes: PART_BYTES },
    ]);
    const listed = await readBody<UploadSessionsResponse>(
      await adminCall(admin, '/api/admin/uploads?slug=ultima'),
    );
    expect(listed.sessions.map((session) => session.id)).toEqual([upload.id]);

    // Завершить раньше времени нельзя; после дозагрузки — можно.
    await expectError(
      await adminJson(admin, 'POST', `/api/admin/uploads/${upload.id}/complete`, {}),
      409,
      'conflict',
    );
    const first = await uploadVideo(admin, 'ultima', bytes);
    expect(first).toMatchObject({
      filmSlug: 'ultima',
      status: 'ready',
      sizeBytes: bytes.byteLength,
      originalFilename: 'love-story.mp4',
      durationSeconds: 12.5,
      width: 1920,
      height: 1080,
      publishedAt: null,
    });
    expect(first.objectKey).toMatch(/^videos\/ultima\/[0-9a-f-]{36}\.mp4$/);

    // Повторное завершение — 409.
    await expectError(
      await adminJson(admin, 'POST', `/api/admin/uploads/${upload.id}/complete`, {}),
      409,
      'conflict',
    );

    // До публикации видео не видно посетителям, но доступно администратору для предпросмотра.
    let site = await readBody<PublicSiteResponse>(await call('/api/public/site'));
    expect(site.films.find((film) => film.slug === 'ultima')?.video).toBeNull();
    await expectError(await call(first.url), 404, 'not_found');
    const preview = await adminCall(admin, first.url, { headers: { Range: 'bytes=0-9' } });
    expect(preview.status).toBe(206);
    expect(preview.headers.get('Cache-Control')).toBe('private, no-store');
    await preview.arrayBuffer();

    // Публикация.
    const published = await adminJson(admin, 'POST', `/api/admin/videos/${first.id}/publish`);
    expect(published.status).toBe(200);
    const film = (await readBody<AdminFilmResponse>(published)).film;
    expect(film.activeVideo).toMatchObject({ id: first.id, status: 'active' });
    expect(film.activeVideo?.publishedAt).not.toBeNull();

    site = await readBody<PublicSiteResponse>(await call('/api/public/site'));
    const publicVideo = site.films.find((item) => item.slug === 'ultima')?.video;
    expect(publicVideo).toMatchObject({ url: first.url, mimeType: 'video/mp4', sizeBytes: bytes.byteLength });

    // Range: точные байты из середины (на стыке частей), открытый и суффиксный диапазоны, 416.
    const start = PART_BYTES - 5;
    const middle = await call(first.url, {
      headers: { Range: `bytes=${String(start)}-${String(start + 9)}` },
    });
    expect(middle.status).toBe(206);
    expect(middle.headers.get('Content-Range')).toBe(
      `bytes ${String(start)}-${String(start + 9)}/${String(bytes.byteLength)}`,
    );
    expect(middle.headers.get('Content-Length')).toBe('10');
    expect(middle.headers.get('Content-Type')).toBe('video/mp4');
    expect(middle.headers.get('Accept-Ranges')).toBe('bytes');
    expect(middle.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(middle.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await middle.arrayBuffer())).toEqual(bytes.slice(start, start + 10));

    const suffix = await call(first.url, { headers: { Range: 'bytes=-7' } });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get('Content-Range')).toBe(
      `bytes ${String(bytes.byteLength - 7)}-${String(bytes.byteLength - 1)}/${String(bytes.byteLength)}`,
    );
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(bytes.slice(-7));

    const open = await call(first.url, { headers: { Range: `bytes=${String(bytes.byteLength - 3)}-` } });
    expect(open.status).toBe(206);
    expect(new Uint8Array(await open.arrayBuffer())).toEqual(bytes.slice(-3));

    const beyond = await call(first.url, { headers: { Range: `bytes=${String(bytes.byteLength)}-` } });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('Content-Range')).toBe(`bytes */${String(bytes.byteLength)}`);

    const head = await call(first.url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe(String(bytes.byteLength));
    const etag = head.headers.get('ETag') ?? '';
    expect(etag.length).toBeGreaterThan(2);
    const notModified = await call(first.url, { headers: { 'If-None-Match': etag } });
    expect(notModified.status).toBe(304);

    const full = await call(first.url);
    expect(full.status).toBe(200);
    expect((await full.arrayBuffer()).byteLength).toBe(bytes.byteLength);

    // Проверка публичной выдачи.
    const check = await readBody<VideoCheckResponse>(
      await adminCall(admin, `/api/admin/videos/${first.id}/check`),
    );
    expect(check.checks.filter((item) => !item.ok)).toEqual([]);
    expect(check.ok).toBe(true);

    // Опубликованную версию нельзя удалить ни напрямую, ни через очистку хранилища.
    await expectError(
      await adminJson(admin, 'DELETE', `/api/admin/videos/${first.id}`, { confirm: true }),
      409,
      'conflict',
    );
    await expectError(
      await adminJson(admin, 'POST', '/api/admin/storage/cleanup', {
        keys: [first.objectKey],
        confirm: true,
      }),
      409,
      'conflict',
    );
    await expectError(
      await adminJson(admin, 'POST', '/api/admin/storage/cleanup', { keys: [first.objectKey] }),
      400,
      'validation_failed',
    );
    expect(await env.MEDIA.head(first.objectKey)).not.toBeNull();

    // Замена: вторая версия; после публикации первая уходит в архив, сайт отдаёт новую.
    const secondBytes = makeMp4(80_000);
    const second = await uploadVideo(admin, 'ultima', secondBytes, 'love-story-v2.mp4');
    await expectError(
      await adminJson(admin, 'DELETE', `/api/admin/videos/${second.id}`, {}),
      400,
      'validation_failed',
    );
    const republished = await adminJson(admin, 'POST', `/api/admin/videos/${second.id}/publish`);
    const replaced = (await readBody<AdminFilmResponse>(republished)).film;
    expect(replaced.activeVideo?.id).toBe(second.id);
    expect(replaced.videos.map((video) => [video.id, video.status])).toEqual([
      [second.id, 'active'],
      [first.id, 'archived'],
    ]);

    site = await readBody<PublicSiteResponse>(await call('/api/public/site'));
    const newVideo = site.films.find((item) => item.slug === 'ultima')?.video;
    expect(newVideo?.url).toBe(second.url);
    expect(newVideo?.version).not.toBe(publicVideo?.version);
    await expectError(await call(first.url), 404, 'not_found');

    // Проверка непубличной версии честно сообщает о проблеме.
    const archivedCheck = await readBody<VideoCheckResponse>(
      await adminCall(admin, `/api/admin/videos/${first.id}/check`),
    );
    expect(archivedCheck.ok).toBe(false);

    // Хранилище и дашборд.
    const storage = await readBody<StorageResponse>(await adminCall(admin, '/api/admin/storage'));
    expect(storage.objects.map((object) => [object.key, object.status, object.filmSlug]).sort()).toEqual(
      [
        [first.objectKey, 'archived', 'ultima'],
        [second.objectKey, 'active', 'ultima'],
      ].sort(),
    );
    expect(storage.summary).toMatchObject({
      totalBytes: bytes.byteLength + secondBytes.byteLength,
      activeVideoBytes: secondBytes.byteLength,
      archivedVideoBytes: bytes.byteLength,
      objectCount: 2,
      incompleteUploads: [],
    });
    const dashboard = await readBody<DashboardResponse>(await adminCall(admin, '/api/admin/dashboard'));
    expect(dashboard.uploadMode).toBe('binding');
    expect(dashboard.films).toHaveLength(4);
    expect(dashboard.warnings.filter((warning) => warning.level === 'info')).toHaveLength(3);
    expect(dashboard.warnings.filter((warning) => warning.level === 'error')).toEqual([]);

    // Смешанный список (архив + активная) отклоняется целиком; только архив — удаляется.
    await expectError(
      await adminJson(admin, 'POST', '/api/admin/storage/cleanup', {
        keys: [first.objectKey, second.objectKey],
        confirm: true,
      }),
      409,
      'conflict',
    );
    expect(await env.MEDIA.head(first.objectKey)).not.toBeNull();
    const cleanup = await adminJson(admin, 'POST', '/api/admin/storage/cleanup', {
      keys: [first.objectKey],
      confirm: true,
    });
    expect(await readBody<StorageCleanupResponse>(cleanup)).toEqual({
      deletedKeys: [first.objectKey],
      freedBytes: bytes.byteLength,
    });
    expect(await env.MEDIA.head(first.objectKey)).toBeNull();
    expect(await env.MEDIA.head(second.objectKey)).not.toBeNull();

    // Снятие уровня с публикации и режим «Скоро открытие» закрывают видео для посетителей.
    await adminJson(admin, 'PATCH', '/api/admin/films/ultima', { isPublished: false });
    await expectError(await call(second.url), 404, 'not_found');
    await adminJson(admin, 'PATCH', '/api/admin/films/ultima', { isPublished: true });
    await adminJson(admin, 'PATCH', '/api/admin/settings', { siteVisible: false });
    await expectError(await call(second.url), 404, 'not_found');
    site = await readBody<PublicSiteResponse>(await call('/api/public/site'));
    expect(site.settings.siteVisible).toBe(false);
    expect(site.films.every((item) => item.video === null)).toBe(true);
  });

  it('неопубликованную версию можно удалить с подтверждением', async () => {
    const admin = await setupAdmin();
    const video = await uploadVideo(admin, 'basic', makeMp4(SMALL));
    const deleted = await adminJson(admin, 'DELETE', `/api/admin/videos/${video.id}`, { confirm: true });
    expect(deleted.status).toBe(200);
    expect(await env.MEDIA.head(video.objectKey)).toBeNull();
    await expectError(
      await adminJson(admin, 'POST', `/api/admin/videos/${video.id}/publish`),
      404,
      'not_found',
    );
  });

  it('просроченные загрузки видны в предупреждениях и прерываются', async () => {
    const admin = await setupAdmin();
    const upload = await createUpload(admin, createInput('econom', SMALL));
    await env.DB.prepare("UPDATE upload_sessions SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(upload.id)
      .run();

    const dashboard = await readBody<DashboardResponse>(await adminCall(admin, '/api/admin/dashboard'));
    expect(dashboard.warnings.some((warning) => warning.message.includes('просроченные'))).toBe(true);
    await expectError(
      await adminJson(admin, 'POST', `/api/admin/uploads/${upload.id}/parts/sign`, { partNumbers: [1] }),
      409,
      'conflict',
    );

    const aborted = await adminJson(admin, 'POST', '/api/admin/storage/abort-stale');
    expect(await readBody<{ abortedSessions: number }>(aborted)).toEqual({ abortedSessions: 1 });
    const state = await env.DB.prepare('SELECT state FROM upload_sessions WHERE id = ?')
      .bind(upload.id)
      .first<{ state: string }>();
    expect(state?.state).toBe('aborted');
  });
});
