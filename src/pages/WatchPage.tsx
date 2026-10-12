import { Link, useParams } from 'react-router';

import type { PublicFilm } from '@shared/api';
import { isTierSlug, type TierSlug } from '@shared/constants';

import { FilmPlaceholder } from '@/features/player/FilmPlaceholder';
import { VideoPlayer } from '@/features/player/VideoPlayer';
import { useSiteData } from '@/features/site/SiteDataProvider';
import { findFilm, posterImage, tierLabel, tierNumber, watchPath } from '@/features/site/tiers';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { NotFoundPage } from '@/pages/NotFoundPage';

interface TierFrame {
  /** Фон страницы за плеером. */
  backdrop: string;
  /** Рамка плеера: у всех уровней плеер один и тот же, меняется только обёртка. */
  frame: string;
  label: string;
  title: string;
  tagline: string;
}

const TIER_FRAMES: Readonly<Record<TierSlug, TierFrame>> = {
  econom: {
    backdrop: '',
    frame: 'rounded-md border border-ink-700',
    label: 'text-ink-300',
    title: 'font-sans text-[clamp(1.9rem,3.6vw,2.75rem)] font-semibold tracking-wide text-ink-100',
    tagline: 'text-ink-200',
  },
  basic: {
    backdrop: 'bg-[radial-gradient(60%_50%_at_50%_0%,rgb(46_41_52/0.7),transparent_70%)]',
    frame: 'rounded-xl border border-ink-600 shadow-card',
    label: 'text-ink-100',
    title: 'text-[clamp(2.4rem,5vw,4rem)] text-pearl',
    tagline: 'text-ink-100',
  },
  premium: {
    backdrop: 'bg-[radial-gradient(70%_55%_at_50%_0%,rgb(74_29_49/0.55),transparent_70%)]',
    frame: 'rounded-2xl shadow-gold ring-1 ring-gold/35',
    label: 'text-gold',
    title: 'text-[clamp(2.8rem,6vw,5rem)] text-pearl',
    tagline: 'font-display text-[clamp(1.3rem,2vw,1.7rem)] text-pearl/90 italic',
  },
  ultima: {
    backdrop:
      'bg-[radial-gradient(80%_60%_at_50%_0%,rgb(74_29_49/0.85),transparent_70%),radial-gradient(40%_30%_at_50%_18%,rgb(216_183_124/0.16),transparent_70%)]',
    frame: 'rounded-2xl shadow-[0_0_0_1px_rgb(216_183_124/0.55),0_40px_120px_-30px_rgb(216_183_124/0.4)]',
    label: 'text-gold-bright',
    title:
      'bg-[linear-gradient(120deg,var(--color-pearl)_15%,var(--color-gold-bright)_60%,var(--color-gold))] bg-clip-text pb-[0.08em] text-[clamp(3.2rem,8vw,6.5rem)] text-transparent',
    tagline: 'font-display text-[clamp(1.4rem,2.2vw,1.9rem)] text-pearl italic',
  },
};

function TierNav({ films, current }: { films: readonly PublicFilm[]; current: TierSlug }) {
  return (
    <nav aria-labelledby="other-tiers-title" className="mt-[clamp(3.5rem,8vw,6rem)]">
      <h2 id="other-tiers-title" className="label text-rose-soft">
        Все уровни
      </h2>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {films.map((film) => {
          const isCurrent = film.slug === current;
          const body = (
            <>
              <span className="label text-gold/80">{tierNumber(film.tierOrder)}</span>
              <span className="mt-2 block font-display text-2xl text-pearl">{film.title}</span>
              <span className="mt-1 block text-sm text-ink-200">
                {isCurrent ? 'Вы смотрите этот уровень' : film.tagline}
              </span>
            </>
          );
          return (
            <li key={film.slug}>
              {isCurrent ? (
                <div
                  aria-current="page"
                  className="block h-full rounded-xl border border-gold/50 bg-wine/60 p-5"
                >
                  {body}
                </div>
              ) : (
                <Link
                  to={watchPath(film.slug)}
                  className="block h-full rounded-xl border border-ink-600 bg-ink-850 p-5 transition-colors duration-300 hover:border-gold/40 hover:bg-ink-800"
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function WatchPage() {
  const { slug } = useParams();
  const { settings, films, status } = useSiteData();
  const film = isTierSlug(slug) ? findFilm(films, slug) : undefined;
  useDocumentTitle(film ? `${film.title} — ${settings.studioName}` : settings.metaTitle);

  if (!film) return <NotFoundPage />;

  const style = TIER_FRAMES[film.slug];

  return (
    <article
      aria-labelledby="watch-title"
      className="relative isolate pt-[clamp(6.5rem,11vw,9rem)] pb-[clamp(4rem,9vw,7rem)]"
    >
      <div
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 -z-10 h-[70rem] max-h-full ${style.backdrop}`}
      />
      <div className="shell">
        <header className="max-w-4xl animate-fade-up">
          <p className={`label ${style.label}`}>{tierLabel(film)}</p>
          <h1 id="watch-title" className={`mt-4 ${style.title}`}>
            {film.title}
          </h1>
          <p className={`mt-4 max-w-2xl ${style.tagline}`}>{film.tagline}</p>
        </header>

        <div className="relative mt-[clamp(2rem,4vw,3.5rem)] animate-fade-in">
          {film.slug === 'ultima' && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-[6%] -inset-y-[10%] -z-10 rounded-[50%] bg-gold/15 blur-3xl motion-safe:animate-sheen"
            />
          )}
          {/* Обёртка зависит от уровня, сам плеер одинаков. */}
          <div className={`overflow-hidden bg-black ${style.frame}`}>
            {film.video ? (
              <VideoPlayer
                key={film.video.version}
                slug={film.slug}
                title={film.title}
                video={film.video}
                poster={posterImage(film)}
              />
            ) : (
              <FilmPlaceholder film={film} pending={status === 'loading'} />
            )}
          </div>
        </div>

        {film.description && (
          <p className="mt-[clamp(2rem,4vw,3rem)] max-w-3xl text-[clamp(1.05rem,1.2vw,1.2rem)] leading-relaxed whitespace-pre-line text-ink-100">
            {film.description}
          </p>
        )}

        <TierNav films={films} current={film.slug} />
      </div>
    </article>
  );
}
