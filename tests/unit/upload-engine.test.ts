import { describe, expect, it } from 'vitest';

import type { AdminVideo, UploadedPart, UploadMode, UploadSessionInfo } from '@shared/api';
import { MAX_SIGN_BATCH, UPLOAD_CONCURRENCY } from '@shared/constants';
import { ApiError, type ApiRequestOptions } from '@/lib/api';
import {
  UploadEngine,
  type ApiCall,
  type UploadEnv,
  type UploadFile,
  type UploadPhase,
  type UploadSnapshot,
} from '@/features/uploads/UploadEngine';
import {
  TransportNetworkError,
  type PartPutRequest,
  type PartPutResult,
  type PartTransport,
} from '@/features/uploads/xhrTransport';

const PART = 10;

const video: AdminVideo = {
  id: 'video-1',
  filmSlug: 'ultima',
  objectKey: 'videos/ultima/1.mp4',
  url: '/media/videos/ultima/1.mp4',
  originalFilename: 'ultima.mp4',
  sizeBytes: 45,
  mimeType: 'video/mp4',
  durationSeconds: 120,
  width: 1920,
  height: 1080,
  status: 'ready',
  createdAt: '2026-10-12T10:00:00Z',
  publishedAt: null,
};

function makeFile(size: number): UploadFile & { slices: [number, number][] } {
  const slices: [number, number][] = [];
  return {
    name: 'ultima.mp4',
    size,
    lastModified: 1_760_000_000_000,
    slices,
    slice(start, end) {
      slices.push([start, end]);
      return new Blob([new Uint8Array(end - start)]);
    },
  };
}

interface ServerOptions {
  fileSize: number;
  mode?: UploadMode;
  uploaded?: UploadedPart[];
  completeFailures?: number;
}

/** Поддельный сервер: помнит принятые части и считает вызовы. */
function makeServer(options: ServerOptions) {
  const mode = options.mode ?? 'presign';
  const totalParts = Math.ceil(options.fileSize / PART);
  const parts = new Map<number, UploadedPart>((options.uploaded ?? []).map((p) => [p.partNumber, p]));
  const calls = {
    create: 0,
    sign: [] as number[][],
    report: [] as number[],
    complete: [] as unknown[],
    remove: 0,
  };
  let completeFailures = options.completeFailures ?? 0;
  let signVersion = 0;

  const session = (): UploadSessionInfo => ({
    id: 'sess-1',
    filmSlug: 'ultima',
    fileName: 'ultima.mp4',
    fileSize: options.fileSize,
    fileLastModified: 1_760_000_000_000,
    mimeType: 'video/mp4',
    partSize: PART,
    totalParts,
    state: 'active',
    mode,
    uploadedParts: [...parts.values()],
    createdAt: '2026-10-12T10:00:00Z',
    expiresAt: '2026-10-15T10:00:00Z',
  });

  const handle = async (path: string, request: ApiRequestOptions = {}): Promise<unknown> => {
    const method = request.method ?? 'GET';
    if (path === '/api/admin/uploads' && method === 'POST') {
      calls.create++;
      return { session: session() };
    }
    if (path === '/api/admin/uploads/sess-1/parts/sign') {
      const { partNumbers } = request.body as { partNumbers: number[] };
      calls.sign.push(partNumbers);
      signVersion++;
      return {
        expiresInSeconds: 900,
        parts: partNumbers.map((n) => ({
          partNumber: n,
          url:
            mode === 'presign'
              ? `https://r2.example/p${n}?v=${signVersion}`
              : `/api/admin/uploads/sess-1/parts/${n}/data`,
          viaApi: mode === 'binding',
        })),
      };
    }
    const report = /^\/api\/admin\/uploads\/sess-1\/parts\/(\d+)$/.exec(path);
    if (report && method === 'POST') {
      const partNumber = Number(report[1]);
      const { etag, sizeBytes } = request.body as { etag: string; sizeBytes: number };
      calls.report.push(partNumber);
      const part = { partNumber, etag, sizeBytes };
      parts.set(partNumber, part);
      return { part };
    }
    if (path === '/api/admin/uploads/sess-1/complete') {
      calls.complete.push(request.body);
      if (completeFailures > 0) {
        completeFailures--;
        throw new ApiError(0, 'internal_error', 'Нет связи с сервером.');
      }
      return { video };
    }
    if (path === '/api/admin/uploads/sess-1' && method === 'DELETE') {
      calls.remove++;
      return { ok: true };
    }
    throw new ApiError(404, 'not_found', `Нет маршрута ${method} ${path}`);
  };
  const api: ApiCall = <T>(path: string, request?: ApiRequestOptions) => handle(path, request) as Promise<T>;
  return { api, calls, parts };
}

