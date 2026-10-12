import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

import {
  SEEK_STEP_SECONDS,
  VOLUME_STEP,
  bufferedEndAt,
  clamp,
  mediaErrorMessage,
  resumablePosition,
  seekTarget,
  shouldSaveProgress,
  type BufferedRange,
} from './playerMath';
import { clearProgress, readProgress, writeProgress } from './progressStore';

const CONTROLS_HIDE_MS = 2800;
const LOADING_DELAY_MS = 400;

export interface PlayerOptions {
  /** Ключ хранилища позиции (уровень + версия видео). */
  storageKey: string;
  /** Длительность из API, если известна до загрузки метаданных. */
  knownDuration: number | null;
}

export interface PlayerApi {
  videoRef: RefObject<HTMLVideoElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  playing: boolean;
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  volume: number;
  muted: boolean;
  loading: boolean;
  error: string | null;
  fullscreen: boolean;
  fullscreenSupported: boolean;
  controlsVisible: boolean;
  /** Сохранённая позиция, с которой можно продолжить; null — предлагать нечего. */
  resumeAt: number | null;
  togglePlay: () => void;
  seekTo: (time: number) => void;
  seekBy: (delta: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  retry: () => void;
  resume: () => void;
  restart: () => void;
  showControls: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  videoEvents: {
    onLoadedMetadata: () => void;
    onDurationChange: () => void;
    onTimeUpdate: () => void;
    onProgress: () => void;
    onPlay: () => void;
    onPause: () => void;
    onWaiting: () => void;
    onStalled: () => void;
    onPlaying: () => void;
    onCanPlay: () => void;
    onSeeked: () => void;
    onEnded: () => void;
    onError: () => void;
    onVolumeChange: () => void;
  };
}

function toRanges(buffered: TimeRanges): BufferedRange[] {
  const ranges: BufferedRange[] = [];
  for (let index = 0; index < buffered.length; index += 1) {
    ranges.push({ start: buffered.start(index), end: buffered.end(index) });
  }
  return ranges;
}

/** iPhone: Fullscreen API для произвольного элемента нет, но видео умеет открываться в системном плеере. */
function enterNativeVideoFullscreen(video: HTMLVideoElement): boolean {
  if (!('webkitEnterFullscreen' in video)) return false;
  const enter = video.webkitEnterFullscreen;
  if (typeof enter !== 'function') return false;
  enter.call(video);
  return true;
}

function detectFullscreenSupport(): boolean {
  if (typeof document === 'undefined') return false;
  return document.fullscreenEnabled === true || 'webkitEnterFullscreen' in HTMLVideoElement.prototype;
}

export function usePlayer({ storageKey, knownDuration }: PlayerOptions): PlayerApi {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration ?? 0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported] = useState(detectFullscreenSupport);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [resumeAt, setResumeAt] = useState<number | null>(() => {
    const saved = readProgress(storageKey);
    return saved === null ? null : resumablePosition(saved, knownDuration);
  });

