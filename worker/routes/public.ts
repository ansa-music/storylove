import { Hono } from 'hono';

import type { PublicSiteResponse } from '../../shared/api.ts';
import { listFilmRows, listVideoRows, toPublicFilm } from '../database/films.ts';
import { loadSettings, toSiteImages } from '../database/settings.ts';
import type { AppBindings } from '../env.ts';
import { json } from '../lib/http.ts';

export const publicRoutes = new Hono<AppBindings>();

publicRoutes.get('/site', async (c) => {
  const [{ settings, imageKeys }, films, videos] = await Promise.all([
    loadSettings(c.env.DB),
    listFilmRows(c.env.DB),
    listVideoRows(c.env.DB),
  ]);
  const { storageBudgetGb: _storageBudgetGb, ...publicSettings } = settings;
  const body: PublicSiteResponse = {
    settings: publicSettings,
    images: toSiteImages(imageKeys),
    films: films.map((film) => toPublicFilm(film, videos, settings.siteVisible)),
  };
  return json(body, 200, { 'Cache-Control': 'public, max-age=30' });
});
