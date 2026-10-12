import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { LoginRequest, LoginResponse, OkResponse, SessionResponse, SetupRequest } from '@shared/api';
import { api, ApiError, errorMessage, setCsrfToken, type ApiRequestOptions } from '@/lib/api';

export type AuthStatus =
  | 'loading' // спрашиваем сервер о сессии
  | 'anonymous' // сессии нет — показываем вход
  | 'authenticated'
  | 'failed'; // сервер не ответил — предлагаем повторить

interface AuthState {
  status: AuthStatus;
  email: string | null;
  setupRequired: boolean;
  /** Почему пользователь оказался на странице входа (например, истекла сессия). */
  notice: string | null;
  error: string | null;
}

export interface AuthContextValue extends AuthState {
  /** Запрос к API админки: любой 401 сбрасывает сессию и возвращает на страницу входа. */
  call: <T>(path: string, options?: ApiRequestOptions) => Promise<T>;
  login: (request: LoginRequest) => Promise<void>;
  setup: (request: SetupRequest) => Promise<void>;
  logout: () => Promise<void>;
  /** Сессия истекла: забыть CSRF-токен и показать вход. */
  expire: () => void;
  recheck: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const initialState: AuthState = {
  status: 'loading',
  email: null,
  setupRequired: false,
  notice: null,
  error: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<SessionResponse>('/api/auth/session', { signal: controller.signal })
      .then((session) => {
        // Токен живёт только в памяти вкладки: ни localStorage, ни sessionStorage.
        setCsrfToken(session.authenticated ? session.csrfToken : null);
        setState({
          status: session.authenticated ? 'authenticated' : 'anonymous',
          email: session.email,
          setupRequired: session.setupRequired,
          notice: null,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ ...initialState, status: 'failed', error: errorMessage(err) });
      });
    return () => controller.abort();
  }, [attempt]);

  const expire = useCallback(() => {
    setCsrfToken(null);
    setState((prev) =>
      prev.status === 'authenticated'
        ? { ...prev, status: 'anonymous', email: null, notice: 'Сессия истекла. Войдите заново.' }
        : prev,
    );
  }, []);

  const call = useCallback(
    async <T,>(path: string, options?: ApiRequestOptions): Promise<T> => {
      try {
        return await api<T>(path, options);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) expire();
        throw err;
      }
    },
    [expire],
  );

  const accept = useCallback((response: LoginResponse) => {
    setCsrfToken(response.csrfToken);
    setState({
      status: 'authenticated',
      email: response.email,
      setupRequired: false,
      notice: null,
      error: null,
    });
  }, []);

  const login = useCallback(
    async (request: LoginRequest) => {
      accept(await api<LoginResponse>('/api/auth/login', { method: 'POST', body: request }));
    },
    [accept],
  );

  const setup = useCallback(
    async (request: SetupRequest) => {
      accept(await api<LoginResponse>('/api/auth/setup', { method: 'POST', body: request }));
    },
    [accept],
  );

  const logout = useCallback(async () => {
    try {
      await api<OkResponse>('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      // 401 значит, что сессии уже нет — это и есть цель выхода. Остальное показываем пользователю.
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    }
    setCsrfToken(null);
    setState({
      status: 'anonymous',
      email: null,
      setupRequired: false,
      notice: 'Вы вышли из панели.',
      error: null,
    });
  }, []);

  const recheck = useCallback(() => {
    setState(initialState);
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, call, login, setup, logout, expire, recheck }),
    [state, call, login, setup, logout, expire, recheck],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth вызван вне AuthProvider');
  return value;
}
