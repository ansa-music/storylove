import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from 'react';

import type { AdminVideo, OkResponse, UploadSessionInfo, UploadSessionsResponse } from '@shared/api';
import { MAX_VIDEO_BYTES, VIDEO_EXTENSIONS, VIDEO_MIME_TYPES, type TierSlug } from '@shared/constants';
import { ConfirmDialog } from '@/features/admin/components/ConfirmDialog';
import { Notice, Spinner } from '@/features/admin/components/ui';
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatEta,
  formatResolution,
  formatSpeed,
} from '@/features/admin/lib/format';
import { errorMessage, getCsrfToken } from '@/lib/api';

import { inspectVideoFile, type VideoInspection } from './lib/fileChecks';
import { clearResumeRecord, isSameFile, loadResumeRecord, saveResumeRecord } from './lib/resume';
import { UploadEngine, type ApiCall, type UploadPhase, type UploadSnapshot } from './UploadEngine';
import { xhrTransport } from './xhrTransport';

interface VideoUploaderProps {
  slug: TierSlug;
  /** Запрос к API админки (сбрасывает сессию при 401). */
  call: ApiCall;
  /** Сервер ответил 401 на отправку части. */
  onUnauthorized: () => void;
  /** Файл загружен и подтверждён сервером. */
  onUploaded: (video: AdminVideo) => void;
}

interface Selection {
  file: File;
  inspection: VideoInspection | null;
}

const BUSY_PHASES: readonly UploadPhase[] = [
  'preparing',
  'uploading',
  'paused',
  'offline',
  'verifying',
  'error',
];

const PHASE_TEXT: Readonly<Record<UploadPhase, string>> = {
  idle: '',
  preparing: 'Готовим загрузку…',
  uploading: 'Загружаем',
  paused: 'Загрузка на паузе',
  offline: 'Нет связи с интернетом. Продолжим сами, как только она появится.',
  verifying: 'Проверяем файл на сервере…',
  done: 'Загружено и проверено',
  error: 'Загрузка остановлена',
  canceled: 'Загрузка отменена',
};

