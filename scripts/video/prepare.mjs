#!/usr/bin/env node
// Подготовка видео к публикации на сайте: MP4 + H.264 (yuv420p, 8 бит) + AAC + faststart.
// Делает минимально необходимое: ничего, перепаковку без потери качества, замену звука
// или полное перекодирование. Запуск: npm run video:prepare -- "<вход>" ["<выход>"] [флаги]

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
  samePath,
} from './ffmpeg.mjs';
import {
  DEFAULT_CRF,
  DEFAULT_PRESET,
  DURATION_TOLERANCE_SECONDS,
  SITE_MAX_VIDEO_BYTES,
  X264_PRESETS,
  analyzeProbe,
  buildFfmpegArgs,
  estimateOutputSize,
  formatBitrate,
  formatBytes,
  formatDuration,
  planAction,
  requiredFreeBytes,
} from './lib.mjs';

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_NEEDS_PREPARE = 2;
const EXIT_INTERRUPTED = 130;

const HELP = `Подготовка видео к загрузке на сайт (MP4, H.264 + AAC, faststart).

Запуск:
  npm run video:prepare -- "<входной файл>" ["<выходной файл>"] [флаги]

Что делает (выбирает самое лёгкое из возможного):
  - файл уже подходит                  -> ничего, новый файл не создаётся
  - кодеки подходят, контейнер нет     -> перепаковка без потери качества (быстро)
  - видео подходит, звук нет           -> видео копируется, звук кодируется в AAC 192k
  - видео не подходит (HEVC, VP9, 10 бит и т. п.) -> перекодирование в H.264

Флаги:
  --check            только анализ, ничего не записывать (код выхода 0 — готов, 2 — нужна подготовка)
  --json             анализ в формате JSON, ничего не записывать (коды выхода как у --check)
  --force            перезаписать выходной файл, если он уже есть
  --crf <n>          качество при перекодировании, 0–51, меньше — лучше и больше файл (по умолчанию ${DEFAULT_CRF})
  --preset <имя>     скорость кодирования x264: ${X264_PRESETS.join(', ')} (по умолчанию ${DEFAULT_PRESET})
  --max-height <n>   уменьшить кадр до этой высоты, если он выше (например 1080); увеличения не будет
  --help             эта справка

Выходной файл по умолчанию: рядом с исходником, "<имя>.web.mp4".

Примеры:
  npm run video:prepare -- "D:\\Мультфильмы\\Свадьба Анны.mov"
  npm run video:prepare -- "D:\\Мультфильмы\\Свадьба Анны.mov" --check
  npm run video:prepare -- "film.mkv" "film-1080.mp4" --max-height 1080
`;

function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        check: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        crf: { type: 'string' },
        preset: { type: 'string' },
        'max-height': { type: 'string' },
      },
    });
  } catch (error) {
    throw new UserError(`${error.message}\nСправка: npm run video:prepare -- --help`);
  }
  const { values, positionals } = parsed;
  if (values.help) return { help: true };
  if (positionals.length === 0) {
    throw new UserError('Не указан входной файл.\nСправка: npm run video:prepare -- --help');
  }
  if (positionals.length > 2) {
    throw new UserError(
      'Слишком много аргументов. Если в пути есть пробелы — возьмите его в кавычки: "D:\\Мои видео\\фильм.mov"',
    );
  }

  let crf = DEFAULT_CRF;
  if (values.crf !== undefined) {
    crf = Number(values.crf);
    if (!Number.isInteger(crf) || crf < 0 || crf > 51) {
      throw new UserError('--crf должен быть целым числом от 0 до 51.');
    }
  }
  const preset = values.preset ?? DEFAULT_PRESET;
  if (!X264_PRESETS.includes(preset)) {
    throw new UserError(`--preset должен быть одним из: ${X264_PRESETS.join(', ')}.`);
  }
  let maxHeight = null;
  if (values['max-height'] !== undefined) {
    maxHeight = Number(values['max-height']);
    if (!Number.isInteger(maxHeight) || maxHeight < 144 || maxHeight > 4320) {
      throw new UserError('--max-height должен быть целым числом от 144 до 4320 (например 1080).');
    }
  }

  return {
    help: false,
    input: path.resolve(positionals[0]),
    output: positionals[1] ? path.resolve(positionals[1]) : null,
    check: values.check,
    json: values.json,
    force: values.force,
    crf,
    preset,
    maxHeight,
  };
}

