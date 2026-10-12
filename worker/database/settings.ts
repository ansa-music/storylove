import type { SiteImages, SiteSettings } from '../../shared/api.ts';
import { SITE_IMAGE_KINDS, mediaUrl, type SiteImageKind } from '../../shared/constants.ts';
import { DEFAULT_SETTINGS } from '../../shared/defaults.ts';
import { nowIso } from '../lib/http.ts';
import { settingsPatchSchema, settingsSchema } from '../lib/schemas.ts';

const IMAGE_KEY_PREFIX = 'image.';

export interface LoadedSettings {
  settings: SiteSettings;
  /** Ключи объектов R2 для изображений сайта; null — встроенное изображение из сборки. */
  imageKeys: Record<SiteImageKind, string | null>;
}

function parseStoredValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    // Повреждённое значение не должно ронять сайт: вместо него берётся значение по умолчанию.
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/** Настройки = DEFAULT_SETTINGS поверх которых лежат корректные значения из site_settings. */
export async function loadSettings(db: D1Database): Promise<LoadedSettings> {
  const { results } = await db
    .prepare('SELECT key, value FROM site_settings')
    .all<{ key: string; value: string }>();

  const imageKeys: Record<SiteImageKind, string | null> = {
    hero: null,
    og: null,
    logo: null,
    favicon: null,
  };
  let overrides: Partial<SiteSettings> = {};

  for (const row of results) {
    const value = parseStoredValue(row.value);
    if (row.key.startsWith(IMAGE_KEY_PREFIX)) {
      const kind = SITE_IMAGE_KINDS.find((item) => IMAGE_KEY_PREFIX + item === row.key);
      if (kind && typeof value === 'string' && value !== '') imageKeys[kind] = value;
      continue;
    }
    if (value === undefined) continue;
    const parsed = settingsPatchSchema.safeParse({ [row.key]: value });
    if (parsed.success) overrides = { ...overrides, ...parsed.data };
  }

  const settings = settingsSchema.parse({ ...DEFAULT_SETTINGS, ...overrides });
  return { settings, imageKeys };
}

export function toSiteImages(imageKeys: Record<SiteImageKind, string | null>): SiteImages {
  return {
    hero: mediaUrl(imageKeys.hero),
    og: mediaUrl(imageKeys.og),
    logo: mediaUrl(imageKeys.logo),
    favicon: mediaUrl(imageKeys.favicon),
  };
}

const UPSERT_SQL = `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

export async function saveSettings(db: D1Database, patch: Partial<SiteSettings>): Promise<void> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const now = nowIso();
  const statement = db.prepare(UPSERT_SQL);
  await db.batch(entries.map(([key, value]) => statement.bind(key, JSON.stringify(value), now)));
}

export async function setSiteImageKey(
  db: D1Database,
  kind: SiteImageKind,
  key: string | null,
): Promise<void> {
  const name = IMAGE_KEY_PREFIX + kind;
  if (key === null) {
    await db.prepare('DELETE FROM site_settings WHERE key = ?').bind(name).run();
    return;
  }
  await db.prepare(UPSERT_SQL).bind(name, JSON.stringify(key), nowIso()).run();
}
