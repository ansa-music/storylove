import { Link, Navigate, Outlet, Route, Routes } from 'react-router';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { ToastProvider } from './components/Toasts';
import { ErrorState, LoadingState, PageHeader } from './components/ui';
import { AdminLayout } from './layout/AdminLayout';
import { ContentPage } from './pages/ContentPage';
import { DashboardPage } from './pages/DashboardPage';
import { FilmPage } from './pages/FilmPage';
import { FilmsPage } from './pages/FilmsPage';
import { SettingsPage } from './pages/SettingsPage';
import { StoragePage } from './pages/StoragePage';

/**
 * Пропускает в панель только после ответа сервера о сессии.
 * Это удобство, а не защита: каждый запрос админки сервер проверяет сам.
 */
function RequireAuth() {
  const auth = useAuth();
  if (auth.status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-obsidian">
        <LoadingState label="Проверяем сессию…" />
      </div>
    );
  }
  if (auth.status === 'failed') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-obsidian p-4">
        <div className="w-full max-w-md">
          <ErrorState message={auth.error ?? 'Не удалось связаться с сервером.'} onRetry={auth.recheck} />
        </div>
      </div>
    );
  }
  if (auth.status === 'anonymous') return <Navigate to="/admin/login" replace />;
  return <Outlet />;
}

function AdminNotFound() {
  return (
    <>
      <PageHeader title="Раздел не найден" description="Такой страницы в панели нет." />
      <Link to="/admin" className="btn btn-quiet btn-sm">
        К обзору
      </Link>
    </>
  );
}

/** Административная панель. Монтируется в App на маршруте admin/*. */
export function AdminApp() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AdminLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="films" element={<FilmsPage />} />
              <Route path="films/:slug" element={<FilmPage />} />
              <Route path="content" element={<ContentPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="storage" element={<StoragePage />} />
              <Route path="*" element={<AdminNotFound />} />
            </Route>
          </Route>
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
