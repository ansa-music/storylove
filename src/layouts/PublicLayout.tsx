import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { ComingSoon } from '@/features/site/ComingSoon';
import { SiteDataProvider, useSiteData } from '@/features/site/SiteDataProvider';

/** Переход на страницу — к началу; переход по якорю (#films) — к секции. */
function useScrollOnNavigation(): void {
  const { pathname, hash, key } = useLocation();

  useEffect(() => {
    if (hash) {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (target) {
        target.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash, key]);
}

function PublicShell() {
  const { settings } = useSiteData();
  useScrollOnNavigation();

  if (!settings.siteVisible) return <ComingSoon />;

  return (
    <div className="flex min-h-dvh flex-col bg-obsidian text-pearl">
      <a href="#main" className="sr-only-focusable btn btn-gold btn-sm fixed top-3 left-3 z-[60]">
        К содержимому
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}

export function PublicLayout() {
  return (
    <SiteDataProvider>
      <PublicShell />
    </SiteDataProvider>
  );
}
