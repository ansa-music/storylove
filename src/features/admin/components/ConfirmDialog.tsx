import { useEffect, useId, useRef, type ReactNode } from 'react';

import { Spinner } from './ui';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Опасное действие (удаление): кнопка подтверждения красная. */
  danger?: boolean;
  /** Идёт запрос: кнопки заблокированы, окно нельзя закрыть. */
  busy?: boolean;
  /** Ошибка выполнения — показывается внутри окна. */
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Подтверждение на нативном <dialog>: браузер сам держит фокус внутри окна,
 * закрывает по Esc и возвращает фокус на кнопку, с которой окно открыли.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Отмена',
  danger = false,
  busy = false,
  error = null,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        // Esc: пока идёт запрос, окно остаётся открытым.
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        // Щелчок по затемнению вокруг окна.
        if (event.target === ref.current && !busy) onClose();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-ink-600 bg-ink-850 p-0 text-pearl shadow-card backdrop:bg-ink-950/80"
    >
      {open && (
        <div className="p-5 sm:p-6">
          <h2 id={titleId} className="font-sans text-lg font-semibold tracking-normal text-pearl">
            {title}
          </h2>
          <div id={bodyId} className="mt-3 space-y-3 text-sm text-ink-100">
            {children}
          </div>
          {error && (
            <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} disabled={busy} autoFocus>
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-gold'}`}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy && <Spinner className="size-4" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
