// Движок multipart-загрузки видео. Без React и без прямого доступа к DOM:
// сеть, часы и события «онлайн/офлайн» приходят снаружи, поэтому движок проверяется unit-тестами.

import { z } from 'zod';

import type {
  AdminVideo,
  CompleteUploadRequest,
  CompleteUploadResponse,
  CreateUploadRequest,
  OkResponse,
  PartResponse,
  ReportPartRequest,
  SignPartsRequest,
  SignPartsResponse,
  UploadedPart,
  UploadSessionInfo,
  UploadSessionResponse,
} from '@shared/api';
import { MAX_SIGN_BATCH, UPLOAD_CONCURRENCY, type TierSlug } from '@shared/constants';
import { ApiError, type ApiRequestOptions } from '@/lib/api';

import {
  acceptedParts,
  countParts,
  missingPartNumbers,
  partRange,
  pickPartsToSign,
  requeueParts,
  takeNextParts,
  urlDeadline,
  type PartRange,
} from './lib/parts';
import { computeProgress, etaSeconds, SpeedMeter } from './lib/progress';
import { decideRetry, type PartFailure } from './lib/retry';
import { TransportNetworkError, type PartTransport } from './xhrTransport';

export type ApiCall = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;

export type UploadPhase =
  | 'idle' // создан, ещё не запущен
  | 'preparing' // создаём или находим сессию на сервере
  | 'uploading' // части уходят
  | 'paused' // остановлено пользователем
  | 'offline' // нет сети, продолжим сами по событию online
  | 'verifying' // все части приняты, сервер собирает и проверяет файл
  | 'done' // сервер подтвердил файл
  | 'error' // остановлено с ошибкой, можно повторить
  | 'canceled'; // сессия удалена на сервере

export interface UploadSnapshot {
  phase: UploadPhase;
  sessionId: string | null;
  fileName: string;
  fileSize: number;
  totalParts: number;
  /** Части, подтверждённые сервером. */
  doneParts: number;
  /** Сколько частей уже было на сервере при старте (возобновление). */
  resumedParts: number;
  confirmedBytes: number;
  uploadedBytes: number;
  percent: number;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  error: string | null;
  video: AdminVideo | null;
}

/** Всё, что движку нужно от файла. File подходит как есть. */
export interface UploadFile {
  name: string;
  size: number;
  lastModified: number;
  slice(start: number, end: number): Blob;
}

export interface UploadEnv {
  now(): number;
  random(): number;
  /** Ждёт ms или до отмены сигнала; не бросает. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  isOnline(): boolean;
  /** Подписка на появление и пропажу сети. Возвращает функцию отписки. */
  onConnectivity(listener: (online: boolean) => void): () => void;
}

export interface UploadEngineOptions {
  file: UploadFile;
  slug: TierSlug;
  mimeType: string;
  /** Длительность и размер кадра, прочитанные браузером, — уходят в complete. */
  meta: CompleteUploadRequest;
  api: ApiCall;
  transport: PartTransport;
  getCsrfToken: () => string | null;
  onChange: (snapshot: UploadSnapshot) => void;
  /** Сессия создана или найдена — можно запомнить её для возобновления. */
  onSession?: (session: UploadSessionInfo) => void;
  /** Сервер ответил 401 на отправку части мимо общего клиента API. */
  onUnauthorized?: () => void;
  env?: Partial<UploadEnv>;
}

const browserEnv: UploadEnv = {
  now: () => Date.now(),
  random: () => Math.random(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted || ms <= 0) {
        resolve();
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    }),
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  onConnectivity: (listener) => {
    if (typeof window === 'undefined') return () => undefined;
    const online = (): void => listener(true);
    const offline = (): void => listener(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  },
};

const partResponseSchema = z.object({
  part: z.object({
    partNumber: z.number().int().positive(),
    etag: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  }),
});

const errorBodySchema = z.object({ error: z.object({ message: z.string().min(1) }) });

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Ответ на PUT части с кодом вне 2xx. */
class PartHttpError extends Error {
  readonly status: number;
  readonly viaApi: boolean;
  readonly serverMessage: string | undefined;

