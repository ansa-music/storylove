import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@shared/constants';
import { Logo } from '@/components/Logo';
import { ApiError, errorMessage } from '@/lib/api';

import { ErrorState, LoadingState, Notice, Spinner, TextField } from '../components/ui';
import { plural } from '../lib/format';
import { useAuth } from './AuthContext';

/** Вход в панель или первичная настройка, если администратора ещё нет. */
export function LoginPage() {
  const auth = useAuth();

  if (auth.status === 'authenticated') return <Navigate to="/admin" replace />;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-obsidian px-4 py-10">
      <title>Вход — панель STORYLOVE</title>
      <meta name="robots" content="noindex, nofollow" />
      <a href="/" aria-label="STORYLOVE — на сайт">
        <Logo />
      </a>
      <div className="mt-8 w-full max-w-md rounded-xl border border-ink-700 bg-ink-850 p-5 shadow-card sm:p-8">
        {auth.status === 'loading' && <LoadingState label="Проверяем сессию…" />}
        {auth.status === 'failed' && (
          <ErrorState message={auth.error ?? 'Не удалось связаться с сервером.'} onRetry={auth.recheck} />
        )}
        {auth.status === 'anonymous' &&
          (auth.setupRequired ? <SetupForm /> : <LoginForm notice={auth.notice} />)}
      </div>
    </main>
  );
}

/** Обратный отсчёт после ответа rate_limited: сколько секунд ещё нельзя повторять. */
function useCooldown(): { secondsLeft: number; start: (seconds: number) => void } {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until <= now) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [until, now]);

  return {
    secondsLeft: Math.max(0, Math.ceil((until - now) / 1000)),
    start: (seconds) => {
      const current = Date.now();
      setNow(current);
      setUntil(current + seconds * 1000);
    },
  };
}

function waitText(seconds: number): string {
  if (seconds >= 120) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')}`;
  }
  return `${seconds} ${plural(seconds, 'секунду', 'секунды', 'секунд')}`;
}

function LoginForm({ notice }: { notice: string | null }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCooldown();

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || cooldown.secondsLeft > 0 || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login({ email: email.trim(), password });
    } catch (err) {
      // Сервер отвечает одним сообщением и не уточняет, что именно неверно.
      setError(errorMessage(err));
      setPassword('');
      if (err instanceof ApiError && err.code === 'rate_limited' && err.retryAfterSeconds) {
        cooldown.start(err.retryAfterSeconds);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="space-y-5">
      <h1 className="text-3xl text-pearl">Вход в панель</h1>
      {notice && <Notice live>{notice}</Notice>}
      <TextField
        label="Email"
        type="email"
        autoComplete="username"
        inputMode="email"
        value={email}
        onChange={setEmail}
        required
        disabled={busy}
      />
      <TextField
        label="Пароль"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        required
        disabled={busy}
      />
      <div aria-live="assertive" className="space-y-2">
        {error && <Notice tone="danger">{error}</Notice>}
        {cooldown.secondsLeft > 0 && (
          <Notice tone="warn">Повторить можно через {waitText(cooldown.secondsLeft)}.</Notice>
        )}
      </div>
      <button
        type="submit"
        className="btn btn-gold w-full"
        disabled={busy || cooldown.secondsLeft > 0 || !email.trim() || !password}
      >
        {busy && <Spinner className="size-4" />}
        Войти
      </button>
    </form>
  );
}

function SetupForm() {
  const { setup } = useAuth();
  const [setupToken, setSetupToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCooldown();

  const longEnough = password.length >= PASSWORD_MIN_LENGTH;
  const tooLong = password.length > PASSWORD_MAX_LENGTH;
  const matches = password === repeat;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit =
    setupToken.trim() !== '' &&
    emailOk &&
    longEnough &&
    !tooLong &&
    matches &&
    !busy &&
    cooldown.secondsLeft === 0;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await setup({ setupToken: setupToken.trim(), email: email.trim(), password });
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === 'rate_limited' && err.retryAfterSeconds) {
        cooldown.start(err.retryAfterSeconds);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="space-y-5">
      <div>
        <h1 className="text-3xl text-pearl">Первичная настройка</h1>
        <p className="mt-2 text-sm text-ink-200">
          Администратора ещё нет. Создайте его: понадобится setup-токен, заданный при развёртывании сайта
          (секрет SETUP_TOKEN). После создания эта форма закроется навсегда.
        </p>
      </div>
      <TextField
        label="Setup-токен"
        type="password"
        autoComplete="off"
        value={setupToken}
        onChange={setSetupToken}
        required
        disabled={busy}
        hint="Используется один раз и нигде не сохраняется."
      />
      <TextField
        label="Email администратора"
        type="email"
        autoComplete="username"
        inputMode="email"
        value={email}
        onChange={setEmail}
        required
        disabled={busy}
        error={email.length > 0 && !emailOk ? 'Похоже, в адресе ошибка.' : null}
      />
      <TextField
        label="Пароль"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        required
        disabled={busy}
        hint={
          <span className={longEnough && !tooLong ? 'text-ok' : undefined}>
            {longEnough && !tooLong
              ? `Длина подходит: ${password.length} ${plural(password.length, 'символ', 'символа', 'символов')}.`
              : `Не короче ${PASSWORD_MIN_LENGTH} символов. Сейчас ${password.length}.`}
          </span>
        }
        error={tooLong ? `Не длиннее ${PASSWORD_MAX_LENGTH} символов.` : null}
      />
      <TextField
        label="Пароль ещё раз"
        type="password"
        autoComplete="new-password"
        value={repeat}
        onChange={setRepeat}
        required
        disabled={busy}
        hint={repeat.length > 0 && matches ? <span className="text-ok">Пароли совпадают.</span> : undefined}
        error={repeat.length > 0 && !matches ? 'Пароли не совпадают.' : null}
      />
      <div aria-live="assertive" className="space-y-2">
        {error && <Notice tone="danger">{error}</Notice>}
        {cooldown.secondsLeft > 0 && (
          <Notice tone="warn">Повторить можно через {waitText(cooldown.secondsLeft)}.</Notice>
        )}
      </div>
      <button type="submit" className="btn btn-gold w-full" disabled={!canSubmit}>
        {busy && <Spinner className="size-4" />}
        Создать администратора
      </button>
    </form>
  );
}
