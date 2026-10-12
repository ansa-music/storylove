import { describe, expect, it } from 'vitest';

import { MAX_VIDEO_BYTES, MIN_VIDEO_BYTES } from '@shared/constants';
import { assessStructure, checkVideoFile } from '@/features/uploads/lib/fileChecks';
import { parseBoxHeader, scanMp4, type ByteReader } from '@/features/uploads/lib/mp4';

function box(type: string, payloadSize: number, payload?: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + payloadSize);
  new DataView(bytes.buffer).setUint32(0, bytes.byteLength);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  if (payload) bytes.set(payload, 8);
  return bytes;
}

function ftyp(brand = 'isom'): Uint8Array {
  const payload = new Uint8Array(8);
  for (let i = 0; i < 4; i++) payload[i] = brand.charCodeAt(i);
  return box('ftyp', 8, payload);
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function readerOf(bytes: Uint8Array): ByteReader & { calls: number; maxLength: number } {
  const reader = (async (offset: number, length: number) => {
    reader.calls++;
    reader.maxLength = Math.max(reader.maxLength, length);
    return bytes.slice(offset, offset + length);
  }) as ByteReader & { calls: number; maxLength: number };
  reader.calls = 0;
  reader.maxLength = 0;
  return reader;
}

describe('заголовок бокса', () => {
  it('читает обычный 32-битный размер', () => {
    expect(parseBoxHeader(box('moov', 92), 0, 100)).toEqual({ type: 'moov', offset: 0, size: 100, headerSize: 8 });
  });

  it('читает 64-битный размер (size = 1)', () => {
    const header = new Uint8Array(16);
    const view = new DataView(header.buffer);
    view.setUint32(0, 1);
    header.set([0x6d, 0x64, 0x61, 0x74], 4); // mdat
    view.setUint32(8, 1); // старшие 32 бита: 4 ГБ
    view.setUint32(12, 16);
    const size = 2 ** 32 + 16;
    expect(parseBoxHeader(header, 0, size)).toEqual({ type: 'mdat', offset: 0, size, headerSize: 16 });
  });

  it('size = 0 означает «до конца файла»', () => {
    const header = box('mdat', 0);
    new DataView(header.buffer).setUint32(0, 0);
    expect(parseBoxHeader(header, 40, 1000)).toEqual({ type: 'mdat', offset: 40, size: 960, headerSize: 8 });
  });

  it('отклоняет мусор, слишком короткие данные и бокс за пределами файла', () => {
    expect(parseBoxHeader(new Uint8Array([0, 0, 0, 16, 0, 1, 2, 3]), 0, 100)).toBeNull();
    expect(parseBoxHeader(new Uint8Array(4), 0, 100)).toBeNull();
    expect(parseBoxHeader(box('moov', 92), 50, 100)).toBeNull();
    const tooSmall = box('free', 0);
    new DataView(tooSmall.buffer).setUint32(0, 4);
    expect(parseBoxHeader(tooSmall, 0, 100)).toBeNull();
  });
});

describe('структура MP4', () => {
  it('moov перед mdat — файл готов к потоковому просмотру', async () => {
    const bytes = concat(ftyp('mp42'), box('moov', 40), box('mdat', 200));
    const result = await scanMp4(readerOf(bytes), bytes.byteLength);
    expect(result.hasFtyp).toBe(true);
    expect(result.majorBrand).toBe('mp42');
    expect(result.fastStart).toBe('yes');
    expect(result.boxes.map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
  });

  it('moov после mdat — не оптимизирован', async () => {
    const bytes = concat(ftyp(), box('free', 8), box('mdat', 200), box('moov', 40));
    const result = await scanMp4(readerOf(bytes), bytes.byteLength);
    expect(result.fastStart).toBe('no');
    expect(assessStructure(result).warnings[0]).toContain('npm run video:prepare');
    expect(assessStructure(result).errors).toEqual([]);
  });

  it('читает только заголовки, а не содержимое боксов', async () => {
    const bytes = concat(ftyp(), box('mdat', 50_000), box('moov', 40));
    const reader = readerOf(bytes);
    await scanMp4(reader, bytes.byteLength);
    expect(reader.calls).toBe(3);
    expect(reader.maxLength).toBeLessThanOrEqual(16);
  });

  it('файл без ftyp — не MP4, загрузка блокируется', async () => {
    const bytes = new TextEncoder().encode('RIFF....AVI LIST и дальше что-то совсем другое');
    const result = await scanMp4(readerOf(bytes), bytes.byteLength);
    expect(result.hasFtyp).toBe(false);
    expect(assessStructure(result).errors).toHaveLength(1);
  });

  it('обрыв структуры после mdat без moov — считаем неоптимизированным', async () => {
    const bytes = concat(ftyp(), box('mdat', 64), new Uint8Array(12));
    const result = await scanMp4(readerOf(bytes), bytes.byteLength);
    expect(result.fastStart).toBe('no');
  });

  it('обрыв до moov и mdat — неизвестно, предупреждаем без блокировки', async () => {
    const bytes = concat(ftyp(), new Uint8Array(32));
    const result = await scanMp4(readerOf(bytes), bytes.byteLength);
    expect(result.fastStart).toBe('unknown');
    const assessed = assessStructure(result);
    expect(assessed.errors).toEqual([]);
    expect(assessed.warnings).toHaveLength(1);
  });
});

describe('проверка файла по имени, типу и размеру', () => {
  const ok = { name: 'Ultima Final.MP4', type: 'video/mp4', size: 3 * 1024 ** 3 };

  it('принимает MP4 нужного размера', () => {
    expect(checkVideoFile(ok)).toEqual([]);
    expect(checkVideoFile({ ...ok, name: 'film.m4v', type: 'video/x-m4v' })).toEqual([]);
    expect(checkVideoFile({ ...ok, type: '' })).toEqual([]);
  });

  it('отклоняет другой формат', () => {
    expect(checkVideoFile({ ...ok, name: 'film.mov', type: 'video/quicktime' })).toHaveLength(1);
    expect(checkVideoFile({ ...ok, name: 'film.mp4', type: 'video/webm' })).toHaveLength(1);
    expect(checkVideoFile({ ...ok, name: 'film.mp4.exe', type: '' })).toHaveLength(1);
  });

  it('отклоняет слишком большой и слишком маленький файл', () => {
    expect(checkVideoFile({ ...ok, size: MAX_VIDEO_BYTES })).toEqual([]);
    expect(checkVideoFile({ ...ok, size: MAX_VIDEO_BYTES + 1 })).toHaveLength(1);
    expect(checkVideoFile({ ...ok, size: MIN_VIDEO_BYTES })).toEqual([]);
    expect(checkVideoFile({ ...ok, size: MIN_VIDEO_BYTES - 1 })).toHaveLength(1);
  });
});
