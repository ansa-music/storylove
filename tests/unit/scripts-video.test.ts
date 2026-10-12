import { describe, expect, it } from 'vitest';
import {
  analyzeProbe,
  buildFfmpegArgs,
  detectFaststart,
  estimateOutputSize,
  parseBoxHeader,
  parseProgressBlock,
  parseSize,
  planAction,
  requiredFreeBytes,
  scanTopLevelBoxes,
} from '../../scripts/video/lib.mjs';

// --- синтетические боксы MP4 ------------------------------------------------

function box(type: string, payloadLength: number): Uint8Array {
  const bytes = new Uint8Array(8 + payloadLength);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  for (let i = 0; i < 4; i += 1) bytes[4 + i] = type.charCodeAt(i);
  return bytes;
}

/** Бокс с 64-битным размером; настоящих данных в буфере может не быть (declaredSize больше буфера). */
function largeBoxHeader(type: string, declaredSize: number): Uint8Array {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1);
  for (let i = 0; i < 4; i += 1) bytes[4 + i] = type.charCodeAt(i);
  view.setBigUint64(8, BigInt(declaredSize));
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function scan(file: Uint8Array, fileSize = file.length) {
  const reads: number[] = [];
  const boxes = scanTopLevelBoxes((offset, length) => {
    reads.push(length);
    return file.subarray(offset, offset + length);
  }, fileSize);
  return { boxes, reads };
}

describe('разбор боксов MP4', () => {
  it('читает обычный 32-битный заголовок', () => {
    expect(parseBoxHeader(box('ftyp', 16))).toEqual({ type: 'ftyp', size: 24, headerSize: 8 });
  });

  it('читает 64-битный размер', () => {
    const header = parseBoxHeader(largeBoxHeader('mdat', 6 * 1024 ** 3));
    expect(header).toEqual({ type: 'mdat', size: 6 * 1024 ** 3, headerSize: 16 });
  });

  it('размер 0 означает «до конца файла»', () => {
    const bytes = box('mdat', 0);
    new DataView(bytes.buffer).setUint32(0, 0);
    expect(parseBoxHeader(bytes)).toEqual({ type: 'mdat', size: null, headerSize: 8 });
  });

  it('отвергает мусор и слишком короткие данные', () => {
    expect(parseBoxHeader(new Uint8Array(4))).toBeNull();
    expect(parseBoxHeader(new Uint8Array(16))).toBeNull();
    const tooSmall = box('free', 0);
    new DataView(tooSmall.buffer).setUint32(0, 4);
    expect(parseBoxHeader(tooSmall)).toBeNull();
  });

  it('moov перед mdat — faststart есть', () => {
    const file = concat(box('ftyp', 16), box('moov', 100), box('free', 8), box('mdat', 500));
    const { boxes } = scan(file);
    expect(boxes.map((b) => b.type)).toEqual(['ftyp', 'moov', 'free', 'mdat']);
    expect(detectFaststart(boxes)).toMatchObject({ isIsoBmff: true, faststart: true });
  });

  it('mdat перед moov — faststart нет', () => {
    const file = concat(box('ftyp', 16), box('free', 0), box('mdat', 500), box('moov', 100));
    const { boxes } = scan(file);
    expect(boxes.map((b) => [b.type, b.offset])).toEqual([
      ['ftyp', 0],
      ['free', 24],
      ['mdat', 32],
      ['moov', 540],
    ]);
    expect(detectFaststart(boxes)).toMatchObject({ isIsoBmff: true, hasMoov: true, faststart: false });
  });

  it('перепрыгивает mdat с 64-битным размером, не читая его содержимое', () => {
    // «Файл» на 3 ГиБ: в буфере есть только заголовки; чтения за пределами не должно быть.
    const mdatSize = 3 * 1024 ** 3;
    const head = concat(box('ftyp', 16), largeBoxHeader('mdat', mdatSize));
    const moov = box('moov', 64);
    const fileSize = 24 + mdatSize + moov.length;
    const reads: number[] = [];
    const boxes = scanTopLevelBoxes((offset, length) => {
      reads.push(length);
      if (offset < head.length) return head.subarray(offset, offset + length);
      if (offset === 24 + mdatSize) return moov.subarray(0, length);
      throw new Error(`неожиданное чтение по смещению ${offset}`);
    }, fileSize);
    expect(boxes).toEqual([
      { type: 'ftyp', offset: 0, size: 24 },
      { type: 'mdat', offset: 24, size: mdatSize },
      { type: 'moov', offset: 24 + mdatSize, size: 72 },
    ]);
    expect(reads.every((length) => length <= 16)).toBe(true);
    expect(detectFaststart(boxes).faststart).toBe(false);
  });

  it('останавливается, как только найдены moov и mdat', () => {
    const file = concat(box('ftyp', 16), box('moov', 10), box('mdat', 10), box('free', 10), box('free', 10));
    expect(scan(file).boxes).toHaveLength(3);
  });

  it('не MP4: пустой список боксов и faststart нет', () => {
    const matroska = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0xf7, 0x81]);
    const { boxes } = scan(matroska);
    expect(boxes).toEqual([]);
    expect(detectFaststart(boxes)).toMatchObject({ isIsoBmff: false, faststart: false });
  });

  it('обрезанный файл без moov', () => {
    const file = concat(box('ftyp', 16), box('mdat', 500)).subarray(0, 200);
    const { boxes } = scan(file);
    expect(detectFaststart(boxes)).toMatchObject({ hasMoov: false, hasMdat: true, faststart: false });
  });
});

