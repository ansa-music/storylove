import { motion, useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import { Link } from 'react-router';

import { TierImage } from '@/components/TierImage';
import { useSiteData } from '@/features/site/SiteDataProvider';
import { findFilm, tierLabel, watchPath } from '@/features/site/tiers';
import { usePointerParallax } from '@/hooks/usePointerParallax';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: '0px 0px -18% 0px' } as const;

/** Секция 7: флагманский showcase — полноширинная кульминация, не карточка. */
export function UltimaShowcase() {
  const { settings, films } = useSiteData();
  const film = findFilm(films, 'ultima');
  const reduceMotion = useReducedMotion() ?? false;
  const sectionRef = useRef<HTMLElement>(null);
  usePointerParallax(sectionRef);

  if (!film) return null;

  const rise = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 26 },
          whileInView: { opacity: 1, y: 0 },
          viewport: VIEWPORT,
          transition: { duration: 1.1, delay, ease: EASE },
        };

  return (
    <section
      ref={sectionRef}
      aria-labelledby="ultima-title"
      className="relative isolate overflow-hidden bg-ink-950 lg:flex lg:min-h-[100svh] lg:items-center"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-[radial-gradient(60%_70%_at_30%_55%,rgb(74_29_49/0.7),transparent_70%),radial-gradient(40%_40%_at_80%_20%,rgb(216_183_124/0.1),transparent_70%)]"
      />
      {/* Автомобиль: на телефоне — кадр сверху, на desktop — кадр во всю секцию; гиперкар стоит справа, слева тёмное поле под текст. */}
      <motion.div
        className="relative aspect-[3/2] w-full overflow-hidden sm:aspect-video lg:absolute lg:inset-0 lg:-z-10 lg:aspect-auto"
        initial={reduceMotion ? false : { opacity: 0, scale: 1.08 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={VIEWPORT}
        transition={{ duration: 1.8, ease: EASE }}
      >
        <div className="h-full w-full [transform:translate3d(calc(var(--px,0)*-16px),calc(var(--py,0)*-9px),0)_scale(1.05)] will-change-transform">
          <TierImage film={film} className="object-center lg:object-[72%_50%]" />
        </div>
        {/* «Дыхание» световых панелей */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [transform:translate3d(calc(var(--px,0)*22px),calc(var(--py,0)*12px),0)] mix-blend-screen"
        >
          <div className="absolute top-0 left-[18%] h-[62%] w-[9%] bg-[linear-gradient(to_bottom,transparent,rgb(236_211_161/0.34),transparent)] blur-2xl motion-safe:animate-sheen" />
          <div className="absolute top-0 left-[58%] h-[66%] w-[11%] bg-[linear-gradient(to_bottom,transparent,rgb(246_239_232/0.3),transparent)] blur-2xl motion-safe:animate-sheen motion-safe:[animation-delay:-2.3s]" />
          <div className="absolute top-0 left-[84%] h-[58%] w-[8%] bg-[linear-gradient(to_bottom,transparent,rgb(236_211_161/0.3),transparent)] blur-2xl motion-safe:animate-sheen motion-safe:[animation-delay:-4.6s]" />
          <div className="absolute bottom-[14%] left-1/2 h-[30%] w-[70%] -translate-x-1/2 rounded-[50%] bg-gold/20 blur-3xl motion-safe:animate-sheen motion-safe:[animation-delay:-1.2s]" />
        </div>
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(to_top,rgb(8_7_10)_0%,rgb(8_7_10/0.2)_38%,transparent_60%,rgb(8_7_10/0.7)_100%)] lg:bg-[linear-gradient(to_right,rgb(8_7_10/0.9)_0%,rgb(8_7_10/0.6)_26%,transparent_52%),linear-gradient(to_top,rgb(8_7_10)_0%,transparent_20%,transparent_82%,rgb(8_7_10)_100%)]"
        />
      </motion.div>

      <div className="shell relative -mt-10 pb-[clamp(4rem,10vw,7rem)] lg:mt-0 lg:flex lg:justify-start lg:py-32">
        <div className="lg:w-[40%]">
          <motion.p className="label text-gold" {...rise(0.1)}>
            {tierLabel(film)}
          </motion.p>
          {settings.ultimaEyebrow && (
            <motion.p className="label mt-3 text-pearl/70" {...rise(0.2)}>
              {settings.ultimaEyebrow}
            </motion.p>
          )}
          <motion.h2
            id="ultima-title"
            className="mt-7 bg-[linear-gradient(120deg,var(--color-pearl)_20%,var(--color-gold-bright)_60%,var(--color-gold))] bg-clip-text pb-[0.08em] text-[clamp(2.7rem,6.2vw,6rem)] leading-[0.98] text-transparent"
            initial={reduceMotion ? false : { opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={VIEWPORT}
            transition={{ duration: 1.5, delay: 0.3, ease: EASE }}
          >
            {settings.ultimaTitle}
          </motion.h2>
          <motion.div className="hairline mt-9 w-40" {...rise(0.6)} />
          <motion.p
            className="mt-8 max-w-md font-display text-[clamp(1.35rem,1.9vw,1.8rem)] leading-snug text-pearl/90 italic"
            {...rise(0.7)}
          >
            {settings.ultimaDescription}
          </motion.p>
          <motion.div className="mt-10" {...rise(0.85)}>
            <Link to={watchPath(film.slug)} className="btn btn-gold min-h-14 px-10 text-[0.85rem]">
              {film.buttonLabel}
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
