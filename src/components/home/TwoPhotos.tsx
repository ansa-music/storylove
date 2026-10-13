import { useSiteData } from '@/features/site/SiteDataProvider';

type Who = 'him' | 'her';

/** Пока фото не загружено в админке — силуэт: место под снимок. */
function Silhouette({ who }: { who: Who }) {
  const her = who === 'her';
  return (
    <svg
      viewBox="0 0 60 80"
      aria-hidden="true"
      preserveAspectRatio="xMidYMax slice"
      className="h-full w-full"
    >
      {/* Общая прозрачность на группе: наложение фигур не даёт тёмных пятен. */}
      <g opacity="0.34">
        {her && (
          <path
            className="fill-gold-deep"
            d="M17.5 35c0-10.5 5-17.5 12.5-17.5S42.5 24.5 42.5 35c0 8 1.5 13 4.5 18h-34c3-5 4.5-10 4.5-18Z"
          />
        )}
        <circle className="fill-gold" cx="30" cy={her ? 32 : 31} r={her ? 10 : 11} />
        <path
          className="fill-gold"
          d={her ? 'M10 80c0-13 8.5-22 20-22s20 9 20 22Z' : 'M9 80c0-14 9-24 21-24s21 10 21 24Z'}
        />
      </g>
    </svg>
  );
}

interface PhotoCardProps {
  who: Who;
  /** Фото из админки; null — показываем силуэт. */
  url: string | null;
  label: string;
  className?: string;
}

/** Снимок в белой рамке с подписью — как отпечатанная фотография. */
function PhotoCard({ who, url, label, className = '' }: PhotoCardProps) {
  const backdrop =
    who === 'her'
      ? 'bg-[linear-gradient(160deg,var(--color-wine-bright),var(--color-wine-deep))]'
      : 'bg-[linear-gradient(160deg,var(--color-ink-600),var(--color-ink-900))]';
  return (
    <figure
      className={`w-[clamp(5.75rem,26.5vw,8.75rem)] shrink-0 rounded-[3px] bg-pearl p-1 shadow-[0_18px_40px_-16px_rgb(0_0_0/0.85)] md:w-36 md:p-1.5 lg:w-40 xl:w-44 ${className}`}
    >
      <div className={`aspect-[3/4] overflow-hidden ${backdrop}`}>
        {url ? (
          <img
            src={url}
            alt={label ? `Фото: ${label}` : 'Фото'}
            width={600}
            height={800}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover object-[50%_28%]"
          />
        ) : (
          <Silhouette who={who} />
        )}
      </div>
      <figcaption className="truncate pt-1 text-center font-display text-[0.95rem] leading-tight text-ink-900 italic md:pt-1.5 md:text-lg">
        {/* Неразрывный пробел держит высоту рамки, если подпись очищена в админке. */}
        {label || ' '}
      </figcaption>
    </figure>
  );
}

/** Два исходных фото — «он» и «она»: всё, что нужно студии, чтобы сделать историю. */
export function TwoPhotos({ className = '' }: { className?: string }) {
  const { settings, images } = useSiteData();
  return (
    <div className={`flex items-center ${className}`}>
      <PhotoCard who="him" url={images.photoHim} label={settings.photoHimLabel} className="-rotate-[5deg]" />
      <span aria-hidden="true" className="mx-3 hidden font-display text-4xl leading-none text-gold sm:block">
        +
      </span>
      {/* На телефоне снимки слегка перекрываются — так пара занимает меньше места. */}
      <PhotoCard
        who="her"
        url={images.photoHer}
        label={settings.photoHerLabel}
        className="-ml-2 translate-y-1 rotate-[4deg] sm:ml-0"
      />
    </div>
  );
}
