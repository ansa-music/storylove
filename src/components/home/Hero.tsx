import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';

import hero1120Webp from '@/assets/photos/hero-1120.webp';
import hero1672Avif from '@/assets/photos/hero-1672.avif';
import hero1672Webp from '@/assets/photos/hero-1672.webp';
import heroMobileAvif from '@/assets/photos/hero-mobile.avif';
import heroMobileWebp from '@/assets/photos/hero-mobile.webp';
import { useSiteData } from '@/features/site/SiteDataProvider';

const HERO_ALT =
  'Пара в контровом свете под гирляндами между деревьями, тёплые огни отражаются в мокром полу';
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const imageClass = 'h-full w-full object-cover object-[50%_30%] md:object-[50%_38%]';

function HeroImage({ customUrl }: { customUrl: string | null }) {
  if (customUrl) {
    return (
      <img
        src={customUrl}
        alt={HERO_ALT}
        width={1672}
        height={941}
        fetchPriority="high"
        className={imageClass}
      />
    );
  }
  return (
    <picture>
      <source
        media="(max-width: 767px)"
        type="image/avif"
        srcSet={heroMobileAvif}
        width={720}
        height={1059}
      />
      <source
        media="(max-width: 767px)"
        type="image/webp"
        srcSet={heroMobileWebp}
        width={720}
        height={1059}
      />
      <source type="image/avif" srcSet={hero1672Avif} width={1672} height={941} />
      <source
        type="image/webp"
        srcSet={`${hero1120Webp} 1120w, ${hero1672Webp} 1672w`}
        sizes="100vw"
        width={1672}
        height={941}
      />
      <img
        src={hero1672Webp}
        alt={HERO_ALT}
        width={1672}
        height={941}
        fetchPriority="high"
        decoding="async"
        className={imageClass}
      />
    </picture>
  );
}

/** Заголовок раскрывается по словам из-под маски; скринридер читает его целиком. */
function RevealTitle({ text, animate }: { text: string; animate: boolean }) {
  if (!animate) return <>{text}</>;
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, index) => (
          <span
            key={`${word}-${index}`}
            className="-mb-[0.14em] inline-block overflow-hidden pb-[0.14em] align-bottom"
          >
            <motion.span
              className="inline-block"
              initial={{ y: '112%' }}
              animate={{ y: 0 }}
              transition={{ duration: 1.1, delay: 0.35 + index * 0.07, ease: EASE }}
            >
              {word}
              {index < words.length - 1 ? ' ' : ''}
            </motion.span>
          </span>
        ))}
      </span>
    </>
  );
}

export function Hero() {
  const { settings, images } = useSiteData();
  const reduceMotion = useReducedMotion() ?? false;
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end start'] });
  const backgroundY = useTransform(scrollYProgress, [0, 1], ['0%', '16%']);
  const contentY = useTransform(scrollYProgress, [0, 1], ['0%', '-10%']);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.75], [1, 0]);

  const fade = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 18 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 1, delay, ease: EASE },
        };

  return (
    <section
      ref={sectionRef}
      aria-labelledby="hero-title"
      className="relative isolate flex min-h-[62svh] items-end overflow-hidden bg-ink-950 md:min-h-[58svh]"
    >
      <motion.div
        className="absolute inset-0 -z-10 will-change-transform"
        style={reduceMotion ? undefined : { y: backgroundY }}
      >
        <div className="h-full w-full motion-safe:animate-drift [&>picture]:block [&>picture]:h-full">
          <HeroImage customUrl={images.hero} />
        </div>
      </motion.div>

      {/* Затемнение: слева и снизу под текстом, пара в центре остаётся в свету. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,rgb(12_10_15)_0%,rgb(12_10_15/0.82)_26%,rgb(12_10_15/0.25)_56%,rgb(12_10_15/0.45)_100%)] md:bg-[linear-gradient(to_top,rgb(12_10_15)_0%,rgb(12_10_15/0.35)_32%,transparent_60%,rgb(12_10_15/0.5)_100%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 hidden bg-[linear-gradient(to_right,rgb(12_10_15/0.92)_0%,rgb(12_10_15/0.7)_26%,transparent_52%)] md:block"
      />

      <motion.div
        className="shell pt-28 pb-[clamp(2rem,5svh,3.5rem)]"
        style={reduceMotion ? undefined : { y: contentY, opacity: contentOpacity }}
      >
        <div className="max-w-[40rem] md:max-w-[min(42vw,36rem)]">
          {settings.heroEyebrow && (
            <motion.p className="label text-gold" {...fade(0.15)}>
              {settings.heroEyebrow}
            </motion.p>
          )}
          <h1
            id="hero-title"
            className="mt-4 text-[clamp(2.3rem,9.5vw,3.5rem)] leading-[1.02] text-pearl md:text-[clamp(2.6rem,4vw,4.25rem)]"
          >
            <RevealTitle text={settings.heroTitle} animate={!reduceMotion} />
          </h1>
          {settings.heroSubtitle && (
            <motion.p className="mt-4 max-w-xl text-[clamp(1rem,1.15vw,1.2rem)] text-pearl/85" {...fade(0.9)}>
              {settings.heroSubtitle}
            </motion.p>
          )}
        </div>
      </motion.div>
    </section>
  );
}
