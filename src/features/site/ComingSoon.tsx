import { BrandLogo } from '@/components/BrandLogo';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import { useSiteData } from './SiteDataProvider';

/** Экран вместо публичных страниц, пока сайт скрыт в админке (siteVisible = false). */
export function ComingSoon() {
  const { settings } = useSiteData();
  useDocumentTitle(`Скоро открытие — ${settings.studioName}`);

  return (
    <main
      id="main"
      tabIndex={-1}
      className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-obsidian px-6 py-20 text-center outline-none"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_40%,rgb(74_29_49/0.75),transparent_70%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 size-[min(70vw,34rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/10 blur-3xl motion-safe:animate-sheen"
      />
      <div className="relative flex max-w-xl animate-fade-up flex-col items-center">
        <BrandLogo />
        <div className="hairline mt-10 w-40" />
        <h1 className="mt-10 text-[clamp(2.6rem,8vw,4.5rem)] text-pearl">Скоро открытие</h1>
        <p className="mt-6 text-lg text-ink-100">
          Мы готовим сайт к показу. Загляните немного позже — здесь появятся мультфильмы студии.
        </p>
      </div>
    </main>
  );
}
