import { useEffect, useState, type FormEvent } from 'react';

import type { AdminSettingsResponse, SiteSettingKey, SiteSettings } from '@shared/api';
import { DEFAULT_SETTINGS, TEXT_LIMITS } from '@shared/defaults';
import { errorMessage } from '@/lib/api';

import { useAuth } from '../auth/AuthContext';
import { plural } from '../lib/format';
import { useToast } from './Toasts';
import { Card, Notice, Spinner, TextField } from './ui';

/** Ключи настроек со строковым значением. */
export type TextSettingKey = {
  [K in SiteSettingKey]: SiteSettings[K] extends string ? K : never;
}[SiteSettingKey];

export interface TextFieldSpec {
  key: TextSettingKey;
  label: string;
  /** Длинный текст: многострочное поле и больший лимит. */
  long?: boolean;
  required?: boolean;
  hint?: string;
}

export interface TextFieldGroup {
  title: string;
  description?: string;
  fields: readonly TextFieldSpec[];
}

interface TextSettingsFormProps {
  settings: SiteSettings;
  groups: readonly TextFieldGroup[];
  onSaved: (response: AdminSettingsResponse) => void;
}

type Draft = Partial<Record<TextSettingKey, string>>;

/** Форма текстовых настроек: отправляет только изменённые поля и показывает несохранённые изменения. */
export function TextSettingsForm({ settings, groups, onSaved }: TextSettingsFormProps) {
  const { call } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const specs = groups.flatMap((group) => group.fields);
  const valueOf = (key: TextSettingKey): string => draft[key] ?? settings[key];
  const dirty = specs.filter((spec) => valueOf(spec.key) !== settings[spec.key]);
  const invalid = dirty.filter((spec) => spec.required && valueOf(spec.key).trim() === '');
  const hasChanges = dirty.length > 0;

  useEffect(() => {
    if (!hasChanges) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasChanges]);

  function change(key: TextSettingKey, value: string): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!hasChanges || saving || invalid.length > 0) return;
    const patch: Draft = {};
    for (const spec of dirty) patch[spec.key] = valueOf(spec.key);
    setSaving(true);
    setError(null);
    try {
      const response = await call<AdminSettingsResponse>('/api/admin/settings', {
        method: 'PATCH',
        body: patch,
      });
      onSaved(response);
      setDraft({});
      toast.success('Изменения сохранены.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="space-y-6">
      {groups.map((group) => (
        <Card key={group.title} title={group.title} description={group.description}>
          <div className="space-y-5">
            {group.fields.map((spec) => {
              const value = valueOf(spec.key);
              const standard = DEFAULT_SETTINGS[spec.key];
              const empty = spec.required && value.trim() === '';
              return (
                <TextField
                  key={spec.key}
                  label={spec.label}
                  value={value}
                  onChange={(next) => change(spec.key, next)}
                  limit={spec.long ? TEXT_LIMITS.settingLong : TEXT_LIMITS.settingShort}
                  multiline={spec.long}
                  required={spec.required}
                  hint={spec.hint}
                  error={empty ? 'Это поле нельзя оставить пустым.' : null}
                  changed={value !== settings[spec.key]}
                  disabled={saving}
                  action={
                    value !== standard ? (
                      <button
                        type="button"
                        className="text-xs text-ink-300 underline-offset-2 hover:text-gold hover:underline"
                        onClick={() => change(spec.key, standard)}
                        disabled={saving}
                      >
                        Сбросить к стандартному
                        <span className="sr-only"> — {spec.label}</span>
                      </button>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        </Card>
      ))}

      <div className="sticky bottom-0 z-10 -mx-1 rounded-xl border border-ink-600 bg-ink-800/95 p-3 backdrop-blur sm:p-4">
        {error && (
          <Notice tone="danger" live className="mb-3">
            {error}
          </Notice>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className={`text-sm ${hasChanges ? 'text-gold' : 'text-ink-300'}`}>
            {hasChanges
              ? `Не сохранено: ${dirty.length} ${plural(dirty.length, 'поле', 'поля', 'полей')}`
              : 'Все изменения сохранены'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={!hasChanges || saving}
              onClick={() => setDraft({})}
            >
              Отменить изменения
            </button>
            <button
              type="submit"
              className="btn btn-gold btn-sm"
              disabled={!hasChanges || saving || invalid.length > 0}
            >
              {saving && <Spinner className="size-4" />}
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
