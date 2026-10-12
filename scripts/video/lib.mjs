// Чистые функции подготовки видео: разбор боксов MP4, разбор вывода ffprobe, выбор плана,
// сборка аргументов ffmpeg, оценка размера. Без обращения к диску и процессам — покрыто
// тестом tests/unit/scripts-video.test.ts.

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** Проектный максимум одного видео. Совпадает с MAX_VIDEO_BYTES в shared/constants.ts. */
export const SITE_MAX_VIDEO_BYTES = 5 * GIB;
export const AUDIO_BITRATE_KBPS = 192;
export const DEFAULT_CRF = 18;
export const DEFAULT_PRESET = 'slow';
export const X264_PRESETS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
];
/** Допустимое расхождение длительности исходника и результата, секунды. */
export const DURATION_TOLERANCE_SECONDS = 0.5;

const MAX_BOXES = 4096;
const WEB_PIX_FMTS = ['yuv420p', 'yuvj420p'];
const MP4_EXTENSIONS = ['.mp4', '.m4v'];

// ---------------------------------------------------------------------------
// Боксы MP4
// ---------------------------------------------------------------------------

/**
 * Разбирает заголовок одного бокса из первых байтов (нужно 8, для 64-битного размера — 16).
 * size === 0 в файле означает «до конца файла» — здесь это возвращается как size: null.
 */