// --- варианты ffprobe -------------------------------------------------------

const MP4_FORMAT = 'mov,mp4,m4a,3gp,3g2,mj2';

interface ProbeOverrides {
  formatName?: string;
  majorBrand?: string;
  video?: Record<string, unknown> | null;
  audio?: Record<string, unknown> | null;
  extra?: Record<string, unknown>[];
  size?: string;
  duration?: string;
}

function probe(overrides: ProbeOverrides = {}) {
  const streams: Record<string, unknown>[] = [];
  if (overrides.video !== null) {
    streams.push({
      index: 0,
      codec_type: 'video',
      codec_name: 'h264',
      profile: 'High',
      pix_fmt: 'yuv420p',
      bits_per_raw_sample: '8',
      width: 1920,
      height: 1080,
      avg_frame_rate: '25/1',
      r_frame_rate: '25/1',
      bit_rate: '8000000',
      disposition: { attached_pic: 0 },
      ...overrides.video,
    });
  }
  if (overrides.audio !== null) {
    streams.push({
      index: 1,
      codec_type: 'audio',
      codec_name: 'aac',
      profile: 'LC',
      channels: 2,
      sample_rate: '48000',
      bit_rate: '192000',
      ...overrides.audio,
    });
  }
  streams.push(...(overrides.extra ?? []));
  return {
    streams,
    format: {
      format_name: overrides.formatName ?? MP4_FORMAT,
      duration: overrides.duration ?? '600.000000',
      size: overrides.size ?? '614400000',
      bit_rate: '8192000',
      tags: { major_brand: overrides.majorBrand ?? 'isom' },
    },
  };
}

function plan(
  overrides: ProbeOverrides,
  meta: { path: string; faststart?: boolean; isIsoBmff?: boolean },
  options = {},
) {
  const info = analyzeProbe(probe(overrides), { faststart: true, isIsoBmff: true, ...meta });
  return { info, plan: planAction(info, options) };
}

describe('analyzeProbe', () => {
  it('собирает сведения о файле', () => {
    const info = analyzeProbe(probe({ video: { avg_frame_rate: '30000/1001' } }), {
      path: 'C:\\Видео\\Свадьба Анны.mp4',
      faststart: true,
      isIsoBmff: true,
    });
    expect(info.container).toMatchObject({ isMp4: true, faststart: true, extension: '.mp4' });
    expect(info.video).toMatchObject({
      codec: 'h264',
      pixFmt: 'yuv420p',
      bitDepth: 8,
      width: 1920,
      height: 1080,
    });
    expect(info.video?.fps).toBeCloseTo(29.97, 2);
    expect(info.audio).toMatchObject({ codec: 'aac', channels: 2, sampleRate: 48000 });
    expect(info.durationSeconds).toBe(600);
    expect(info.sizeBytes).toBe(614400000);
  });

  it('обложка (attached_pic) не считается видеодорожкой', () => {
    const cover = { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } };
    const info = analyzeProbe({ streams: [cover], format: { format_name: 'mp3' } }, { path: 'a.mp3' });
    expect(info.video).toBeNull();
    expect(planAction(info).action).toBe('unsupported');
  });

  it('глубина цвета берётся из pix_fmt, если ffprobe её не сообщил', () => {
    const info = analyzeProbe(probe({ video: { pix_fmt: 'yuv420p10le', bits_per_raw_sample: undefined } }), {
      path: 'a.mp4',
    });
    expect(info.video?.bitDepth).toBe(10);
  });
});