  constructor(status: number, viaApi: boolean, serverMessage?: string) {
    super(serverMessage ?? `Часть файла отклонена (код ${status}).`);
    this.name = 'PartHttpError';
    this.status = status;
    this.viaApi = viaApi;
    this.serverMessage = serverMessage;
  }
}

class MissingEtagError extends Error {
  constructor() {
    super('В ответе хранилища не виден заголовок ETag.');
    this.name = 'MissingEtagError';
  }
}

function toFailure(err: unknown): PartFailure {
  if (err instanceof TransportNetworkError) return { kind: 'network' };
  if (err instanceof MissingEtagError) return { kind: 'missing_etag' };
  if (err instanceof PartHttpError) {
    return { kind: 'http', status: err.status, viaApi: err.viaApi, message: err.serverMessage };
  }
  if (err instanceof ApiError) {
    return err.status === 0 ? { kind: 'network' } : { kind: 'api', status: err.status, message: err.message };
  }
  return { kind: 'unknown', message: err instanceof Error ? err.message : 'Неизвестная ошибка при загрузке.' };
}

interface SignedUrl {
  url: string;
  viaApi: boolean;
  /** До какого момента (мс) ссылку можно использовать. */
  deadline: number;
}

interface InFlightPart {
  loaded: number;
  controller: AbortController;
}

/** Ссылки берём с небольшим запасом вперёд: при медленной связи дальние успели бы истечь. */
const SIGN_BATCH = Math.min(MAX_SIGN_BATCH, UPLOAD_CONCURRENCY * 2);
/** Не чаще одного уведомления о прогрессе за это время; смена состояния уходит сразу. */
const EMIT_INTERVAL_MS = 200;

export class UploadEngine {
  private readonly options: UploadEngineOptions;
  private readonly env: UploadEnv;
  private readonly meter = new SpeedMeter();

  private phase: UploadPhase = 'idle';
  private session: UploadSessionInfo | null = null;
  private pending: number[] = [];
  private readonly inFlight = new Map<number, InFlightPart>();
  private readonly done = new Map<number, number>();
  private readonly urls = new Map<number, SignedUrl>();
  /** Часть уже лежит в хранилище, но сервер ещё не знает её ETag: повторяем только сообщение. */
  private readonly storedEtags = new Map<number, string>();
  private signPromise: Promise<void> | null = null;
  private completeStarted = false;
  private canceling = false;
  /** Растёт при паузе, отмене, ошибке и новом запуске: задачи прошлого запуска себя узнают и выходят. */
  private runId = 0;
  private resumedParts = 0;
  private error: string | null = null;
  private video: AdminVideo | null = null;
  private lastEmit = 0;
  private destroyed = false;
  private unsubscribe: (() => void) | null = null;

  constructor(options: UploadEngineOptions) {
    this.options = options;
    this.env = { ...browserEnv, ...options.env };
  }

  getSnapshot(): UploadSnapshot {
    const { file } = this.options;
    let confirmedBytes = 0;
    for (const size of this.done.values()) confirmedBytes += size;
    const loaded = [...this.inFlight.values()].map((part) => part.loaded);
    const progress = computeProgress(confirmedBytes, loaded, file.size);
    const speed = this.phase === 'uploading' ? this.meter.rate(this.env.now()) : 0;
    return {
      phase: this.phase,
      sessionId: this.session?.id ?? null,
      fileName: file.name,
      fileSize: file.size,
      totalParts: this.session?.totalParts ?? 0,
      doneParts: this.done.size,
      resumedParts: this.resumedParts,
      confirmedBytes,
      uploadedBytes: progress.uploadedBytes,
      percent: progress.percent,
      speedBytesPerSecond: speed,
      etaSeconds: this.phase === 'uploading' ? etaSeconds(file.size - progress.uploadedBytes, speed) : null,
      error: this.error,
      video: this.video,
    };
  }

