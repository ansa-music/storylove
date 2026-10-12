import { Link } from 'react-router';

import type { AdminFilmsResponse } from '@shared/api';

import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '../components/ui';
import { filmVideoStatus } from '../lib/filmStatus';
import { formatBytes, formatDate, formatDuration } from '../lib/format';
import { useAdminQuery } from '../lib/useAdminQuery';

export function FilmsPage() {
  const { data, error, loading, reload } = useAdminQuery<AdminFilmsResponse>('/api/admin/films');
  const films = data ? [...data.films].sort((a, b) => a.tierOrder - b.tierOrder) : [];

  return (
    <>
      <PageHeader
        title="Мультфильмы"
        description="Четыре уровня. Откройте уровень, чтобы заменить видео, изображения и тексты."
      />
      {!data && loading && <LoadingState label="Загружаем уровни…" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && films.length === 0 && <EmptyState>Уровни не найдены. Проверьте, что миграции базы применены.</EmptyState>}

      <ul className="mt-4 space-y-4">
        {films.map((film) => {
          const status = filmVideoStatus(film);
          return (
            <li key={film.slug}>
              <Link
                to={`/admin/films/${film.slug}`}
                className="flex flex-col gap-4 rounded-xl border border-ink-700 bg-ink-850 p-4 shadow-card transition-colors hover:border-gold/50 sm:flex-row sm:items-center sm:p-5"
              >
                <div className="aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-ink-900 sm:w-44">
                  {(film.posterUrl ?? film.carImageUrl) ? (
                    <img src={film.posterUrl ?? film.carImageUrl ?? undefined} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <span className="flex size-full items-center justify-center text-xs text-ink-400">Стандартное изображение</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="label text-gold/80">Уровень {String(film.tierOrder).padStart(2, '0')}</p>
                  <h2 className="mt-1.5 text-2xl break-words text-pearl">{film.title}</h2>
                  <p className="mt-1 text-sm break-words text-ink-200">{film.tagline}</p>
                </div>
                <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 text-sm sm:w-72">
                  <dt className="text-ink-300">Статус</dt>
                  <dd>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </dd>
                  <dt className="text-ink-300">Видео</dt>
                  <dd className="tabular-nums text-pearl">
                    {status.video ? `${formatBytes(status.video.sizeBytes)} · ${formatDuration(status.video.durationSeconds)}` : '—'}
                  </dd>
                  <dt className="text-ink-300">Версий</dt>
                  <dd className="tabular-nums text-pearl">{film.videos.length}</dd>
                  <dt className="text-ink-300">Изменён</dt>
                  <dd className="tabular-nums text-pearl">{formatDate(film.updatedAt)}</dd>
                </dl>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