describe('planAction', () => {
  it('a) MP4 + H.264 + AAC + faststart — ничего делать не нужно', () => {
    const result = plan({}, { path: 'film.mp4' });
    expect(result.plan).toMatchObject({ action: 'none', reasons: [] });
  });

  it('a) готовый файл без звука — тоже ничего', () => {
    expect(plan({ audio: null }, { path: 'film.m4v' }).plan.action).toBe('none');
  });

  it('b) нет faststart — перепаковка без перекодирования', () => {
    const result = plan({}, { path: 'film.mp4', faststart: false });
    expect(result.plan).toMatchObject({ action: 'remux', lossless: true });
    const args = buildFfmpegArgs(result.plan, 'C:\\Мои видео\\film.mp4', 'C:\\Мои видео\\film.partial.mp4');
    expect(args.join(' ')).toContain('-c:v copy -c:a copy -movflags +faststart');
    expect(args).not.toContain('libx264');
    // Путь с пробелом и кириллицей — один элемент массива, без кавычек и склейки.
    expect(args[args.indexOf('-i') + 1]).toBe('C:\\Мои видео\\film.mp4');
    expect(args.at(-1)).toBe('C:\\Мои видео\\film.partial.mp4');
  });

  it('b) H.264 + AAC в MKV — перепаковка', () => {
    const result = plan(
      { formatName: 'matroska,webm' },
      { path: 'film.mkv', faststart: false, isIsoBmff: false },
    );
    expect(result.plan.action).toBe('remux');
    expect(result.plan.reasons).toEqual(['контейнер не MP4']);
  });

  it('b) QuickTime .mov с подходящими кодеками — перепаковка', () => {
    const result = plan({ majorBrand: 'qt  ' }, { path: 'film.mov' });
    expect(result.info.container.isMp4).toBe(false);
    expect(result.plan.action).toBe('remux');
  });

  it('c) видео подходит, звук AC-3 — видео копируется, звук в AAC 192k', () => {
    const result = plan({ audio: { codec_name: 'ac3' } }, { path: 'film.mp4' });
    expect(result.plan.action).toBe('audio');
    const args = buildFfmpegArgs(result.plan, 'in.mp4', 'out.mp4').join(' ');
    expect(args).toContain('-c:v copy -c:a aac -b:a 192k -movflags +faststart');
  });

  it.each([
    ['HEVC', { codec_name: 'hevc', profile: 'Main' }],
    ['VP9', { codec_name: 'vp9', profile: 'Profile 0' }],
    ['AV1', { codec_name: 'av1', profile: 'Main' }],
    ['ProRes', { codec_name: 'prores', pix_fmt: 'yuv422p10le', bits_per_raw_sample: '10' }],
    ['H.264 10 бит', { profile: 'High 10', pix_fmt: 'yuv420p10le', bits_per_raw_sample: '10' }],
    ['H.264 4:2:2', { profile: 'High 4:2:2', pix_fmt: 'yuv422p' }],
    ['H.264 4:4:4', { profile: 'High 4:4:4 Predictive', pix_fmt: 'yuv444p' }],
  ])('d) %s — перекодирование в H.264', (_name, video) => {
    const result = plan({ video }, { path: 'film.mp4' });
    expect(result.plan).toMatchObject({ action: 'transcode', lossless: false });
    expect(result.plan.reasons.length).toBeGreaterThan(0);
    const args = buildFfmpegArgs(result.plan, 'in.mp4', 'out.mp4').join(' ');
    expect(args).toContain('-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -profile:v high');
    expect(args).toContain('-c:a copy');
    expect(args).toContain('-movflags +faststart');
    // Разрешение и частота кадров не трогаются.
    expect(args).not.toContain('-vf');
    expect(args).not.toContain(' -r ');
  });

  it('d) HEVC + Opus — перекодируются и видео, и звук', () => {
    const result = plan(
      { formatName: 'matroska,webm', video: { codec_name: 'hevc' }, audio: { codec_name: 'opus' } },
      { path: 'film.mkv', faststart: false, isIsoBmff: false },
    );
    expect(result.plan.action).toBe('transcode');
    expect(buildFfmpegArgs(result.plan, 'in.mkv', 'out.mp4').join(' ')).toContain('-c:a aac -b:a 192k');
  });

  it('d) видео без звука — звуковых параметров нет', () => {
    const result = plan(
      { video: { codec_name: 'vp9' }, audio: null },
      { path: 'film.webm', isIsoBmff: false },
    );
    expect(buildFfmpegArgs(result.plan, 'in.webm', 'out.mp4')).not.toContain('-c:a');
  });

  it('--crf и --preset попадают в аргументы', () => {
    const result = plan(
      { video: { codec_name: 'hevc' } },
      { path: 'film.mp4' },
      { crf: 21, preset: 'medium' },
    );
    expect(buildFfmpegArgs(result.plan, 'a', 'b').join(' ')).toContain('-preset medium -crf 21');
  });

  it('--max-height уменьшает кадр с чётными размерами', () => {
    const result = plan(
      { video: { codec_name: 'hevc', width: 3840, height: 2160 } },
      { path: 'film.mp4' },
      { maxHeight: 1080 },
    );
    expect(result.plan.video).toMatchObject({ mode: 'encode', scale: { width: 1920, height: 1080 } });
    expect(buildFfmpegArgs(result.plan, 'a', 'b')).toContain('scale=1920:1080');
  });

  it('--max-height: нечётная ширина округляется до чётной', () => {
    const result = plan({ video: { width: 1998, height: 1080 } }, { path: 'film.mp4' }, { maxHeight: 721 });
    expect(result.plan.video).toMatchObject({ scale: { width: 1334, height: 722 } });
  });

  it('--max-height не увеличивает кадр и не вызывает перекодирования готового файла', () => {
    const result = plan({ video: { width: 1280, height: 720 } }, { path: 'film.mp4' }, { maxHeight: 1080 });
    expect(result.plan.action).toBe('none');
  });

  it('--max-height ниже высоты готового H.264 — перекодирование', () => {
    const result = plan({}, { path: 'film.mp4' }, { maxHeight: 720 });
    expect(result.plan.action).toBe('transcode');
    expect(result.plan.video).toMatchObject({ scale: { width: 1280, height: 720 } });
  });

  it('нечётные размеры исходника при перекодировании выравниваются', () => {
    const result = plan({ video: { codec_name: 'vp9', width: 853, height: 480 } }, { path: 'film.mp4' });
    expect(result.plan.video).toMatchObject({ scale: { width: 854, height: 480 } });
  });

  it('для готового файла аргументы ffmpeg не строятся', () => {
    const result = plan({}, { path: 'film.mp4' });
    expect(() => buildFfmpegArgs(result.plan, 'a', 'b')).toThrow();
  });
});

