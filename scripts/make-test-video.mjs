#!/usr/bin/env node
// Генерация тестового MP4 заданного размера (H.264 + AAC, faststart) для проверки загрузки
// больших файлов. Картинка — тестовая таблица с шумом, звук — тон 440 Гц.
// Запуск: node scripts/make-test-video.mjs --size 300MB --out tmp/test-300mb.mp4

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  AbortError,
  UserError,
  ensureTools,
  freeSpaceBytes,
  probeFile,
  readFaststart,
  removeIfExists,
  runFfmpeg,
} from './video/ffmpeg.mjs';
import {
  analyzeProbe,
  formatBitrate,
  formatBytes,
  formatDuration,
  parseSize,
  planAction,
} from './video/lib.mjs';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const MIN_SIZE_BYTES = MIB;
const MAX_SIZE_WITHOUT_FORCE = 6 * GIB;
const TOLERANCE = 0.1;
const AUDIO_BITRATE = 128_000;
const BASE_BITRATE = 8_000_000;
const MAX_BITRATE = 40_000_000;
const MIN_DURATION_SECONDS = 5;
const LONG_DURATION_SECONDS = 300;
// Доля размера, уходящая на служебные данные контейнера.
const CONTAINER_OVERHEAD = 0.005;

const HELP = `Создаёт тестовый MP4 заданного размера для проверки загрузки.

Запуск:
  node scripts/make-test-video.mjs --size <размер> [--out <файл>] [--force]

Флаги:
  --size <размер>   нужный размер: 40MB, 300MB, 2.5GB (1 MB = 1024 × 1024 байт); допуск ±10%
  --out <файл>      куда записать (по умолчанию tmp/test-<размер>.mp4)
  --force           перезаписать существующий файл; разрешить размер больше 6 ГБ
  --help            эта справка
`;

function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        size: { type: 'string' },
        out: { type: 'string' },
        force: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    throw new UserError(`${error.message}\nСправка: node scripts/make-test-video.mjs --help`);
  }
  const { values } = parsed;
  if (values.help) return { help: true };
  if (!values.size) throw new UserError('Не указан размер: --size 300MB');
  const sizeBytes = parseSize(values.size);
  if (!sizeBytes)
    throw new UserError(`Не удалось разобрать размер "${values.size}". Примеры: 40MB, 300MB, 2.5GB.`);
  if (sizeBytes < MIN_SIZE_BYTES) throw new UserError('Минимальный размер — 1MB.');
  const label = String(values.size)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');
  const output = path.resolve(values.out ?? path.join('tmp', `test-${label}.mp4`));
  if (path.extname(output).toLowerCase() !== '.mp4') {
    throw new UserError(`Выходной файл должен иметь расширение .mp4 (указано: ${output}).`);
  }
  return { help: false, sizeBytes, output, force: values.force };
}

/** Подбирает длительность и битрейт: небольшие файлы — 8 Мбит/с 720p, большие — до 40 Мбит/с 1080p. */
function chooseEncoding(sizeBytes) {
  const totalBits = sizeBytes * 8;
  let bitrate = BASE_BITRATE;
  let duration = totalBits / bitrate;
  if (duration < MIN_DURATION_SECONDS) {
    duration = MIN_DURATION_SECONDS;
    bitrate = totalBits / duration;
  } else if (duration > LONG_DURATION_SECONDS) {
    bitrate = Math.min(MAX_BITRATE, totalBits / LONG_DURATION_SECONDS);
    duration = totalBits / bitrate;
  }
  const frame = bitrate > BASE_BITRATE ? '1920x1080' : '1280x720';
  return { bitrate, duration, frame };
}

