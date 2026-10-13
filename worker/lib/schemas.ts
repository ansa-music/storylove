import { z } from 'zod';

import type { SiteSettingKey } from '../../shared/api.ts';
import { MAX_SIGN_BATCH, PASSWORD_MAX_LENGTH, TIER_SLUGS } from '../../shared/constants.ts';
import { TEXT_LIMITS } from '../../shared/defaults.ts';

const text = (max: number, min = 0): z.ZodString => z.string().trim().min(min).max(max);
const shortText = text(TEXT_LIMITS.settingShort);
const longText = text(TEXT_LIMITS.settingLong);

/** Схема каждого ключа настроек: используется и при записи, и при чтении из базы. */
export const settingsShape = {
  studioName: text(TEXT_LIMITS.settingShort, 1),
  logoTagline: shortText,
  heroEyebrow: shortText,
  heroTitle: shortText,
  heroSubtitle: longText,
  heroPrimaryCta: shortText,
  heroSecondaryCta: shortText,
  aboutEyebrow: shortText,
  aboutTitle: shortText,
  aboutText: longText,
  photosText: shortText,
  photoHimLabel: shortText,
  photoHerLabel: shortText,
  tiersEyebrow: shortText,
  tiersTitle: shortText,
  ultimaEyebrow: shortText,
  ultimaTitle: shortText,
  ultimaDescription: longText,
  compareTitle: shortText,
  compareIntro: longText,
  finalTitle: shortText,
  finalText: longText,
  finalCta: shortText,
  footerText: longText,
  footerNote: longText,
  metaTitle: text(TEXT_LIMITS.settingShort, 1),
  metaDescription: longText,
  siteVisible: z.boolean(),
  storageBudgetGb: z.number().min(1).max(100_000),
} satisfies Record<SiteSettingKey, z.ZodType>;

export const settingsSchema = z.object(settingsShape);
/** Неизвестные ключи отклоняются. */
export const settingsPatchSchema = z.strictObject(settingsShape).partial();

export const filmPatchSchema = z
  .strictObject({
    title: text(TEXT_LIMITS.title, 1),
    tagline: text(TEXT_LIMITS.tagline),
    description: text(TEXT_LIMITS.description),
    compareText: text(TEXT_LIMITS.compareText),
    buttonLabel: text(TEXT_LIMITS.buttonLabel, 1),
    isPublished: z.boolean(),
  })
  .partial();

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
// Политика длины нового пароля проверяется отдельно (assertPasswordPolicy), чтобы текст ошибки был понятным.
const password = z.string().min(1).max(PASSWORD_MAX_LENGTH);

export const loginSchema = z.strictObject({ email, password });
export const setupSchema = z.strictObject({ setupToken: z.string().min(1).max(512), email, password });
export const changePasswordSchema = z.strictObject({
  currentPassword: password,
  newPassword: z.string().max(1000),
});

export const createUploadSchema = z.strictObject({
  slug: z.enum(TIER_SLUGS),
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().positive(),
  mimeType: z.string().max(100),
  fileLastModified: z.number().int().min(0),
});

export const signPartsSchema = z.strictObject({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(MAX_SIGN_BATCH),
});

export const reportPartSchema = z.strictObject({
  etag: z.string().min(1).max(128),
  sizeBytes: z.number().int().positive(),
});

export const completeUploadSchema = z.strictObject({
  durationSeconds: z
    .number()
    .positive()
    .max(24 * 60 * 60)
    .nullable()
    .optional(),
  width: z.number().int().min(1).max(16_384).nullable().optional(),
  height: z.number().int().min(1).max(16_384).nullable().optional(),
});

export const confirmSchema = z.strictObject({ confirm: z.literal(true) });

export const cleanupSchema = z.strictObject({
  keys: z.array(z.string().min(1).max(512)).min(1).max(1000),
  confirm: z.literal(true),
});
