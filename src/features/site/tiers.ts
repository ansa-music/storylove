// Оформление уровней: встроенные изображения и подписи.
// Изображения из админки (carImageUrl, posterUrl) имеют приоритет над встроенными.

import type { PublicFilm } from '@shared/api';
import type { TierSlug } from '@shared/constants';

import carBasicLgAvif from '@/assets/photos/car-basic-1600.avif';
import carBasicLgWebp from '@/assets/photos/car-basic-1600.webp';
import carBasicSmAvif from '@/assets/photos/car-basic-960.avif';
import carBasicSmWebp from '@/assets/photos/car-basic-960.webp';
import carEconomLgAvif from '@/assets/photos/car-econom-1600.avif';
import carEconomLgWebp from '@/assets/photos/car-econom-1600.webp';
import carEconomSmAvif from '@/assets/photos/car-econom-960.avif';
import carEconomSmWebp from '@/assets/photos/car-econom-960.webp';
import carPremiumLgAvif from '@/assets/photos/car-premium-1600.avif';
import carPremiumLgWebp from '@/assets/photos/car-premium-1600.webp';
import carPremiumSmAvif from '@/assets/photos/car-premium-960.avif';
import carPremiumSmWebp from '@/assets/photos/car-premium-960.webp';
import carUltimaSmAvif from '@/assets/photos/car-ultima-1440.avif';
import carUltimaSmWebp from '@/assets/photos/car-ultima-1440.webp';
import carUltimaLgAvif from '@/assets/photos/car-ultima-2400.avif';
import carUltimaLgWebp from '@/assets/photos/car-ultima-2400.webp';
import carUltimaMobileAvif from '@/assets/photos/car-ultima-mobile.avif';
import carUltimaMobileWebp from '@/assets/photos/car-ultima-mobile.webp';
import posterBasic from '@/assets/visuals/poster-basic.svg';
import posterEconom from '@/assets/visuals/poster-econom.svg';
import posterPremium from '@/assets/visuals/poster-premium.svg';
import posterUltima from '@/assets/visuals/poster-ultima.svg';

/** Набор файлов одного встроенного фото: два размера в AVIF и WebP. */
export interface PhotoSet {
  /** srcset для <source type="image/avif"> */
  avif: string;
  /** srcset для <source type="image/webp"> */
  webp: string;
  /** Запасной src для <img>. */
  fallback: string;
  width: number;
  height: number;
  /** Отдельный кроп для узких экранов (только у УЛЬТИМА). */
  mobile?: { avif: string; webp: string };
}

interface TierVisual {
  car: PhotoSet;
  poster: string;
  /** Описание образа уровня для alt. */
  carAlt: string;
}

function photo(
  small: { avif: string; webp: string; width: number },
  large: { avif: string; webp: string; width: number },
  mobile?: { avif: string; webp: string },
): PhotoSet {
  return {
    avif: `${small.avif} ${small.width}w, ${large.avif} ${large.width}w`,
    webp: `${small.webp} ${small.width}w, ${large.webp} ${large.width}w`,
    fallback: small.webp,
    width: 1600,
    height: 900,
    ...(mobile ? { mobile } : {}),
  };
}

const TIER_VISUALS: Readonly<Record<TierSlug, TierVisual>> = {
  econom: {
    car: photo(
      { avif: carEconomSmAvif, webp: carEconomSmWebp, width: 960 },
      { avif: carEconomLgAvif, webp: carEconomLgWebp, width: 1600 },
    ),
    poster: posterEconom,
    carAlt: 'Старый бюджетный седан в бетонном паркинге под холодным рассеянным светом',
  },
  basic: {
    car: photo(
      { avif: carBasicSmAvif, webp: carBasicSmWebp, width: 960 },
      { avif: carBasicLgAvif, webp: carBasicLgWebp, width: 1600 },
    ),
    poster: posterBasic,
    carAlt: 'Современный серебристый седан на городской площади в мягком дневном свете',
  },
  premium: {
    car: photo(
      { avif: carPremiumSmAvif, webp: carPremiumSmWebp, width: 960 },
      { avif: carPremiumLgAvif, webp: carPremiumLgWebp, width: 1600 },
    ),
    poster: posterPremium,
    carAlt: 'Чёрный представительский седан в тёмной студии со световыми панелями и зеркальным полом',
  },
  ultima: {
    car: photo(
      { avif: carUltimaSmAvif, webp: carUltimaSmWebp, width: 1440 },
      { avif: carUltimaLgAvif, webp: carUltimaLgWebp, width: 2400 },
      { avif: carUltimaMobileAvif, webp: carUltimaMobileWebp },
    ),
    poster: posterUltima,
    carAlt: 'Жемчужно-белый гиперкар в тёмном павильоне, очерченный золотым контровым светом',
  },
};

/** Размеры встроенных постеров — для width/height у <img>, чтобы вёрстка не прыгала. */
export const VISUAL_WIDTH = 1600;
export const VISUAL_HEIGHT = 900;

export function tierNumber(order: number): string {
  return String(order).padStart(2, '0');
}

/** «01 / ЭКОНОМ» */
export function tierLabel(film: Pick<PublicFilm, 'tierOrder' | 'title'>): string {
  return `${tierNumber(film.tierOrder)} / ${film.title}`;
}

/** Встроенное фото автомобиля уровня (используется, пока в админке не загружено своё). */
export function builtinCar(slug: TierSlug): PhotoSet {
  return TIER_VISUALS[slug].car;
}

export function posterImage(film: Pick<PublicFilm, 'slug' | 'posterUrl'>): string {
  return film.posterUrl ?? TIER_VISUALS[film.slug].poster;
}

export function carAlt(slug: TierSlug): string {
  return TIER_VISUALS[slug].carAlt;
}

export function watchPath(slug: TierSlug): string {
  return `/watch/${slug}`;
}

/** Найти фильм уровня; данные всегда содержат все четыре, но тип этого не гарантирует. */
export function findFilm(films: readonly PublicFilm[], slug: TierSlug): PublicFilm | undefined {
  return films.find((film) => film.slug === slug);
}
