import { describe, expect, it } from 'vitest';

import type { AdminVideo } from '@shared/api';
import { MAX_SVG_BYTES } from '@shared/constants';
import { deleteBlockReason, filmVideoStatus, isDeletableStatus } from '@/features/admin/lib/filmStatus';
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatEta,
  formatPercent,
  formatSpeed,
  plural,
} from '@/features/admin/lib/format';
import { BRAND_RULES, checkImageFile, fitWithin, RASTER_RULES } from '@/features/admin/lib/imageOptimize';

/** Intl ставит между числом и единицей неразрывные пробелы — для сравнения приводим к обычным. */
const plain = (text: string): string => text.replace(/[  ]/g, ' ');

function video(status: AdminVideo['status'], sizeBytes = 100): AdminVideo {
  return {
    id: `v-${status}`,
    filmSlug: 'basic',
    objectKey: 'k',
    url: '/media/k',
    originalFilename: 'f.mp4',
    sizeBytes,
    mimeType: 'video/mp4',
    durationSeconds: 60,
    width: 1920,
    height: 1080,
    status,
    createdAt: '2026-10-12T10:00:00Z',
    publishedAt: null,
  };
}

describe('форматирование', () => {
  it('размеры: Б, КБ, МБ, ГБ', () => {
    expect(plain(formatBytes(0))).toBe('0 Б');
    expect(plain(formatBytes(1536))).toBe('1,5 КБ');
    expect(plain(formatBytes(16 * 1024 ** 2))).toBe('16 МБ');
    expect(plain(formatBytes(2.5 * 1024 ** 3))).toBe('2,5 ГБ');
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });

  it('длительность', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(null)).toBe('—');
  });

  it('оставшееся время словами', () => {
    expect(formatEta(30)).toBe('меньше минуты');
    expect(formatEta(600)).toBe('около 10 мин');
    expect(formatEta(4800)).toBe('около 1 ч 20 мин');
    expect(formatEta(null)).toBe('считаем…');
  });

  it('скорость и проценты', () => {
    expect(plain(formatSpeed(4.2 * 1024 ** 2))).toBe('4,2 МБ/с');
    expect(formatSpeed(0)).toBe('—');
    expect(formatPercent(0.756)).toBe('76%');
    expect(formatPercent(1.2)).toBe('120%');
  });

  it('даты: пустые и непонятные значения не ломают вывод', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('не дата')).toBe('—');
    expect(formatDate('2026-10-12T10:00:00Z')).toMatch(/^\d{2}\.\d{2}\.2026, \d{2}:\d{2}$/);
    expect(formatDate('2026-10-12 10:00:00')).toBe(formatDate('2026-10-12T10:00:00Z'));
  });

  it('склонение числительных', () => {
    const word = (n: number): string => plural(n, 'объект', 'объекта', 'объектов');
    expect([1, 2, 5, 11, 21, 22, 25, 111].map(word)).toEqual([
      'объект',
      'объекта',
      'объектов',
      'объектов',
      'объект',
      'объекта',
      'объектов',
      'объектов',
    ]);
  });
});

describe('статус уровня', () => {
  it('опубликовано, если есть активное видео', () => {
    const active = video('active', 500);
    const status = filmVideoStatus({
      isPublished: true,
      activeVideo: active,
      videos: [video('ready'), active],
    });
    expect(status.state).toBe('published');
    expect(status.video?.sizeBytes).toBe(500);
  });

  it('загружено, но не опубликовано', () => {
    const status = filmVideoStatus({
      isPublished: true,
      activeVideo: null,
      videos: [video('ready', 300), video('archived')],
    });
    expect(status.state).toBe('unpublished');
    expect(status.video?.sizeBytes).toBe(300);
  });

  it('нет видео: архивные версии не считаются', () => {
    expect(filmVideoStatus({ isPublished: true, activeVideo: null, videos: [] }).state).toBe('empty');
    expect(filmVideoStatus({ isPublished: true, activeVideo: null, videos: [video('archived')] }).state).toBe(
      'empty',
    );
  });

  it('скрытый уровень остаётся скрытым даже с активным видео', () => {
    const active = video('active');
    expect(filmVideoStatus({ isPublished: false, activeVideo: active, videos: [active] }).state).toBe(
      'hidden',
    );
  });
});

describe('что можно удалять из хранилища', () => {
  it('только старые версии и неиспользуемые объекты', () => {
    expect(isDeletableStatus('archived')).toBe(true);
    expect(isDeletableStatus('orphan')).toBe(true);
    expect(isDeletableStatus('active')).toBe(false);
    expect(isDeletableStatus('ready')).toBe(false);
    expect(isDeletableStatus('uploading')).toBe(false);
  });

  it('для защищённых объектов есть объяснение', () => {
    expect(deleteBlockReason('active')).toContain('удалить нельзя');
    expect(deleteBlockReason('ready')).not.toBeNull();
    expect(deleteBlockReason('uploading')).not.toBeNull();
    expect(deleteBlockReason('archived')).toBeNull();
    expect(deleteBlockReason('orphan')).toBeNull();
  });
});

describe('изображения', () => {
  it('вписывает в длинную сторону и не увеличивает', () => {
    expect(fitWithin(5120, 2880, 2560)).toEqual({ width: 2560, height: 1440 });
    expect(fitWithin(3000, 6000, 1920)).toEqual({ width: 960, height: 1920 });
    expect(fitWithin(1200, 800, 2560)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(10_000, 1, 100)).toEqual({ width: 100, height: 1 });
  });

  it('проверяет формат', () => {
    expect(checkImageFile({ type: 'image/jpeg', size: 1000 }, RASTER_RULES)).toBeNull();
    expect(checkImageFile({ type: 'image/avif', size: 1000 }, RASTER_RULES)).toBeNull();
    expect(checkImageFile({ type: 'image/gif', size: 1000 }, RASTER_RULES)).toContain('JPG, PNG, WebP, AVIF');
    expect(checkImageFile({ type: 'image/svg+xml', size: 1000 }, RASTER_RULES)).not.toBeNull();
  });

  it('SVG — только для логотипа и favicon и в пределах лимита', () => {
    expect(checkImageFile({ type: 'image/svg+xml', size: 1000 }, BRAND_RULES)).toBeNull();
    expect(checkImageFile({ type: 'image/svg+xml', size: MAX_SVG_BYTES + 1 }, BRAND_RULES)).not.toBeNull();
    expect(checkImageFile({ type: 'image/jpeg', size: 1000 }, BRAND_RULES)).not.toBeNull();
  });
});
