import { useCallback, useState } from 'react';

import type {
  AdminFilm,
  AdminFilmResponse,
  AdminVideo,
  DeleteVideoRequest,
  OkResponse,
  VideoCheckResponse,
} from '@shared/api';
import { VideoUploader } from '@/features/uploads/VideoUploader';
import { errorMessage } from '@/lib/api';

import { useAuth } from '../../auth/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toasts';
import { Card, EmptyState, Notice, Spinner, StatusBadge } from '../../components/ui';
import { VIDEO_STATUS_LABELS } from '../../lib/filmStatus';
import { formatBytes, formatDate, formatDuration, formatResolution } from '../../lib/format';

interface VideoSectionProps {
  film: AdminFilm;
  onFilmChange: (film: AdminFilm) => void;
  /** Перечитать фильм с сервера (после загрузки или удаления версии). */
  reload: () => void;
}

interface CheckState {
  videoId: string;
  loading: boolean;
  result: VideoCheckResponse | null;
  error: string | null;
}

type DialogState = { kind: 'publish'; video: AdminVideo } | { kind: 'delete'; video: AdminVideo } | null;

/** Видео уровня: загрузка новой версии, предпросмотр, публикация с проверкой и список версий. */
export function VideoSection({ film, onFilmChange, reload }: VideoSectionProps) {
  const { call, expire } = useAuth();
  const toast = useToast();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckState | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const active = film.activeVideo;
  const newestReady = film.videos.find((video) => video.status === 'ready') ?? null;
  const preview = film.videos.find((video) => video.id === previewId) ?? newestReady;
  /** Удалять прежние версии предлагаем только после успешной проверки нынешней опубликованной. */
  const activeVerified = Boolean(active && check?.videoId === active.id && check.result?.ok);

  const runCheck = useCallback(
    async (videoId: string) => {
      setCheck({ videoId, loading: true, result: null, error: null });
      try {
        const result = await call<VideoCheckResponse>(
          `/api/admin/videos/${encodeURIComponent(videoId)}/check`,
        );
        setCheck({ videoId, loading: false, result, error: null });
      } catch (err) {
        setCheck({ videoId, loading: false, result: null, error: errorMessage(err) });
      }
    },
    [call],
  );

  const handleUploaded = useCallback(
    (video: AdminVideo) => {
      setPreviewId(video.id);
      reload();
    },
    [reload],
  );

  async function publish(video: AdminVideo): Promise<void> {
    setDialogBusy(true);
    setDialogError(null);
    try {
      const { film: next } = await call<AdminFilmResponse>(
        `/api/admin/videos/${encodeURIComponent(video.id)}/publish`,
        {
          method: 'POST',
        },
      );
      onFilmChange(next);
      setDialog(null);
      toast.success('Версия опубликована. Проверяем, как она открывается для посетителей…');
      await runCheck(video.id);
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setDialogBusy(false);
    }
  }

  async function remove(video: AdminVideo): Promise<void> {
    setDialogBusy(true);
    setDialogError(null);
    try {
      const body: DeleteVideoRequest = { confirm: true };
      await call<OkResponse>(`/api/admin/videos/${encodeURIComponent(video.id)}`, { method: 'DELETE', body });
      setDialog(null);
      if (previewId === video.id) setPreviewId(null);
      toast.success(`Версия удалена, освобождено ${formatBytes(video.sizeBytes)}.`);
      reload();
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setDialogBusy(false);
    }
  }

  function openDialog(next: DialogState): void {
    setDialogError(null);
    setDialog(next);
  }

  return (
    <Card
      title="Видео"
      description="Новая версия сначала загружается и проверяется, и только потом публикуется отдельным действием. Прежняя версия остаётся на сайте, пока вы не опубликуете новую."
    >
      <VideoUploader slug={film.slug} call={call} onUnauthorized={expire} onUploaded={handleUploaded} />

      {preview && preview.status !== 'active' && (
        <div className="mt-6 rounded-lg border border-ink-600 bg-ink-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 text-sm font-semibold break-all text-pearl">
              Предпросмотр: {preview.originalFilename}
            </p>
            <StatusBadge tone={VIDEO_STATUS_LABELS[preview.status].tone}>
              {VIDEO_STATUS_LABELS[preview.status].label}
            </StatusBadge>
          </div>
          <video
            key={preview.id}
            controls
            preload="metadata"
            playsInline
            src={preview.url}
            className="mt-3 aspect-video w-full rounded-md bg-ink-950"
          >
            Браузер не может показать это видео.
          </video>
          <p className="mt-2 text-xs text-ink-300">
            Эту версию видите только вы. Посетители увидят её после публикации.
          </p>
          {preview.status === 'ready' && (
            <button
              type="button"
              className="btn btn-gold btn-sm mt-3"
              onClick={() => openDialog({ kind: 'publish', video: preview })}
            >
              Опубликовать эту версию
            </button>
          )}
        </div>
      )}

      {active && (
        <div className="mt-6 rounded-lg border border-ink-600 bg-ink-900 p-4" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-pearl">Проверка опубликованной версии</p>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={check?.loading}
              onClick={() => void runCheck(active.id)}
            >
              {check?.loading && <Spinner className="size-4" />}
              {check?.videoId === active.id && !check.loading
                ? 'Проверить ещё раз'
                : 'Проверить воспроизведение'}
            </button>
          </div>
          {(!check || check.videoId !== active.id) && (
            <p className="mt-2 text-sm text-ink-200">
              Проверка показывает, отдаётся ли опубликованный файл посетителям и можно ли его перематывать.
            </p>
          )}
          {check?.videoId === active.id && check.loading && (
            <p className="mt-2 text-sm text-ink-200">Проверяем публичное воспроизведение…</p>
          )}
          {check?.videoId === active.id && check.error && (
            <Notice tone="danger" className="mt-3">
              Проверку выполнить не удалось: {check.error}
            </Notice>
          )}
          {check?.videoId === active.id && check.result && (
            <>
              <Notice tone={check.result.ok ? 'ok' : 'danger'} className="mt-3">
                {check.result.ok
                  ? 'Проверка пройдена: посетители видят новую версию.'
                  : 'Проверка не пройдена. Прежние версии не удаляйте, пока не разберётесь с причиной.'}
              </Notice>
              <ul className="mt-3 space-y-2">
                {check.result.checks.map((item) => (
                  <li key={item.name} className="flex items-start gap-2 text-sm">
                    <span className={`mt-0.5 shrink-0 font-semibold ${item.ok ? 'text-ok' : 'text-danger'}`}>
                      {item.ok ? 'Да' : 'Нет'}
                    </span>
                    <span className="min-w-0">
                      <span className="text-pearl">{item.name}</span>
                      {item.detail && <span className="block break-words text-ink-300">{item.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <h3 className="mt-8 mb-3 font-sans text-sm font-semibold tracking-normal text-pearl">Версии</h3>
      {film.videos.length === 0 ? (
        <EmptyState>Видео ещё не загружено. Посетители видят надпись «Мультфильм скоро появится».</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-ink-700">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="bg-ink-800 text-xs text-ink-300">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Файл
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Размер
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Длительность
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Статус
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Загружено
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Опубликовано
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700">
              {film.videos.map((video) => (
                <tr key={video.id} className="align-top">
                  <th scope="row" className="max-w-[16rem] px-3 py-2.5 font-normal break-all text-pearl">
                    {video.originalFilename}
                    <span className="block text-xs text-ink-400">
                      {formatResolution(video.width, video.height)}
                    </span>
                  </th>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                    {formatBytes(video.sizeBytes)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                    {formatDuration(video.durationSeconds)}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge tone={VIDEO_STATUS_LABELS[video.status].tone}>
                      {VIDEO_STATUS_LABELS[video.status].label}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(video.createdAt)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(video.publishedAt)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1.5">
                      {video.status !== 'active' && (
                        <button
                          type="button"
                          className="text-gold underline-offset-2 hover:underline"
                          onClick={() => setPreviewId(video.id)}
                        >
                          Предпросмотр
                        </button>
                      )}
                      {video.status !== 'active' && (
                        <button
                          type="button"
                          className="text-gold underline-offset-2 hover:underline"
                          onClick={() => openDialog({ kind: 'publish', video })}
                        >
                          {video.status === 'archived' ? 'Опубликовать снова' : 'Опубликовать'}
                        </button>
                      )}
                      {video.status === 'ready' && (
                        <button
                          type="button"
                          className="text-danger underline-offset-2 hover:underline"
                          onClick={() => openDialog({ kind: 'delete', video })}
                        >
                          Удалить
                        </button>
                      )}
                      {video.status === 'archived' &&
                        (activeVerified ? (
                          <button
                            type="button"
                            className="text-left text-danger underline-offset-2 hover:underline"
                            onClick={() => openDialog({ kind: 'delete', video })}
                          >
                            Удалить предыдущую версию (освободит {formatBytes(video.sizeBytes)})
                          </button>
                        ) : (
                          <span className="text-xs text-ink-400">
                            Удаление станет доступно после успешной проверки опубликованной версии.
                          </span>
                        ))}
                      {video.status === 'active' && (
                        <span className="text-xs text-ink-400">Показывается на сайте</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={dialog?.kind === 'publish'}
        title="Опубликовать эту версию?"
        confirmLabel="Опубликовать"
        busy={dialogBusy}
        error={dialogError}
        onConfirm={() => {
          if (dialog?.kind === 'publish') void publish(dialog.video);
        }}
        onClose={() => setDialog(null)}
      >
        <p>
          Посетители сразу начнут видеть файл «{dialog?.video.originalFilename}» (
          {formatBytes(dialog?.video.sizeBytes)}).
        </p>
        {active && active.id !== dialog?.video.id && (
          <p>
            Нынешняя версия «{active.originalFilename}» станет предыдущей и останется в хранилище, пока вы её
            не удалите.
          </p>
        )}
        {!film.isPublished && (
          <p>Уровень сейчас скрыт: видео появится на сайте, когда вы включите показ уровня.</p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        title="Удалить версию видео?"
        confirmLabel="Удалить навсегда"
        danger
        busy={dialogBusy}
        error={dialogError}
        onConfirm={() => {
          if (dialog?.kind === 'delete') void remove(dialog.video);
        }}
        onClose={() => setDialog(null)}
      >
        <p>
          Файл «{dialog?.video.originalFilename}» будет удалён из хранилища, освободится{' '}
          {formatBytes(dialog?.video.sizeBytes)}.
        </p>
        <p>Вернуть его можно будет только повторной загрузкой.</p>
      </ConfirmDialog>
    </Card>
  );
}
