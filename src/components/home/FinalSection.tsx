import { Link } from 'react-router';

import { LogoMark } from '@/components/Logo';
import { Reveal } from '@/components/Reveal';
import { useSiteData } from '@/features/site/SiteDataProvider';
import { watchPath } from '@/features/site/tiers';

/** Секция 9: финальный эмоциональный экран. */
export function FinalSection() {
  const { settings } = useSiteData();

  return (
    <section
      aria-labelledby="final-title"
      className="relative isolate overflow-hidden bg-wine-deep py-[clamp(6rem,15vw,12rem)] text-center"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(70%_80%_at_50%_100%,var(--color-wine-bright),transparent_70%),linear-gradient(to_bottom,var(--color-obsidian),transparent_40%)]"
      />
      <div
        aria-hidden="true"
        className="absolute bottom-[-30%] left-1/2 -z-10 size-[min(90vw,46rem)] -translate-x-1/2 rounded-full bg-gold/15 blur-3xl motion-safe:animate-sheen"
      />
      <Reveal className="shell flex flex-col items-center">
        <LogoMark className="size-12" />
        <h2 id="final-title" className="mt-8 max-w-4xl text-[clamp(2.4rem,6vw,5.5rem)] text-pearl">
          {settings.finalTitle}
        </h2>
        {settings.finalText && (
          <p className="mt-7 max-w-xl text-[clamp(1.05rem,1.3vw,1.25rem)] text-pearl/85">
            {settings.finalText}
          </p>
        )}
        <Link to={watchPath('ultima')} className="btn btn-gold mt-11 min-h-14 px-10 text-[0.85rem]">
          {settings.finalCta}
        </Link>
      </Reveal>
    </section>
  );
}
