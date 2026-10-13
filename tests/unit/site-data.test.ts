import { describe, expect, it } from 'vitest';

import { TIER_SLUGS } from '../../shared/constants';
import { DEFAULT_FILMS, DEFAULT_SETTINGS } from '../../shared/defaults';
import { defaultSiteData, normalizeSiteResponse } from '../../src/features/site/siteData';

describe('defaultSiteData', () => {
  it('содержит четыре уровня без видео и встроенные изображения', () => {
    const data = defaultSiteData();
    expect(data.films.map((film) => film.slug)).toEqual([...TIER_SLUGS]);
    for (const film of data.films) {
      expect(film.video).toBeNull();
      expect(film.posterUrl).toBeNull();
      expect(film.carImageUrl).toBeNull();
    }
    expect(data.images).toEqual({
      hero: null,
      og: null,
      logo: null,
      favicon: null,
      photoHim: null,
      photoHer: null,
    });
    expect(data.settings.heroTitle).toBe(DEFAULT_SETTINGS.heroTitle);
    expect('storageBudgetGb' in data.settings).toBe(false);
  });
});

describe('normalizeSiteResponse', () => {
  it('отвергает то, что не похоже на ответ', () => {
    expect(normalizeSiteResponse(null)).toBeNull();
    expect(normalizeSiteResponse('<html>')).toBeNull();
    expect(normalizeSiteResponse({ films: [] })).toBeNull();
    expect(normalizeSiteResponse([])).toBeNull();
  });

  it('принимает все текстовые настройки из ответа', () => {
    const settings: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (typeof value === 'string') settings[key] = `изменено: ${key}`;
    }
    settings.siteVisible = false;

    const data = normalizeSiteResponse({ settings, images: {}, films: [] });
    expect(data).not.toBeNull();
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (typeof value === 'string') {
        expect(data?.settings).toHaveProperty(key, `изменено: ${key}`);
      }
    }
    expect(data?.settings.siteVisible).toBe(false);
  });

  it('подставляет значения по умолчанию вместо отсутствующих и неверных полей', () => {
    const data = normalizeSiteResponse({ settings: { heroTitle: 42, siteVisible: 'да' } });
    expect(data?.settings.heroTitle).toBe(DEFAULT_SETTINGS.heroTitle);
    expect(data?.settings.siteVisible).toBe(true);
    expect(data?.films).toHaveLength(4);
    expect(data?.films[0]?.title).toBe(DEFAULT_FILMS[0]?.title);
  });

  it('разбирает фильм с видео и держит порядок уровней', () => {
    const data = normalizeSiteResponse({
      settings: {},
      images: { hero: '/media/images/hero.webp', og: 'javascript:alert(1)' },
      films: [
        {
          slug: 'ultima',
          title: 'УЛЬТИМА+',
          posterUrl: '/media/images/poster.webp',
          video: {
            url: '/media/videos/ultima/a.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 2_500_000_000,
            durationSeconds: 1800,
            width: 3840,
            height: 2160,
            version: 'v7',
          },
        },
        { slug: 'econom', video: { url: 'ftp://example/file.mp4', version: 'v1' } },
        { slug: 'unknown', title: 'Лишний' },
      ],
    });

    expect(data?.films.map((film) => film.slug)).toEqual([...TIER_SLUGS]);
    const ultima = data?.films[3];
    expect(ultima?.title).toBe('УЛЬТИМА+');
    expect(ultima?.posterUrl).toBe('/media/images/poster.webp');
    expect(ultima?.video?.version).toBe('v7');
    expect(ultima?.video?.durationSeconds).toBe(1800);
    expect(data?.films[0]?.video).toBeNull();
    expect(data?.images.hero).toBe('/media/images/hero.webp');
    expect(data?.images.og).toBeNull();
  });

  it('без версии использует адрес видео как ключ позиции', () => {
    const data = normalizeSiteResponse({
      settings: {},
      films: [{ slug: 'basic', video: { url: '/media/videos/basic/b.mp4' } }],
    });
    expect(data?.films[1]?.video?.version).toBe('/media/videos/basic/b.mp4');
  });
});