function buildArgs({ bitrate, duration, frame }, outputPath) {
  const videoBitrate = Math.max(Math.round(bitrate * (1 - CONTAINER_OVERHEAD) - AUDIO_BITRATE), 100_000);
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${frame}:rate=30,noise=alls=40:allf=t`,
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    duration.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    String(videoBitrate),
    '-minrate',
    String(videoBitrate),
    '-maxrate',
    String(videoBitrate),
    '-bufsize',
    String(videoBitrate * 2),
    '-x264-params',
    'nal-hrd=cbr',
    '-c:a',
    'aac',
    '-b:a',
    String(AUDIO_BITRATE),
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    '-f',
    'mp4',
    outputPath,
  ];
}

function withinTolerance(actual, target) {
  return Math.abs(actual - target) <= target * TOLERANCE;
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  const { sizeBytes, output, force } = options;

  if (sizeBytes > MAX_SIZE_WITHOUT_FORCE && !force) {
    throw new UserError(
      `Запрошено ${formatBytes(sizeBytes)} — это больше 6 ГБ. Если это не ошибка, добавьте --force.`,
    );
  }
  if (fs.existsSync(output) && !force) {
    throw new UserError(`Файл уже существует: ${output}\nДобавьте --force, чтобы перезаписать.`);
  }

  await ensureTools();

  const outputDir = path.dirname(output);
  fs.mkdirSync(outputDir, { recursive: true });

  // Нужно вдвое больше: faststart переписывает файл вторым проходом.
  const required = sizeBytes * 2;
  const free = await freeSpaceBytes(outputDir);
  if (free === null) {
    console.log('ВНИМАНИЕ: не удалось узнать свободное место на диске — проверьте его сами.');
  } else if (free < required) {
    throw new UserError(
      `Недостаточно места на диске.\n  Папка:    ${outputDir}\n  Свободно: ${formatBytes(free)}\n  Нужно:    ${formatBytes(required)} (размер файла × 2)`,
    );
  }

  const parsedOutput = path.parse(output);
  const partial = path.join(parsedOutput.dir, `${parsedOutput.name}.partial.mp4`);

  let encoding = chooseEncoding(sizeBytes);
  console.log(`Файл:         ${output}`);
  console.log(`Размер:       ${formatBytes(sizeBytes)} (допуск ±${TOLERANCE * 100}%)`);
  console.log(`Кадр:         ${encoding.frame}, 30 к/с, H.264 + AAC`);
  console.log(
    `Длительность: ${formatDuration(encoding.duration)}, битрейт ${formatBitrate(encoding.bitrate)}`,
  );
  if (free !== null) console.log(`Свободно:     ${formatBytes(free)}, нужно ${formatBytes(required)}`);
  console.log('');

  let actualBytes = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await removeIfExists(partial);
    try {
      await runFfmpeg(buildArgs(encoding, partial), {
        durationSeconds: encoding.duration,
        label: 'Генерация',
      });
    } catch (error) {
      await removeIfExists(partial);
      throw error;
    }
    actualBytes = fs.statSync(partial).size;
    if (withinTolerance(actualBytes, sizeBytes) || attempt === 2) break;
    console.log(`Получилось ${formatBytes(actualBytes)} — вне допуска, вторая попытка с поправкой битрейта.`);
    encoding = { ...encoding, bitrate: (encoding.bitrate * sizeBytes) / actualBytes };
  }

  if (!withinTolerance(actualBytes, sizeBytes)) {
    await removeIfExists(partial);
    throw new UserError(
      `Не удалось попасть в размер: получилось ${formatBytes(actualBytes)} вместо ${formatBytes(sizeBytes)}.`,
    );
  }

  const boxes = readFaststart(partial);
  const info = analyzeProbe(await probeFile(partial), {
    path: partial,
    faststart: boxes.faststart,
    isIsoBmff: boxes.isIsoBmff,
  });
  const plan = planAction(info, {});
  if (plan.action !== 'none') {
    await removeIfExists(partial);
    throw new UserError(`Файл получился не в целевом формате: ${plan.reasons.join('; ')}.`);
  }
  fs.renameSync(partial, output);

  const deviation = ((actualBytes - sizeBytes) / sizeBytes) * 100;
  console.log('Готово.');
  console.log(
    `  размер:       ${formatBytes(actualBytes)} (${actualBytes} байт, отклонение ${deviation >= 0 ? '+' : ''}${deviation.toFixed(1)}%)`,
  );
  console.log(
    `  видео:        ${info.video.codec} ${info.video.profile}, ${info.video.pixFmt}, ${info.video.width}x${info.video.height}`,
  );
  console.log(`  аудио:        ${info.audio.codec}, ${info.audio.sampleRate} Гц`);
  console.log(`  длительность: ${formatDuration(info.durationSeconds)}`);
  console.log(`  faststart:    ${info.container.faststart ? 'есть' : 'нет'}`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof AbortError) {
      console.error('\nОстановлено. Недописанный файл удалён.');
      process.exitCode = 130;
    } else if (error instanceof UserError) {
      console.error(`Ошибка: ${error.message}`);
      process.exitCode = 1;
    } else {
      console.error(error);
      process.exitCode = 1;
    }
  },
);
