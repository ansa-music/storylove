import { Link } from 'react-router';

import { useSiteData } from '@/features/site/SiteDataProvider';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export function NotFoundPage() {
  const { settings } = useSiteData();
  useDocumentTitle(`Страница не найдена — ${settings.studioName}`);

  return (
    <section
      aria-labelledby="not-found-title"
      className="relative isolate flex min-h-[calc(100svh-5rem)] items-center overflow-hidden pt-28 pb-20 text-center"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(50%_50%_at_50%_45%,rgb(74_29_49/0.6),transparent_70%)]"
      />
      <div className="shell flex animate-fade-up flex-col items-center">
        <p
          aria-hidden="true"
          className="font-display text-[clamp(6rem,22vw,13rem)] leading-none text-gold/25"
        >
          404
        </p>
        <h1 id="not-found-title" className="-mt-4 text-[clamp(2.2rem,5vw,4rem)] text-pearl">
          Такой страницы нет
        </h1>
        <p className="mt-5 max-w-md text-lg text-ink-100">
          Возможно, ссылка устарела. Вернитесь на главную — мультфильмы студии там.
        </p>
        <div className="mt-9 flex flex-col gap-3 xs:flex-row">
          <Link to="/" className="btn btn-gold">
            На главную
          </Link>
          <Link to={{ pathname: '/', hash: '#films' }} className="btn btn-ghost">
            К мультфильмам
          </Link>
        </div>
      </div>
    </section>
  );
}
