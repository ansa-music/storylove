import { describe, expect, it } from 'vitest';

import {
  clearResumeRecord,
  isSameFile,
  loadResumeRecord,
  parseResumeRecord,
  saveResumeRecord,
  type ResumeRecord,
  type ResumeStorage,
} from '@/features/uploads/lib/resume';

function memoryStorage(): ResumeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const record: ResumeRecord = {
  sessionId: 'sess-1',
  slug: 'ultima',
  fileName: 'ultima.mp4',
  fileSize: 3_000_000_000,
  fileLastModified: 1_760_000_000_000,
};

describe('сопоставление файла с сессией', () => {
  const session = { fileName: 'ultima.mp4', fileSize: 3_000_000_000, fileLastModified: 1_760_000_000_000 };

  it('тот же файл — совпадают имя, размер и дата изменения', () => {
    expect(isSameFile({ name: 'ultima.mp4', size: 3_000_000_000, lastModified: 1_760_000_000_000 }, session)).toBe(true);
  });

  it('любое отличие — другой файл', () => {
    expect(isSameFile({ name: 'ultima-v2.mp4', size: 3_000_000_000, lastModified: 1_760_000_000_000 }, session)).toBe(false);
    expect(isSameFile({ name: 'ultima.mp4', size: 3_000_000_001, lastModified: 1_760_000_000_000 }, session)).toBe(false);
    expect(isSameFile({ name: 'ultima.mp4', size: 3_000_000_000, lastModified: 1_760_000_000_001 }, session)).toBe(false);
  });
});

describe('запись о незавершённой загрузке в хранилище браузера', () => {
  it('сохраняет, читает и удаляет запись по уровню', () => {
    const storage = memoryStorage();
    expect(saveResumeRecord(record, storage)).toBe(true);
    expect(loadResumeRecord('ultima', storage)).toEqual(record);
    expect(loadResumeRecord('basic', storage)).toBeNull();
    expect(clearResumeRecord('ultima', storage)).toBe(true);
    expect(loadResumeRecord('ultima', storage)).toBeNull();
  });

  it('хранит только сведения о файле и номер сессии', () => {
    const storage = memoryStorage();
    saveResumeRecord(record, storage);
    const stored: unknown = JSON.parse([...storage.data.values()][0] ?? '{}');
    expect(Object.keys(stored as object).sort()).toEqual(
      ['fileLastModified', 'fileName', 'fileSize', 'sessionId', 'slug'].sort(),
    );
  });

  it('отбрасывает повреждённые и чужие данные', () => {
    expect(parseResumeRecord(null)).toBeNull();
    expect(parseResumeRecord('не json')).toBeNull();
    expect(parseResumeRecord('{"sessionId":"x"}')).toBeNull();
    expect(parseResumeRecord(JSON.stringify({ ...record, slug: 'gold' }))).toBeNull();
    expect(parseResumeRecord(JSON.stringify({ ...record, fileSize: '3000' }))).toBeNull();
    expect(parseResumeRecord(JSON.stringify(record))).toEqual(record);
  });

  it('не падает, если хранилище недоступно или переполнено', () => {
    const broken: ResumeStorage = {
      getItem: () => {
        throw new Error('доступ запрещён');
      },
      setItem: () => {
        throw new Error('нет места');
      },
      removeItem: () => {
        throw new Error('доступ запрещён');
      },
    };
    expect(loadResumeRecord('ultima', broken)).toBeNull();
    expect(saveResumeRecord(record, broken)).toBe(false);
    expect(clearResumeRecord('ultima', broken)).toBe(false);
    expect(loadResumeRecord('ultima', null)).toBeNull();
  });
});