export function parseBoxHeader(bytes) {
  if (!bytes || bytes.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size32 = view.getUint32(0);
  let type = '';
  for (let i = 4; i < 8; i += 1) type += String.fromCharCode(bytes[i]);
  if (!/^[\x20-\x7e\xa9]{4}$/.test(type)) return null;
  if (size32 === 1) {
    if (bytes.length < 16) return null;
    const size = Number(view.getBigUint64(8));
    if (!Number.isSafeInteger(size) || size < 16) return null;
    return { type, size, headerSize: 16 };
  }
  if (size32 === 0) return { type, size: null, headerSize: 8 };
  if (size32 < 8) return null;
  return { type, size: size32, headerSize: 8 };
}

/**
 * Проходит по боксам верхнего уровня, читая только их заголовки.
 * read(offset, length) возвращает байты файла (может вернуть меньше у конца файла).
 * После того как найдены и moov, и mdat, чтение прекращается.
 */
export function scanTopLevelBoxes(read, fileSize) {
  const boxes = [];
  let offset = 0;
  let seenMoov = false;
  let seenMdat = false;
  while (offset + 8 <= fileSize && boxes.length < MAX_BOXES) {
    const header = parseBoxHeader(read(offset, Math.min(16, fileSize - offset)));
    if (!header) break;
    const size = header.size === null ? fileSize - offset : header.size;
    boxes.push({ type: header.type, offset, size });
    if (header.type === 'moov') seenMoov = true;
    if (header.type === 'mdat') seenMdat = true;
    if (seenMoov && seenMdat) break;
    if (header.size === null) break;
    offset += size;
  }
  return boxes;
}

/** faststart: индекс (moov) лежит раньше данных (mdat), плеер начинает показ без докачки файла. */
export function detectFaststart(boxes) {
  const first = boxes[0];
  const moov = boxes.find((box) => box.type === 'moov');
  const mdat = boxes.find((box) => box.type === 'mdat');
  const fragmented = boxes.some((box) => box.type === 'moof');
  return {
    isIsoBmff: Boolean(first && first.type === 'ftyp'),
    hasMoov: Boolean(moov),
    hasMdat: Boolean(mdat),
    fragmented,
    faststart: Boolean(moov && mdat && moov.offset < mdat.offset),
  };
}

// ---------------------------------------------------------------------------
// Разбор ffprobe
// ---------------------------------------------------------------------------

function toNumber(value) {
  if (value === undefined || value === null || value === '' || value === 'N/A') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** "30000/1001" → 29.97 */
export function parseRate(value) {
  if (typeof value !== 'string') return null;
  const [numerator, denominator] = value.split('/').map(Number);
  if (!Number.isFinite(numerator) || numerator <= 0) return null;
  if (denominator === undefined) return numerator;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function extensionOf(filePath) {
  const name = String(filePath ?? '')
    .split(/[\\/]/)
    .pop();
  const dot = name ? name.lastIndexOf('.') : -1;
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

function bitDepthOf(stream) {
  const raw = toNumber(stream.bits_per_raw_sample);
  if (raw) return raw;
  const match = /p(\d{2})(le|be)?$/.exec(stream.pix_fmt ?? '');
  if (match) return Number(match[1]);
  return 8;
}

/**
 * Сводит JSON ffprobe (-show_format -show_streams) и результат detectFaststart в плоское описание.
 * meta: { path, faststart, isIsoBmff }.
 */
export function analyzeProbe(probe, meta = {}) {
  const format = probe?.format ?? {};
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const videoStream = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  const formatNames = String(format.format_name ?? '')
    .split(',')
    .filter(Boolean);
  const majorBrand = String(format.tags?.major_brand ?? '').trim();
  const extension = extensionOf(meta.path ?? format.filename);
  const isMp4 =
    formatNames.includes('mp4') &&
    majorBrand !== 'qt' &&
    MP4_EXTENSIONS.includes(extension) &&
    meta.isIsoBmff !== false;

  const durationSeconds =
    toNumber(format.duration) ?? toNumber(videoStream?.duration) ?? toNumber(audioStream?.duration);
  const sizeBytes = toNumber(format.size);
  const totalBitrate =
    toNumber(format.bit_rate) ??
    (sizeBytes && durationSeconds ? Math.round((sizeBytes * 8) / durationSeconds) : null);
  const audioBitrate = audioStream ? toNumber(audioStream.bit_rate) : null;

  let video = null;
  if (videoStream) {
    const streamBitrate = toNumber(videoStream.bit_rate);
    video = {
      codec: videoStream.codec_name ?? 'unknown',
      profile: videoStream.profile ?? null,
      pixFmt: videoStream.pix_fmt ?? null,
      bitDepth: bitDepthOf(videoStream),
      width: toNumber(videoStream.width),
      height: toNumber(videoStream.height),
      fps: parseRate(videoStream.avg_frame_rate) ?? parseRate(videoStream.r_frame_rate),
      bitrate: streamBitrate ?? (totalBitrate ? Math.max(totalBitrate - (audioBitrate ?? 0), 0) : null),
      bitrateIsEstimate: streamBitrate === null,
    };
  }

  const audio = audioStream
    ? {
        codec: audioStream.codec_name ?? 'unknown',
        profile: audioStream.profile ?? null,
        channels: toNumber(audioStream.channels),
        sampleRate: toNumber(audioStream.sample_rate),
        bitrate: audioBitrate,
      }
    : null;

  return {
    container: {
      formatName: formatNames.join(','),
      majorBrand: majorBrand || null,
      extension,
      isMp4,
      faststart: meta.faststart === true,
    },
    video,
    audio,
    durationSeconds,
    sizeBytes,
    bitrate: totalBitrate,
  };
}

// ---------------------------------------------------------------------------
// План
// ---------------------------------------------------------------------------

function roundEven(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function videoProblems(video) {
  const problems = [];
  if (video.codec !== 'h264') problems.push(`видеокодек ${video.codec}, нужен H.264`);
  if (video.bitDepth > 8) problems.push(`глубина цвета ${video.bitDepth} бит, нужно 8`);
  if (!WEB_PIX_FMTS.includes(video.pixFmt ?? '')) {
    problems.push(`формат пикселей ${video.pixFmt ?? 'неизвестен'}, нужен yuv420p`);
  }
  return problems;
}

/**
 * Выбирает минимально необходимое действие.
 * action: 'none' | 'remux' | 'audio' | 'transcode' | 'unsupported'.
 */
export function planAction(info, options = {}) {
  const crf = options.crf ?? DEFAULT_CRF;
  const preset = options.preset ?? DEFAULT_PRESET;
  const maxHeight = options.maxHeight ?? null;

  if (!info.video) {
    return {
      action: 'unsupported',
      reasons: ['в файле нет видеодорожки'],
      video: null,
      audio: null,
      lossless: false,
    };
  }

  const reasons = [];
  const problems = videoProblems(info.video);
  const { width, height } = info.video;
  const needsDownscale = Boolean(maxHeight && height && height > maxHeight);
  if (needsDownscale) problems.push(`высота ${height} больше заданной --max-height ${maxHeight}`);

  const audioOk = !info.audio || info.audio.codec === 'aac';
  const audio = !info.audio
    ? { mode: 'none' }
    : audioOk
      ? { mode: 'copy' }
      : { mode: 'aac', bitrateKbps: AUDIO_BITRATE_KBPS };

  if (problems.length > 0) {
    let scale = null;
    if (needsDownscale && width && height) {
      scale = { width: roundEven((width * maxHeight) / height), height: roundEven(maxHeight) };
    } else if (width && height && (width % 2 !== 0 || height % 2 !== 0)) {
      scale = { width: roundEven(width), height: roundEven(height) };
    }
    reasons.push(...problems);
    if (!audioOk) reasons.push(`аудиокодек ${info.audio.codec}, нужен AAC`);
    return {
      action: 'transcode',
      reasons,
      video: { mode: 'encode', crf, preset, scale },
      audio,
      lossless: false,
    };
  }

  if (!audioOk) {
    reasons.push(`аудиокодек ${info.audio.codec}, нужен AAC`);
    return { action: 'audio', reasons, video: { mode: 'copy' }, audio, lossless: false };
  }

  if (!info.container.isMp4) reasons.push('контейнер не MP4');
  else if (!info.container.faststart) reasons.push('нет faststart: индекс файла (moov) лежит после данных');
  if (reasons.length > 0) {
    return { action: 'remux', reasons, video: { mode: 'copy' }, audio, lossless: true };
  }

  return { action: 'none', reasons: [], video: { mode: 'copy' }, audio, lossless: true };
}

/** Аргументы ffmpeg для плана. Пути передаются отдельными элементами массива — без оболочки. */
export function buildFfmpegArgs(plan, inputPath, outputPath) {
  if (plan.action === 'none' || plan.action === 'unsupported') {
    throw new Error(`Для действия "${plan.action}" ffmpeg не запускается`);
  }
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', inputPath];
  args.push('-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-map_chapters', '-1');

  if (plan.video.mode === 'copy') {
    args.push('-c:v', 'copy');
  } else {
    if (plan.video.scale) {
      args.push('-vf', `scale=${plan.video.scale.width}:${plan.video.scale.height}`);
    }
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      plan.video.preset,
      '-crf',
      String(plan.video.crf),
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'high',
    );
  }

  if (plan.audio.mode === 'copy') args.push('-c:a', 'copy');
  else if (plan.audio.mode === 'aac') args.push('-c:a', 'aac', '-b:a', `${plan.audio.bitrateKbps}k`);

  args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', '-f', 'mp4', outputPath);
  return args;
}

// ---------------------------------------------------------------------------
// Оценка размера
// ---------------------------------------------------------------------------

// Насколько битрейт H.264 (CRF 18) обычно отличается от исходного кодека. Очень грубо.
const TRANSCODE_BITRATE_FACTOR = {
  hevc: 1.8,
  vp9: 1.7,
  av1: 2.2,
  h264: 1,
  mpeg4: 0.9,
  mpeg2video: 0.6,
  prores: 0.15,
  dnxhd: 0.15,
};

/**
 * Оценка размера результата в байтах.
 * exact: true — копирование потоков, размер почти равен исходному.
 * exact: false — перекодирование, реальный размер зависит от содержимого.
 */
export function estimateOutputSize(info, plan) {
  const { sizeBytes, durationSeconds } = info;
  if (plan.action === 'none' || plan.action === 'remux') {
    return { bytes: sizeBytes, exact: true };
  }
  if (!sizeBytes || !durationSeconds) return { bytes: sizeBytes, exact: false };

  const newAudioBytes =
    plan.audio.mode === 'aac' ? (plan.audio.bitrateKbps * 1000 * durationSeconds) / 8 : null;

  if (plan.action === 'audio') {
    const oldAudioBytes = info.audio?.bitrate ? (info.audio.bitrate * durationSeconds) / 8 : newAudioBytes;
    return { bytes: Math.max(Math.round(sizeBytes - oldAudioBytes + newAudioBytes), 0), exact: true };
  }

  const video = info.video;
  const sourceVideoBytes = video?.bitrate ? (video.bitrate * durationSeconds) / 8 : sizeBytes;
  let factor = TRANSCODE_BITRATE_FACTOR[video?.codec] ?? 1;
  const scale = plan.video.scale;
  if (scale && video?.width && video?.height) {
    factor *= Math.pow((scale.width * scale.height) / (video.width * video.height), 0.75);
  }
  const audioBytes = newAudioBytes ?? (info.audio?.bitrate ? (info.audio.bitrate * durationSeconds) / 8 : 0);
  return { bytes: Math.round(sourceVideoBytes * factor + audioBytes), exact: false };
}

/** Сколько свободного места требуем перед запуском: оценка + запас. */
export function requiredFreeBytes(estimate) {
  if (!estimate.bytes) return 0;
  const margin = estimate.exact ? 1.05 : 1.5;
  return Math.round(estimate.bytes * margin + 64 * MIB);
}

// ---------------------------------------------------------------------------
// Прогресс и форматирование
// ---------------------------------------------------------------------------

/** Разбирает порцию вывода `-progress pipe:1` (строки key=value). */
export function parseProgressBlock(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'out_time_us' || key === 'out_time_ms') {
      // Оба поля у ffmpeg — в микросекундах.
      const micro = Number(value);
      if (Number.isFinite(micro) && micro >= 0) result.outTimeSeconds = micro / 1e6;
    } else if (key === 'speed') {
      const speed = Number.parseFloat(value);
      if (Number.isFinite(speed) && speed > 0) result.speed = speed;
    } else if (key === 'total_size') {
      const size = Number(value);
      if (Number.isFinite(size)) result.totalSize = size;
    } else if (key === 'progress') {
      result.ended = value === 'end';
    }
  }
  return result;
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return 'неизвестно';
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} ГБ`;
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${bytes} Б`;
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'неизвестно';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatBitrate(bitsPerSecond) {
  if (!bitsPerSecond) return 'неизвестно';
  if (bitsPerSecond >= 1e6) return `${(bitsPerSecond / 1e6).toFixed(1)} Мбит/с`;
  return `${Math.round(bitsPerSecond / 1000)} кбит/с`;
}

/** "300MB", "1.5GB", "512k", "1048576" → байты (приставки двоичные: 1 MB = 1024 × 1024). */
export function parseSize(text) {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*([kmg]?)(?:i?b)?\s*$/i.exec(String(text ?? ''));
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'g' ? GIB : unit === 'm' ? MIB : unit === 'k' ? 1024 : 1;
  const bytes = Math.round(value * multiplier);
  return bytes > 0 ? bytes : null;
}
