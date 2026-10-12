import { Link } from 'react-router';

import { BrandLogo } from '@/components/BrandLogo';
import { useSiteData } from '@/features/site/SiteDataProvider';

const linkClass =
  'label inline-flex min-h-11 items-center text-ink-200 transition-colors duration-300 hover:text-gold-bright';

export function SiteFooter() {
  const { settings } = useSiteData();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-pearl/10 bg-ink-950">
      <div className="shell grid gap-10 py-14 md:grid-cols-[1.4fr_1fr] md:py-16">
        <div>
          <BrandLogo />
          {settings.footerText && <p className="mt-6 max-w-md text-ink-200">{settings.footerText}</p>}
        </div>
        <nav aria-label="Навигация в подвале" className="md:justify-self-end">
          <ul className="flex flex-col gap-1 md:items-end">
            <li>
              <Link to="/" className={linkClass}>
                Главная
              </Link>
            </li>
            <li>
              <Link to={{ pathname: '/', hash: '#films' }} className={linkClass}>
                Мультфильмы
              </Link>
            </li>
            <li>
              <Link to="/about" className={linkClass}>
                О студии
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="shell">
        <div className="hairline opacity-60" />
        <div className="flex flex-col gap-2 py-6 text-sm text-ink-300 md:flex-row md:items-center md:justify-between">
          <p>
            © {year} {settings.studioName}
          </p>
          {settings.footerNote && <p>{settings.footerNote}</p>}
        </div>
      </div>
    </footer>
  );
}