type PutHandler = (request: PartPutRequest, attempt: number) => PartPutResult | Promise<PartPutResult>;

function makeTransport(handler?: PutHandler) {
  const puts: PartPutRequest[] = [];
  const attempts = new Map<string, number>();
  let active = 0;
  let maxActive = 0;
  const transport: PartTransport = {
    async put(request) {
      puts.push(request);
      const key = request.url.split('?')[0] ?? request.url;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        await Promise.resolve();
        request.onProgress(request.body.size);
        if (handler) return await handler(request, attempt);
        return { status: 200, etag: `"etag-${key}"`, body: '' };
      } finally {
        active--;
      }
    },
  };
  return { transport, puts, maxActive: () => maxActive };
}

function makeEnv(overrides: Partial<UploadEnv> = {}) {
  let clock = 0;
  const sleeps: number[] = [];
  const listeners = new Set<(online: boolean) => void>();
  const env: UploadEnv = {
    now: () => (clock += 50),
    random: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    isOnline: () => true,
    onConnectivity: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...overrides,
  };
  return {
    env,
    sleeps,
    setConnectivity: (online: boolean) => listeners.forEach((listener) => listener(online)),
  };
}

function run(options: {
  server: ReturnType<typeof makeServer>;
  transport: PartTransport;
  env: UploadEnv;
  fileSize: number;
  csrf?: string | null;
  onUnauthorized?: () => void;
}) {
  const snapshots: UploadSnapshot[] = [];
  const waiters: { phase: UploadPhase; resolve: (s: UploadSnapshot) => void }[] = [];
  const file = makeFile(options.fileSize);
  const engine = new UploadEngine({
    file,
    slug: 'ultima',
    mimeType: 'video/mp4',
    meta: { durationSeconds: 120, width: 1920, height: 1080 },
    api: options.server.api,
    transport: options.transport,
    getCsrfToken: () => options.csrf ?? null,
    onUnauthorized: options.onUnauthorized,
    env: options.env,
    onChange: (snapshot) => {
      snapshots.push(snapshot);
      for (const waiter of [...waiters]) {
        if (waiter.phase === snapshot.phase) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(snapshot);
        }
      }
    },
  });
  const until = (phase: UploadPhase): Promise<UploadSnapshot> => {
    const current = engine.getSnapshot();
    if (current.phase === phase) return Promise.resolve(current);
    return new Promise((resolve) => waiters.push({ phase, resolve }));
  };
  return { engine, file, snapshots, until };
}