async function inspect(filePath) {
  const probe = await probeFile(filePath);
  const boxes = readFaststart(filePath);
  return analyzeProbe(probe, { path: filePath, faststart: boxes.faststart, isIsoBmff: boxes.isIsoBmff });
}

function describeContainer(info) {
  const { container } = info;
  if (container.isMp4) return container.faststart ? 'MP4, faststart есть' : 'MP4, faststart нет';
  const ext = container.extension ? container.extension.slice(1).toUpperCase() : '?';
  return `${ext} (${container.formatName || 'формат не определён'})`;
}

function describeVideo(video) {
  if (!video) return 'нет';
  const parts = [video.profile ? `${video.codec} ${video.profile}` : video.codec];
  parts.push(`${video.pixFmt ?? '?'} ${video.bitDepth} бит`);
  if (video.width && video.height) parts.push(`${video.width}x${video.height}`);
  if (video.fps) parts.push(`${Number(video.fps.toFixed(3))} к/с`);
  if (video.bitrate) parts.push(`${video.bitrateIsEstimate ? '~' : ''}${formatBitrate(video.bitrate)}`);
  return parts.join(', ');
}

function describeAudio(audio) {
  if (!audio) return 'нет';
  const parts = [audio.codec];
  if (audio.channels) parts.push(`каналов: ${audio.channels}`);
  if (audio.sampleRate) parts.push(`${audio.sampleRate} Гц`);
  if (audio.bitrate) parts.push(formatBitrate(audio.bitrate));
  return parts.join(', ');
}

function describePlannedVideo(info, plan) {
  if (!plan.video) return '—';
  if (plan.video.mode === 'copy') return 'без изменений (копирование)';
  const size = plan.video.scale
    ? `${plan.video.scale.width}x${plan.video.scale.height}`
    : `${info.video.width}x${info.video.height}`;
  return `перекодирование в H.264 High, yuv420p 8 бит, ${size}, CRF ${plan.video.crf}, preset ${plan.video.preset}`;
}

function describePlannedAudio(plan) {
  if (!plan.audio || plan.audio.mode === 'none') return 'нет';
  if (plan.audio.mode === 'copy') return 'без изменений (копирование)';
  return `кодирование в AAC ${plan.audio.bitrateKbps} кбит/с`;
}

function describeEstimate(estimate) {
  if (!estimate.bytes) return 'неизвестно';
  if (estimate.exact) return `≈ ${formatBytes(estimate.bytes)}`;
  return `≈ ${formatBytes(estimate.bytes)} — грубая оценка, зависит от содержимого`;
}

const ACTION_TITLES = {
  none: 'ничего делать не нужно',
  remux: 'перепаковка в MP4 без потери качества (быстро)',
  audio: 'видео копируется как есть, звук кодируется в AAC',
  transcode: 'перекодирование видео в H.264 (долго, зависит от длины и мощности компьютера)',
  unsupported: 'файл нельзя подготовить',
};

const PROGRESS_LABELS = {
  remux: 'Перепаковка',
  audio: 'Кодирование звука',
  transcode: 'Перекодирование',
};

function printTable(rows) {
  const labelWidth = Math.max(...rows.map((row) => row[0].length));
  const leftWidth = Math.max(...rows.map((row) => row[1].length));
  for (const [label, left, right] of rows) {
    console.log(`  ${label.padEnd(labelWidth)}  ${left.padEnd(leftWidth)}  ${right}`.trimEnd());
  }
}

