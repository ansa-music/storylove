// Состояние уровня и его видео для обзора и списка мультфильмов.

import type { AdminFilm, AdminVideo, StorageObjectStatus, VideoStatus } from '@shared/api';

export type FilmVideoState = 'published' | 'unpublished' | 'empty' | 'hidden';
export type Tone = 'ok' | 'warn' | 'danger' | 'muted' | 'gold';

export interface FilmVideoStatus {
  state: FilmVideoState;
  label: string;
  tone: Tone;
  /** Видео, по которому показываем размер: активное, иначе самое свежее загруженное. */
  video: AdminVideo | null;
}

type FilmLike = Pick<AdminFilm, 'isPublished' | 'activeVideo' | 'videos'>;

export function filmVideoStatus(film: FilmLike): FilmVideoStatus {
  const ready = film.videos.find((video) => video.status === 'ready') ?? null;
  const video = film.activeVideo ?? ready;
  if (!film.isPublished) return { state: 'hidden', label: 'Уровень скрыт', tone: 'muted', video };
  if (film.activeVideo) return { state: 'published', label: 'Опубликовано', tone: 'ok', video };
  if (ready) return { state: 'unpublished', label: 'Загружено, не опубликовано', tone: 'warn', video };
  return { state: 'empty', label: 'Нет видео', tone: 'danger', video: null };
}

export const VIDEO_STATUS_LABELS: Readonly<Record<VideoStatus, { label: string; tone: Tone }>> = {
  active: { label: 'Опубликовано', tone: 'ok' },
  ready: { label: 'Загружено, не опубликовано', tone: 'warn' },
  archived: { label: 'Предыдущая версия', tone: 'muted' },
};

export const STORAGE_STATUS_LABELS: Readonly<Record<StorageObjectStatus, { label: string; tone: Tone }>> = {
  active: { label: 'Используется сайтом', tone: 'ok' },
  ready: { label: 'Не опубликовано', tone: 'warn' },
  archived: { label: 'Старая версия', tone: 'muted' },
  uploading: { label: 'Загружается', tone: 'gold' },
  orphan: { label: 'Не используется', tone: 'danger' },
};

/** Из хранилища можно удалять только старые версии и ничьи объекты. */
export function isDeletableStatus(status: StorageObjectStatus): boolean {
  return status === 'archived' || status === 'orphan';
}

/** Почему объект нельзя удалить со страницы хранилища. */
export function deleteBlockReason(status: StorageObjectStatus): string | null {
  switch (status) {
    case 'active':
      return 'Используется опубликованным сайтом — удалить нельзя.';
    case 'ready':
      return 'Готовая неопубликованная версия — удаляется на странице мультфильма.';
    case 'uploading':
      return 'Часть незавершённой загрузки — прервите загрузку, чтобы освободить место.';
    case 'archived':
    case 'orphan':
      return null;
  }
}
