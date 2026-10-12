import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

import { SEEK_STEP_SECONDS, describeTime, formatTime, ratio } from './playerMath';

interface SeekBarProps {
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  onSeek: (time: number) => void;
}

/**
 * Шкала перемотки: нативный range поверх нарисованной дорожки.
 * Пока тянут мышью или пальцем, позиция только показывается; перемотка — один раз при отпускании,
 * чтобы не засыпать сервер Range-запросами на большом файле.
 */
export function SeekBar({ currentTime, duration, bufferedEnd, onSeek }: SeekBarProps) {
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const dragging = useRef(false);
  const known = Number.isFinite(duration) && duration > 0;
  const shownTime = scrubTime ?? currentTime;

  const commit = () => {
    dragging.current = false;
    if (scrubTime !== null) {
      onSeek(scrubTime);
      setScrubTime(null);
    }
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    if (dragging.current) setScrubTime(value);
    else onSeek(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    let target: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') target = currentTime - SEEK_STEP_SECONDS;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') target = currentTime + SEEK_STEP_SECONDS;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = duration;
    if (target === null) return;
    event.preventDefault();
    onSeek(target);
  };

  return (
    <div className="group/seek relative flex h-11 items-center rounded-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold">
      <div className="relative h-1 w-full rounded-full bg-pearl/20 transition-[height] duration-200 group-hover/seek:h-1.5">
        <div
          className="absolute inset-0 origin-left rounded-full bg-pearl/35"
          style={{ transform: `scaleX(${ratio(bufferedEnd, duration)})` }}
        />
        <div
          className="absolute inset-0 origin-left rounded-full bg-gold"
          style={{ transform: `scaleX(${ratio(shownTime, duration)})` }}
        />
        <div
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-bright shadow-[0_0_0_4px_rgb(216_183_124/0.25)]"
          style={{ left: `${ratio(shownTime, duration) * 100}%` }}
        />
      </div>
      {scrubTime !== null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-ink-950/90 px-2 py-0.5 text-xs tabular-nums text-pearl"
          style={{ left: `${ratio(scrubTime, duration) * 100}%` }}
        >
          {formatTime(scrubTime)}
        </span>
      )}
      <input
        type="range"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        min={0}
        max={known ? duration : 0}
        step="any"
        value={known ? shownTime : 0}
        disabled={!known}
        aria-label="Перемотка"
        aria-valuetext={`${describeTime(shownTime)} из ${describeTime(duration)}`}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onPointerDown={() => {
          dragging.current = true;
        }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onBlur={commit}
      />
    </div>
  );
}
