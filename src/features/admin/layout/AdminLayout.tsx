import { useEffect, useId, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';

import { Logo, LogoMark } from '@/components/Logo';
import { errorMessage } from '@/lib/api';

import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toasts';
import { Spinner } from '../components/ui';

const SECTIONS: readonly { to: string; label: string; end?: boolean }[] = [
  { to: '/admin', label: 'Обзор', end: true },
  { to: '/admin/films', label: 'Мультфильмы' },
  { to: '/admin/content', label: 'Тексты' },
  { to: '/admin/settings', label: 'Настройки' },
  { to: '/admin/storage', label: 'Хранилище' },
];

function navClass({ isActive }: { isActive: boolean }): string {
  return `block rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-gold/10 text-gold' : 'text-ink-100 hover:bg-ink-800 hover:text-pearl'
  }`;
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const { email, logout } = useAuth();
  const toast = useToast();
  const [leaving, setLeaving] = useState(false);

  async function leave(): Promise<void> {
    if (leaving) return;
    setLeaving(true);
    try {
      await logout();
    } catch (err) {
      toast.error(`Не удалось выйти: ${errorMessage(err)}`);
      setLeaving(false);
    }
  }

  return (
    <>
      <ul className="space-y-1">
        {SECTIONS.map((section) => (
          <li key={section.to}>
            <NavLink to={section.to} end={section.end} className={navClass} onClick={onNavigate}>
              {section.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="mt-6 space-y-2 border-t border-ink-700 pt-4">
        {email && <p className="px-1 text-xs break-all text-ink-300">{email}</p>}
        <a href="/" target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm w-full">
          Открыть сайт
        </a>
        <button type="button" className="btn btn-quiet btn-sm w-full" onClick={() => void leave()} disabled={leaving}>
          {leaving && <Spinner className="size-4" />}
          Выйти
        </button>
      </div>
    </>
  );
}

/** Каркас панели: боковая навигация на широком экране, выезжающее меню на телефоне. */
export function AdminLayout() {
  const location = useLocation();
  const menuId = useId();
  const [menuPath, setMenuPath] = useState<string | null>(null);
  // Меню считается открытым только для страницы, на которой его открыли: переход закрывает его сам.
  const menuOpen = menuPath === location.pathname;

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuPath(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="min-h-dvh bg-obsidian text-pearl lg:flex">
      <title>Панель управления — STORYLOVE</title>
      <meta name="robots" content="noindex, nofollow" />
      <a
        href="#admin-main"
        className="sr-only-focusable fixed top-2 left-2 z-50 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink-950"
      >
        К содержимому
      </a>

      {/* Телефон и планшет: верхняя панель с меню */}
      <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-900/95 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="flex min-w-0 items-center gap-2.5">
            <LogoMark className="size-7 shrink-0" />
            <span className="truncate text-sm font-semibold tracking-[0.18em] text-pearl">ПАНЕЛЬ</span>
          </span>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuPath(menuOpen ? null : location.pathname)}
          >
            {menuOpen ? 'Закрыть' : 'Меню'}
          </button>
        </div>
        <nav id={menuId} aria-label="Разделы панели" hidden={!menuOpen} className="border-t border-ink-700 px-4 py-4">
          <NavContent onNavigate={() => setMenuPath(null)} />
        </nav>
      </header>

      {/* Широкий экран: боковая панель */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-y-auto border-r border-ink-700 bg-ink-900 p-5 lg:flex">
        <Logo variant="compact" className="mb-1" />
        <p className="label mb-6 text-gold/70">Панель управления</p>
        <nav aria-label="Разделы панели">
          <NavContent />
        </nav>
      </aside>

      <main id="admin-main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
