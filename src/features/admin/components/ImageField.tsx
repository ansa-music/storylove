import { useEffect, useId, useRef, useState, type DragEvent } from 'react';

import { errorMessage } from '@/lib/api';

import { formatBytes } from '../lib/format';
import {
  acceptAttribute,
  checkImageFile,
  describeFormats,
  prepareImage,
  type ImageRules,
  type PreparedImage,
} from '../lib/imageOptimize';
import { ConfirmDialog } from './ConfirmDialog';
import { Notice, Spinner } from './ui';

interface ImageFieldProps {
  title: string;
  hint?: string;
  /** Текущее изображение с сервера. null — используется стандартное из сборки сайта. */
  currentUrl: string | null;
  rules: ImageRules;
  /** До скольких пикселей по длинной стороне уменьшать. null — отправлять файл как есть. */
  maxSide: number | null;
  /** Класс пропорций области предпросмотра, например aspect-video. */
  previewClass?: string;
  onSave: (blob: Blob, contentType: string) => Promise<void>;
  onReset: () => Promise<void>;
}

interface Picked {
  previewUrl: string;
  prepared: PreparedImage;
  fileName: string;
}

/** Выбор изображения с предпросмотром до сохранения, оптимизацией и возвратом к стандартному. */
export function ImageField({
  title,
  hint,
  currentUrl,
  rules,
  maxSide,
  previewClass = 'aspect-video',
  onSave,
  onReset,
}: ImageFieldProps) {
  const inputId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Временная ссылка предпросмотра освобождается при замене и при уходе со страницы.
  useEffect(() => {
    const url = picked?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [picked]);

  const busy = preparing || saving || resetting;

  async function choose(file: File | undefined): Promise<void> {
    if (!file || busy) return;
    setSuccess(null);
    const problem = checkImageFile(file, rules);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setPreparing(true);
    try {
      const prepared = await prepareImage(file, maxSide);
      setPicked({ previewUrl: URL.createObjectURL(prepared.blob), prepared, fileName: file.name });
    } catch (err) {
      setPicked(null);
      setError(errorMessage(err));
    } finally {
      setPreparing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function save(): Promise<void> {
    if (!picked || busy) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(picked.prepared.blob, picked.prepared.contentType);
      setPicked(null);
      setSuccess('Изображение сохранено.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function reset(): Promise<void> {
    setResetting(true);
    setResetError(null);
    try {
      await onReset();
      setConfirmReset(false);
      setPicked(null);
      setSuccess('Возвращено стандартное изображение.');
    } catch (err) {
      setResetError(errorMessage(err));
    } finally {
      setResetting(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragOver(false);
    void choose(event.dataTransfer.files[0]);
  }

  const shownUrl = picked?.previewUrl ?? currentUrl;
  const prepared = picked?.prepared;

  return (
    <div className="min-w-0">
      <h3 className="font-sans text-sm font-semibold tracking-normal text-pearl">{title}</h3>
      {hint && <p className="mt-1 text-xs text-ink-300">{hint}</p>}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`mt-3 overflow-hidden rounded-lg border border-dashed transition-colors ${
          dragOver ? 'border-gold bg-gold/5' : 'border-ink-600 bg-ink-900'
        }`}
      >
        <div className={`relative flex items-center justify-center ${previewClass}`}>
          {shownUrl ? (
            <img src={shownUrl} alt="" className="size-full object-contain" />
          ) : (
            <p className="px-4 text-center text-sm text-ink-300">
              Используется стандартное изображение сайта.
              <br />
              Перетащите сюда файл или выберите его кнопкой ниже.
            </p>
          )}
          {picked && (
            <span className="absolute top-2 left-2 rounded-full border border-gold/50 bg-ink-950/85 px-2.5 py-0.5 text-xs font-semibold text-gold">
              Предпросмотр — ещё не сохранено
            </span>
          )}
          {preparing && (
            <span className="absolute inset-0 flex items-center justify-center gap-3 bg-ink-950/80 text-sm text-ink-100">
              <Spinner /> Готовим изображение…
            </span>
          )}
        </div>
      </div>

      <div id={statusId} aria-live="polite" className="mt-3 space-y-2">
        {prepared && picked && (
          <p className="text-xs text-ink-200">
            <span className="break-all">{picked.fileName}</span>:{' '}
            {prepared.optimized ? (
              <>
                было {formatBytes(prepared.originalBytes)} → стало {formatBytes(prepared.blob.size)}
                {prepared.width && prepared.height
                  ? `, ${prepared.width}×${prepared.height}, WebP`
                  : ', WebP'}
              </>
            ) : (
              <>
                {formatBytes(prepared.originalBytes)}, отправится без изменений
                {prepared.width && prepared.height ? ` (${prepared.width}×${prepared.height})` : ''}
              </>
            )}
          </p>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        {success && !picked && <Notice tone="ok">{success}</Notice>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={acceptAttribute(rules)}
          className="hidden"
          tabIndex={-1}
          aria-label={title}
          disabled={busy}
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        {picked ? (
          <>
            <button type="button" className="btn btn-gold btn-sm" onClick={() => void save()} disabled={busy}>
              {saving && <Spinner className="size-4" />}
              Сохранить
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={busy}
              onClick={() => {
                setPicked(null);
                setError(null);
              }}
            >
              Отмена
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {currentUrl ? 'Заменить' : 'Выбрать файл'}
            <span className="sr-only"> — {title}</span>
          </button>
        )}
        {currentUrl && !picked && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={busy}
            onClick={() => setConfirmReset(true)}
          >
            Вернуть стандартное
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-400">Форматы: {describeFormats(rules)}.</p>

      <ConfirmDialog
        open={confirmReset}
        title="Вернуть стандартное изображение?"
        confirmLabel="Вернуть стандартное"
        danger
        busy={resetting}
        error={resetError}
        onConfirm={() => void reset()}
        onClose={() => {
          setConfirmReset(false);
          setResetError(null);
        }}
      >
        <p>Загруженное изображение «{title}» будет удалено, сайт снова покажет встроенное.</p>
      </ConfirmDialog>
    </div>
  );
}
