import { AwsClient } from 'aws4fetch';

import type { SignedPart, UploadMode } from '../../shared/api.ts';
import { PART_URL_TTL_SECONDS } from '../../shared/constants.ts';
import { hasR2Credentials, type AppEnv } from '../env.ts';
import { ApiError, badRequest, storageError } from '../lib/errors.ts';

export interface StoredPart {
  partNumber: number;
  etag: string;
  sizeBytes: number;
}

export interface PartTarget {
  sessionId: string;
  key: string;
  uploadId: string;
  partNumber: number;
}

/** Единый интерфейс multipart-загрузки; реализации — presign (S3 API R2) и binding (R2-биндинг). */
export interface MultipartStorage {
  readonly mode: UploadMode;
  /** Начинает multipart-загрузку и возвращает её идентификатор. */
  create(key: string, contentType: string): Promise<string>;
  /** Адрес, на который клиент отправляет тело части методом PUT. */
  signPart(target: PartTarget): Promise<SignedPart>;
  /** Записывает часть потоком через Worker. Возвращает ETag части. */
  putPart(target: PartTarget, body: ReadableStream<Uint8Array>, sizeBytes: number): Promise<string>;
  /** Авторитетный список частей в хранилище; null — хранилище его не отдаёт (верим учёту в базе). */
  listParts(key: string, uploadId: string): Promise<StoredPart[] | null>;
  complete(key: string, uploadId: string, parts: StoredPart[]): Promise<void>;
  /** Прерывает загрузку. Уже прерванная или несуществующая загрузка ошибкой не считается. */
  abort(key: string, uploadId: string): Promise<void>;
}

// ───────────────────────── binding: локальная разработка и тесты ─────────────────────────

class BindingStorage implements MultipartStorage {
  readonly mode = 'binding' as const;
  readonly #bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket;
  }

  async create(key: string, contentType: string): Promise<string> {
    const upload = await this.#bucket.createMultipartUpload(key, {
      httpMetadata: { contentType },
    });
    return upload.uploadId;
  }

  signPart(target: PartTarget): Promise<SignedPart> {
    return Promise.resolve({
      partNumber: target.partNumber,
      url: `/api/admin/uploads/${target.sessionId}/parts/${String(target.partNumber)}/data`,
      viaApi: true,
    });
  }

  async putPart(target: PartTarget, body: ReadableStream<Uint8Array>, sizeBytes: number): Promise<string> {
    const upload = this.#bucket.resumeMultipartUpload(target.key, target.uploadId);
    // FixedLengthStream сообщает R2 длину тела и обрывает запись, если байтов пришло больше или меньше.
    // Тело идёт потоком и целиком в память не читается.
    const part = await upload.uploadPart(
      target.partNumber,
      body.pipeThrough(new FixedLengthStream(sizeBytes)),
    );
    return part.etag;
  }

  listParts(): Promise<StoredPart[] | null> {
    return Promise.resolve(null);
  }

  async complete(key: string, uploadId: string, parts: StoredPart[]): Promise<void> {
    const upload = this.#bucket.resumeMultipartUpload(key, uploadId);
    await upload.complete(parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })));
  }

  async abort(key: string, uploadId: string): Promise<void> {
    try {
      await this.#bucket.resumeMultipartUpload(key, uploadId).abort();
    } catch (error) {
      // 10024 NoSuchUpload: загрузка уже завершена или прервана — прерывать нечего.
      if (error instanceof Error && /10024|does not exist|NoSuchUpload/i.test(error.message)) return;
      throw error;
    }
  }
}

// ───────────────────────── presign: боевой режим, S3 API R2 ─────────────────────────

function decodeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function encodeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function xmlTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return match?.[1] === undefined ? null : decodeXml(match[1]);
}

export function parseListPartsXml(xml: string): {
  parts: StoredPart[];
  nextMarker: string | null;
} {
  const parts: StoredPart[] = [];
  for (const match of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
    const block = match[1] ?? '';
    const partNumber = Number(xmlTag(block, 'PartNumber'));
    const sizeBytes = Number(xmlTag(block, 'Size'));
    const etag = xmlTag(block, 'ETag');
    if (!Number.isInteger(partNumber) || !Number.isInteger(sizeBytes) || !etag) {
      throw storageError('Хранилище вернуло непонятный список частей.');
    }
    parts.push({ partNumber, etag, sizeBytes });
  }
  const truncated = xmlTag(xml, 'IsTruncated') === 'true';
  return { parts, nextMarker: truncated ? xmlTag(xml, 'NextPartNumberMarker') : null };
}

