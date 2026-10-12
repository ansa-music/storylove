// План частей multipart-загрузки. Чистые функции без DOM — покрыты tests/unit/upload-parts.test.ts.

export interface PartRange {
  partNumber: number;
  /** Смещение первого байта части в файле. */
  start: number;
  /** Смещение за последним байтом (как второй аргумент Blob.slice). */
  end: number;
  size: number;
}

export interface KnownPart {
  partNumber: number;
  sizeBytes: number;
}

/** Сколько частей нужно для файла. Пустой файл — ноль частей. */
export function countParts(fileSize: number, partSize: number): number {
  if (!Number.isFinite(fileSize) || !Number.isFinite(partSize) || fileSize <= 0 || partSize <= 0) return 0;
  return Math.ceil(fileSize / partSize);
}

/** Границы части с номером partNumber (нумерация с 1, как в S3/R2). */
export function partRange(partNumber: number, fileSize: number, partSize: number): PartRange {
  const total = countParts(fileSize, partSize);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > total) {
    throw new RangeError(`Части с номером ${partNumber} нет: всего частей ${total}.`);
  }
  const start = (partNumber - 1) * partSize;
  const end = Math.min(start + partSize, fileSize);
  return { partNumber, start, end, size: end - start };
}

/**
 * Части, принятые сервером и совпадающие по размеру с планом.
 * Часть с неожиданным размером считается непринятой и будет загружена заново.
 */
export function acceptedParts(
  uploaded: readonly KnownPart[],
  fileSize: number,
  partSize: number,
): Map<number, number> {
  const total = countParts(fileSize, partSize);
  const accepted = new Map<number, number>();
  for (const part of uploaded) {
    if (!Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > total) continue;
    const expected = partRange(part.partNumber, fileSize, partSize).size;
    if (part.sizeBytes === expected) accepted.set(part.partNumber, expected);
  }
  return accepted;
}

/** Номера частей, которых ещё нет на сервере, по возрастанию. */
export function missingPartNumbers(totalParts: number, accepted: ReadonlyMap<number, number>): number[] {
  const missing: number[] = [];
  for (let n = 1; n <= totalParts; n++) {
    if (!accepted.has(n)) missing.push(n);
  }
  return missing;
}

/** Берёт из очереди столько частей, сколько свободных потоков. Входной массив не меняется. */
export function takeNextParts(
  pending: readonly number[],
  inFlightCount: number,
  concurrency: number,
): { take: number[]; rest: number[] } {
  const free = Math.max(0, concurrency - inFlightCount);
  return { take: pending.slice(0, free), rest: pending.slice(free) };
}

/** Вернуть прерванные части в очередь: без дублей, по возрастанию. */
export function requeueParts(pending: readonly number[], returned: Iterable<number>): number[] {
  return [...new Set([...pending, ...returned])].sort((a, b) => a - b);
}

/**
 * Для каких частей запросить ссылки одним вызовом: обязательно first,
 * затем ближайшие из upcoming без действующей ссылки, не больше maxBatch.
 */
export function pickPartsToSign(
  first: number,
  upcoming: readonly number[],
  hasValidUrl: (partNumber: number) => boolean,
  maxBatch: number,
): number[] {
  const picked = [first];
  for (const n of upcoming) {
    if (picked.length >= maxBatch) break;
    if (n === first || picked.includes(n) || hasValidUrl(n)) continue;
    picked.push(n);
  }
  return picked;
}

/**
 * До какого момента (мс) ссылкой можно пользоваться. Запас — минута или четверть срока,
 * чтобы не начать отправку части по ссылке, которая истечёт через секунду.
 */
export function urlDeadline(nowMs: number, expiresInSeconds: number): number {
  const ttl = Math.max(0, expiresInSeconds);
  const margin = Math.min(60, ttl * 0.25);
  return nowMs + (ttl - margin) * 1000;
}
