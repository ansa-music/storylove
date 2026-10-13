// Данные публичного сайта: значения по умолчанию и разбор ответа GET /api/public/site.
// Разбор терпимый: неизвестное поле игнорируется, отсутствующее или неверное заменяется значением
// по умолчанию — сайт остаётся целым, даже если сервер и клиент разошлись по версиям.

import type { PublicFilm, PublicSiteResponse, PublicVideo, SiteImages } from '@shared/api';
import { SITE_IMAGE_KINDS, TIER_SLUGS } from '@shared/constants';
import { DEFAULT_FILMS, DEFAULT_SETTINGS } from '@shared/defaults';

export type PublicSettings = PublicSiteResponse['settings'];

export interface SiteData {
  settings: PublicSettings;
  images: SiteImages;
  films: PublicFilm[];
}

const TEXT_KEYS = [
  'studioName',
  'logoTagline',
  'heroEyebrow',
  'heroTitle',
  'heroSubtitle',
  'heroPrimaryCta',
  'heroSecondaryCta',
  'aboutEyebrow',
  'aboutTitle',
  'aboutText',
  'photosText',
  'photoHimLabel',
  'photoHerLabel',
  'tiersEyebrow',
  'tiersTitle',
  'ultimaEyebrow',
  'ultimaTitle',
  'ultimaDescription',
  'compareTitle',
  'compareIntro',
  'finalTitle',
  'finalText',
  'finalCta',
  'footerText',
  'footerNote',
  'metaTitle',
  'metaDescription',
] as const satisfies readonly (keyof PublicSettings)[];

const FILM_TEXT_KEYS = ['title', 'tagline', 'description', 'compareText', 'buttonLabel'] as const;

function defaultSettings(): PublicSettings {
  const { storageBudgetGb: _adminOnly, ...settings } = DEFAULT_SETTINGS;
  return settings;
}

function defaultImages(): SiteImages {
  return { hero: null, og: null, logo: null, favicon: null, photoHim: null, photoHer: null };
}

function defaultFilms(): PublicFilm[] {
  return DEFAULT_FILMS.map((film) => ({ ...film, posterUrl: null, carImageUrl: null, video: null }));
}

export function defaultSiteData(): SiteData {
  return { settings: defaultSettings(), images: defaultImages(), films: defaultFilms() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Адрес медиа: только путь этого сайта или http(s). Остальное (javascript:, data:) отбрасываем. */
function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function parseVideo(value: unknown): PublicVideo | null {
  if (!isRecord(value)) return null;
  const url = safeUrl(value.url);
  if (url === null) return null;
  return {
    url,
    mimeType: typeof value.mimeType === 'string' ? value.mimeType : 'video/mp4',
    sizeBytes: numberOrNull(value.sizeBytes) ?? 0,
    durationSeconds: numberOrNull(value.durationSeconds),
    width: numberOrNull(value.width),
    height: numberOrNull(value.height),
    // Без версии позицию просмотра привязываем к адресу файла.
    version: typeof value.version === 'string' && value.version.length > 0 ? value.version : url,
  };
}

function parseFilms(value: unknown): PublicFilm[] {
  const received = Array.isArray(value) ? value.filter(isRecord) : [];
  const films = defaultFilms();
  for (const film of films) {
    const raw = received.find((item) => item.slug === film.slug);
    if (!raw) continue;
    for (const key of FILM_TEXT_KEYS) {
      const text = raw[key];
      if (typeof text === 'string' && text.trim().length > 0) film[key] = text;
    }
    film.posterUrl = safeUrl(raw.posterUrl);
    film.carImageUrl = safeUrl(raw.carImageUrl);
    film.video = parseVideo(raw.video);
  }
  // Порядок уровней фиксирован: эконом → ультима.
  return films.sort((a, b) => TIER_SLUGS.indexOf(a.slug) - TIER_SLUGS.indexOf(b.slug));
}

/** Разобрать ответ сервера. null — это вообще не ответ /api/public/site. */
export function normalizeSiteResponse(raw: unknown): SiteData | null {
  if (!isRecord(raw) || !isRecord(raw.settings)) return null;

  const settings = defaultSettings();
  for (const key of TEXT_KEYS) {
    const text = raw.settings[key];
    if (typeof text === 'string') settings[key] = text;
  }
  if (typeof raw.settings.siteVisible === 'boolean') settings.siteVisible = raw.settings.siteVisible;

  const images = defaultImages();
  if (isRecord(raw.images)) {
    for (const kind of SITE_IMAGE_KINDS) images[kind] = safeUrl(raw.images[kind]);
  }

  return { settings, images, films: parseFilms(raw.films) };
}