function printPlan(inputPath, info, plan, estimate) {
  console.log(`Файл: ${inputPath}`);
  console.log('');
  const rows = [['', 'ЧТО ЕСТЬ', 'ЧТО БУДЕТ']];
  if (plan.action === 'none' || plan.action === 'unsupported') {
    rows.push(
      ['Контейнер', describeContainer(info), '—'],
      ['Видео', describeVideo(info.video), '—'],
      ['Аудио', describeAudio(info.audio), '—'],
      ['Длительность', formatDuration(info.durationSeconds), '—'],
      ['Размер', formatBytes(info.sizeBytes), '—'],
    );
  } else {
    rows.push(
      ['Контейнер', describeContainer(info), 'MP4, faststart есть'],
      ['Видео', describeVideo(info.video), describePlannedVideo(info, plan)],
      ['Аудио', describeAudio(info.audio), describePlannedAudio(plan)],
      ['Длительность', formatDuration(info.durationSeconds), 'та же'],
      ['Размер', formatBytes(info.sizeBytes), describeEstimate(estimate)],
    );
  }
  printTable(rows);
  console.log('');
  console.log(`Действие: ${ACTION_TITLES[plan.action]}`);
  for (const reason of plan.reasons) console.log(`  причина: ${reason}`);
}

function warn(message) {
  console.log(`ВНИМАНИЕ: ${message}`);
}

