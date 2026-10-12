import type { PublicFilm } from '@shared/api';

import { LogoMark } from '@/components/Logo';
import { TierImage } from '@/components/TierImage';

interface FilmPlaceholderProps {
  film: PublicFilm;
  /** true — данные сайта ещё загружаются: показываем только постер, без текста «скоро». */
  pending: boolean;
}

/** Место плеера, пока видео уровня не опубликовано: постер и спокойная подпись, без кнопки play. */
export function FilmPlaceholder({ film, pending }: FilmPlaceholderProps) {
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-ink-950">
      <TierImage film={film} kind={film.posterUrl ? 'poster' : 'car'} eager decorative />
      <div aria-hidden="true" className="absolute inset-0 bg-ink-950/70" />
      {pending ? (
        <div role="status" className="absolute inset-0 flex items-center justify-center">
          <span className="size-10 animate-spin-slow rounded-full border-2 border-gold/25 border-t-gold" />
          <span className="sr-only">Загрузка…</span>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
          <LogoMark className="size-10 sm:size-12" />
          <p className="mt-5 font-display text-[clamp(1.6rem,4vw,3rem)] leading-tight text-pearl">
            Мультфильм скоро появится
          </p>
          <p className="mt-3 max-w-sm text-sm text-pearl/80 sm:text-base">
            Пока можно посмотреть другие форматы.
          </p>
        </div>
      )}
    </div>
  );
}
