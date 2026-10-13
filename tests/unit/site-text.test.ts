import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../shared/defaults';
import { splitSentences } from '../../src/features/site/text';

describe('splitSentences', () => {
  it('делит строку о двух фото на два предложения', () => {
    // В тексте по умолчанию стоят неразрывные пробелы; для сравнения приводим их к обычным.
    const plain = splitSentences(DEFAULT_SETTINGS.photosText).map((part) => part.replaceAll(' ', ' '));
    expect(plain).toEqual(['Нам нужно всего два фото — он и она.', 'Мы превратим их в историю.']);
  });

  it('понимает разные знаки конца предложения и лишние пробелы', () => {
    expect(splitSentences('  Два фото!   И всё?  Да…  Готово')).toEqual([
      'Два фото!',
      'И всё?',
      'Да…',
      'Готово',
    ]);
  });

  it('строку без знаков препинания возвращает целиком, пустую — пустым списком', () => {
    expect(splitSentences('Всего два фото')).toEqual(['Всего два фото']);
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   ')).toEqual([]);
  });
});