describe('UploadEngine', () => {
  it('грузит файл частями, сообщает ETag и вызывает complete один раз', async () => {
    const server = makeServer({ fileSize: 45 });
    const { transport, puts, maxActive } = makeTransport();
    const { env } = makeEnv();
    const { engine, file, snapshots, until } = run({ server, transport, env, fileSize: 45 });

    await engine.start();
    const done = await until('done');

    expect(done.video).toEqual(video);
    expect(done.doneParts).toBe(5);
    expect(done.confirmedBytes).toBe(45);
    expect(done.percent).toBe(100);
    expect(file.slices.sort((a, b) => a[0] - b[0])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
      [30, 40],
      [40, 45],
    ]);
    expect(maxActive()).toBeLessThanOrEqual(UPLOAD_CONCURRENCY);
    expect(server.calls.create).toBe(1);
    expect(server.calls.report.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(server.calls.complete).toEqual([{ durationSeconds: 120, width: 1920, height: 1080 }]);
    for (const batch of server.calls.sign) expect(batch.length).toBeLessThanOrEqual(MAX_SIGN_BATCH);
    // Подписанная ссылка: без CSRF и без cookie.
    expect(puts.every((put) => !put.viaApi && put.csrfToken === null)).toBe(true);

    const phases = snapshots.map((s) => s.phase);
    expect(phases[0]).toBe('preparing');
    expect(phases.indexOf('verifying')).toBeGreaterThan(phases.indexOf('uploading'));
    expect(phases.indexOf('done')).toBeGreaterThan(phases.indexOf('verifying'));
    // «Готово» не объявляется до ответа complete.
    expect(snapshots.filter((s) => s.phase !== 'done').every((s) => s.video === null)).toBe(true);
  });

  it('возобновляет загрузку: отправляет только недостающие части', async () => {
    const server = makeServer({
      fileSize: 45,
      uploaded: [
        { partNumber: 1, etag: 'a', sizeBytes: 10 },
        { partNumber: 3, etag: 'c', sizeBytes: 10 },
        { partNumber: 5, etag: 'e', sizeBytes: 5 },
      ],
    });
    const { transport } = makeTransport();
    const { env } = makeEnv();
    const { engine, file, snapshots, until } = run({ server, transport, env, fileSize: 45 });

    await engine.start();
    const done = await until('done');

    expect(done.resumedParts).toBe(3);
    expect(file.slices.sort((a, b) => a[0] - b[0])).toEqual([
      [10, 20],
      [30, 40],
    ]);
    const firstUploading = snapshots.find((s) => s.phase === 'uploading');
    expect(firstUploading?.confirmedBytes).toBe(25);
    expect(server.calls.complete).toHaveLength(1);
  });

  it('в режиме через сайт передаёт CSRF и берёт часть из ответа', async () => {
    const server = makeServer({ fileSize: 15, mode: 'binding' });
    const { transport, puts } = makeTransport((request) => ({
      status: 200,
      etag: null,
      body: JSON.stringify({ part: { partNumber: 1, etag: 'x', sizeBytes: request.body.size } }),
    }));
    const { env } = makeEnv();
    const { engine, until } = run({ server, transport, env, fileSize: 15, csrf: 'csrf-token' });

    await engine.start();
    await until('done');

    expect(puts.every((put) => put.viaApi && put.csrfToken === 'csrf-token')).toBe(true);
    expect(server.calls.report).toEqual([]);
  });

  it('при 403 от хранилища берёт новую ссылку и повторяет часть', async () => {
    const server = makeServer({ fileSize: 10 });
    const { transport, puts } = makeTransport((request, attempt) =>
      attempt === 1
        ? { status: 403, etag: null, body: '' }
        : { status: 200, etag: '"ok"', body: request.url },
    );
    const { env, sleeps } = makeEnv();
    const { engine, until } = run({ server, transport, env, fileSize: 10 });

    await engine.start();
    await until('done');

    expect(server.calls.sign).toEqual([[1], [1]]);
    expect(puts.map((put) => put.url)).toEqual(['https://r2.example/p1?v=1', 'https://r2.example/p1?v=2']);
    expect(sleeps).toEqual([0]);
  });

  it('повторяет сетевую ошибку с растущей паузой и сдаётся после пяти попыток', async () => {
    const server = makeServer({ fileSize: 10 });
    const { transport, puts } = makeTransport(() => {
      throw new TransportNetworkError();
    });
    const { env, sleeps } = makeEnv();
    const { engine, until } = run({ server, transport, env, fileSize: 10 });

    await engine.start();
    const failed = await until('error');

    expect(puts).toHaveLength(5);
    expect(sleeps).toEqual([500, 1000, 2000, 4000]);
    expect(failed.error).toContain('5 попыток');
    expect(server.calls.complete).toEqual([]);
  });

  it('не повторяет отказ 400 и останавливается с ошибкой', async () => {
    const server = makeServer({ fileSize: 30 });
    const { transport, puts } = makeTransport((request) =>
      request.url.includes('/p2')
        ? { status: 400, etag: null, body: '' }
        : { status: 200, etag: '"ok"', body: '' },
    );
    const { env } = makeEnv();
    const { engine, until } = run({ server, transport, env, fileSize: 30 });

    await engine.start();
    const failed = await until('error');

    expect(puts.filter((put) => put.url.includes('/p2'))).toHaveLength(1);
    expect(failed.error).toContain('400');
    expect(server.calls.complete).toEqual([]);
  });

  it('объясняет скрытый заголовок ETag', async () => {
    const server = makeServer({ fileSize: 10 });
    const { transport } = makeTransport(() => ({ status: 200, etag: null, body: '' }));
    const { env } = makeEnv();
    const { engine, until } = run({ server, transport, env, fileSize: 10 });

    await engine.start();
    const failed = await until('error');
    expect(failed.error).toContain('в CORS бакета не открыт заголовок ETag');
  });

  it('после ошибки повтор продолжает с недостающих частей', async () => {
    const server = makeServer({ fileSize: 30 });
    let broken = true;
    const { transport } = makeTransport((request) =>
      broken && request.url.includes('/p3')
        ? { status: 400, etag: null, body: '' }
        : { status: 200, etag: '"ok"', body: '' },
    );
    const { env } = makeEnv();
    const { engine, file, until } = run({ server, transport, env, fileSize: 30 });

    await engine.start();
    await until('error');
    const confirmed = [...server.parts.keys()];
    broken = false;
    file.slices.length = 0;
    await engine.retry();
    const done = await until('done');

    expect(server.calls.create).toBe(2);
    expect(done.doneParts).toBe(3);
    // Уже принятые сервером части повторно не читались с диска.
    for (const n of confirmed) expect(file.slices).not.toContainEqual([(n - 1) * PART, n * PART]);
    expect(server.calls.complete).toHaveLength(1);
  });

  it('сбой финальной проверки: повтор вызывает только complete, без новой сессии', async () => {
    const server = makeServer({ fileSize: 20, completeFailures: 1 });
    const { transport, puts } = makeTransport();
    const { env } = makeEnv();
    const { engine, until } = run({ server, transport, env, fileSize: 20 });

    await engine.start();
    const failed = await until('error');
    expect(failed.percent).toBe(100);
    expect(failed.video).toBeNull();

    await engine.retry();
    const done = await until('done');
    expect(done.video).toEqual(video);
    expect(server.calls.create).toBe(1);
    expect(server.calls.complete).toHaveLength(2);
    expect(puts).toHaveLength(2);
  });

  it('пауза прерывает текущие части, продолжение дозагружает их', async () => {
    const server = makeServer({ fileSize: 60 });
    const gates: (() => void)[] = [];
    let hold = true;
    const { transport } = makeTransport(
      (request) =>
        new Promise<PartPutResult>((resolve, reject) => {
          const ok = (): void => resolve({ status: 200, etag: '"ok"', body: '' });
          if (!hold) {
            ok();
            return;
          }
          gates.push(ok);
          request.signal.addEventListener('abort', () => reject(new DOMException('Отменено', 'AbortError')));
        }),
    );
    const { env } = makeEnv();
    const { engine, until } = run({ server, transport, env, fileSize: 60 });

    await engine.start();
    await until('uploading');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gates).toHaveLength(UPLOAD_CONCURRENCY);

    engine.pause();
    const paused = engine.getSnapshot();
    expect(paused.phase).toBe('paused');
    expect(paused.uploadedBytes).toBe(paused.confirmedBytes);

    hold = false;
    engine.resume();
    const done = await until('done');
    expect(done.doneParts).toBe(6);
    expect(server.calls.complete).toHaveLength(1);
  });

  it('без сети ждёт и продолжает сам, когда связь вернулась', async () => {
    const server = makeServer({ fileSize: 20 });
    let online = false;
    const { transport, puts } = makeTransport();
    const { env, setConnectivity } = makeEnv({ isOnline: () => online });
    const { engine, until } = run({ server, transport, env, fileSize: 20 });

    await engine.start();
    expect(engine.getSnapshot().phase).toBe('offline');
    expect(puts).toHaveLength(0);

    online = true;
    setConnectivity(true);
    await until('done');
    expect(puts).toHaveLength(2);
  });

  it('отмена удаляет сессию на сервере', async () => {
    const server = makeServer({ fileSize: 20 });
    const { transport } = makeTransport(
      (request) =>
        new Promise<PartPutResult>((_, reject) => {
          request.signal.addEventListener('abort', () => reject(new DOMException('Отменено', 'AbortError')));
        }),
    );
    const { env } = makeEnv();
    const { engine, until } = run({ server, transport, env, fileSize: 20 });

    await engine.start();
    await until('uploading');
    await engine.cancel();

    expect(engine.getSnapshot().phase).toBe('canceled');
    expect(server.calls.remove).toBe(1);
    expect(server.calls.complete).toEqual([]);
  });

  it('401 при отправке части сообщает об истёкшей сессии', async () => {
    const server = makeServer({ fileSize: 10, mode: 'binding' });
    const { transport } = makeTransport(() => ({ status: 401, etag: null, body: '' }));
    const { env } = makeEnv();
    let unauthorized = 0;
    const { engine, until } = run({
      server,
      transport,
      env,
      fileSize: 10,
      onUnauthorized: () => {
        unauthorized++;
      },
    });

    await engine.start();
    const failed = await until('error');
    expect(unauthorized).toBe(1);
    expect(failed.error).toContain('Сессия истекла');
  });
});
