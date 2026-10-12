import { useState, type FormEvent } from 'react';

import type { AdminSettingsResponse, ChangePasswordRequest, OkResponse, SiteSettings } from '@shared/api';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type SiteImageKind } from '@shared/constants';
import { errorMessage } from '@/lib/api';

import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ImageField } from '../components/ImageField';
import { TextSettingsForm, type TextFieldGroup } from '../components/TextSettingsForm';
import { useToast } from '../components/Toasts';
import { Card, ErrorState, LoadingState, Notice, PageHeader, Spinner, Switch, TextField } from '../components/ui';
import { BRAND_RULES, RASTER_RULES, type ImageRules } from '../lib/imageOptimize';
import { useAdminQuery } from '../lib/useAdminQuery';

const TEXT_GROUPS: readonly TextFieldGroup[] = [
  {
    title: 'Студия',
    fields: [
      { key: 'studioName', label: 'Имя студии', required: true, hint: 'Показывается в шапке, футере и рядом с логотипом.' },
      { key: 'logoTagline', label: 'Подпись логотипа', hint: 'Мелкая строка под именем студии.' },
    ],
  },
  {
    title: 'Поисковики и соцсети',
    description: 'Заголовок и описание страницы в результатах поиска и при отправке ссылки.',
    fields: [
      { key: 'metaTitle', label: 'Meta title', required: true, hint: 'Поисковики обычно показывают до 60 символов.' },
      { key: 'metaDescription', label: 'Meta description', long: true, hint: 'Поисковики обычно показывают до 160 символов.' },
    ],
  },
];

interface SiteImageSpec {
  kind: SiteImageKind;
  title: string;
  hint: string;
  rules: ImageRules;
  maxSide: number | null;
  previewClass: string;
}

const SITE_IMAGES: readonly SiteImageSpec[] = [
  {
    kind: 'logo',
    title: 'Логотип',
    hint: 'PNG или WebP с прозрачным фоном либо SVG. SVG сохраняется как есть, без перекодирования.',
    rules: BRAND_RULES,
    maxSide: 1024,
    previewClass: 'h-40',
  },
  {
    kind: 'favicon',
    title: 'Favicon',
    hint: 'Значок вкладки браузера: квадратный PNG от 180 px или SVG. Сохраняется без изменений.',
    rules: BRAND_RULES,
    maxSide: null,
    previewClass: 'h-40',
  },
  {
    kind: 'hero',
    title: 'Изображение Hero',
    hint: 'Фон первого экрана. Горизонтальное, от 2560 px по ширине.',
    rules: RASTER_RULES,
    maxSide: 2560,
    previewClass: 'aspect-video',
  },
  {
    kind: 'og',
    title: 'Превью для соцсетей',
    hint: 'Картинка ссылки в мессенджерах: 1200×630, JPG или PNG. Сохраняется без перекодирования — не все соцсети понимают WebP.',
    rules: RASTER_RULES,
    maxSide: null,
    previewClass: 'aspect-[1200/630]',
  },
];

