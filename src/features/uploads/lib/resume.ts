// Возобновление загрузки: сопоставление файла с сессией и запись в localStorage.
// В хранилище браузера лежат только имя, размер и дата файла и номер сессии — никаких секретов.

import { z } from 'zod';

import { TIER_SLUGS, type TierSlug } from '@shared/constants';

export interface FileIdentity {
  name: string;
  size: number;
  lastModified: number;
}

export interface SessionIdentity {
  fileName: string;
  fileSize: number;
  fileLastModified: number;
}

/** Тот же ли это файл, что в незавершённой сессии: совпадают имя, размер и дата изменения. */
export function isSameFile(file: FileIdentity, session: SessionIdentity): boolean {
  return (
    file.name === session.fileName &&
    file.size === session.fileSize &&
    file.lastModified === session.fileLastModified
  );
}

const resumeRecordSchema = z.object({
  sessionId: z.string().min(1),
  slug: z.enum(TIER_SLUGS),
  fileName: z.string().min(1),
  fileSize: z.number().int().positive(),
  fileLastModified: z.number().int().nonnegative(),
});

export type ResumeRecord = z.infer<typeof resumeRecordSchema>;

/** Разбор строки из localStorage. Чужие и повреждённые данные — null. */
export function parseResumeRecord(raw: string | null): ResumeRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = resumeRecordSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

const KEY_PREFIX = 'storylove.upload.';

function storageKey(slug: TierSlug): string {
  return KEY_PREFIX + slug;
}

/** Минимум Storage, чтобы хранилище можно было подменить в тестах. */
export type ResumeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): ResumeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Доступ к localStorage запрещён настройками браузера — работаем без подсказки.
    return null;
  }
}

export function loadResumeRecord(
  slug: TierSlug,
  storage: ResumeStorage | null = defaultStorage(),
): ResumeRecord | null {
  if (!storage) return null;
  try {
    const record = parseResumeRecord(storage.getItem(storageKey(slug)));
    return record && record.slug === slug ? record : null;
  } catch {
    return null;
  }
}

/** true — запись сохранена. Сбой (переполнение, запрет) не мешает загрузке: список сессий есть на сервере. */
export function saveResumeRecord(
  record: ResumeRecord,
  storage: ResumeStorage | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(storageKey(record.slug), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function clearResumeRecord(slug: TierSlug, storage: ResumeStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(storageKey(slug));
    return true;
  } catch {
    return false;
  }
}
