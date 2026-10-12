import type { ReactNode } from 'react';

function Icon({ children, className = 'size-6' }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function PlayIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M8 5.2v13.6a.8.8 0 0 0 1.220.68l10.800-6.800a.8.8 0 0 0 0-1.360L9.220 4.520A.8.8 0 0 0 8 5.200Z" />
    </Icon>
  );
}

export function PauseIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </Icon>
  );
}

export function VolumeIcon({ muted, low, className }: { muted: boolean; low: boolean; className?: string }) {
  return (
    <Icon className={className}>
      <path d="M4 9.5v5a.5.5 0 0 0 .5.5H8l4.200 3.600a.5.5 0 0 0 .8-.4V5.800a.5.5 0 0 0-.8-.4L8 9H4.500a.5.5 0 0 0-.5.5Z" />
      {muted ? (
        <path
          d="m16 9.500 5 5m0-5-5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      ) : (
        <>
          <path
            d="M15.500 9.200a4 4 0 0 1 0 5.600"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          {!low && (
            <path
              d="M18 6.800a7.400 7.400 0 0 1 0 10.400"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          )}
        </>
      )}
    </Icon>
  );
}

export function FullscreenIcon({ active, className }: { active: boolean; className?: string }) {
  return (
    <Icon className={className}>
      <path
        d={active ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}
