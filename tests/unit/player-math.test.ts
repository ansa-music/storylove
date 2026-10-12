import { describe, expect, it } from 'vitest';

import {
  bufferedEndAt,
  clamp,
  describeTime,
  formatTime,
  mediaErrorMessage,
  parseStoredProgress,
  progressKey,
  ratio,
  resumablePosition,
  seekTarget,
  serializeProgress,
  shouldSaveProgress,
} from '../../src/features/player/playerMath';

describe('formatTime', () => {
  it('форматирует минуты и секунды', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9.9)).toBe('0:09');
    expect(formatTime(75)).toBe('1:15');
    expect(formatTime(754)).toBe('12:34');
  });

  it('добавляет часы для длинных фильмов', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3675)).toBe('1:01:15');
  });

  it('не ломается на некорректных значениях', () => {
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(formatTime(-3)).toBe('0:00');
  });
});

describe('describeTime', () => {
  it('даёт текст для скринридера', () => {
    expect(describeTime(5)).toBe('5 с');
    expect(describeTime(125)).toBe('2 мин 5 с');
    expect(describeTime(3605)).toBe('1 ч 0 мин 5 с');
    expect(describeTime(Number.NaN)).toBe('0 с');
  });
});

describe('clamp и ratio', () => {
  it('ограничивает значение', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(Number.NaN, 1, 3)).toBe(1);
  });

  it('считает долю и не делит на ноль', () => {
    expect(ratio(30, 120)).toBe(0.25);
    expect(ratio(200, 120)).toBe(1);
    expect(ratio(10, 0)).toBe(0);
    expect(ratio(10, Number.NaN)).toBe(0);
  });
});

describe('bufferedEndAt', () => {
  const ranges = [
    { start: 0, end: 40 },
    { start: 100, end: 160 },
  ];

  it('возвращает конец диапазона, в котором находится позиция', () => {
    expect(bufferedEndAt(ranges, 10)).toBe(40);
    expect(bufferedEndAt(ranges, 120)).toBe(160);
  });

  it('вне диапазонов возвращает саму позицию', () => {
    expect(bufferedEndAt(ranges, 60)).toBe(60);
    expect(bufferedEndAt([], 12)).toBe(12);
  });

  it('прощает небольшой зазор перед началом диапазона', () => {
    expect(bufferedEndAt(ranges, 99.9)).toBe(160);
  });
});

describe('seekTarget', () => {
  it('перематывает в пределах длительности', () => {
    expect(seekTarget(10, 5, 100)).toBe(15);
    expect(seekTarget(2, -5, 100)).toBe(0);
    expect(seekTarget(98, 5, 100)).toBe(100);
  });

  it('работает, пока длительность неизвестна', () => {
    expect(seekTarget(10, 5, Number.NaN)).toBe(15);
  });
});

describe('сохранение позиции', () => {
  it('ключ зависит от уровня и версии видео', () => {
    expect(progressKey('ultima', 'v2')).toBe('storylove:progress:ultima:v2');
    expect(progressKey('ultima', 'v2')).not.toBe(progressKey('ultima', 'v3'));
  });

  it('не предлагает продолжить с самого начала', () => {
    expect(resumablePosition(4.9, 600)).toBeNull();
    expect(resumablePosition(5, 600)).toBe(5);
  });

  it('не предлагает продолжить, если осталось меньше 5 секунд', () => {
    expect(resumablePosition(596, 600)).toBeNull();
    expect(resumablePosition(595, 600)).toBe(595);
  });

  it('без известной длительности проверяет только начало', () => {
    expect(resumablePosition(754, null)).toBe(754);
    expect(resumablePosition(Number.NaN, null)).toBeNull();
  });

  it('пишет не чаще раза в 5 секунд, но реагирует на перемотку назад', () => {
    expect(shouldSaveProgress(3, null)).toBe(false);
    expect(shouldSaveProgress(6, null)).toBe(true);
    expect(shouldSaveProgress(12, 10)).toBe(false);
    expect(shouldSaveProgress(15, 10)).toBe(true);
    expect(shouldSaveProgress(100, 400)).toBe(true);
  });

  it('запись читается обратно', () => {
    expect(parseStoredProgress(serializeProgress(754.26, 1_700_000_000_000))).toBe(754.3);
  });

  it('повреждённая запись игнорируется', () => {
    expect(parseStoredProgress(null)).toBeNull();
    expect(parseStoredProgress('')).toBeNull();
    expect(parseStoredProgress('{not json')).toBeNull();
    expect(parseStoredProgress('42')).toBeNull();
    expect(parseStoredProgress('{"t":"12"}')).toBeNull();
    expect(parseStoredProgress('{"t":-1}')).toBeNull();
  });
});

describe('mediaErrorMessage', () => {
  it('даёт отдельный текст для каждого кода', () => {
    const messages = [1, 2, 3, 4].map((code) => mediaErrorMessage(code));
    expect(new Set(messages).size).toBe(4);
    expect(mediaErrorMessage(2)).toContain('сет');
  });

  it('имеет текст по умолчанию', () => {
    expect(mediaErrorMessage(null)).toContain('Не удалось');
    expect(mediaErrorMessage(99)).toContain('Не удалось');
  });
});
