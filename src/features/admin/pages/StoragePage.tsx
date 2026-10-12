import { useId, useState } from 'react';

import type {
  AbortStaleResponse,
  StorageCleanupRequest,
  StorageCleanupResponse,
  StorageObjectKind,
  StorageObjectStatus,
  StorageResponse,
} from '@shared/api';
import { errorMessage } from '@/lib/api';

import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toasts';
import {
  Card,
  EmptyState,
  ErrorState,
  inputClass,
  LoadingState,
  PageHeader,
  Spinner,
  StatusBadge,
  UsageBar,
} from '../components/ui';
import { deleteBlockReason, isDeletableStatus, STORAGE_STATUS_LABELS } from '../lib/filmStatus';
import { formatBytes, formatDate, plural } from '../lib/format';
import { useAdminQuery } from '../lib/useAdminQuery';

type Filter = 'all' | StorageObjectStatus;

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'all', label: 'Все объекты' },
  { value: 'active', label: 'Используются сайтом' },
  { value: 'ready', label: 'Не опубликованы' },
  { value: 'archived', label: 'Старые версии' },
  { value: 'orphan', label: 'Не используются' },
  { value: 'uploading', label: 'Загружаются' },
];

const KIND_LABELS: Readonly<Record<StorageObjectKind, string>> = {
  video: 'Видео',
  image: 'Изображение',
  other: 'Другое',
};

