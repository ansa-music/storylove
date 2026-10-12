// Отправка одной части через XMLHttpRequest: только он даёт прогресс отправки (upload.onprogress).

import { CSRF_HEADER } from '@shared/constants';

export interface PartPutRequest {
  url: string;
  body: Blob;
  /** true — адрес этого же сайта (нужны cookie и CSRF); false — подписанная ссылка хранилища. */
  viaApi: boolean;
  csrfToken: string | null;
  signal: AbortSignal;
  onProgress: (loadedBytes: number) => void;
}

export interface PartPutResult {
  status: number;
  /** Заголовок ETag ответа. null — заголовка нет или он не открыт в CORS. */
  etag: string | null;
  body: string;
}

export interface PartTransport {
  put(request: PartPutRequest): Promise<PartPutResult>;
}

/** Обрыв связи или зависшее соединение — повторяемая ошибка. */
export class TransportNetworkError extends Error {
  constructor(message = 'Соединение прервалось при отправке части файла.') {
    super(message);
    this.name = 'TransportNetworkError';
  }
}

/** Если отправка не двигается столько времени, считаем соединение зависшим. */
const STALL_TIMEOUT_MS = 90_000;

export const xhrTransport: PartTransport = {
  put(request) {
    return new Promise<PartPutResult>((resolve, reject) => {
      if (request.signal.aborted) {
        reject(new DOMException('Отправка отменена.', 'AbortError'));
        return;
      }
      const xhr = new XMLHttpRequest();
      let stallTimer = 0;
      let stalled = false;

      const armStallTimer = (): void => {
        window.clearTimeout(stallTimer);
        stallTimer = window.setTimeout(() => {
          stalled = true;
          xhr.abort();
        }, STALL_TIMEOUT_MS);
      };
      const cleanup = (): void => {
        window.clearTimeout(stallTimer);
        request.signal.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => xhr.abort();

      xhr.open('PUT', request.url);
      if (request.viaApi) {
        xhr.withCredentials = true;
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        if (request.csrfToken) xhr.setRequestHeader(CSRF_HEADER, request.csrfToken);
      }
      // Для подписанной ссылки — никаких cookie и лишних заголовков: они не входят в подпись
      // и превратили бы запрос в «непростой» с точки зрения CORS.

      xhr.upload.onprogress = (event) => {
        armStallTimer();
        request.onProgress(event.loaded);
      };
      xhr.onload = () => {
        cleanup();
        resolve({ status: xhr.status, etag: xhr.getResponseHeader('ETag'), body: xhr.responseText });
      };
      xhr.onerror = () => {
        cleanup();
        reject(new TransportNetworkError());
      };
      xhr.onabort = () => {
        cleanup();
        if (stalled) reject(new TransportNetworkError('Отправка части файла зависла.'));
        else reject(new DOMException('Отправка отменена.', 'AbortError'));
      };

      request.signal.addEventListener('abort', onAbort);
      armStallTimer();
      xhr.send(request.body);
    });
  },
};