export function SettingsPage() {
  const { call } = useAuth();
  const { data, error, loading, reload, setData } = useAdminQuery<AdminSettingsResponse>('/api/admin/settings');

  async function saveImage(kind: SiteImageKind, blob: Blob, contentType: string): Promise<void> {
    setData(await call<AdminSettingsResponse>(`/api/admin/settings/image/${kind}`, { method: 'PUT', body: blob, contentType }));
  }
  async function resetImage(kind: SiteImageKind): Promise<void> {
    setData(await call<AdminSettingsResponse>(`/api/admin/settings/image/${kind}`, { method: 'DELETE' }));
  }

  return (
    <>
      <PageHeader title="Настройки" description="Имя студии, изображения сайта, видимость, бюджет хранилища и пароль." />
      {!data && loading && <LoadingState label="Загружаем настройки…" />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {data && (
        <div className="mt-4 space-y-6">
          <VisibilityCard settings={data.settings} onSaved={setData} />
          <TextSettingsForm settings={data.settings} groups={TEXT_GROUPS} onSaved={setData} />

          <Card title="Изображения сайта" description="Сначала предпросмотр — на сайт изображение попадает только после кнопки «Сохранить».">
            <div className="grid gap-8 md:grid-cols-2">
              {SITE_IMAGES.map((spec) => (
                <ImageField
                  key={spec.kind}
                  title={spec.title}
                  hint={spec.hint}
                  currentUrl={data.images[spec.kind]}
                  rules={spec.rules}
                  maxSide={spec.maxSide}
                  previewClass={spec.previewClass}
                  onSave={(blob, type) => saveImage(spec.kind, blob, type)}
                  onReset={() => resetImage(spec.kind)}
                />
              ))}
            </div>
          </Card>

          <BudgetCard key={data.settings.storageBudgetGb} settings={data.settings} onSaved={setData} />
          <PasswordCard />
        </div>
      )}
    </>
  );
}

interface SettingsCardProps {
  settings: SiteSettings;
  onSaved: (response: AdminSettingsResponse) => void;
}

function VisibilityCard({ settings, onSaved }: SettingsCardProps) {
  const { call } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  async function save(siteVisible: boolean): Promise<void> {
    setBusy(true);
    setDialogError(null);
    try {
      const body: Partial<SiteSettings> = { siteVisible };
      onSaved(await call<AdminSettingsResponse>('/api/admin/settings', { method: 'PATCH', body }));
      setConfirm(false);
      toast.success(siteVisible ? 'Сайт открыт для посетителей.' : 'Сайт закрыт: посетители видят «Скоро открытие».');
    } catch (err) {
      if (siteVisible) toast.error(errorMessage(err));
      else setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Видимость сайта">
      <Switch
        checked={settings.siteVisible}
        disabled={busy}
        label={settings.siteVisible ? 'Сайт открыт для посетителей' : 'Сайт закрыт'}
        description={
          settings.siteVisible
            ? 'Посетители видят главную страницу, уровни и мультфильмы.'
            : 'Вместо сайта посетители видят экран «Скоро открытие». Панель управления продолжает работать, данные не удаляются.'
        }
        onChange={(next) => {
          if (next) void save(true);
          else {
            setDialogError(null);
            setConfirm(true);
          }
        }}
      />
      <ConfirmDialog
        open={confirm}
        title="Закрыть сайт для посетителей?"
        confirmLabel="Закрыть сайт"
        busy={busy}
        error={dialogError}
        onConfirm={() => void save(false)}
        onClose={() => setConfirm(false)}
      >
        <p>
          Все посетители вместо сайта увидят экран «Скоро открытие». Мультфильмы, изображения и тексты сохранятся; сайт
          можно открыть обратно этим же переключателем.
        </p>
      </ConfirmDialog>
    </Card>
  );
}

const BUDGET_MIN = 1;
const BUDGET_MAX = 100_000;

function BudgetCard({ settings, onSaved }: SettingsCardProps) {
  const { call } = useAuth();
  const toast = useToast();
  const [value, setValue] = useState(String(settings.storageBudgetGb));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(value.replace(',', '.'));
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= BUDGET_MIN && parsed <= BUDGET_MAX;
  const changed = valid && parsed !== settings.storageBudgetGb;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!changed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: Partial<SiteSettings> = { storageBudgetGb: parsed };
      onSaved(await call<AdminSettingsResponse>('/api/admin/settings', { method: 'PATCH', body }));
      toast.success('Бюджет хранилища сохранён.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Бюджет хранилища"
      description="Объём, относительно которого панель показывает заполнение и предупреждения. На само хранилище не влияет: загрузку он не ограничивает."
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-wrap items-start gap-3">
        <div className="w-full max-w-[14rem]">
          <TextField
            label="Бюджет, ГБ"
            value={value}
            onChange={(next) => {
              setValue(next);
              setError(null);
            }}
            inputMode="decimal"
            disabled={saving}
            error={valid ? error : `Введите число от ${BUDGET_MIN} до ${BUDGET_MAX.toLocaleString('ru-RU')}.`}
          />
        </div>
        <button type="submit" className="btn btn-gold btn-sm mt-7" disabled={!changed || saving}>
          {saving && <Spinner className="size-4" />}
          Сохранить
        </button>
      </form>
      <p className="mt-2 text-xs text-ink-300">
        Бесплатный объём Cloudflare R2 — 10 ГБ-месяц; хранение сверх него оплачивается. Точные тарифы — в документации
        Cloudflare.
      </p>
    </Card>
  );
}

function PasswordCard() {
  const { call } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const longEnough = next.length >= PASSWORD_MIN_LENGTH;
  const matches = next === repeat;
  const differs = next !== current;
  const canSubmit = current.length > 0 && longEnough && matches && differs && !saving;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    setDone(false);
    try {
      const body: ChangePasswordRequest = { currentPassword: current, newPassword: next };
      await call<OkResponse>('/api/admin/account/password', { method: 'POST', body });
      setCurrent('');
      setNext('');
      setRepeat('');
      setDone(true);
      toast.success('Пароль изменён.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Смена пароля">
      <form onSubmit={(event) => void submit(event)} noValidate className="max-w-md space-y-4">
        <TextField
          label="Текущий пароль"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={setCurrent}
          limit={undefined}
          disabled={saving}
          required
        />
        <TextField
          label="Новый пароль"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={setNext}
          disabled={saving}
          required
          hint={`Не короче ${PASSWORD_MIN_LENGTH} символов и не длиннее ${PASSWORD_MAX_LENGTH}.`}
          error={
            next.length > 0 && !longEnough
              ? `Сейчас ${next.length} из ${PASSWORD_MIN_LENGTH} символов.`
              : next.length > 0 && !differs
                ? 'Новый пароль совпадает с текущим.'
                : null
          }
        />
        <TextField
          label="Новый пароль ещё раз"
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={setRepeat}
          disabled={saving}
          required
          error={repeat.length > 0 && !matches ? 'Пароли не совпадают.' : null}
        />
        {error && (
          <Notice tone="danger" live>
            {error}
          </Notice>
        )}
        {done && (
          <Notice tone="ok" live>
            Пароль изменён. В следующий раз входите с новым паролем.
          </Notice>
        )}
        <button type="submit" className="btn btn-gold btn-sm" disabled={!canSubmit}>
          {saving && <Spinner className="size-4" />}
          Сменить пароль
        </button>
      </form>
    </Card>
  );
}
