import { Link } from 'react-router';

import type { DashboardResponse, UploadMode, WarningLevel } from '@shared/api';

import {
  Card,
  ErrorState,
  LoadingState,
  Notice,
  PageHeader,
  Spinner,
  StatusBadge,
  UsageBar,
} from '../components/ui';
import { filmVideoStatus } from '../lib/filmStatus';
import { formatBytes, formatDate } from '../lib/format';
import { useAdminQuery } from '../lib/useAdminQuery';

const WARNING_TONE: Readonly<Record<WarningLevel, 'info' | 'warn' | 'danger'>> = {
  info: 'info',
  warning: 'warn',
  error: 'danger',
};
const WARNING_LABEL: Readonly<Record<WarningLevel, string>> = {
  info: 'К сведению',
  warning: 'Внимание',
  error: 'Ошибка',
};

const UPLOAD_MODE_TEXT: Readonly<Record<UploadMode, { title: string; detail: string }>> = {
  presign: {
    title: 'Напрямую в хранилище',
    detail: 'Части файла уходят из браузера сразу в R2 — так грузятся файлы по 2–3 ГБ.',
  },
  binding: {
    title: 'Через сервер сайта',
    detail:
      'Части файла идут в хранилище через сервер сайта. Загрузка работает, но каждая часть тратит лимит запросов сервера; после добавления ключей R2 части пойдут напрямую.',
  },
};

export function DashboardPage() {
  const { data, error, loading, reload } = useAdminQuery<DashboardResponse>('/api/admin/dashboard');

  return (
    <>
      <PageHeader
        title="Обзор"
        description="Состояние четырёх уровней, хранилища и то, что требует внимания."
        actions={
          <button type="button" className="btn btn-quiet btn-sm" onClick={reload} disabled={loading}>
            {loading && <Spinner className="size-4" />}
            Обновить
          </button>
        }
      />

      {!data && loading && <LoadingState label="Загружаем обзор…" />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {data && (
        <div className="mt-4 space-y-6">
          <Card title="Что требует внимания">
            {data.warnings.length === 0 ? (
              <Notice tone="ok">Замечаний нет: всё работает как задумано.</Notice>
            ) : (
              <ul className="space-y-2">
                {data.warnings.map((warning, index) => (
                  <li key={`${index}-${warning.message}`}>
                    <Notice tone={WARNING_TONE[warning.level]}>
                      <strong className="font-semibold">{WARNING_LABEL[warning.level]}: </strong>
                      {warning.message}
                    </Notice>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <section aria-label="Уровни">
            <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              {[...data.films]
                .sort((a, b) => a.tierOrder - b.tierOrder)
                .map((film) => {
                  const status = filmVideoStatus(film);
                  return (
                    <li
                      key={film.slug}
                      className="min-w-0 rounded-xl border border-ink-700 bg-ink-850 p-4 shadow-card sm:p-5"
                    >
                      <p className="label text-gold/80">Уровень {String(film.tierOrder).padStart(2, '0')}</p>
                      <h2 className="mt-2 text-2xl break-words text-pearl">{film.title}</h2>
                      <div className="mt-3">
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      </div>
                      <dl className="mt-4 space-y-1.5 text-sm">
                        <div className="flex justify-between gap-3">
                          <dt className="text-ink-300">Размер видео</dt>
                          <dd className="tabular-nums text-pearl">
                            {status.video ? formatBytes(status.video.sizeBytes) : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-ink-300">Изменён</dt>
                          <dd className="text-right tabular-nums text-pearl">{formatDate(film.updatedAt)}</dd>
                        </div>
                      </dl>
                      <Link to={`/admin/films/${film.slug}`} className="btn btn-quiet btn-sm mt-4 w-full">
                        Открыть<span className="sr-only"> уровень {film.title}</span>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card
              title="Хранилище"
              actions={
                <Link to="/admin/storage" className="text-sm text-gold underline-offset-2 hover:underline">
                  Подробнее
                </Link>
              }
            >
              <UsageBar usedBytes={data.storage.totalBytes} budgetBytes={data.storage.budgetBytes} />
              {data.storage.incompleteUploads.length > 0 && (
                <p className="mt-3 text-sm text-warn">
                  Незавершённых загрузок: {data.storage.incompleteUploads.length}. Их части занимают место,
                  пока загрузка не завершена или не прервана.
                </p>
              )}
            </Card>
            <Card title="Режим загрузки видео">
              <p className="text-sm font-semibold text-pearl">{UPLOAD_MODE_TEXT[data.uploadMode].title}</p>
              <p className="mt-1 text-sm text-ink-200">{UPLOAD_MODE_TEXT[data.uploadMode].detail}</p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
