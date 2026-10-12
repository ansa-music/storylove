import { Hono } from 'hono';

import type { AdminSettingsResponse } from '../../shared/api.ts';
import { SITE_IMAGE_KINDS, type SiteImageKind } from '../../shared/constants.ts';
import { loadSettings, saveSettings, setSiteImageKey, toSiteImages } from '../database/settings.ts';
import type { AppBindings } from '../env.ts';
import { notFound } from '../lib/errors.ts';
import { json, readJson } from '../lib/http.ts';
import { settingsPatchSchema } from '../lib/schemas.ts';
import { deleteImageQuietly, storeImage } from '../storage/images.ts';

// SVG допускается только для логотипа и favicon.
const SVG_KINDS: readonly SiteImageKind[] = ['logo', 'favicon'];

function requireImageKind(value: string): SiteImageKind {
  const kind = SITE_IMAGE_KINDS.find((item) => item === value);
  if (!kind) throw notFound('Такого изображения сайта нет.');
  return kind;
}

async function settingsResponse(db: D1Database): Promise<Response> {
  const { settings, imageKeys } = await loadSettings(db);
  const body: AdminSettingsResponse = { settings, images: toSiteImages(imageKeys) };
  return json(body);
}

export const settingsRoutes = new Hono<AppBindings>();

settingsRoutes.get('/', (c) => settingsResponse(c.env.DB));

settingsRoutes.patch('/', async (c) => {
  const patch = await readJson(c.req.raw, settingsPatchSchema);
  await saveSettings(c.env.DB, patch);
  return settingsResponse(c.env.DB);
});

settingsRoutes.put('/image/:kind', async (c) => {
  const kind = requireImageKind(c.req.param('kind'));
  const previousKey = (await loadSettings(c.env.DB)).imageKeys[kind];
  const key = await storeImage(c.env, c.req.raw, kind, { allowSvg: SVG_KINDS.includes(kind) });
  try {
    await setSiteImageKey(c.env.DB, kind, key);
  } catch (error) {
    await deleteImageQuietly(c.env, key);
    throw error;
  }
  await deleteImageQuietly(c.env, previousKey);
  return settingsResponse(c.env.DB);
});

settingsRoutes.delete('/image/:kind', async (c) => {
  const kind = requireImageKind(c.req.param('kind'));
  const previousKey = (await loadSettings(c.env.DB)).imageKeys[kind];
  await setSiteImageKey(c.env.DB, kind, null);
  await deleteImageQuietly(c.env, previousKey);
  return settingsResponse(c.env.DB);
});