describe('оценка размера', () => {
  it('перепаковка — размер исходника, оценка точная', () => {
    const result = plan({}, { path: 'film.mp4', faststart: false });
    expect(estimateOutputSize(result.info, result.plan)).toEqual({ bytes: 614400000, exact: true });
  });

  it('замена звука — меняется только звуковая часть', () => {
    const result = plan({ audio: { codec_name: 'ac3', bit_rate: '640000' } }, { path: 'film.mp4' });
    const estimate = estimateOutputSize(result.info, result.plan);
    expect(estimate.exact).toBe(true);
    expect(estimate.bytes).toBe(614400000 - (640000 * 600) / 8 + (192000 * 600) / 8);
  });

  it('перекодирование — оценка помечена как неточная, запас места больше', () => {
    const result = plan({ video: { codec_name: 'hevc' } }, { path: 'film.mp4' });
    const estimate = estimateOutputSize(result.info, result.plan);
    expect(estimate.exact).toBe(false);
    expect(estimate.bytes).toBeGreaterThan(614400000);
    expect(requiredFreeBytes(estimate)).toBeGreaterThan((estimate.bytes ?? 0) * 1.4);
  });
});

describe('вспомогательные функции', () => {
  it('разбирает блок прогресса ffmpeg', () => {
    const block =
      'frame=250\nfps=120.5\nout_time_us=10000000\ntotal_size=1048576\nspeed=4.02x\nprogress=continue\n';
    expect(parseProgressBlock(block)).toEqual({
      outTimeSeconds: 10,
      totalSize: 1048576,
      speed: 4.02,
      ended: false,
    });
    expect(parseProgressBlock('out_time_us=N/A\nspeed=N/A\nprogress=end\n')).toEqual({ ended: true });
  });

  it('разбирает размер', () => {
    expect(parseSize('40MB')).toBe(40 * 1024 * 1024);
    expect(parseSize('2.5gb')).toBe(2.5 * 1024 ** 3);
    expect(parseSize('512k')).toBe(512 * 1024);
    expect(parseSize('1000')).toBe(1000);
    expect(parseSize('много')).toBeNull();
    expect(parseSize('0MB')).toBeNull();
  });
});