export function StoragePage() {
  const { call } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useAdminQuery<StorageResponse>('/api/admin/storage');
  const filterId = useId();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const objects = data?.objects ?? [];
  const visible = filter === 'all' ? objects : objects.filter((object) => object.status === filter);
  // В выборе остаются только существующие объекты, которые по-прежнему можно удалять.
  const chosen = objects.filter((object) => selected.has(object.key) && isDeletableStatus(object.status));
  const chosenBytes = chosen.reduce((sum, object) => sum + object.sizeBytes, 0);
  const deletableVisible = visible.filter((object) => isDeletableStatus(object.status));
  const allVisibleChosen =
    deletableVisible.length > 0 && deletableVisible.every((object) => selected.has(object.key));

  function toggle(key: string, checked: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const object of deletableVisible) {
        if (checked) next.add(object.key);
        else next.delete(object.key);
      }
      return next;
    });
  }

  async function cleanup(): Promise<void> {
    if (chosen.length === 0) return;
    setBusy(true);
    setDialogError(null);
    try {
      const body: StorageCleanupRequest = { keys: chosen.map((object) => object.key), confirm: true };
      const result = await call<StorageCleanupResponse>('/api/admin/storage/cleanup', {
        method: 'POST',
        body,
      });
      setConfirmCleanup(false);
      setSelected(new Set());
      const count = result.deletedKeys.length;
      toast.success(
        `Удалено ${count} ${plural(count, 'объект', 'объекта', 'объектов')}, освобождено ${formatBytes(result.freedBytes)}.`,
      );
      reload();
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function abortStale(): Promise<void> {
    setBusy(true);
    setDialogError(null);
    try {
      const result = await call<AbortStaleResponse>('/api/admin/storage/abort-stale', { method: 'POST' });
      setConfirmAbort(false);
      toast.success(
        result.abortedSessions === 0
          ? 'Просроченных загрузок нет.'
          : `Прервано загрузок: ${result.abortedSessions}. Их части удалены.`,
      );
      reload();
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const summary = data?.summary;

  return (
    <>
      <PageHeader
        title="Хранилище"
        description="Что занимает место и что можно безопасно удалить."
        actions={
          <button type="button" className="btn btn-quiet btn-sm" onClick={reload} disabled={loading}>
            {loading && <Spinner className="size-4" />}
            Обновить
          </button>
        }
      />
      {!data && loading && <LoadingState label="Считаем объекты в хранилище…" />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {summary && (
        <div className="mt-4 space-y-6">
          <Card title="Сводка">
            <UsageBar usedBytes={summary.totalBytes} budgetBytes={summary.budgetBytes} />
            <dl className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {[
                {
                  label: 'Всего',
                  value: summary.totalBytes,
                  note: `${summary.objectCount} ${plural(summary.objectCount, 'объект', 'объекта', 'объектов')}`,
                },
                { label: 'Активные видео', value: summary.activeVideoBytes, note: 'показываются на сайте' },
                {
                  label: 'Неопубликованные',
                  value: summary.readyVideoBytes,
                  note: 'загружены, ждут публикации',
                },
                { label: 'Старые версии', value: summary.archivedVideoBytes, note: 'можно удалить' },
                { label: 'Изображения', value: summary.imageBytes, note: 'постеры, логотип, Hero' },
                { label: 'Не используются', value: summary.orphanBytes, note: 'можно удалить' },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-ink-700 bg-ink-900 p-3">
                  <dt className="text-xs text-ink-300">{item.label}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-pearl">
                    {formatBytes(item.value)}
                  </dd>
                  <dd className="text-xs text-ink-400">{item.note}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-ink-300">
              Бесплатный объём Cloudflare R2 — 10 ГБ-месяц; хранение сверх него оплачивается. Точные тарифы —
              в документации Cloudflare. Бюджет для этой полосы задаётся в настройках.
            </p>
          </Card>

          <Card
            title="Незавершённые загрузки"
            description="Части незавершённой загрузки занимают место, пока загрузку не завершат или не прервут."
            actions={
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={busy}
                onClick={() => {
                  setDialogError(null);
                  setConfirmAbort(true);
                }}
              >
                Прервать просроченные
              </button>
            }
          >
            {summary.incompleteUploads.length === 0 ? (
              <EmptyState>Незавершённых загрузок нет.</EmptyState>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-ink-700">
                <table className="w-full min-w-[38rem] text-left text-sm">
                  <thead className="bg-ink-800 text-xs text-ink-300">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Файл
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Уровень
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Принято частей
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Начата
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Хранится до
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-700">
                    {summary.incompleteUploads.map((session) => (
                      <tr key={session.id}>
                        <th
                          scope="row"
                          className="max-w-[16rem] px-3 py-2.5 font-normal break-all text-pearl"
                        >
                          {session.fileName}
                          <span className="block text-xs text-ink-400">{formatBytes(session.fileSize)}</span>
                        </th>
                        <td className="px-3 py-2.5">{session.filmSlug}</td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {session.uploadedParts.length} из {session.totalParts}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(session.createdAt)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(session.expiresAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card
            title="Объекты"
            description="Удалять отсюда можно только старые версии видео и объекты, которые не используются. Всё, что показывает сайт, защищено."
          >
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <label htmlFor={filterId} className="mb-1.5 block text-sm font-medium text-ink-100">
                  Показать
                </label>
                <select
                  id={filterId}
                  value={filter}
                  onChange={(event) =>
                    setFilter(FILTERS.find((option) => option.value === event.target.value)?.value ?? 'all')
                  }
                  className={`${inputClass} min-w-[14rem]`}
                >
                  {FILTERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                      {option.value === 'all'
                        ? ` (${objects.length})`
                        : ` (${objects.filter((object) => object.status === option.value).length})`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <p role="status" className="text-sm text-ink-200">
                  {chosen.length === 0
                    ? 'Ничего не выбрано'
                    : `Выбрано ${chosen.length}: освободится ${formatBytes(chosenBytes)}`}
                </p>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={chosen.length === 0 || busy}
                  onClick={() => {
                    setDialogError(null);
                    setConfirmCleanup(true);
                  }}
                >
                  Удалить выбранное
                </button>
              </div>
            </div>

            {visible.length === 0 ? (
              <EmptyState>
                {objects.length === 0 ? 'Хранилище пустое.' : 'Объектов с таким статусом нет.'}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-ink-700">
                <table className="w-full min-w-[44rem] text-left text-sm">
                  <thead className="bg-ink-800 text-xs text-ink-300">
                    <tr>
                      <th scope="col" className="w-10 px-3 py-2">
                        <input
                          type="checkbox"
                          className="size-4 accent-gold"
                          aria-label="Выбрать все объекты в списке, которые можно удалить"
                          checked={allVisibleChosen}
                          disabled={deletableVisible.length === 0}
                          onChange={(event) => toggleAllVisible(event.target.checked)}
                        />
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Объект
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Тип
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Размер
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Статус
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Загружен
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-700">
                    {visible.map((object, index) => {
                      const reason = deleteBlockReason(object.status);
                      const reasonId = `${filterId}-reason-${index}`;
                      return (
                        <tr key={object.key} className="align-top">
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              className="size-4 accent-gold disabled:opacity-40"
                              aria-label={`Выбрать ${object.key}`}
                              aria-describedby={reason ? reasonId : undefined}
                              title={reason ?? undefined}
                              checked={selected.has(object.key) && reason === null}
                              disabled={reason !== null}
                              onChange={(event) => toggle(object.key, event.target.checked)}
                            />
                          </td>
                          <th
                            scope="row"
                            className="max-w-[20rem] px-3 py-2.5 font-normal break-all text-pearl"
                          >
                            {object.key}
                            {reason && (
                              <span id={reasonId} className="mt-0.5 block text-xs break-normal text-ink-400">
                                {reason}
                              </span>
                            )}
                          </th>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {KIND_LABELS[object.kind]}
                            {object.filmSlug && (
                              <span className="block text-xs text-ink-400">{object.filmSlug}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                            {formatBytes(object.sizeBytes)}
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge tone={STORAGE_STATUS_LABELS[object.status].tone}>
                              {STORAGE_STATUS_LABELS[object.status].label}
                            </StatusBadge>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(object.uploadedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={confirmCleanup}
        title="Удалить выбранные объекты?"
        confirmLabel={`Удалить и освободить ${formatBytes(chosenBytes)}`}
        danger
        busy={busy}
        error={dialogError}
        onConfirm={() => void cleanup()}
        onClose={() => setConfirmCleanup(false)}
      >
        <p>
          Будет удалено {chosen.length} {plural(chosen.length, 'объект', 'объекта', 'объектов')}, освободится{' '}
          {formatBytes(chosenBytes)}. Восстановить их будет нельзя.
        </p>
        <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 p-3 text-xs">
          {chosen.map((object) => (
            <li key={object.key} className="flex justify-between gap-3">
              <span className="min-w-0 break-all">
                {object.key}{' '}
                <span className="text-ink-400">
                  — {STORAGE_STATUS_LABELS[object.status].label.toLowerCase()}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{formatBytes(object.sizeBytes)}</span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmAbort}
        title="Прервать просроченные загрузки?"
        confirmLabel="Прервать просроченные"
        danger
        busy={busy}
        error={dialogError}
        onConfirm={() => void abortStale()}
        onClose={() => setConfirmAbort(false)}
      >
        <p>
          Загрузки, срок хранения которых истёк, будут прерваны, а их части удалены. Продолжить такие загрузки
          уже нельзя. Загрузки, срок которых ещё не вышел, не затрагиваются.
        </p>
      </ConfirmDialog>
    </>
  );
}
