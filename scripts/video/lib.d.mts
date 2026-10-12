// Типы для lib.mjs — нужны тесту tests/unit/scripts-video.test.ts (проект собирается без allowJs).

export const SITE_MAX_VIDEO_BYTES: number;
export const AUDIO_BITRATE_KBPS: number;
export const DEFAULT_CRF: number;
export const DEFAULT_PRESET: string;
export const X264_PRESETS: string[];
export const DURATION_TOLERANCE_SECONDS: number;

export interface BoxHeader {
  type: string;
  /** null — бокс тянется до конца файла. */
  size: number | null;
  headerSize: number;
}

export interface TopLevelBox {
  type: string;
  offset: number;
  size: number;
}

export interface FaststartInfo {
  isIsoBmff: boolean;
  hasMoov: boolean;
  hasMdat: boolean;
  fragmented: boolean;
  faststart: boolean;
}

export function parseBoxHeader(bytes: Uint8Array): BoxHeader | null;
export function scanTopLevelBoxes(
  read: (offset: number, length: number) => Uint8Array,
  fileSize: number,
): TopLevelBox[];
export function detectFaststart(boxes: TopLevelBox[]): FaststartInfo;

export interface VideoInfo {
  codec: string;
  profile: string | null;
  pixFmt: string | null;
  bitDepth: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrate: number | null;
  bitrateIsEstimate: boolean;
}

export interface AudioInfo {
  codec: string;
  profile: string | null;
  channels: number | null;
  sampleRate: number | null;
  bitrate: number | null;
}

export interface MediaInfo {
  container: {
    formatName: string;
    majorBrand: string | null;
    extension: string;
    isMp4: boolean;
    faststart: boolean;
  };
  video: VideoInfo | null;
  audio: AudioInfo | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
  bitrate: number | null;
}

export interface ProbeMeta {
  path?: string;
  faststart?: boolean;
  isIsoBmff?: boolean;
}

export function parseRate(value: unknown): number | null;
export function analyzeProbe(probe: unknown, meta?: ProbeMeta): MediaInfo;

export type PlanActionName = 'none' | 'remux' | 'audio' | 'transcode' | 'unsupported';

export interface PlanOptions {
  crf?: number;
  preset?: string;
  maxHeight?: number | null;
}

export type VideoPlan =
  | { mode: 'copy' }
  | { mode: 'encode'; crf: number; preset: string; scale: { width: number; height: number } | null };

export type AudioPlan = { mode: 'none' } | { mode: 'copy' } | { mode: 'aac'; bitrateKbps: number };

export interface Plan {
  action: PlanActionName;
  reasons: string[];
  video: VideoPlan | null;
  audio: AudioPlan | null;
  lossless: boolean;
}

export function planAction(info: MediaInfo, options?: PlanOptions): Plan;
export function buildFfmpegArgs(plan: Plan, inputPath: string, outputPath: string): string[];

export interface SizeEstimate {
  bytes: number | null;
  exact: boolean;
}

export function estimateOutputSize(info: MediaInfo, plan: Plan): SizeEstimate;
export function requiredFreeBytes(estimate: SizeEstimate): number;

export interface ProgressUpdate {
  outTimeSeconds?: number;
  speed?: number;
  totalSize?: number;
  ended?: boolean;
}

export function parseProgressBlock(text: string): ProgressUpdate;
export function formatBytes(bytes: number | null | undefined): string;
export function formatDuration(seconds: number | null | undefined): string;
export function formatBitrate(bitsPerSecond: number | null | undefined): string;
export function parseSize(text: unknown): number | null;
