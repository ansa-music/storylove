import { BrandLogo } from '@/components/BrandLogo';
import { useSiteData } from '@/features/site/SiteDataProvider';

export function SiteFooter() {
  const { settings } = useSiteData();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-pearl/10 bg-ink-950">
      <div className="shell flex flex-col gap-6 py-10 md:flex-row md:items-center md:justify-between">
        <div>
          <BrandLogo />
          {settings.footerText && <p className="mt-4 max-w-md text-sm text-ink-200">{settings.footerText}</p>}
        </div>
        <div className="text-sm text-ink-300 md:text-right">
          {settings.footerNote && <p>{settings.footerNote}</p>}
          <p className="mt-1">
            © {year} {settings.studioName}
          </p>
        </div>
      </div>
    </footer>
  );
}