/** Загрузчик видео уровня: проверки файла, прогресс, пауза, отмена и возобновление. */
export function VideoUploader({ slug, call, onUnauthorized, onUploaded }: VideoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<UploadEngine | null>(null);
  const statusId = useId();

  const [pending, setPending] = useState<UploadSessionInfo | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsNonce, setSessionsNonce] = useState(0);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [snapshot, setSnapshot] = useState<UploadSnapshot | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger' | 'info'; text: string } | null>(null);

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const phase = snapshot?.phase ?? 'idle';
  const engineBusy = BUSY_PHASES.includes(phase);

  // Незавершённые загрузки этого уровня: сервер — источник правды, localStorage — только подсказка.
  useEffect(() => {
    const controller = new AbortController();
    call<UploadSessionsResponse>(`/api/admin/uploads?slug=${encodeURIComponent(slug)}`, {
      signal: controller.signal,
    })
      .then(({ sessions }) => {
        const open = sessions.filter(
          (s) => s.filmSlug === slug && (s.state === 'active' || s.state === 'completing'),
        );
        const remembered = loadResumeRecord(slug);
        const found = open.find((s) => s.id === remembered?.sessionId) ?? open[0] ?? null;
        // Запись о сессии, которой на сервере уже нет, бесполезна.
        if (remembered && found?.id !== remembered.sessionId) clearResumeRecord(slug);
        setPending(found);
        setSessionsError(null);
        setSessionsLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setSessionsError(errorMessage(err));
        setSessionsLoading(false);
      });
    return () => controller.abort();
  }, [call, slug, sessionsNonce]);

  // Уход со страницы: части перестают отправляться, сессия остаётся на сервере для возобновления.
  useEffect(
    () => () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    },
    [],
  );

  // Предупреждение при закрытии вкладки во время загрузки.
  useEffect(() => {
    if (!engineBusy) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [engineBusy]);

  const handleSnapshot = useCallback(
    (next: UploadSnapshot) => {
      setSnapshot(next);
      if (next.phase === 'done' && next.video) {
        clearResumeRecord(slug);
        engineRef.current = null;
        setPending(null);
        setSelection(null);
        onUploaded(next.video);
      }
    },
    [slug, onUploaded],
  );

  async function choose(file: File | undefined): Promise<void> {
    if (!file || engineBusy || starting) return;
    if (inputRef.current) inputRef.current.value = '';
    setMessage(null);
    setSnapshot(null);
    setSelection({ file, inspection: null });
    const inspection = await inspectVideoFile(file);
    // Пока шла проверка, могли выбрать другой файл.
    setSelection((current) => (current?.file === file ? { file, inspection } : current));
  }

  function startEngine(file: File, inspection: VideoInspection): void {
    const engine = new UploadEngine({
      file,
      slug,
      mimeType: VIDEO_MIME_TYPES[0],
      meta: {
        durationSeconds: inspection.metadata?.durationSeconds ?? null,
        width: inspection.metadata?.width ?? null,
        height: inspection.metadata?.height ?? null,
      },
      api: call,
      transport: xhrTransport,
      getCsrfToken,
      onUnauthorized,
      onChange: handleSnapshot,
      onSession: (session) => {
        setPending(session);
        saveResumeRecord({
          sessionId: session.id,
          slug,
          fileName: session.fileName,
          fileSize: session.fileSize,
          fileLastModified: session.fileLastModified,
        });
      },
    });
    engineRef.current?.destroy();
    engineRef.current = engine;
    setSnapshot(engine.getSnapshot());
    void engine.start();
  }

  function start(): void {
    if (!selection?.inspection || selection.inspection.errors.length > 0 || engineBusy || starting) return;
    if (pending && !isSameFile(selection.file, pending)) {
      setDialogError(null);
      setConfirmReplace(true);
      return;
    }
    startEngine(selection.file, selection.inspection);
  }

  async function deleteSession(id: string): Promise<void> {
    await call<OkResponse>(`/api/admin/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' });
    clearResumeRecord(slug);
    setPending(null);
  }

  /** Другой файл при незавершённой загрузке: старую сессию удаляем, новую начинаем. */
  async function replaceAndStart(): Promise<void> {
    if (!pending || !selection?.inspection) return;
    setDialogBusy(true);
    setDialogError(null);
    setStarting(true);
    try {
      await deleteSession(pending.id);
      setConfirmReplace(false);
      startEngine(selection.file, selection.inspection);
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setDialogBusy(false);
      setStarting(false);
    }
  }

  /** Отмена идущей загрузки. */
  async function cancelUpload(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      await engine.cancel();
      clearResumeRecord(slug);
      engineRef.current = null;
      setPending(null);
      setSnapshot(null);
      setSelection(null);
      setConfirmCancel(false);
      setMessage({ tone: 'info', text: 'Загрузка отменена, принятые части удалены с сервера.' });
    } catch (err) {
      setDialogError(`Не удалось отменить загрузку: ${errorMessage(err)}`);
    } finally {
      setDialogBusy(false);
    }
  }

  /** Отмена незавершённой загрузки из прошлого сеанса. */
  async function discardPending(): Promise<void> {
    if (!pending) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      await deleteSession(pending.id);
      setConfirmDiscard(false);
      setMessage({ tone: 'info', text: 'Незавершённая загрузка отменена, место освобождено.' });
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setDialogBusy(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragOver(false);
    void choose(event.dataTransfer.files[0]);
  }

  const inspection = selection?.inspection ?? null;
  const canStart = Boolean(inspection && inspection.errors.length === 0) && !engineBusy && !starting;
  const resuming = Boolean(pending && selection && isSameFile(selection.file, pending));
  const showPendingBanner = pending !== null && !engineBusy && phase !== 'done';
  const maxGb = (MAX_VIDEO_BYTES / 1024 ** 3).toLocaleString('ru-RU');

  return (
    <div className="space-y-4">
      {sessionsLoading && (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-200">
          <Spinner className="size-4" /> Проверяем незавершённые загрузки…
        </p>
      )}
      {sessionsError && (
        <Notice tone="warn">
          Не удалось проверить незавершённые загрузки: {sessionsError}{' '}
          <button type="button" className="underline" onClick={() => setSessionsNonce((n) => n + 1)}>
            Повторить
          </button>
        </Notice>
      )}

      {showPendingBanner && pending && (
        <Notice tone="warn">
          <p>
            Незавершённая загрузка <strong className="break-all">{pending.fileName}</strong> (
            {formatBytes(pending.fileSize)}
            ): принято {pending.uploadedParts.length} из {pending.totalParts} частей. Выберите тот же файл,
            чтобы продолжить.
          </p>
          <p className="mt-1 text-xs opacity-80">
            Начата {formatDate(pending.createdAt)}, хранится до {formatDate(pending.expiresAt)}.
          </p>
          <button
            type="button"
            className="btn btn-danger btn-sm mt-3"
            onClick={() => {
              setDialogError(null);
              setConfirmDiscard(true);
            }}
          >
            Отменить загрузку
          </button>
        </Notice>
      )}

      {!engineBusy && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors sm:py-14 ${
            dragOver ? 'border-gold bg-gold/5' : 'border-ink-600 bg-ink-900'
          }`}
        >
          <svg
            viewBox="0 0 48 48"
            className="mx-auto size-10 text-gold"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M24 32V10m0 0-8 8m8-8 8 8M8 34v4h32v-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="mt-4 text-base text-pearl">Перетащите сюда файл мультфильма</p>
          <p className="mt-1 text-sm text-ink-300">
            MP4 (H.264 + AAC), до {maxGb} ГБ. Загрузку можно поставить на паузу и продолжить позже.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={[...VIDEO_MIME_TYPES, ...VIDEO_EXTENSIONS].join(',')}
            className="hidden"
            tabIndex={-1}
            aria-label="Файл мультфильма"
            onChange={(event) => void choose(event.target.files?.[0])}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-5"
            disabled={starting}
            aria-describedby={statusId}
            onClick={() => inputRef.current?.click()}
          >
            Выбрать файл
          </button>
        </div>
      )}

      <div id={statusId} aria-live="polite" className="space-y-3">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        {selection && !engineBusy && phase !== 'done' && (
          <div className="rounded-lg border border-ink-600 bg-ink-800 p-4">
            <p className="text-sm font-semibold break-all text-pearl">{selection.file.name}</p>
            <p className="mt-1 text-sm text-ink-200">
              {formatBytes(selection.file.size)}
              {inspection?.metadata && (
                <>
                  {' · '}
                  {formatDuration(inspection.metadata.durationSeconds)}
                  {' · '}
                  {formatResolution(inspection.metadata.width, inspection.metadata.height)}
                </>
              )}
            </p>
            {!inspection && (
              <p className="mt-3 flex items-center gap-2 text-sm text-ink-200">
                <Spinner className="size-4" /> Проверяем файл…
              </p>
            )}
            {inspection && (
              <ul className="mt-3 space-y-2">
                {inspection.errors.map((text) => (
                  <li key={text}>
                    <Notice tone="danger">{text}</Notice>
                  </li>
                ))}
                {inspection.warnings.map((text) => (
                  <li key={text}>
                    <Notice tone="warn">{text}</Notice>
                  </li>
                ))}
                {inspection.errors.length === 0 && inspection.warnings.length === 0 && (
                  <li>
                    <Notice tone="ok">
                      Файл прошёл проверки: MP4, оптимизирован для потокового просмотра.
                    </Notice>
                  </li>
                )}
              </ul>
            )}
            {inspection && inspection.errors.length === 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn btn-gold btn-sm" onClick={start} disabled={!canStart}>
                  {resuming ? 'Продолжить загрузку' : 'Начать загрузку'}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => setSelection(null)}
                  disabled={starting}
                >
                  Убрать файл
                </button>
              </div>
            )}
            {resuming && pending && (
              <p className="mt-2 text-xs text-ink-300">
                Это тот же файл: загрузка продолжится с недостающих частей (
                {pending.totalParts - pending.uploadedParts.length} из {pending.totalParts}).
              </p>
            )}
          </div>
        )}

        {phase === 'done' && snapshot?.video && (
          <Notice tone="ok">
            Загружено и проверено: <span className="break-all">{snapshot.video.originalFilename}</span> (
            {formatBytes(snapshot.video.sizeBytes)}). Версия появилась в списке ниже со статусом «Загружено,
            не опубликовано» — посмотрите её и опубликуйте.
          </Notice>
        )}
      </div>

      {snapshot && engineBusy && (
        <UploadProgress
          snapshot={snapshot}
          onPause={() => engineRef.current?.pause()}
          onResume={() => engineRef.current?.resume()}
          onRetry={() => void engineRef.current?.retry()}
          onCancel={() => {
            setDialogError(null);
            setConfirmCancel(true);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Отменить загрузку?"
        confirmLabel="Отменить загрузку"
        cancelLabel="Не отменять"
        danger
        busy={dialogBusy}
        error={dialogError}
        onConfirm={() => void cancelUpload()}
        onClose={() => setConfirmCancel(false)}
      >
        <p>
          Уже принятые части ({snapshot ? formatBytes(snapshot.confirmedBytes) : '—'}) будут удалены с
          сервера. Продолжить эту загрузку потом не получится — файл придётся загружать с начала.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDiscard}
        title="Отменить незавершённую загрузку?"
        confirmLabel="Отменить загрузку"
        cancelLabel="Оставить"
        danger
        busy={dialogBusy}
        error={dialogError}
        onConfirm={() => void discardPending()}
        onClose={() => setConfirmDiscard(false)}
      >
        <p>
          Принятые части файла «{pending?.fileName}» ({pending?.uploadedParts.length ?? 0} из{' '}
          {pending?.totalParts ?? 0}) будут удалены с сервера.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmReplace}
        title="Выбран другой файл"
        confirmLabel="Отменить старую и начать новую"
        cancelLabel="Выбрать другой файл"
        danger
        busy={dialogBusy}
        error={dialogError}
        onConfirm={() => void replaceAndStart()}
        onClose={() => setConfirmReplace(false)}
      >
        <p>
          Для этого уровня есть незавершённая загрузка файла «{pending?.fileName}» (
          {formatBytes(pending?.fileSize)}), а выбран «{selection?.file.name}» (
          {formatBytes(selection?.file.size)}).
        </p>
        <p>Если продолжить, принятые части старого файла будут удалены, и начнётся загрузка нового.</p>
      </ConfirmDialog>
    </div>
  );
}

