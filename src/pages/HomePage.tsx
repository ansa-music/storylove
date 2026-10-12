import { AboutIntro } from '@/components/home/AboutIntro';
import { CompareSection } from '@/components/home/CompareSection';
import { FinalSection } from '@/components/home/FinalSection';
import { Hero } from '@/components/home/Hero';
import { TierLadder } from '@/components/home/TierLadder';
import { UltimaShowcase } from '@/components/home/UltimaShowcase';
import { useSiteData } from '@/features/site/SiteDataProvider';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export function HomePage() {
  const { settings } = useSiteData();
  useDocumentTitle(settings.metaTitle);

  return (
    <>
      <Hero />
      <AboutIntro />
      <TierLadder />
      <UltimaShowcase />
      <CompareSection />
      <FinalSection />
    </>
  );
}
