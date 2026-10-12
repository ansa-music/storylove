import { useEffect, useRef } from 'react';
import { Link } from 'react-router';

import type { PublicFilm } from '@shared/api';

import { posterImage, tierNumber, watchPath } from '@/features/site/tiers';

import { FilmPlaceholder } from './FilmPlaceholder';
import { VideoPlayer } from './VideoPlayer';

interface WatchDialogProps {
  film: PublicFilm;
  films: readonly PublicFilm[];
  /** true — данные сайта ещё загружаются. */
  pending: boolean;
  onClose: () => void;
}

/** Окно просмотра поверх главной: плеер и переключение между четырьмя форматами. */
export function WatchDialog({ film, films, pending, onClose }: WatchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // Страница под окном не должна прокручиваться.
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previous;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="watch-title"
      onCancel={(event) => {
        // Esc: закрываем через маршрут, чтобы адрес и окно не расходились.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-ink-950/95 p-0 text-pearl backdrop:bg-black/80"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[72rem] flex-col justify-center px-3 py-4 sm:px-6 sm:py-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="watch-title" className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-none">
            <span className="label mr-3 align-middle text-gold">{tierNumber(film.tierOrder)}</span>
            {film.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="-mr-1 flex size-12 shrink-0 items-center justify-center rounded-full border border-pearl/20 text-pearl transition-colors duration-300 hover:border-gold hover:text-gold-bright"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M5 5l14 14M19 5L5 19" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="mt-3 overflow-hidden rounded-xl bg-black ring-1 ring-gold/30 sm:mt-4 sm:rounded-2xl">
          {film.video ? (
            <VideoPlayer
              key={`${film.slug}:${film.video.version}`}
              slug={film.slug}
              title={film.title}
              video={film.video}
              poster={posterImage(film)}
              autoPlay
            />
          ) : (
            <FilmPlaceholder film={film} pending={pending} />
          )}
        </div>

        <nav aria-label="Форматы" className="mt-3 sm:mt-4">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {films.map((item) => {
              const current = item.slug === film.slug;
              return (
                <li key={item.slug}>
                  <Link
                    to={watchPath(item.slug)}
                    replace
                    preventScrollReset
                    aria-current={current ? 'page' : undefined}
                    className={`flex min-h-12 items-center justify-center gap-2 rounded-full border px-3 text-center transition-colors duration-300 ${
                      current
                        ? 'border-gold bg-gold/15 text-gold-bright'
                        : 'border-pearl/20 text-pearl/85 hover:border-gold/60 hover:text-pearl'
                    }`}
                  >
                    <span className="label text-[0.62rem] opacity-70">{tierNumber(item.tierOrder)}</span>
                    <span className="label text-[0.72rem]">{item.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </dialog>
  );
}
