import { useEffect, useState, type FormEvent } from 'react';

import type { AdminFilm, AdminFilmResponse, UpdateFilmRequest } from '@shared/api';
import { TEXT_LIMITS } from '@shared/defaults';
import { errorMessage } from '@/lib/api';

import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toasts';
import { Card, Notice, Spinner, TextField } from '../../components/ui';

type FilmTextKey = 'title' | 'tagline' | 'description' | 'compareText' | 'buttonLabel';

interface FieldSpec {
  key: FilmTextKey;
  label: string;
  hint: string;
  multiline?: boolean;
  required?: boolean;
}

const FIELDS: readonly FieldSpec[] = [
  {
    key: 'title',
    label: 'Название уровня',
    hint: 'Показывается на карточке и на странице просмотра.',
    required: true,
  },
  { key: 'tagline', label: 'Короткая фраза', hint: 'Одна строка под названием уровня.' },
  { key: 'description', label: 'Описание', hint: 'Текст на странице просмотра.', multiline: true },
  {
    key: 'compareText',
    label: 'Текст для сравнения',
    hint: 'Строка в блоке «Сравните четыре уровня».',
    multiline: true,
  },
  { key: 'buttonLabel', label: 'Надпись на кнопке', hint: 'Кнопка перехода к просмотру.', required: true },
];

interface FilmTextFormProps {
  film: AdminFilm;
  onFilmChange: (film: AdminFilm) => void;
}

type Draft = Partial<Record<FilmTextKey, string>>;

/** Тексты уровня. На сервер уходят только изменённые поля. */
export function FilmTextForm({ film, onFilmChange }: FilmTextFormProps) {
  const { call } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valueOf = (key: FilmTextKey): string => draft[key] ?? film[key];
  const dirty = FIELDS.filter((field) => valueOf(field.key) !== film[field.key]);
  const invalid = FIELDS.filter((field) => field.required && valueOf(field.key).trim() === '');
  const hasChanges = dirty.length > 0;

  useEffect(() => {
    if (!hasChanges) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasChanges]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!hasChanges || saving || invalid.length > 0) return;
    const patch: UpdateFilmRequest = {};
    for (const field of dirty) patch[field.key] = valueOf(field.key);
    setSaving(true);
    setError(null);
    try {
      const { film: next } = await call<AdminFilmResponse>(`/api/admin/films/${film.slug}`, {
        method: 'PATCH',
        body: patch,
      });
      onFilmChange(next);
      setDraft({});
      toast.success('Тексты уровня сохранены.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Тексты уровня">
      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-5">
        {FIELDS.map((field) => {
          const value = valueOf(field.key);
          return (
            <TextField
              key={field.key}
              label={field.label}
              value={value}
              onChange={(next) => {
                setDraft((prev) => ({ ...prev, [field.key]: next }));
                setError(null);
              }}
              limit={TEXT_LIMITS[field.key]}
              multiline={field.multiline}
              rows={field.key === 'description' ? 6 : 3}
              required={field.required}
              hint={field.hint}
              error={field.required && value.trim() === '' ? 'Это поле нельзя оставить пустым.' : null}
              changed={value !== film[field.key]}
              disabled={saving}
            />
          );
        })}
        {error && (
          <Notice tone="danger" live>
            {error}
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="btn btn-gold btn-sm"
            disabled={!hasChanges || saving || invalid.length > 0}
          >
            {saving && <Spinner className="size-4" />}
            Сохранить
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={!hasChanges || saving}
            onClick={() => setDraft({})}
          >
            Отмена
          </button>
          <p role="status" className={`text-sm ${hasChanges ? 'text-gold' : 'text-ink-300'}`}>
            {hasChanges ? 'Есть несохранённые изменения' : 'Изменений нет'}
          </p>
        </div>
      </form>
    </Card>
  );
}
