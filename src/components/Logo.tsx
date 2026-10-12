import { useId } from 'react';

interface LogoMarkProps {
  className?: string;
  title?: string;
}

/** Знак STORYLOVE: сердце, собранное из светового кадра, с треугольником «play» внутри. */
export function LogoMark({ className, title }: LogoMarkProps) {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="6" y1="6" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ECD3A1" />
          <stop offset="0.55" stopColor="#D8B77C" />
          <stop offset="1" stopColor="#AE7789" />
        </linearGradient>
      </defs>
      <path
        d="M24 41.5C13.5 33.6 6 27.1 6 18.4 6 12.3 10.6 8 16.1 8c3.3 0 6.1 1.6 7.9 4.2C25.8 9.6 28.600 8 31.9 8 37.4 8 42 12.3 42 18.400c0 8.700-7.500 15.200-18 23.100Z"
        stroke={`url(#${gradientId})`}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M20.6 17.400v11.200l9.600-5.600-9.600-5.600Z" fill={`url(#${gradientId})`} />
    </svg>
  );
}

interface LogoProps {
  /** compact — только знак и название (шапка на телефоне). */
  variant?: 'full' | 'compact';
  studioName?: string;
  tagline?: string;
  className?: string;
}

export function Logo({
  variant = 'full',
  studioName = 'STORYLOVE',
  tagline = 'AI CINEMATIC LOVE STORIES',
  className = '',
}: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <LogoMark className="size-9 shrink-0" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[1.45rem] font-semibold tracking-[0.22em] text-pearl">
          {studioName}
        </span>
        {variant === 'full' && (
          <span className="mt-1.5 text-[0.56rem] font-semibold tracking-[0.34em] text-gold/80 uppercase">
            {tagline}
          </span>
        )}
      </span>
    </span>
  );
}
