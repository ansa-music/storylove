import { Link } from 'react-router';

import { BrandLogo } from '@/components/BrandLogo';
import { useSiteData } from '@/features/site/SiteDataProvider';
import { useScrolled } from '@/hooks/useScrolled';

/** Шапка одностраничного сайта: только логотип, прозрачная над первым экраном. */
export function SiteHeader() {
  const { settings } = useSiteData();
  const scrolled = useScrolled();

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 border-b transition-[background-color,border-color,backdrop-filter] duration-500 ease-soft ${
        scrolled ? 'border-pearl/10 bg-obsidian/80 backdrop-blur-xl' : 'border-transparent bg-transparent'
      }`}
    >
      <div
        className={`shell flex items-center transition-[height] duration-500 ease-cinema ${scrolled ? 'h-16' : 'h-20'}`}
      >
        <Link to="/" aria-label={`${settings.studioName} — в начало`} className="animate-fade-in rounded-sm">
          <BrandLogo variant="compact" />
        </Link>
      </div>
    </header>
  );
}
