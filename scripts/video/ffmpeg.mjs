// Обёртки над ffmpeg/ffprobe и диском. Общие для prepare.mjs и make-test-video.mjs.
// Процессы запускаются через spawn с массивом аргументов (без оболочки): пути с пробелами
// и кириллицей передаются как есть.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectFaststart,
  formatBytes,
  formatDuration,
  parseProgressBlock,
  scanTopLevelBoxes,
} from './lib.mjs';

export class UserError extends Error {}
export class AbortError extends Error {}

const INSTALL_HINT = [
  'Как установить ffmpeg (вместе с ним ставится ffprobe):',
  '  Windows:  winget install Gyan.FFmpeg   (после установки откройте терминал заново)',
  '  macOS:    brew install ffmpeg',
  '  Linux:    sudo apt install ffmpeg',
  '  Сборки:   https://ffmpeg.org/download.html',
].join('\n');

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

/** Проверяет, что ffmpeg и ffprobe запускаются. Иначе — понятная ошибка с подсказкой. */
export async function ensureTools() {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    let result;
    try {
      result = await capture(tool, ['-version']);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new UserError(`Не найдена программа ${tool}: её нет в PATH.\n${INSTALL_HINT}`);
      }
      throw new UserError(`Не удалось запустить ${tool}: ${error.message}\n${INSTALL_HINT}`);
    }
    if (result.code !== 0) {
      throw new UserError(`${tool} -version завершился с кодом ${result.code}.\n${INSTALL_HINT}`);
    }
  }
}

/** ffprobe -show_format -show_streams в виде объекта. */
export async function probeFile(filePath) {
  const result = await capture('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || `код ${result.code}`;
    throw new UserError(
      `ffprobe не смог прочитать файл — возможно, это не видео или файл повреждён.\n${detail}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new UserError('ffprobe вернул ответ, который не удалось разобрать.');
  }
}

/** Читает только заголовки боксов верхнего уровня (по 16 байт на бокс). */
export function readFaststart(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    const read = (offset, length) => {
      const buffer = Buffer.alloc(length);
      const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    };
    return detectFaststart(scanTopLevelBoxes(read, fileSize));
  } finally {
    fs.closeSync(fd);
  }
}

/** Свободное место на диске, где лежит папка dir, в байтах. null — узнать не удалось. */
export async function freeSpaceBytes(dir) {
  try {
    const stats = await fs.promises.statfs(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

/** Удаляет файл, если он есть. На Windows файл может освободиться не сразу после остановки ffmpeg. */
export async function removeIfExists(filePath) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.promises.rm(filePath, { force: true });
      return true;
    } catch (error) {
      if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  return false;
}

export function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function progressLine(label, outTimeSeconds, durationSeconds, speed, totalSize) {
  const parts = [label];
  if (durationSeconds) {
    const percent = Math.min(100, (outTimeSeconds / durationSeconds) * 100);
    parts.push(`${percent.toFixed(1).padStart(5)}%`);
    parts.push(`${formatDuration(outTimeSeconds)} из ${formatDuration(durationSeconds)}`);
  } else {
    parts.push(formatDuration(outTimeSeconds));
  }
  if (speed) parts.push(`скорость ${speed.toFixed(2)}x`);
  if (speed && durationSeconds) {
    parts.push(`осталось ~${formatDuration(Math.max(durationSeconds - outTimeSeconds, 0) / speed)}`);
  }
  if (totalSize) parts.push(formatBytes(totalSize));
  return parts.join(' | ');
}

/**
 * Запускает ffmpeg и показывает прогресс по `-progress pipe:1`.
 * В терминале — одна обновляемая строка; при выводе в файл или конвейер — строка на каждые 10%.
 * Ctrl+C останавливает ffmpeg и отклоняет промис с AbortError (недописанный файл удаляет вызывающий).
 */
export function runFfmpeg(args, { durationSeconds = null, label = 'Обработка', quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const interactive = Boolean(process.stderr.isTTY);
    let aborted = false;
    let pending = '';
    let stderrTail = '';
    let lastStep = -1;
    let lineShown = false;
    const state = { outTimeSeconds: 0, speed: null, totalSize: null };

    const clearLine = () => {
      if (interactive && lineShown) process.stderr.write('\r\x1b[2K');
      lineShown = false;
    };

    const render = () => {
      if (quiet) return;
      const line = progressLine(label, state.outTimeSeconds, durationSeconds, state.speed, state.totalSize);
      if (interactive) {
        process.stderr.write(`\r\x1b[2K${line}`);
        lineShown = true;
        return;
      }
      const step = durationSeconds ? Math.floor((state.outTimeSeconds / durationSeconds) * 10) : -1;
      if (step > lastStep) {
        lastStep = step;
        process.stderr.write(`${line}\n`);
      }
    };

    const onSigint = () => {
      aborted = true;
      child.kill();
    };
    process.on('SIGINT', onSigint);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      pending += chunk;
      const cut = pending.lastIndexOf('\n');
      if (cut < 0) return;
      const update = parseProgressBlock(pending.slice(0, cut));
      pending = pending.slice(cut + 1);
      if (update.outTimeSeconds !== undefined) state.outTimeSeconds = update.outTimeSeconds;
      if (update.speed !== undefined) state.speed = update.speed;
      if (update.totalSize !== undefined) state.totalSize = update.totalSize;
      render();
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-4000);
    });

    child.on('error', (error) => {
      process.off('SIGINT', onSigint);
      clearLine();
      reject(new UserError(`Не удалось запустить ffmpeg: ${error.message}`));
    });

    child.on('close', (code) => {
      process.off('SIGINT', onSigint);
      clearLine();
      if (aborted) {
        reject(new AbortError('Остановлено пользователем'));
      } else if (code === 0) {
        resolve();
      } else {
        const detail = stderrTail.trim() || 'ffmpeg не сообщил подробностей';
        reject(new UserError(`ffmpeg завершился с ошибкой (код ${code}):\n${detail}`));
      }
    });
  });
}
