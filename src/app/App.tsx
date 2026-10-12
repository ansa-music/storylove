import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';

import { PublicLayout } from '@/layouts/PublicLayout';
import { HomePage } from '@/pages/HomePage';

// Страницы просмотра и админка грузятся отдельными чанками:
// посетителю главной не нужен код плеера и тем более админки.
const WatchPage = lazy(() => import('@/pages/WatchPage').then((m) => ({ default: m.WatchPage })));
const AboutPage = lazy(() => import('@/pages/AboutPage').then((m) => ({ default: m.AboutPage })));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const AdminApp = lazy(() => import('@/features/admin/AdminApp').then((m) => ({ default: m.AdminApp })));

function RouteFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-obsidian" role="status" aria-live="polite">
      <span className="size-8 animate-spin-slow rounded-full border-2 border-gold/25 border-t-gold" />
      <span className="sr-only">Загрузка…</span>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<HomePage />} />
            <Route path="watch/:slug" element={<WatchPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          {/* /admin/login и все разделы панели — внутри AdminApp */}
          <Route path="admin/*" element={<AdminApp />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