class PresignStorage implements MultipartStorage {
  readonly mode = 'presign' as const;
  readonly #client: AwsClient;
  readonly #endpoint: string;

  constructor(accountId: string, bucket: string, accessKeyId: string, secretAccessKey: string) {
    this.#client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
    this.#endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
  }

  #url(key: string, query: Record<string, string>): string {
    const url = new URL(`${this.#endpoint}/${key.split('/').map(encodeURIComponent).join('/')}`);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return url.toString();
  }

  async #call(action: string, url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.#client.fetch(url, init);
    } catch (error) {
      throw new Error(`R2 S3 API: ${action}: сеть недоступна`, { cause: error });
    }
    return response;
  }

  async create(key: string, contentType: string): Promise<string> {
    const response = await this.#call('CreateMultipartUpload', this.#url(key, { uploads: '' }), {
      method: 'POST',
      headers: { 'Content-Type': contentType },
    });
    const xml = await response.text();
    const uploadId = response.ok ? xmlTag(xml, 'UploadId') : null;
    if (!uploadId) {
      throw storageError(
        `Хранилище не приняло начало загрузки (код ${String(response.status)}). Проверьте ключи R2.`,
      );
    }
    return uploadId;
  }

  async signPart(target: PartTarget): Promise<SignedPart> {
    const url = this.#url(target.key, {
      partNumber: String(target.partNumber),
      uploadId: target.uploadId,
      'X-Amz-Expires': String(PART_URL_TTL_SECONDS),
    });
    const signed = await this.#client.sign(new Request(url, { method: 'PUT' }), {
      aws: { signQuery: true },
    });
    return { partNumber: target.partNumber, url: signed.url, viaApi: false };
  }

  putPart(): Promise<string> {
    return Promise.reject(
      badRequest('В боевом режиме части видео отправляются напрямую в хранилище по выданной ссылке.'),
    );
  }

  async listParts(key: string, uploadId: string): Promise<StoredPart[]> {
    const all: StoredPart[] = [];
    let marker: string | null = null;
    do {
      const query: Record<string, string> = { uploadId, 'max-parts': '1000' };
      if (marker) query['part-number-marker'] = marker;
      const response = await this.#call('ListParts', this.#url(key, query), { method: 'GET' });
      const xml = await response.text();
      if (!response.ok) {
        throw storageError(`Хранилище не отдало список частей (код ${String(response.status)}).`);
      }
      const page = parseListPartsXml(xml);
      all.push(...page.parts);
      marker = page.nextMarker;
    } while (marker);
    return all;
  }

  async complete(key: string, uploadId: string, parts: StoredPart[]): Promise<void> {
    const body =
      '<CompleteMultipartUpload>' +
      parts
        .map(
          (part) =>
            `<Part><PartNumber>${String(part.partNumber)}</PartNumber><ETag>${encodeXml(part.etag)}</ETag></Part>`,
        )
        .join('') +
      '</CompleteMultipartUpload>';
    const response = await this.#call('CompleteMultipartUpload', this.#url(key, { uploadId }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body,
    });
    const xml = await response.text();
    // S3 может ответить 200 и положить ошибку в тело.
    if (!response.ok || xml.includes('<Error>')) {
      throw storageError(
        `Хранилище не смогло собрать файл из частей (код ${String(response.status)}${
          xmlTag(xml, 'Code') ? `, ${xmlTag(xml, 'Code') ?? ''}` : ''
        }).`,
      );
    }
  }

  async abort(key: string, uploadId: string): Promise<void> {
    const response = await this.#call('AbortMultipartUpload', this.#url(key, { uploadId }), {
      method: 'DELETE',
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) {
      throw storageError(`Хранилище не прервало загрузку (код ${String(response.status)}).`);
    }
  }
}

/** Хранилище для режима, в котором была создана сессия (или для текущего режима). */
export function getMultipartStorage(env: AppEnv, mode: UploadMode): MultipartStorage {
  if (mode === 'binding') return new BindingStorage(env.MEDIA);
  if (!hasR2Credentials(env) || !env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new ApiError(
      500,
      'storage_error',
      'Загрузка видео недоступна: не настроены ключи R2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).',
    );
  }
  return new PresignStorage(
    env.R2_ACCOUNT_ID,
    env.R2_BUCKET_NAME,
    env.R2_ACCESS_KEY_ID,
    env.R2_SECRET_ACCESS_KEY,
  );
}
