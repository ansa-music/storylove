import { Link } from 'react-router';

import type { PublicFilm } from '@shared/api';
import type { TierSlug } from '@shared/constants';

import { TwoPhotos } from '@/components/home/TwoPhotos';
import { Reveal } from '@/components/Reveal';
import { TierImage } from '@/components/TierImage';
import { PlayIcon } from '@/features/player/icons';
import { useSiteData } from '@/features/site/SiteDataProvider';
import { splitSentences } from '@/features/site/text';
import { tierNumber, watchPath } from '@/features/site/tiers';

interface CardStyle {
  frame: string;
  number: string;
  title: string;
  play: string;
}

// Лестница читается по рамке и акценту: от нейтральной у ЭКОНОМ до золотого свечения у УЛЬТИМА.
const CARD_STYLES: Readonly<Record<TierSlug, CardStyle>> = {
  econom: {
    frame: 'ring-1 ring-ink-600',
    number: 'text-ink-200',
    title: 'text-pearl',
    play: 'border-pearl/40 text-pearl',
  },
  basic: {
    frame: 'ring-1 ring-ink-400',
    number: 'text-ink-100',
    title: 'text-pearl',
    play: 'border-pearl/60 text-pearl',
  },
  premium: {
    frame: 'ring-1 ring-gold/50',
    number: 'text-gold',
    title: 'text-pearl',
    play: 'border-gold/70 text-gold-bright',
  },
  ultima: {
    frame: 'ring-2 ring-gold shadow-[0_30px_90px_-30px_rgb(216_183_124/0.55)]',
    number: 'text-gold-bright',
    title:
      'bg-[linear-gradient(120deg,var(--color-pearl),var(--color-gold-bright))] bg-clip-text text-transparent',
    play: 'border-gold bg-gold/15 text-gold-bright',
  },
};

function FormatCard({ film }: { film: PublicFilm }) {
  const style = CARD_STYLES[film.slug];
  return (
    <Link
      to={watchPath(film.slug)}
      preventScrollReset
      aria-label={`${film.title} — смотреть пример`}
      className={`group relative block aspect-video overflow-hidden rounded-2xl bg-ink-900 ${style.frame}`}
    >
      <TierImage
        film={film}
        decorative
        sizes="(min-width: 768px) 50vw, 100vw"
        className="transition-transform duration-[900ms] ease-cinema group-hover:scale-[1.04] motion-reduce:transform-none"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(to_top,rgb(8_7_10/0.92)_0%,rgb(8_7_10/0.35)_38%,transparent_62%)]"
      />

      {!film.video && (
        <span className="label absolute top-3 right-3 rounded-full border border-pearl/25 bg-ink-950/65 px-3 py-1.5 text-[0.62rem] text-pearl/85 backdrop-blur-sm sm:top-5 sm:right-5">
          Скоро
        </span>
      )}

      <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 sm:p-7">
        <span className="min-w-0">
          <span className={`label block ${style.number}`}>{tierNumber(film.tierOrder)}</span>
          <span
            className={`mt-1 block pb-1 font-display text-[clamp(1.6rem,3.4vw,3.25rem)] leading-none font-medium ${style.title}`}
          >
            {film.title}
          </span>
          {film.tagline && (
            <span className="mt-1 block truncate text-[0.82rem] text-pearl/80 sm:mt-1.5 sm:text-base">
              {film.tagline}
            </span>
          )}
        </span>
        <span
          aria-hidden="true"
          className={`flex size-12 shrink-0 items-center justify-center rounded-full border bg-ink-950/55 backdrop-blur-sm transition-[scale,background-color] duration-300 ease-cinema group-hover:scale-110 group-hover:bg-ink-950/75 sm:size-16 ${style.play}`}
        >
          <PlayIcon className="size-5 translate-x-0.5 sm:size-7" />
        </span>
      </span>
    </Link>
  );
}

/** Четыре формата на одном экране: нажал на карточку — смотришь пример. */
export function FormatGrid() {
  const { settings, films } = useSiteData();
  // Пустая строка о двух фото (её очищают в админке) убирает и строку, и сами фото.
  const showPhotos = settings.photosText.trim().length > 0;

  return (
    <section
      id="films"
      aria-labelledby="films-title"
      className="scroll-mt-20 pt-[clamp(2.5rem,5vw,4rem)] pb-[clamp(3.5rem,7vw,6rem)]"
    >
      <div className="shell">
        {/* Телефон: фото слева, строка справа, заголовок ниже. Desktop: тексты слева, фото справа. */}
        <Reveal
          className={
            showPhotos
              ? 'grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-6 md:grid-cols-[1fr_auto] md:items-end md:gap-x-12 md:gap-y-5'
              : undefined
          }
        >
          {showPhotos && (
            <p className="col-start-2 row-start-1 font-display text-[clamp(1.2rem,2.1vw,1.85rem)] leading-snug text-balance text-gold-bright italic md:col-start-1 md:max-w-3xl">
              {/* На desktop каждое предложение с новой строки; на телефоне текст идёт подряд. */}
              {splitSentences(settings.photosText).map((sentence, index) => (
                <span key={`${String(index)}-${sentence}`} className="md:block">
                  {index > 0 ? ' ' : ''}
                  {sentence}
                </span>
              ))}
            </p>
          )}
          <div className={showPhotos ? 'col-span-2 row-start-2 md:col-span-1 md:col-start-1' : undefined}>
            {settings.tiersEyebrow && <p className="label text-rose-soft">{settings.tiersEyebrow}</p>}
            <h2 id="films-title" className="mt-3 text-[clamp(1.7rem,3vw,2.75rem)] text-pearl">
              {settings.tiersTitle}
            </h2>
          </div>
          {showPhotos && (
            <TwoPhotos className="col-start-1 row-start-1 md:col-start-2 md:row-span-2 md:self-end" />
          )}
        </Reveal>

        <ul className="mt-[clamp(1.5rem,3vw,2.5rem)] grid gap-4 sm:gap-5 md:grid-cols-2 lg:gap-6">
          {films.map((film, index) => (
            <li key={film.slug}>
              <Reveal delay={index * 0.06}>
                <FormatCard film={film} />
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
