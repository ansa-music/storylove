import type { PublicVideo } from '@shared/api';

import { PlayIcon } from './icons';
import { PlayerControls } from './PlayerControls';
import { formatTime, progressKey } from './playerMath';
import { usePlayer } from './usePlayer';

interface VideoPlayerProps {
  slug: string;
  title: string;
  video: PublicVideo;
  poster: string;
}

/**
 * Плеер мультфильма. Файлы весят гигабайты, поэтому preload="metadata":
 * браузер сам запрашивает нужные куски через HTTP Range, целиком файл не качается.
 * При смене версии видео компонент нужно перемонтировать (key={video.version}).
 */
export function VideoPlayer({ slug, title, video, poster }: VideoPlayerProps) {
  const { videoRef, containerRef, ...player } = usePlayer({
    storageKey: progressKey(slug, video.version),
    knownDuration: video.durationSeconds,
  });
  const { playing, error, resumeAt, loading } = player;
  const overlayOpen = error !== null || resumeAt !== null;
  const controlsShown = player.controlsVisible || !playing || overlayOpen;

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={`Плеер: ${title}`}
      tabIndex={0}
      onKeyDown={player.onKeyDown}
      onPointerMove={player.showControls}
      className={`group/player relative aspect-video w-full overflow-hidden bg-black outline-offset-4 ${
        controlsShown ? '' : 'cursor-none'
      }`}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        src={video.url}
        poster={poster}
        preload="metadata"
        playsInline
        onClick={player.togglePlay}
        onDoubleClick={player.fullscreenSupported ? player.toggleFullscreen : undefined}
        {...player.videoEvents}
      />

      {!playing && !overlayOpen && !loading && (
        <button
          type="button"
          onClick={player.togglePlay}
          aria-label={`Смотреть: ${title}`}
          className="absolute top-1/2 left-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-gold/50 bg-ink-950/60 text-gold-bright backdrop-blur-sm transition-[background-color,scale] duration-300 ease-cinema hover:scale-105 hover:bg-ink-950/80 sm:size-24"
        >
          <PlayIcon className="size-9 translate-x-0.5 sm:size-10" />
        </button>
      )}

      {loading && error === null && (
        <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="size-12 animate-spin-slow rounded-full border-2 border-gold/25 border-t-gold" />
          <span className="sr-only">Видео загружается…</span>
        </div>
      )}

      {resumeAt !== null && error === null && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-950/70 p-4 backdrop-blur-sm">
          <div
            role="group"
            aria-label="Продолжить просмотр"
            className="flex max-w-md flex-col items-center text-center"
          >
            <p className="font-display text-2xl text-pearl sm:text-3xl">
              Вы уже начинали смотреть этот мультфильм
            </p>
            <div className="mt-6 flex flex-col gap-3 xs:flex-row">
              <button type="button" className="btn btn-gold" onClick={player.resume}>
                Продолжить с {formatTime(resumeAt)}
              </button>
              <button type="button" className="btn btn-ghost" onClick={player.restart}>
                С начала
              </button>
            </div>
          </div>
        </div>
      )}

      {error !== null && (
        <div
          role="alert"
          className="absolute inset-0 flex items-center justify-center bg-ink-950/85 p-5 text-center"
        >
          <div className="flex max-w-md flex-col items-center">
            <p className="text-base text-pearl sm:text-lg">{error}</p>
            <button type="button" className="btn btn-gold mt-6" onClick={player.retry}>
              Повторить
            </button>
          </div>
        </div>
      )}

      {error === null && resumeAt === null && (
        <div
          className={`absolute inset-x-0 bottom-0 transition-opacity duration-300 group-has-[:focus-visible]/player:opacity-100 ${
            controlsShown
              ? 'opacity-100'
              : 'pointer-events-none opacity-0 group-has-[:focus-visible]/player:pointer-events-auto'
          }`}
        >
          <PlayerControls player={player} />
        </div>
      )}
    </div>
  );
}