  /** Создать или найти сессию и начать отправку недостающих частей. */
  async start(): Promise<void> {
    if (this.phase !== 'idle') return;
    this.unsubscribe = this.env.onConnectivity((online) => this.handleConnectivity(online));
    await this.begin();
  }

  /** Повтор после ошибки: продолжает с частей, которых нет на сервере. */
  async retry(): Promise<void> {
    if (this.phase !== 'error') return;
    // Все части уже приняты — упала только финальная проверка. Сессию заново не создаём:
    // иначе сервер, успевший собрать файл, завёл бы новую и файл пришлось бы грузить с нуля.
    if (this.session && this.pending.length === 0 && this.done.size === this.session.totalParts) {
      this.error = null;
      await this.finish();
      return;
    }
    await this.begin();
  }

  pause(): void {
    if (this.phase !== 'uploading' && this.phase !== 'offline') return;
    this.runId++;
    this.abortInFlight();
    this.setPhase('paused');
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    if (!this.env.isOnline()) {
      this.setPhase('offline');
      return;
    }
    this.meter.reset();
    this.setPhase('uploading');
    this.pump();
  }

  /**
   * Отменить загрузку и удалить сессию на сервере. При сбое удаления бросает ошибку,
   * а загрузка остаётся на паузе — её можно продолжить или отменить ещё раз.
   */
  async cancel(): Promise<void> {
    if (this.canceling || ['idle', 'preparing', 'verifying', 'done', 'canceled'].includes(this.phase)) return;
    this.canceling = true;
    this.runId++;
    this.abortInFlight();
    this.error = null;
    this.setPhase('paused');
    try {
      if (this.session) {
        await this.options.api<OkResponse>(`/api/admin/uploads/${encodeURIComponent(this.session.id)}`, {
          method: 'DELETE',
        });
      }
      this.setPhase('canceled');
      this.release();
    } finally {
      this.canceling = false;
    }
  }

  /** Остановить всё без удаления сессии (уход со страницы): загрузку можно будет возобновить. */
  destroy(): void {
    this.destroyed = true;
    this.runId++;
    this.abortInFlight();
    this.release();
  }

  // ───────────────────────── Внутреннее ─────────────────────────

