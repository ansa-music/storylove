import { Link } from 'react-router';

import type { PublicFilm } from '@shared/api';

import { Reveal } from '@/components/Reveal';
import { TierImage } from '@/components/TierImage';
import { useSiteData } from '@/features/site/SiteDataProvider';
import { findFilm, tierLabel, watchPath } from '@/features/site/tiers';

/** 01 / ЭКОНОМ — компактно, матово, без золота; при наведении только чуть светлее. */
function EconomCard({ film }: { film: PublicFilm }) {
  return (
    <article className="group w-[86%] max-w-sm rounded-md border border-ink-700 bg-ink-850 sm:w-full lg:max-w-none">
      <div className="aspect-video overflow-hidden rounded-t-md bg-ink-800">
        <TierImage
          film={film}
          className="brightness-90 saturate-[0.7] transition-[filter] duration-500 group-hover:brightness-100"
        />
      </div>
      <div className="p-5">
        <h3 className="label text-ink-300">{tierLabel(film)}</h3>
        <p className="mt-3 text-base text-ink-200">{film.tagline}</p>
        <Link to={watchPath(film.slug)} className="btn btn-quiet btn-sm mt-5 min-h-11">
          {film.buttonLabel}
          <span className="sr-only"> — {film.title}</span>
        </Link>
      </div>
    </article>
  );
}

/** 02 / БАЗОВЫЙ — средний приоритет, лёгкое увеличение кадра при наведении. */
function BasicCard({ film }: { film: PublicFilm }) {
  return (
    <article className="group overflow-hidden rounded-xl border border-ink-600 bg-ink-800 shadow-card">
      <div className="aspect-video overflow-hidden bg-ink-700">
        <TierImage
          film={film}
          className="transition-transform duration-700 ease-cinema group-hover:scale-[1.035] motion-reduce:transform-none"
        />
      </div>
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-8">
        <div>
          <h3 className="label text-ink-100">{tierLabel(film)}</h3>
          <p className="mt-3 font-display text-[clamp(1.6rem,2.4vw,2.2rem)] leading-tight text-pearl">
            {film.tagline}
          </p>
        </div>
        <Link to={watchPath(film.slug)} className="btn btn-ghost shrink-0">
          {film.buttonLabel}
          <span className="sr-only"> — {film.title}</span>
        </Link>
      </div>
    </article>
  );
}

/** 03 / ПРЕМИУМ — заметно крупнее: широкий кадр, золотая окантовка, крупная типографика. */
function PremiumCard({ film }: { film: PublicFilm }) {
  return (
    <article className="group relative isolate overflow-hidden rounded-2xl bg-ink-950 shadow-gold ring-1 ring-gold/30 transition-shadow duration-700 hover:ring-gold/55 lg:grid lg:grid-cols-12">
      <div className="relative aspect-video overflow-hidden lg:order-2 lg:col-span-8">
        <TierImage
          film={film}
          sizes="(min-width: 1024px) 60vw, 100vw"
          className="transition-transform duration-[1200ms] ease-cinema group-hover:scale-[1.045] motion-reduce:transform-none"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(to_top,rgb(8_7_10)_0%,rgb(8_7_10/0.35)_22%,transparent_45%)] lg:bg-[linear-gradient(to_right,rgb(8_7_10)_0%,rgb(8_7_10/0.4)_12%,transparent_30%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(40%_60%_at_78%_30%,rgb(216_183_124/0.16),transparent_70%)] opacity-0 transition-opacity duration-700 group-hover:opacity-100"
        />
      </div>
      <div className="relative -mt-6 p-6 sm:p-10 lg:order-1 lg:col-span-4 lg:mt-0 lg:flex lg:flex-col lg:justify-end lg:p-12">
        <h3 className="label text-gold">{tierLabel(film)}</h3>
        <p className="mt-4 font-display text-[clamp(2.1rem,3.2vw,3.25rem)] leading-[1.04] text-pearl">
          {film.tagline}
        </p>
        <div className="hairline mt-7 w-28 origin-left transition-transform duration-700 ease-cinema group-hover:scale-x-150" />
        <div className="mt-7">
          <Link to={watchPath(film.slug)} className="btn btn-gold">
            {film.buttonLabel}
          </Link>
        </div>
      </div>
    </article>
  );
}

/** Секции 4–6: лестница восприятия — каждая ступень крупнее и богаче предыдущей. */
export function TierLadder() {
  const { settings, films } = useSiteData();
  const econom = findFilm(films, 'econom');
  const basic = findFilm(films, 'basic');
  const premium = findFilm(films, 'premium');

  return (
    <section
      id="films"
      aria-labelledby="films-title"
      className="scroll-mt-20 border-t border-pearl/5 bg-[linear-gradient(to_bottom,var(--color-ink-850),var(--color-obsidian)_45%)] pt-[clamp(4.5rem,10vw,8rem)] pb-[clamp(4rem,8vw,7rem)]"
    >
      <div className="shell">
        <Reveal className="max-w-3xl">
          {settings.tiersEyebrow && <p className="label text-rose-soft">{settings.tiersEyebrow}</p>}
          <h2 id="films-title" className="mt-5 text-[clamp(2.1rem,4.4vw,4.25rem)] text-pearl">
            {settings.tiersTitle}
          </h2>
        </Reveal>

        <div className="mt-[clamp(2.5rem,6vw,5rem)] grid items-end gap-x-8 gap-y-12 lg:grid-cols-12">
          {econom && (
            <Reveal className="lg:col-span-4 xl:col-span-3">
              <EconomCard film={econom} />
            </Reveal>
          )}
          {basic && (
            <Reveal delay={0.12} className="lg:col-span-8 xl:col-span-8 xl:col-start-5">
              <BasicCard film={basic} />
            </Reveal>
          )}
          {premium && (
            <Reveal className="mt-4 lg:col-span-12 lg:mt-10">
              <PremiumCard film={premium} />
            </Reveal>
          )}
        </div>
      </div>
    </section>
  );
}