  const hideTimer = useRef<number | null>(null);
  const loadingTimer = useRef<number | null>(null);
  const lastSavedTime = useRef<number | null>(null);
  /** Позиция, к которой нужно вернуться после перезагрузки источника («Повторить»). */
  const pendingSeek = useRef<number | null>(null);
  const lastKnownTime = useRef(0);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      const video = videoRef.current;
      if (video && !video.paused && !video.ended) setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, []);

  const stopLoading = useCallback(() => {
    if (loadingTimer.current !== null) {
      window.clearTimeout(loadingTimer.current);
      loadingTimer.current = null;
    }
    setLoading(false);
  }, []);

  /** Индикатор появляется с задержкой, чтобы не мигать на коротких подгрузках. */
  const startLoading = useCallback(() => {
    if (loadingTimer.current !== null) return;
    loadingTimer.current = window.setTimeout(() => setLoading(true), LOADING_DELAY_MS);
  }, []);

  const persist = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const time = video.currentTime;
    const total = Number.isFinite(video.duration) ? video.duration : null;
    const position = resumablePosition(time, total);
    if (position !== null) {
      if (writeProgress(storageKey, position)) lastSavedTime.current = position;
    } else if (total !== null && time > total / 2) {
      // Досмотрели до конца — в следующий раз начинаем сначала.
      clearProgress(storageKey);
      lastSavedTime.current = null;
    }
  }, [storageKey]);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().catch((err: unknown) => {
      // AbortError — воспроизведение прервано паузой или сменой источника, это штатно.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // Остальное (запрет автозапуска, неподдерживаемый файл): остаёмся на паузе;
      // если причина в файле — текст покажет событие error.
      setPlaying(false);
    });
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || error !== null) return;
    if (video.paused || video.ended) play();
    else video.pause();
    showControls();
  }, [error, play, showControls]);

  const seekTo = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const target = seekTarget(time, 0, video.duration);
      video.currentTime = target;
      lastKnownTime.current = target;
      setCurrentTime(target);
      showControls();
    },
    [showControls],
  );

  const seekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (video) seekTo(video.currentTime + delta);
    },
    [seekTo],
  );

  const setVolume = useCallback((next: number) => {
    const video = videoRef.current;
    if (!video) return;
    const value = clamp(next, 0, 1);
    video.volume = value;
    video.muted = value === 0;
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 0.5;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => setFullscreen(document.fullscreenElement !== null));
      return;
    }
    if (document.fullscreenEnabled && typeof container.requestFullscreen === 'function') {
      container.requestFullscreen().catch(() => {
        // Контейнер развернуть не дали — пробуем системный плеер; иначе остаёмся в окне.
        if (!enterNativeVideoFullscreen(video)) setFullscreen(false);
      });
      return;
    }
    enterNativeVideoFullscreen(video);
  }, []);

  const retry = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    pendingSeek.current = lastKnownTime.current;
    setError(null);
    startLoading();
    video.load();
  }, [startLoading]);

  const resume = useCallback(() => {
    const video = videoRef.current;
    if (!video || resumeAt === null) return;
    video.currentTime = resumeAt;
    lastKnownTime.current = resumeAt;
    setCurrentTime(resumeAt);
    setResumeAt(null);
    play();
  }, [play, resumeAt]);

  const restart = useCallback(() => {
    clearProgress(storageKey);
    lastSavedTime.current = null;
    setResumeAt(null);
    play();
  }, [play, storageKey]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      const onRange = target instanceof HTMLInputElement;
      const onControl = onRange || target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement;
      const video = videoRef.current;
      if (!video) return;

      // event.code не зависит от раскладки: K, M, F работают и в русской.
      switch (event.code) {
        case 'Space':
          if (onControl) return;
          togglePlay();
          break;
        case 'KeyK':
          togglePlay();
          break;
        case 'KeyM':
          toggleMute();
          break;
        case 'KeyF':
          toggleFullscreen();
          break;
        case 'ArrowLeft':
          if (onRange) return;
          seekBy(-SEEK_STEP_SECONDS);
          break;
        case 'ArrowRight':
          if (onRange) return;
          seekBy(SEEK_STEP_SECONDS);
          break;
        case 'ArrowUp':
          if (onRange) return;
          setVolume(video.volume + VOLUME_STEP);
          break;
        case 'ArrowDown':
          if (onRange) return;
          setVolume(video.volume - VOLUME_STEP);
          break;
        case 'Home':
          if (onRange) return;
          seekTo(0);
          break;
        case 'End':
          if (onRange) return;
          seekTo(video.duration);
          break;
        default:
          return;
      }
      event.preventDefault();
      showControls();
    },
    [seekBy, seekTo, setVolume, showControls, toggleFullscreen, toggleMute, togglePlay],
  );

  // Полноэкранный режим, уход со страницы, размонтирование.
  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('pagehide', persist);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('pagehide', persist);
      persist();
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      if (loadingTimer.current !== null) window.clearTimeout(loadingTimer.current);
    };
  }, [persist]);

  const videoEvents: PlayerApi['videoEvents'] = {
    onLoadedMetadata: () => {
      const video = videoRef.current;
      if (!video) return;
      if (Number.isFinite(video.duration)) setDuration(video.duration);
      if (pendingSeek.current !== null) {
        video.currentTime = pendingSeek.current;
        pendingSeek.current = null;
        play();
        return;
      }
      // Теперь длительность известна точно — перепроверяем предложение продолжить.
      setResumeAt((saved) => (saved === null ? null : resumablePosition(saved, video.duration)));
    },
    onDurationChange: () => {
      const video = videoRef.current;
      if (video && Number.isFinite(video.duration)) setDuration(video.duration);
    },
    onTimeUpdate: () => {
      const video = videoRef.current;
      if (!video) return;
      lastKnownTime.current = video.currentTime;
      setCurrentTime(video.currentTime);
      setBufferedEnd(bufferedEndAt(toRanges(video.buffered), video.currentTime));
      if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) stopLoading();
      if (!video.paused && shouldSaveProgress(video.currentTime, lastSavedTime.current)) persist();
    },
    onProgress: () => {
      const video = videoRef.current;
      if (video) setBufferedEnd(bufferedEndAt(toRanges(video.buffered), video.currentTime));
    },
    onPlay: () => {
      setPlaying(true);
      setResumeAt(null);
      showControls();
    },
    onPause: () => {
      setPlaying(false);
      setControlsVisible(true);
      stopLoading();
      persist();
    },
    onWaiting: startLoading,
    onStalled: () => {
      const video = videoRef.current;
      // С preload="metadata" stalled приходит и на паузе — тогда индикатор не нужен.
      if (video && !video.paused) startLoading();
    },
    onPlaying: stopLoading,
    onCanPlay: stopLoading,
    onSeeked: stopLoading,
    onEnded: () => {
      setPlaying(false);
      setControlsVisible(true);
      clearProgress(storageKey);
      lastSavedTime.current = null;
    },
    onError: () => {
      stopLoading();
      setPlaying(false);
      setControlsVisible(true);
      setError(mediaErrorMessage(videoRef.current?.error?.code));
    },
    onVolumeChange: () => {
      const video = videoRef.current;
      if (!video) return;
      setVolumeState(video.volume);
      setMuted(video.muted);
    },
  };

  return {
    videoRef,
    containerRef,
    playing,
    currentTime,
    duration,
    bufferedEnd,
    volume,
    muted,
    loading,
    error,
    fullscreen,
    fullscreenSupported,
    controlsVisible,
    resumeAt,
    togglePlay,
    seekTo,
    seekBy,
    setVolume,
    toggleMute,
    toggleFullscreen,
    retry,
    resume,
    restart,
    showControls,
    onKeyDown,
    videoEvents,
  };
}

/** Всё, кроме ссылок на DOM-элементы, — для дочерних компонентов плеера. */
export type PlayerControlsApi = Omit<PlayerApi, 'videoRef' | 'containerRef'>;
