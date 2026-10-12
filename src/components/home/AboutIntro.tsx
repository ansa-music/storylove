import { Link } from 'react-router';

import { Reveal } from '@/components/Reveal';
import { useSiteData } from '@/features/site/SiteDataProvider';

/** Короткая презентация студии: редакционная вёрстка в две колонки. */
export function AboutIntro() {
  const { settings } = useSiteData();

  return (
    <section aria-labelledby="about-intro-title" className="relative py-[clamp(5rem,12vw,10rem)]">
      <div className="shell grid gap-10 lg:grid-cols-12 lg:gap-16">
        <Reveal className="lg:col-span-7">
          {settings.aboutEyebrow && <p className="label text-rose-soft">{settings.aboutEyebrow}</p>}
          <h2 id="about-intro-title" className="mt-5 text-[clamp(2.1rem,4.4vw,4.25rem)] text-pearl">
            {settings.aboutTitle}
          </h2>
        </Reveal>
        <Reveal delay={0.15} className="lg:col-span-5 lg:pt-14">
          <div className="hairline mb-8 w-24" />
          <p className="text-[clamp(1.05rem,1.2vw,1.2rem)] leading-relaxed text-ink-100">
            {settings.aboutText}
          </p>
          <Link
            to="/about"
            className="label mt-8 inline-flex min-h-11 items-center gap-3 text-gold transition-colors duration-300 hover:text-gold-bright"
          >
            Подробнее о студии
            <span aria-hidden="true" className="h-px w-10 bg-current" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
