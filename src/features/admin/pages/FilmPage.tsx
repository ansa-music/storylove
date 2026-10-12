import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';

import type { AdminFilm, AdminFilmResponse, UpdateFilmRequest } from '@shared/api';
import { isTierSlug, type FilmImageKind, type TierSlug } from '@shared/constants';
import { errorMessage } from '@/lib/api';

import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ImageField } from '../components/ImageField';
import { useToast } from '../components/Toasts';
import { Card, ErrorState, LoadingState, PageHeader, StatusBadge, Switch } from '../components/ui';
import { filmVideoStatus } from '../lib/filmStatus';
import { formatDate } from '../lib/format';
import { RASTER_RULES } from '../lib/imageOptimize';
import { useAdminQuery } from '../lib/useAdminQuery';
import { FilmTextForm } from './film/FilmTextForm';
import { VideoSection } from './film/VideoSection';

export function FilmPage() {
  const { slug } = useParams();
  if (!isTierSlug(slug)) {
    return (
      <>
        <PageHeader title="Уровень не найден" />
        <ErrorState message="Такого уровня нет. Доступны: Эконом, Базовый, Премиум и Ультима." />
        <Link to="/admin/films" className="btn btn-quiet btn-sm mt-4">
          К списку мультфильмов
        </Link>
      </>
    );
  }
  // key: при переходе на другой уровень формы и загрузчик начинают с чистого состояния.
  return <FilmEditor key={slug} slug={slug} />;
}

function FilmEditor({ slug }: { slug: TierSlug }) {
  const { call } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useAdminQuery<AdminFilmResponse>(`/api/admin/films/${slug}`);
  const [toggling, setToggling] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const film = data?.film ?? null;
  const setFilm = useCallback((next: AdminFilm) => setData({ film: next }), [setData]);

  async function setPublished(isPublished: boolean): Promise<void> {
    setToggling(true);
    setToggleError(null);
    try {
      const body: UpdateFilmRequest = { isPublished };
      const response = await call<AdminFilmResponse>(`/api/admin/films/${slug}`, { method: 'PATCH', body });
      setFilm(response.film);
      setConfirmHide(false);
      toast.success(isPublished ? 'Уровень показывается на сайте.' : 'Уровень скрыт с сайта.');
    } catch (err) {
      if (isPublished) toast.error(errorMessage(err));
      else setToggleError(errorMessage(err));
    } finally {
      setToggling(false);
    }
  }

  async function saveImage(kind: FilmImageKind, blob: Blob, contentType: string): Promise<void> {
    const response = await call<AdminFilmResponse>(`/api/admin/films/${slug}/image/${kind}`, {
      method: 'PUT',
      body: blob,
      contentType,
    });
    setFilm(response.film);
  }

  async function resetImage(kind: FilmImageKind): Promise<void> {
    const response = await call<AdminFilmResponse>(`/api/admin/films/${slug}/image/${kind}`, { method: 'DELETE' });
    setFilm(response.film);
  }

  if (!film) {
    return (
      <>
        <PageHeader title="Мультфильм" />
        {loading && <LoadingState label="Загружаем уровень…" />}
        {error && <ErrorState message={error} onRetry={reload} />}
      </>
    );
  }

  const status = filmVideoStatus(film);

  return (
    <>
      <nav aria-label="Навигация по разделу" className="mb-3 text-sm">
        <Link to="/admin/films" className="text-ink-200 underline-offset-2 hover:text-gold hover:underline">
          ← Все мультфильмы
        </Link>
      </nav>
      <PageHeader
        title={film.title}
        description={
          <>
            Уровень {film.tierOrder} из 4 · изменён {formatDate(film.updatedAt)} ·{' '}
            <a
              href={`/watch/${film.slug}`}
              target="_blank"
              rel="noreferrer"
              className="text-gold underline-offset-2 hover:underline"
            >
              страница на сайте
            </a>
          </>
        }
        actions={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
      />
      {error && <ErrorState message={`Не удалось обновить данные: ${error}`} onRetry={reload} />}

      <div className="mt-4 space-y-6">
        <Card title="Показ на сайте">
          <Switch
            checked={film.isPublished}
            disabled={toggling}
            label={film.isPublished ? 'Уровень показывается на сайте' : 'Уровень скрыт'}
            description={
              film.isPublished
                ? 'Посетители видят карточку уровня и могут смотреть опубликованное видео.'
                : 'Вместо видео посетители видят надпись «Мультфильм скоро появится». Загруженные файлы не удаляются.'
            }
            onChange={(next) => {
              if (next) void setPublished(true);
              else {
                setToggleError(null);
                setConfirmHide(true);
              }
            }}
          />
        </Card>

        <VideoSection film={film} onFilmChange={setFilm} reload={reload} />

        <Card
          title="Изображения"
          description="Перед сохранением изображение уменьшается и сжимается в браузере. Сначала вы видите предпросмотр — на сайт оно попадёт только после кнопки «Сохранить»."
        >
          <div className="grid gap-8 md:grid-cols-2">
            <ImageField
              title="Изображение автомобиля"
              hint="Главный кадр карточки уровня. Лучше горизонтальный, от 2560 px по длинной стороне."
              currentUrl={film.carImageUrl}
              rules={RASTER_RULES}
              maxSide={2560}
              onSave={(blob, type) => saveImage('car', blob, type)}
              onReset={() => resetImage('car')}
            />
            <ImageField
              title="Постер"
              hint="Заставка плеера до начала просмотра. Формат 16:9, от 1920 px по ширине."
              currentUrl={film.posterUrl}
              rules={RASTER_RULES}
              maxSide={1920}
              onSave={(blob, type) => saveImage('poster', blob, type)}
              onReset={() => resetImage('poster')}
            />
          </div>
        </Card>

        <FilmTextForm film={film} onFilmChange={setFilm} />
      </div>

      <ConfirmDialog
        open={confirmHide}
        title="Скрыть уровень с сайта?"
        confirmLabel="Скрыть уровень"
        busy={toggling}
        error={toggleError}
        onConfirm={() => void setPublished(false)}
        onClose={() => setConfirmHide(false)}
      >
        <p>
          Посетители перестанут видеть видео уровня «{film.title}» — вместо него появится надпись «Мультфильм скоро
          появится». Файлы останутся в хранилище, показ можно включить обратно в любой момент.
        </p>
      </ConfirmDialog>
    </>
  );
}
