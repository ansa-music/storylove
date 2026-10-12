import { Hono } from 'hono';

import type { AdminFilmResponse, AdminFilmsResponse } from '../../shared/api.ts';
import { FILM_IMAGE_KINDS, isTierSlug, type FilmImageKind, type TierSlug } from '../../shared/constants.ts';
import {
  filmImageKey,
  getFilmRow,
  loadAdminFilm,
  loadAdminFilms,
  setFilmImageKey,
  updateFilm,
} from '../database/films.ts';
import type { AppBindings } from '../env.ts';
import { notFound } from '../lib/errors.ts';
import { json, readJson } from '../lib/http.ts';
import { filmPatchSchema } from '../lib/schemas.ts';
import { deleteImageQuietly, storeImage } from '../storage/images.ts';

function requireSlug(value: string): TierSlug {
  if (!isTierSlug(value)) throw notFound('Фильм не найден.');
  return value;
}

function requireImageKind(value: string): FilmImageKind {
  const kind = FILM_IMAGE_KINDS.find((item) => item === value);
  if (!kind) throw notFound('Такого изображения у фильма нет.');
  return kind;
}

export const filmRoutes = new Hono<AppBindings>();

filmRoutes.get('/', async (c) => {
  const body: AdminFilmsResponse = { films: await loadAdminFilms(c.env.DB) };
  return json(body);
});

filmRoutes.get('/:slug', async (c) => {
  const body: AdminFilmResponse = {
    film: await loadAdminFilm(c.env.DB, requireSlug(c.req.param('slug'))),
  };
  return json(body);
});

filmRoutes.patch('/:slug', async (c) => {
  const slug = requireSlug(c.req.param('slug'));
  const patch = await readJson(c.req.raw, filmPatchSchema);
  await updateFilm(c.env.DB, slug, patch);
  const body: AdminFilmResponse = { film: await loadAdminFilm(c.env.DB, slug) };
  return json(body);
});

filmRoutes.put('/:slug/image/:kind', async (c) => {
  const slug = requireSlug(c.req.param('slug'));
  const kind = requireImageKind(c.req.param('kind'));
  const film = await getFilmRow(c.env.DB, slug);
  const previousKey = filmImageKey(film, kind);

  const key = await storeImage(c.env, c.req.raw, kind, { allowSvg: false });
  try {
    await setFilmImageKey(c.env.DB, slug, kind, key);
  } catch (error) {
    await deleteImageQuietly(c.env, key);
    throw error;
  }
  // Старый объект удаляется только после успешной замены.
  await deleteImageQuietly(c.env, previousKey);
  const body: AdminFilmResponse = { film: await loadAdminFilm(c.env.DB, slug) };
  return json(body);
});

filmRoutes.delete('/:slug/image/:kind', async (c) => {
  const slug = requireSlug(c.req.param('slug'));
  const kind = requireImageKind(c.req.param('kind'));
  const film = await getFilmRow(c.env.DB, slug);
  await setFilmImageKey(c.env.DB, slug, kind, null);
  await deleteImageQuietly(c.env, filmImageKey(film, kind));
  const body: AdminFilmResponse = { film: await loadAdminFilm(c.env.DB, slug) };
  return json(body);
});
