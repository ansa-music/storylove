import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router';

import { BrandLogo } from '@/components/BrandLogo';
import { useSiteData } from '@/features/site/SiteDataProvider';
import { useScrolled } from '@/hooks/useScrolled';

const linkClass =
  'label inline-flex min-h-11 items-center text-pearl/80 transition-colors duration-300 hover:text-gold-bright aria-[current=page]:text-gold';
const mobileLinkClass =
  'flex min-h-14 items-center border-b border-pearl/10 font-display text-3xl text-pearl transition-colors hover:text-gold-bright aria-[current=page]:text-gold';

function NavItems({ className }: { className: string }) {
  return (
    <>
      <li>
        <NavLink to="/" end className={className}>
          Главная
        </NavLink>
      </li>
      <li>
        <Link to={{ pathname: '/', hash: '#films' }} className={className}>
          Мультфильмы
        </Link>
      </li>
      <li>
        <NavLink to="/about" className={className}>
          О студии
        </NavLink>
      </li>
    </>
  );
}

export function SiteHeader() {
  const { settings } = useSiteData();
  const scrolled = useScrolled();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const solid = scrolled || menuOpen;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color,backdrop-filter] duration-500 ease-soft ${
        solid ? 'border-pearl/10 bg-obsidian/80 backdrop-blur-xl' : 'border-transparent bg-transparent'
      }`}
    >
      <div
        className={`shell flex items-center justify-between transition-[height] duration-500 ease-cinema ${scrolled ? 'h-16' : 'h-20'}`}
      >
        <Link
          to="/"
          aria-label={`${settings.studioName} — на главную`}
          className="animate-fade-in rounded-sm"
        >
          <BrandLogo variant="compact" />
        </Link>

        <nav aria-label="Основная навигация" className="hidden md:block">
          <ul className="flex items-center gap-10">
            <NavItems className={linkClass} />
          </ul>
        </nav>

        <button
          ref={toggleRef}
          type="button"
          className="-mr-2 flex size-12 items-center justify-center rounded-full text-pearl md:hidden"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true" className="relative block h-[14px] w-6">
            <span
              className={`absolute inset-x-0 top-0 h-px bg-current transition-transform duration-300 ease-cinema ${
                menuOpen ? 'translate-y-[7px] rotate-45' : ''
              }`}
            />
            <span
              className={`absolute inset-x-0 bottom-0 h-px bg-current transition-transform duration-300 ease-cinema ${
                menuOpen ? '-translate-y-[6px] -rotate-45' : ''
              }`}
            />
          </span>
        </button>
      </div>

      <nav id={menuId} aria-label="Меню" hidden={!menuOpen} className="md:hidden">
        {/* Переход по любой ссылке закрывает меню. */}
        <ul className="shell animate-fade-up pt-2 pb-10" onClick={() => setMenuOpen(false)}>
          <NavItems className={mobileLinkClass} />
        </ul>
      </nav>
    </header>
  );
}
