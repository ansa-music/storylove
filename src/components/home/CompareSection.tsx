import { Link } from 'react-router';

import type { TierSlug } from '@shared/constants';

import { Reveal } from '@/components/Reveal';
import { useSiteData } from '@/features/site/SiteDataProvider';
import { tierNumber, watchPath } from '@/features/site/tiers';

interface StepStyle {
  /** Высота ступени на desktop — та же лестница, что и выше на странице. */
  column: string;
  number: string;
  title: string;
  text: string;
  link: string;
}

const STEP_STYLES: Readonly<Record<TierSlug, StepStyle>> = {
  econom: {
    column: 'border-ink-700 bg-ink-850 lg:min-h-[19rem]',
    number: 'text-ink-400',
    title: 'font-sans text-xl font-semibold tracking-wide text-ink-100',
    text: 'text-ink-300',
    link: 'text-ink-200 hover:text-pearl',
  },
  basic: {
    column: 'border-ink-600 bg-ink-800 lg:min-h-[23rem]',
    number: 'text-ink-300',
    title: 'text-3xl text-pearl',
    text: 'text-ink-200',
    link: 'text-pearl hover:text-gold-bright',
  },
  premium: {
    column:
      'border-gold/30 bg-[linear-gradient(to_bottom,var(--color-ink-700),var(--color-ink-850))] lg:min-h-[27rem]',
    number: 'text-gold/80',
    title: 'text-4xl text-pearl',
    text: 'text-ink-100',
    link: 'text-gold hover:text-gold-bright',
  },
  ultima: {
    column:
      'border-gold/60 bg-[linear-gradient(to_bottom,var(--color-wine-bright),var(--color-wine)_45%,var(--color-ink-850))] shadow-gold lg:min-h-[32rem]',
    number: 'text-gold-bright',
    title:
      'bg-[linear-gradient(120deg,var(--color-pearl),var(--color-gold-bright))] bg-clip-text text-5xl text-transparent',
    text: 'text-pearl/90',
    link: 'text-gold-bright hover:text-pearl',
  },
};

/** Секция 8: сравнение уровней — только названия и тексты из админки, без выдуманных характеристик. */
export function CompareSection() {
  const { settings, films } = useSiteData();

  return (
    <section aria-labelledby="compare-title" className="py-[clamp(5rem,11vw,9rem)]">
      <div className="shell">
        <Reveal className="max-w-3xl">
          <h2 id="compare-title" className="text-[clamp(2.1rem,4.4vw,4.25rem)] text-pearl">
            {settings.compareTitle}
          </h2>
          {settings.compareIntro && (
            <p className="mt-6 max-w-2xl text-[clamp(1.05rem,1.2vw,1.2rem)] text-ink-100">
              {settings.compareIntro}
            </p>
          )}
        </Reveal>

        <ol className="mt-[clamp(2.5rem,5vw,4.5rem)] grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end lg:gap-5">
          {films.map((film, index) => {
            const style = STEP_STYLES[film.slug];
            return (
              <li key={film.slug} className="h-full lg:h-auto">
                <Reveal delay={index * 0.08} className="h-full">
                  <article className={`flex h-full flex-col rounded-xl border p-6 lg:p-7 ${style.column}`}>
                    <p className={`label ${style.number}`}>{tierNumber(film.tierOrder)}</p>
                    <h3 className={`mt-4 pb-1 ${style.title}`}>{film.title}</h3>
                    <p className={`mt-4 font-display text-xl leading-snug italic ${style.text}`}>
                      {film.tagline}
                    </p>
                    <p className={`mt-3 text-[0.95rem] ${style.text}`}>{film.compareText}</p>
                    <Link
                      to={watchPath(film.slug)}
                      className={`label mt-auto inline-flex min-h-11 items-center gap-3 pt-6 transition-colors duration-300 ${style.link}`}
                    >
                      Смотреть
                      <span className="sr-only"> {film.title}</span>
                      <span aria-hidden="true" className="h-px w-8 bg-current" />
                    </Link>
                  </article>
                </Reveal>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
