// Разбор верхнего уровня MP4 (ISO BMFF): ищем ftyp, moov и mdat, читая только заголовки боксов.
// Файл целиком в память не попадает: читаем по 16 байт и перепрыгиваем содержимое.

export interface Mp4Box {
  type: string;
  offset: number;
  /** Полный размер бокса с заголовком. */
  size: number;
  headerSize: number;
}

export interface Mp4Structure {
  /** Первый бокс — ftyp: файл действительно MP4. */
  hasFtyp: boolean;
  /** Основной бренд из ftyp (isom, mp42, M4V …). */
  majorBrand: string | null;
  boxes: Mp4Box[];
  /**
   * 'yes' — moov стоит раньше mdat, видео начинает играть без скачивания целиком;
   * 'no' — moov в конце; 'unknown' — структуру не удалось прочитать до конца.
   */
  fastStart: 'yes' | 'no' | 'unknown';
}

/** Читает length байт файла со смещения offset (в конце файла может вернуть меньше). */
export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

const HEADER_BYTES = 16;
const MAX_BOXES = 256;

function fourCc(bytes: Uint8Array, at: number): string {
  let out = '';
  for (let i = 0; i < 4; i++) out += String.fromCharCode(bytes[at + i] ?? 0);
  return out;
}

function isBoxType(type: string): boolean {
  return /^[\x20-\x7e]{4}$/.test(type);
}

/**
 * Заголовок бокса по первым 8–16 байтам. null — байт мало или это не бокс.
 * size 1 — размер в следующих 8 байтах; size 0 — бокс длится до конца файла.
 */
export function parseBoxHeader(bytes: Uint8Array, offset: number, fileSize: number): Mp4Box | null {
  if (bytes.byteLength < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size32 = view.getUint32(0);
  const type = fourCc(bytes, 4);
  if (!isBoxType(type)) return null;

  let size = size32;
  let headerSize = 8;
  if (size32 === 1) {
    if (bytes.byteLength < 16) return null;
    size = view.getUint32(8) * 2 ** 32 + view.getUint32(12);
    headerSize = 16;
  } else if (size32 === 0) {
    size = fileSize - offset;
  }
  if (size < headerSize || offset + size > fileSize) return null;
  return { type, offset, size, headerSize };
}

/** Проходит по боксам верхнего уровня и определяет, готов ли файл к потоковому просмотру. */
export async function scanMp4(read: ByteReader, fileSize: number): Promise<Mp4Structure> {
  const boxes: Mp4Box[] = [];
  let majorBrand: string | null = null;
  let offset = 0;
  let complete = false;

  while (boxes.length < MAX_BOXES) {
    if (offset >= fileSize) {
      complete = true;
      break;
    }
    const header = await read(offset, HEADER_BYTES);
    const box = parseBoxHeader(header, offset, fileSize);
    if (!box) break;
    if (box.type === 'ftyp' && boxes.length === 0 && header.byteLength >= box.headerSize + 4) {
      majorBrand = fourCc(header, box.headerSize).trim() || null;
    }
    boxes.push(box);
    offset += box.size;
  }

  const hasFtyp = boxes[0]?.type === 'ftyp';
  const moov = boxes.find((box) => box.type === 'moov');
  const mdat = boxes.find((box) => box.type === 'mdat');

  let fastStart: Mp4Structure['fastStart'] = 'unknown';
  if (moov && mdat) fastStart = moov.offset < mdat.offset ? 'yes' : 'no';
  else if (moov && !mdat && complete) fastStart = 'yes';
  // mdat найден, а moov так и не встретился до сбоя разбора: moov точно не в начале.
  else if (mdat && !moov) fastStart = 'no';

  return { hasFtyp, majorBrand, boxes, fastStart };
}

/** Читатель для File/Blob: берёт только запрошенный кусок. */
export function blobReader(blob: Blob): ByteReader {
  return async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
}