function resolveOutput(options) {
  const parsedInput = path.parse(options.input);
  const output = options.output ?? path.join(parsedInput.dir, `${parsedInput.name}.web.mp4`);
  const ext = path.extname(output).toLowerCase();
  if (ext !== '.mp4' && ext !== '.m4v') {
    throw new UserError(`Выходной файл должен иметь расширение .mp4 (указано: ${output}).`);
  }
  if (samePath(options.input, output)) {
    throw new UserError('Входной и выходной файл совпадают. Укажите другое имя для результата.');
  }
  const parsedOutput = path.parse(output);
  const partial = path.join(parsedOutput.dir, `${parsedOutput.name}.partial.mp4`);
  if (samePath(options.input, partial)) {
    throw new UserError(
      'Имя входного файла совпадает с именем временного файла. Укажите другое имя результата.',
    );
  }
  return { output, partial };
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return EXIT_OK;
  }

  const inputStat = fs.statSync(options.input, { throwIfNoEntry: false });
  if (!inputStat) throw new UserError(`Файл не найден: ${options.input}`);
  if (!inputStat.isFile()) throw new UserError(`Это не файл: ${options.input}`);

  await ensureTools();

  const info = await inspect(options.input);
  const plan = planAction(info, { crf: options.crf, preset: options.preset, maxHeight: options.maxHeight });
  const estimate = estimateOutputSize(info, plan);
  const ready = plan.action === 'none';

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          input: options.input,
          ready,
          action: plan.action,
          reasons: plan.reasons,
          info,
          plan,
          estimate: { bytes: estimate.bytes, exact: estimate.exact },
          exceedsSiteLimit: Boolean(info.sizeBytes && info.sizeBytes > SITE_MAX_VIDEO_BYTES),
        },
        null,
        2,
      ),
    );
    if (plan.action === 'unsupported') return EXIT_ERROR;
    return ready ? EXIT_OK : EXIT_NEEDS_PREPARE;
  }

  printPlan(options.input, info, plan, estimate);
  console.log('');

  const siteLimit = formatBytes(SITE_MAX_VIDEO_BYTES);
  if (info.sizeBytes && info.sizeBytes > SITE_MAX_VIDEO_BYTES) {
    warn(
      `исходник ${formatBytes(info.sizeBytes)} больше максимума сайта (${siteLimit}). ` +
        'Чтобы уменьшить, запустите с --max-height 1080 или с большим --crf (например 21).',
    );
  }

  if (plan.action === 'unsupported') {
    throw new UserError(`Файл нельзя подготовить: ${plan.reasons.join('; ')}.`);
  }

  if (ready) {
    console.log('Файл готов, ничего делать не нужно. Можно загружать через админку.');
    return EXIT_OK;
  }

  if (options.check) {
    console.log('Нужна подготовка. Запустите команду без --check, чтобы создать готовый файл.');
    return EXIT_NEEDS_PREPARE;
  }

  const { output, partial } = resolveOutput(options);
  const outputDir = path.dirname(output);
  if (!fs.existsSync(outputDir)) throw new UserError(`Папка для результата не существует: ${outputDir}`);
  if (fs.existsSync(output) && !options.force) {
    throw new UserError(
      `Выходной файл уже существует: ${output}\nДобавьте --force, чтобы перезаписать, или укажите другое имя.`,
    );
  }

  if (estimate.bytes && estimate.bytes > SITE_MAX_VIDEO_BYTES) {
    warn(
      `результат по оценке (${formatBytes(estimate.bytes)}) будет больше максимума сайта (${siteLimit}). ` +
        'Подумайте о --max-height 1080 или большем --crf.',
    );
  }

  const required = requiredFreeBytes(estimate);
  const free = await freeSpaceBytes(outputDir);
  if (free === null) {
    warn('не удалось узнать свободное место на диске — проверьте его сами.');
  } else if (required > free) {
    throw new UserError(
      `Недостаточно места на диске для результата.\n` +
        `  Папка:      ${outputDir}\n` +
        `  Свободно:   ${formatBytes(free)}\n` +
        `  Нужно:      ${formatBytes(required)} (оценка размера ${formatBytes(estimate.bytes)} + запас)\n` +
        'Освободите место или укажите выходной файл на другом диске.',
    );
  } else {
    console.log(`Свободно на диске: ${formatBytes(free)}, нужно около ${formatBytes(required)} — хватает.`);
  }

  console.log(`Результат: ${output}`);
  console.log('Остановить: Ctrl+C (недописанный файл будет удалён).');
  console.log('');

  await removeIfExists(partial);
  const startedAt = Date.now();
  try {
    await runFfmpeg(buildFfmpegArgs(plan, options.input, partial), {
      durationSeconds: info.durationSeconds,
      label: PROGRESS_LABELS[plan.action],
    });
  } catch (error) {
    const removed = await removeIfExists(partial);
    if (!removed) warn(`не удалось удалить недописанный файл: ${partial}`);
    throw error;
  }

  const result = await inspect(partial);
  const resultPlan = planAction(result, {});
  if (resultPlan.action !== 'none') {
    await removeIfExists(partial);
    throw new UserError(
      `Результат не прошёл проверку (${resultPlan.reasons.join('; ')}). Файл удалён. ` +
        'Сообщите об этом разработчику вместе с исходным файлом.',
    );
  }
  fs.renameSync(partial, output);

  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  console.log(`Готово за ${formatDuration(elapsedSeconds)}.`);
  console.log('');
  printTable([
    ['', 'БЫЛО', 'СТАЛО'],
    ['Контейнер', describeContainer(info), describeContainer(result)],
    ['Видео', describeVideo(info.video), describeVideo(result.video)],
    ['Аудио', describeAudio(info.audio), describeAudio(result.audio)],
    ['Длительность', formatDuration(info.durationSeconds), formatDuration(result.durationSeconds)],
    ['Размер', formatBytes(info.sizeBytes), formatBytes(result.sizeBytes)],
  ]);
  console.log('');

  if (info.durationSeconds !== null && result.durationSeconds !== null) {
    const diff = Math.abs(info.durationSeconds - result.durationSeconds);
    if (diff > DURATION_TOLERANCE_SECONDS) {
      warn(
        `длительность результата отличается от исходника на ${diff.toFixed(2)} с. ` +
          'Просмотрите конец ролика и проверьте звук перед загрузкой.',
      );
    }
  }
  if (result.sizeBytes && result.sizeBytes > SITE_MAX_VIDEO_BYTES) {
    warn(
      `результат ${formatBytes(result.sizeBytes)} больше максимума сайта (${siteLimit}) — загрузить его не получится. ` +
        'Запустите снова с --max-height 1080 или большим --crf и флагом --force.',
    );
    console.log(`Файл: ${output}`);
    return EXIT_OK;
  }

  console.log(`Файл: ${output}`);
  console.log('Можно загружать через админку.');
  return EXIT_OK;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof AbortError) {
      console.error('\nОстановлено. Недописанный файл удалён.');
      process.exitCode = EXIT_INTERRUPTED;
    } else if (error instanceof UserError) {
      console.error(`Ошибка: ${error.message}`);
      process.exitCode = EXIT_ERROR;
    } else {
      console.error(error);
      process.exitCode = EXIT_ERROR;
    }
  },
);
