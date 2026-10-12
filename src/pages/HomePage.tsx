import { useNavigate, useParams } from 'react-router';

import { isTierSlug } from '@shared/constants';

import { FormatGrid } from '@/components/home/FormatGrid';
import { Hero } from '@/components/home/Hero';
import { WatchDialog } from '@/features/player/WatchDialog';
import { useSiteData } from '@/features/site/SiteDataProvider';
import { findFilm } from '@/features/site/tiers';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * Единственная публичная страница. Адрес /watch/<формат> — та же страница
 * с открытым окном просмотра, поэтому ссылкой на формат можно поделиться.
 */
export function HomePage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { settings, films, status } = useSiteData();
  const film = isTierSlug(slug) ? findFilm(films, slug) : undefined;
  useDocumentTitle(film ? `${film.title} — ${settings.studioName}` : settings.metaTitle);

  if (slug !== undefined && !film) return <NotFoundPage />;

  return (
    <>
      <Hero />
      <FormatGrid />
      {film && (
        <WatchDialog
          film={film}
          films={films}
          pending={status === 'loading'}
          onClose={() => {
            void navigate('/', { preventScrollReset: true });
          }}
        />
      )}
    </>
  );
}
