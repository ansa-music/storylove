import type { PublicFilm } from '@shared/api';

import { VISUAL_HEIGHT, VISUAL_WIDTH, builtinCar, carAlt, posterImage } from '@/features/site/tiers';

interface TierImageProps {
  film: PublicFilm;
  /** car — образ уровня (автомобиль), poster — постер фильма. */
  kind?: 'car' | 'poster';
  className?: string;
  /** Только для изображений первого экрана. */
  eager?: boolean;
  /** Декоративное изображение рядом с текстом, который уже называет уровень. */
  decorative?: boolean;
  /** Подсказка браузеру, какую ширину займёт изображение (атрибут sizes). */
  sizes?: string;
}

/** Слот изображения уровня под кадр 16:9; родитель задаёт размер, картинка заполняет его. */
export function TierImage({
  film,
  kind = 'car',
  className = '',
  eager = false,
  decorative = false,
  sizes = '100vw',
}: TierImageProps) {
  const alt = decorative
    ? ''
    : kind === 'car'
      ? carAlt(film.slug)
      : `Постер мультфильма уровня ${film.title}`;
  const imgClass = `h-full w-full object-cover ${className}`;
  const loading = eager ? 'eager' : 'lazy';

  // Изображение из админки или постер — один файл, без набора размеров.
  if (kind === 'poster' || film.carImageUrl) {
    const src = kind === 'poster' ? posterImage(film) : (film.carImageUrl ?? '');
    return (
      <img
        src={src}
        alt={alt}
        width={VISUAL_WIDTH}
        height={VISUAL_HEIGHT}
        loading={loading}
        decoding="async"
        className={imgClass}
      />
    );
  }

  const photo = builtinCar(film.slug);
  return (
    <picture className="block h-full w-full">
      {photo.mobile && (
        <>
          <source media="(max-width: 639px)" type="image/avif" srcSet={photo.mobile.avif} />
          <source media="(max-width: 639px)" type="image/webp" srcSet={photo.mobile.webp} />
        </>
      )}
      <source type="image/avif" srcSet={photo.avif} sizes={sizes} />
      <source type="image/webp" srcSet={photo.webp} sizes={sizes} />
      <img
        src={photo.fallback}
        alt={alt}
        width={photo.width}
        height={photo.height}
        loading={loading}
        decoding="async"
        className={imgClass}
      />
    </picture>
  );
}
