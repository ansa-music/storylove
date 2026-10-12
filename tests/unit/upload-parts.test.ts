import { describe, expect, it } from 'vitest';

import { MAX_SIGN_BATCH, UPLOAD_CONCURRENCY, UPLOAD_PART_BYTES } from '@shared/constants';
import {
  acceptedParts,
  countParts,
  missingPartNumbers,
  partRange,
  pickPartsToSign,
  requeueParts,
  takeNextParts,
  urlDeadline,
} from '@/features/uploads/lib/parts';
import { computeProgress, etaSeconds, SpeedMeter } from '@/features/uploads/lib/progress';

const GIB = 1024 ** 3;

describe('план частей', () => {
  it('считает количество частей для файла 3 ГБ', () => {
    expect(countParts(3 * GIB, UPLOAD_PART_BYTES)).toBe(192);
    expect(countParts(3 * GIB + 1, UPLOAD_PART_BYTES)).toBe(193);
    expect(countParts(1, UPLOAD_PART_BYTES)).toBe(1);
  });

  it('возвращает ноль частей для пустого файла и неверных аргументов', () => {
    expect(countParts(0, UPLOAD_PART_BYTES)).toBe(0);
    expect(countParts(100, 0)).toBe(0);
    expect(countParts(Number.NaN, 10)).toBe(0);
  });

  it('даёт границы частей; последняя короче', () => {
    expect(partRange(1, 25, 10)).toEqual({ partNumber: 1, start: 0, end: 10, size: 10 });
    expect(partRange(2, 25, 10)).toEqual({ partNumber: 2, start: 10, end: 20, size: 10 });
    expect(partRange(3, 25, 10)).toEqual({ partNumber: 3, start: 20, end: 25, size: 5 });
  });

  it('части покрывают файл без дыр и наложений', () => {
    const fileSize = 5 * UPLOAD_PART_BYTES + 12345;
    const total = countParts(fileSize, UPLOAD_PART_BYTES);
    let cursor = 0;
    for (let n = 1; n <= total; n++) {
      const range = partRange(n, fileSize, UPLOAD_PART_BYTES);
      expect(range.start).toBe(cursor);
      cursor = range.end;
    }
    expect(cursor).toBe(fileSize);
  });

  it('отказывается от номера вне диапазона', () => {
    expect(() => partRange(0, 25, 10)).toThrow(RangeError);
    expect(() => partRange(4, 25, 10)).toThrow(RangeError);
    expect(() => partRange(1.5, 25, 10)).toThrow(RangeError);
  });
});

describe('возобновление: какие части уже приняты', () => {
  it('принимает части с верным размером и отбрасывает остальные', () => {
    const accepted = acceptedParts(
      [
        { partNumber: 1, sizeBytes: 10 },
        { partNumber: 2, sizeBytes: 7 }, // размер не совпал — грузим заново
        { partNumber: 3, sizeBytes: 5 },
        { partNumber: 9, sizeBytes: 10 }, // такой части в плане нет
      ],
      25,
      10,
    );
    expect([...accepted.entries()]).toEqual([
      [1, 10],
      [3, 5],
    ]);
    expect(missingPartNumbers(3, accepted)).toEqual([2]);
  });

  it('без принятых частей недостаёт всех', () => {
    expect(missingPartNumbers(4, new Map())).toEqual([1, 2, 3, 4]);
  });
});

describe('очередь частей', () => {
  it('берёт столько частей, сколько свободных потоков', () => {
    const pending = [3, 4, 5, 6, 7, 8];
    expect(takeNextParts(pending, 0, UPLOAD_CONCURRENCY)).toEqual({ take: [3, 4, 5, 6], rest: [7, 8] });
    expect(takeNextParts(pending, 3, UPLOAD_CONCURRENCY)).toEqual({ take: [3], rest: [4, 5, 6, 7, 8] });
    expect(takeNextParts(pending, 4, UPLOAD_CONCURRENCY)).toEqual({ take: [], rest: pending });
    expect(pending).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it('возвращает прерванные части в очередь по порядку и без дублей', () => {
    expect(requeueParts([7, 8], [5, 3, 7])).toEqual([3, 5, 7, 8]);
  });

  it('выбирает части для подписи: сначала нужная, потом ближайшие без ссылки', () => {
    const valid = new Set([4, 6]);
    expect(pickPartsToSign(5, [3, 4, 5, 6, 7, 8], (n) => valid.has(n), 4)).toEqual([5, 3, 7, 8]);
  });

  it('не превышает лимит пачки', () => {
    const upcoming = Array.from({ length: 100 }, (_, i) => i + 1);
    const picked = pickPartsToSign(1, upcoming, () => false, MAX_SIGN_BATCH);
    expect(picked).toHaveLength(MAX_SIGN_BATCH);
    expect(new Set(picked).size).toBe(MAX_SIGN_BATCH);
  });

  it('срок ссылки берётся с запасом', () => {
    expect(urlDeadline(1000, 900)).toBe(1000 + 840_000);
    expect(urlDeadline(1000, 40)).toBe(1000 + 30_000);
    expect(urlDeadline(1000, 0)).toBe(1000);
  });
});

describe('прогресс, скорость и оставшееся время', () => {
  it('складывает подтверждённые байты и байты текущих частей', () => {
    expect(computeProgress(500, [100, 50], 1000)).toEqual({ uploadedBytes: 650, percent: 65 });
  });

  it('не показывает больше 100% и не округляет вверх', () => {
    expect(computeProgress(900, [200], 1000)).toEqual({ uploadedBytes: 1000, percent: 100 });
    expect(computeProgress(9999, [], 10_000).percent).toBe(99.9);
    expect(computeProgress(0, [], 0)).toEqual({ uploadedBytes: 0, percent: 0 });
  });

  it('считает скорость как среднее за окно', () => {
    const meter = new SpeedMeter(10_000);
    meter.add(0, 1000);
    expect(meter.rate(500)).toBe(0); // данных меньше секунды
    meter.add(1000, 2000);
    meter.add(2000, 2000);
    expect(meter.rate(2000)).toBe(2000);
  });

  it('забывает старые отметки и падает до нуля при простое', () => {
    const meter = new SpeedMeter(10_000);
    meter.add(0, 5000);
    meter.add(1000, 5000);
    expect(meter.rate(1000)).toBe(5000);
    expect(meter.rate(30_000)).toBe(0);
    meter.add(31_000, 100);
    meter.reset();
    expect(meter.rate(32_000)).toBe(0);
  });

  it('оценивает оставшееся время', () => {
    expect(etaSeconds(1000, 100)).toBe(10);
    expect(etaSeconds(1001, 100)).toBe(11);
    expect(etaSeconds(0, 0)).toBe(0);
    expect(etaSeconds(1000, 0)).toBeNull();
  });
});
