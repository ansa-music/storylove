import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { PublicLayout } from '@/layouts/PublicLayout';
import { HomePage } from '@/pages/HomePage';

// Админка грузится отдельным чанком: посетителю сайта её код не нужен.
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
            {/* Тот же экран с открытым окном просмотра. */}
            <Route path="watch/:slug" element={<HomePage />} />
            <Route path="about" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          {/* /admin/login и все разделы панели — внутри AdminApp */}
          <Route path="admin/*" element={<AdminApp />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