interface UploadProgressProps {
  snapshot: UploadSnapshot;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

function UploadProgress({ snapshot, onPause, onResume, onRetry, onCancel }: UploadProgressProps) {
  const { phase } = snapshot;
  const verifying = phase === 'verifying';
  const allSent = snapshot.totalParts > 0 && snapshot.doneParts === snapshot.totalParts;
  const percentText = snapshot.percent.toLocaleString('ru-RU', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const barTone =
    phase === 'error' ? 'bg-danger' : phase === 'paused' || phase === 'offline' ? 'bg-warn' : 'bg-gold';

  return (
    <div className="rounded-xl border border-ink-600 bg-ink-800 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-sm font-semibold break-all text-pearl">{snapshot.fileName}</p>
        <p className="text-2xl font-semibold tabular-nums text-pearl">{percentText}%</p>
      </div>

      <div
        role="progressbar"
        aria-label={`Загрузка файла ${snapshot.fileName}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(snapshot.percent)}
        aria-valuetext={`${percentText}%, ${PHASE_TEXT[phase]}`}
        className="mt-3 h-3 overflow-hidden rounded-full bg-ink-700"
      >
        <div className={`h-full rounded-full ${barTone}`} style={{ width: `${snapshot.percent}%` }} />
      </div>

      {/* Состояние объявляется диктору при смене фазы, а не на каждый процент. */}
      <p role="status" className="mt-3 flex items-center gap-2 text-sm text-ink-100">
        {(phase === 'uploading' || phase === 'preparing' || verifying) && <Spinner className="size-4" />}
        {PHASE_TEXT[phase]}
        {verifying && ' Не закрывайте страницу: файл ещё не принят.'}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-300">Отправлено</dt>
          <dd className="tabular-nums text-pearl">
            {formatBytes(snapshot.uploadedBytes)} из {formatBytes(snapshot.fileSize)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-300">Принято сервером</dt>
          <dd className="tabular-nums text-pearl">
            частей {snapshot.doneParts} из {snapshot.totalParts || '…'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-300">Скорость</dt>
          <dd className="tabular-nums text-pearl">
            {phase === 'uploading' ? formatSpeed(snapshot.speedBytesPerSecond) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-300">Осталось</dt>
          <dd className="tabular-nums text-pearl">
            {phase === 'uploading' ? formatEta(snapshot.etaSeconds) : '—'}
          </dd>
        </div>
      </dl>

      {snapshot.resumedParts > 0 && (
        <p className="mt-2 text-xs text-ink-300">
          Загрузка возобновлена: {snapshot.resumedParts} из {snapshot.totalParts} частей уже были на сервере.
        </p>
      )}
      {phase === 'error' && snapshot.error && (
        <Notice tone="danger" live className="mt-3">
          {snapshot.error}
        </Notice>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {phase === 'uploading' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onPause}>
            Пауза
          </button>
        )}
        {phase === 'offline' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onPause}>
            Поставить на паузу
          </button>
        )}
        {phase === 'paused' && (
          <button type="button" className="btn btn-gold btn-sm" onClick={onResume}>
            Продолжить
          </button>
        )}
        {phase === 'error' && (
          <button type="button" className="btn btn-gold btn-sm" onClick={onRetry}>
            {allSent ? 'Повторить проверку' : 'Повторить'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={onCancel}
          disabled={phase === 'preparing' || verifying}
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
