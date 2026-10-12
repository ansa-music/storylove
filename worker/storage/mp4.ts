const KNOWN_TOP_LEVEL_BOXES = new Set([
  'moov',
  'mdat',
  'free',
  'skip',
  'wide',
  'uuid',
  'moof',
  'styp',
  'sidx',
  'pdin',
  'meta',
]);

function boxType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
}

/**
 * Проверка начала файла: настоящий MP4 начинается с бокса `ftyp`,
 * за которым идёт другой известный бокс верхнего уровня.
 */
export function looksLikeMp4(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ftypSize = view.getUint32(0);
  if (boxType(bytes, 0) !== 'ftyp') return false;
  // ftyp: заголовок 8 байт + major brand 4 + minor version 4, плюс совместимые бренды по 4 байта.
  if (ftypSize < 16 || ftypSize > 4096 || ftypSize % 4 !== 0) return false;
  if (bytes.byteLength < ftypSize + 8) return false;
  return KNOWN_TOP_LEVEL_BOXES.has(boxType(bytes, ftypSize));
}
