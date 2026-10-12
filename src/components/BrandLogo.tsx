import { Logo } from '@/components/Logo';
import { useSiteData } from '@/features/site/SiteDataProvider';

interface BrandLogoProps {
  variant?: 'full' | 'compact';
  className?: string;
}

/** Логотип студии: загруженный в админке или встроенный знак с названием из настроек. */
export function BrandLogo({ variant = 'full', className }: BrandLogoProps) {
  const { settings, images } = useSiteData();

  if (images.logo) {
    return (
      <img
        src={images.logo}
        alt={settings.studioName}
        width={180}
        height={40}
        className={`h-10 w-auto max-w-[11rem] object-contain ${className ?? ''}`}
      />
    );
  }
  return (
    <Logo
      variant={variant}
      studioName={settings.studioName}
      tagline={settings.logoTagline}
      className={className}
    />
  );
}
