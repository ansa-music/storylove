import { FullscreenIcon, PauseIcon, PlayIcon, VolumeIcon } from './icons';
import { formatTime } from './playerMath';
import { SeekBar } from './SeekBar';
import type { PlayerControlsApi } from './usePlayer';

const buttonClass =
  'flex size-11 shrink-0 items-center justify-center rounded-full text-pearl transition-colors duration-200 hover:bg-pearl/10 hover:text-gold-bright';

/** Панель управления: шкала, Play/Pause, время, громкость, полный экран. */
export function PlayerControls({ player }: { player: PlayerControlsApi }) {
  const silent = player.muted || player.volume === 0;

  return (
    <div className="bg-[linear-gradient(to_top,rgb(8_7_10/0.92),rgb(8_7_10/0.55)_60%,transparent)] px-3 pt-10 pb-2 sm:px-5 sm:pb-3">
      <SeekBar
        currentTime={player.currentTime}
        duration={player.duration}
        bufferedEnd={player.bufferedEnd}
        onSeek={player.seekTo}
      />
      <div className="flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={player.togglePlay}
          aria-label={player.playing ? 'Пауза' : 'Смотреть'}
          aria-keyshortcuts="K"
        >
          {player.playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <p className="px-1 text-sm tabular-nums text-pearl/90">
          <span className="sr-only">Время: </span>
          {formatTime(player.currentTime)}
          <span aria-hidden="true" className="px-1 text-pearl/50">
            /
          </span>
          <span className="sr-only"> из </span>
          {formatTime(player.duration)}
        </p>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={player.toggleMute}
            aria-label={silent ? 'Включить звук' : 'Выключить звук'}
            aria-pressed={silent}
            aria-keyshortcuts="M"
          >
            <VolumeIcon muted={silent} low={player.volume < 0.5} />
          </button>
          {/* На сенсорных устройствах громкость регулируется кнопками телефона. */}
          <input
            type="range"
            className="hidden h-11 w-24 cursor-pointer accent-gold [@media(hover:hover)_and_(pointer:fine)]:block"
            min={0}
            max={1}
            step={0.05}
            value={silent ? 0 : player.volume}
            aria-label="Громкость"
            aria-valuetext={`${Math.round((silent ? 0 : player.volume) * 100)}%`}
            onChange={(event) => player.setVolume(Number(event.target.value))}
          />
          {player.fullscreenSupported && (
            <button
              type="button"
              className={buttonClass}
              onClick={player.toggleFullscreen}
              aria-label={player.fullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран'}
              aria-keyshortcuts="F"
            >
              <FullscreenIcon active={player.fullscreen} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