  private release(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private emit(force: boolean): void {
    if (this.destroyed) return;
    const now = this.env.now();
    if (!force && now - this.lastEmit < EMIT_INTERVAL_MS) return;
    this.lastEmit = now;
    this.options.onChange(this.getSnapshot());
  }

  private setPhase(phase: UploadPhase): void {
    this.phase = phase;
    this.emit(true);
  }

  private fail(err: unknown): void {
    this.runId++;
    this.abortInFlight();
    this.error = err instanceof Error ? err.message : 'Неизвестная ошибка при загрузке.';
    this.setPhase('error');
  }

  private abortInFlight(): void {
    const returned = [...this.inFlight.keys()];
    for (const part of this.inFlight.values()) part.controller.abort();
    this.inFlight.clear();
    this.pending = requeueParts(this.pending, returned);
  }

  private handleConnectivity(online: boolean): void {
    if (online && this.phase === 'offline') {
      this.meter.reset();
      this.setPhase('uploading');
      this.pump();
    } else if (!online && this.phase === 'uploading') {
      this.goOffline();
    }
  }

  private goOffline(): void {
    this.runId++;
    this.abortInFlight();
    this.setPhase('offline');
  }

  private async begin(): Promise<void> {
    const run = ++this.runId;
    const { file, slug, mimeType, api } = this.options;
    this.error = null;
    this.setPhase('preparing');
    try {
      const request: CreateUploadRequest = {
        slug,
        fileName: file.name,
        fileSize: file.size,
        mimeType,
        fileLastModified: file.lastModified,
      };
      const { session } = await api<UploadSessionResponse>('/api/admin/uploads', { method: 'POST', body: request });
      if (run !== this.runId) return;

      if (session.fileSize !== file.size || session.totalParts !== countParts(file.size, session.partSize)) {
        throw new Error('Сервер вернул сессию загрузки для другого файла. Отмените её и начните заново.');
      }
      if (session.state !== 'active' && session.state !== 'completing') {
        throw new Error('Эта сессия загрузки уже закрыта. Обновите страницу и выберите файл ещё раз.');
      }

      this.session = session;
      this.options.onSession?.(session);
      const accepted = acceptedParts(session.uploadedParts, file.size, session.partSize);
      this.done.clear();
      for (const [partNumber, size] of accepted) this.done.set(partNumber, size);
      this.resumedParts = accepted.size;
      this.pending = missingPartNumbers(session.totalParts, accepted);
      this.urls.clear();
      this.storedEtags.clear();
      this.meter.reset();

      if (!this.env.isOnline()) {
        this.setPhase('offline');
        return;
      }
      this.setPhase('uploading');
      this.pump();
    } catch (err) {
      if (run === this.runId) this.fail(err);
    }
  }

  /** Занять свободные потоки частями из очереди; если всё отправлено — перейти к проверке. */
  private pump(): void {
    if (this.phase !== 'uploading') return;
    const { take, rest } = takeNextParts(this.pending, this.inFlight.size, UPLOAD_CONCURRENCY);
    this.pending = rest;
    for (const partNumber of take) {
      const controller = new AbortController();
      this.inFlight.set(partNumber, { loaded: 0, controller });
      void this.runPart(partNumber, controller, this.runId);
    }
    if (this.inFlight.size === 0 && this.pending.length === 0) void this.finish();
  }

  /** Отправка одной части с повторами. Никогда не бросает: все исходы обработаны внутри. */
  private async runPart(partNumber: number, controller: AbortController, run: number): Promise<void> {
    const session = this.session;
    if (!session) return;
    const range = partRange(partNumber, this.options.file.size, session.partSize);

    for (let attempt = 1; ; attempt++) {
      try {
        const part = await this.uploadPartOnce(session, range, controller.signal);
        this.markDone(part, range, controller);
        if (run === this.runId) this.pump();
        return;
      } catch (err) {
        // Пауза, отмена, офлайн или ошибка соседней части: часть уже возвращена в очередь.
        if (run !== this.runId || controller.signal.aborted) return;

        const failure = toFailure(err);
        if (failure.kind === 'network' && !this.env.isOnline()) {
          this.goOffline();
          return;
        }
        const decision = decideRetry(failure, attempt, this.env.random());
        if (decision.action === 'fail') {
          if (decision.unauthorized) this.options.onUnauthorized?.();
          this.fail(new Error(decision.message));
          return;
        }
        if (decision.resign) this.urls.delete(partNumber);
        const entry = this.inFlight.get(partNumber);
        if (entry) entry.loaded = 0;
        this.emit(true);

        await this.env.sleep(decision.delayMs, controller.signal);
        if (run !== this.runId || controller.signal.aborted) return;
      }
    }
  }

  private async uploadPartOnce(
    session: UploadSessionInfo,
    range: PartRange,
    signal: AbortSignal,
  ): Promise<UploadedPart> {
    const { file, api, transport, getCsrfToken } = this.options;
    const partNumber = range.partNumber;
    let etag = this.storedEtags.get(partNumber);

    if (etag === undefined) {
      const signed = await this.ensureUrl(session, partNumber);
      if (signal.aborted) throw new DOMException('Отправка отменена.', 'AbortError');

      const result = await transport.put({
        url: signed.url,
        // slice не читает файл: браузер отправит этот кусок с диска потоком.
        body: file.slice(range.start, range.end),
        viaApi: signed.viaApi,
        csrfToken: signed.viaApi ? getCsrfToken() : null,
        signal,
        onProgress: (loaded) => this.handleProgress(partNumber, loaded, range.size),
      });

      if (result.status < 200 || result.status >= 300) {
        const body = errorBodySchema.safeParse(parseJson(result.body));
        throw new PartHttpError(result.status, signed.viaApi, body.success ? body.data.error.message : undefined);
      }
      if (signed.viaApi) {
        const parsed = partResponseSchema.safeParse(parseJson(result.body));
        // Непонятный ответ на успешный код — считаем сбоем сервера и повторяем часть.
        if (!parsed.success) throw new PartHttpError(502, true);
        return parsed.data.part;
      }
      if (!result.etag) throw new MissingEtagError();
      etag = result.etag;
      this.storedEtags.set(partNumber, etag);
    }

    const report: ReportPartRequest = { etag, sizeBytes: range.size };
    const { part } = await api<PartResponse>(
      `/api/admin/uploads/${encodeURIComponent(session.id)}/parts/${partNumber}`,
      { method: 'POST', body: report, signal },
    );
    this.storedEtags.delete(partNumber);
    return part;
  }

  private markDone(part: UploadedPart, range: PartRange, controller: AbortController): void {
    if (this.destroyed || this.phase === 'canceled') return;
    // Подтверждение могло прийти уже после паузы — часть всё равно принята сервером.
    this.done.set(range.partNumber, range.size);
    if (this.inFlight.get(range.partNumber)?.controller === controller) this.inFlight.delete(range.partNumber);
    this.pending = this.pending.filter((n) => n !== part.partNumber);
    this.emit(true);
  }

  private handleProgress(partNumber: number, loaded: number, partSize: number): void {
    const entry = this.inFlight.get(partNumber);
    if (!entry) return;
    const next = Math.min(Math.max(loaded, 0), partSize);
    const delta = next - entry.loaded;
    entry.loaded = next;
    if (delta > 0) this.meter.add(this.env.now(), delta);
    this.emit(false);
  }

  /** Действующая ссылка для части. Запросы подписи идут по одному: потоки ждут общий ответ. */
  private async ensureUrl(session: UploadSessionInfo, partNumber: number): Promise<SignedUrl> {
    for (let round = 0; round < 3; round++) {
      const current = this.urls.get(partNumber);
      if (current && current.deadline > this.env.now()) return current;
      this.signPromise ??= this.signBatch(session, partNumber).finally(() => {
        this.signPromise = null;
      });
      await this.signPromise;
    }
    throw new Error('Сервер не выдал ссылку для загрузки части файла. Попробуйте ещё раз.');
  }

  private async signBatch(session: UploadSessionInfo, first: number): Promise<void> {
    const now = this.env.now();
    const upcoming = [...this.inFlight.keys(), ...this.pending];
    const request: SignPartsRequest = {
      partNumbers: pickPartsToSign(
        first,
        upcoming,
        (n) => this.storedEtags.has(n) || (this.urls.get(n)?.deadline ?? 0) > now,
        SIGN_BATCH,
      ),
    };
    const response = await this.options.api<SignPartsResponse>(
      `/api/admin/uploads/${encodeURIComponent(session.id)}/parts/sign`,
      { method: 'POST', body: request },
    );
    const deadline = urlDeadline(this.env.now(), response.expiresInSeconds);
    for (const part of response.parts) {
      this.urls.set(part.partNumber, { url: part.url, viaApi: part.viaApi, deadline });
    }
  }

  /** Финальная проверка на сервере. Одновременно выполняется не больше одного вызова complete. */
  private async finish(): Promise<void> {
    const session = this.session;
    if (!session || this.completeStarted) return;
    this.completeStarted = true;
    const run = ++this.runId;
    this.setPhase('verifying');
    try {
      const { video } = await this.options.api<CompleteUploadResponse>(
        `/api/admin/uploads/${encodeURIComponent(session.id)}/complete`,
        { method: 'POST', body: this.options.meta },
      );
      this.video = video;
      this.setPhase('done');
      this.release();
    } catch (err) {
      this.completeStarted = false;
      if (run !== this.runId) return;
      const reason = err instanceof Error ? err.message : 'неизвестная ошибка';
      this.fail(
        new Error(
          `Все части отправлены, но сервер не подтвердил файл: ${reason} Нажмите «Повторить проверку». Если не поможет — обновите страницу: возможно, файл уже появился в списке версий.`,
        ),
      );
    }
  }
}
