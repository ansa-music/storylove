// Базовые элементы интерфейса админки: карточки, поля, значки состояния, полоса использования.

import { useId, type ReactNode } from 'react';

import { formatBytes, formatPercent } from '../lib/format';
import type { Tone } from '../lib/filmStatus';

export const inputClass =
  'w-full rounded-lg border border-ink-600 bg-ink-900 px-3.5 py-2.5 text-base text-pearl placeholder:text-ink-400 transition-colors focus:border-gold focus:outline-none focus-visible:outline-2 disabled:opacity-60 sm:text-sm';

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 animate-spin-slow rounded-full border-2 border-gold/25 border-t-gold ${className}`}
    />
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl text-pearl sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-ink-200">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

interface CardProps {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Card({ title, description, actions, children, className = '' }: CardProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={`min-w-0 rounded-xl border border-ink-700 bg-ink-850 p-4 shadow-card sm:p-6 ${className}`}
    >
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="font-sans text-base font-semibold tracking-normal text-pearl">
                {title}
              </h2>
            )}
            {description && <p className="mt-1 text-sm text-ink-200">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const toneClasses: Readonly<Record<Tone, string>> = {
  ok: 'border-ok/40 bg-ok/10 text-ok',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  muted: 'border-ink-500 bg-ink-700/60 text-ink-200',
  gold: 'border-gold/40 bg-gold/10 text-gold',
};

export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}

type NoticeTone = 'info' | 'ok' | 'warn' | 'danger';

const noticeClasses: Readonly<Record<NoticeTone, string>> = {
  info: 'border-ink-600 bg-ink-800 text-ink-100',
  ok: 'border-ok/40 bg-ok/10 text-ok',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  danger: 'border-danger/40 bg-danger/10 text-danger',
};

interface NoticeProps {
  tone?: NoticeTone;
  children: ReactNode;
  id?: string;
  className?: string;
  /** Объявлять экранным дикторам при появлении. Ошибки объявляются сразу, остальное — вежливо. */
  live?: boolean;
}

export function Notice({ tone = 'info', children, id, className = '', live = false }: NoticeProps) {
  const role = live ? (tone === 'danger' ? 'alert' : 'status') : undefined;
  return (
    <div id={id} role={role} className={`rounded-lg border px-3.5 py-2.5 text-sm ${noticeClasses[tone]} ${className}`}>
      {children}
    </div>
  );
}

export function LoadingState({ label = 'Загружаем…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-10 text-sm text-ink-200">
      <Spinner />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-danger/40 bg-danger/5 p-5">
      <p className="text-sm text-danger">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-quiet btn-sm mt-4" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-ink-600 px-4 py-8 text-center text-sm text-ink-300">{children}</p>
  );
}

interface UsageBarProps {
  usedBytes: number;
  budgetBytes: number;
  label?: string;
}

/** Полоса использования хранилища относительно бюджета. Пороги: 80% — внимание, 100% — превышение. */
export function UsageBar({ usedBytes, budgetBytes, label = 'Использование хранилища' }: UsageBarProps) {
  const ratio = budgetBytes > 0 ? usedBytes / budgetBytes : 0;
  const tone = ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warn' : 'ok';
  const fill = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' }[tone];
  const text = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }[tone];
  const summary = `${formatBytes(usedBytes)} из ${formatBytes(budgetBytes)} (${formatPercent(ratio)})`;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="text-ink-100">{label}</span>
        <span className={`font-semibold tabular-nums ${text}`}>{summary}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(ratio * 100))}
        aria-valuetext={summary}
        className="relative h-3 overflow-hidden rounded-full bg-ink-700"
      >
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        <span aria-hidden="true" className="absolute inset-y-0 left-[80%] w-px bg-pearl/40" />
      </div>
      <p className="mt-2 text-xs text-ink-300">
        {tone === 'danger' && 'Бюджет превышен: освободите место или увеличьте бюджет в настройках. '}
        {tone === 'warn' && 'Занято больше 80% бюджета. '}
        Отметка на полосе — 80% бюджета.
      </p>
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Максимум символов: показывает счётчик и не даёт ввести больше. */
  limit?: number;
  multiline?: boolean;
  rows?: number;
  type?: 'text' | 'email' | 'password' | 'number';
  autoComplete?: string;
  inputMode?: 'text' | 'decimal' | 'numeric' | 'email';
  required?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** Кнопка рядом с подписью (например, «Сбросить к стандартному»). */
  action?: ReactNode;
  /** Пометка «изменено» рядом с подписью. */
  changed?: boolean;
  name?: string;
  min?: number;
  max?: number;
  step?: number;
}

export function TextField({
  label,
  value,
  onChange,
  limit,
  multiline = false,
  rows = 4,
  type = 'text',
  autoComplete,
  inputMode,
  required,
  disabled,
  hint,
  error,
  action,
  changed = false,
  name,
  min,
  max,
  step,
}: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const countId = `${id}-count`;
  const describedBy = [hint ? hintId : null, error ? errorId : null, limit ? countId : null].filter(Boolean).join(' ');
  const shared = {
    id,
    name,
    value,
    required,
    disabled,
    maxLength: limit,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    className: `${inputClass} ${error ? 'border-danger/70' : ''}`,
  };
  const nearLimit = limit !== undefined && value.length >= limit * 0.9;

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor={id} className="text-sm font-medium text-ink-100">
          {label}
          {changed && <span className="ml-2 text-xs font-semibold text-gold">изменено</span>}
        </label>
        {action}
      </div>
      {multiline ? (
        <textarea {...shared} rows={rows} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...shared}
          type={type}
          autoComplete={autoComplete}
          inputMode={inputMode}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <div className="mt-1 flex items-start justify-between gap-3 text-xs">
        <div className="min-w-0">
          {hint && (
            <p id={hintId} className="text-ink-300">
              {hint}
            </p>
          )}
          {error && (
            <p id={errorId} className="text-danger">
              {error}
            </p>
          )}
        </div>
        {limit !== undefined && (
          <span id={countId} className={`shrink-0 tabular-nums ${nearLimit ? 'text-warn' : 'text-ink-400'}`}>
            <span className="sr-only">Символов: </span>
            {value.length} / {limit}
          </span>
        )}
      </div>
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
          checked ? 'border-gold bg-gold/80' : 'border-ink-500 bg-ink-700'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 left-0.5 size-[1.125rem] rounded-full bg-pearl transition-transform ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </button>
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-sm font-medium text-pearl">
          {label}
        </p>
        {description && (
          <p id={`${id}-description`} className="mt-0.5 text-sm text-ink-200">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
