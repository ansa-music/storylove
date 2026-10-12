import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import { errorMessage } from '@/lib/api';

import { useAuth } from '../auth/AuthContext';

export interface AdminQuery<T> {
  data: T | null;
  /** Текст ошибки последней загрузки; при этом data может хранить прежний ответ. */
  error: string | null;
  loading: boolean;
  reload: () => void;
  /** Подменить данные ответом мутации, чтобы не перезапрашивать. */
  setData: Dispatch<SetStateAction<T | null>>;
}

interface QueryState<T> {
  key: string;
  path: string | null;
  data: T | null;
  error: string | null;
}

/** GET-запрос к API админки с состояниями «загрузка / ошибка / данные» и ручным обновлением. */
export function useAdminQuery<T>(path: string | null): AdminQuery<T> {
  const { call } = useAuth();
  const [nonce, setNonce] = useState(0);
  const key = `${path ?? ''}#${nonce}`;
  const [state, setState] = useState<QueryState<T>>({ key: '', path: null, data: null, error: null });

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    call<T>(path, { signal: controller.signal })
      .then((data) => setState({ key, path, data, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          key,
          path,
          data: prev.path === path ? prev.data : null,
          error: errorMessage(err),
        }));
      });
    return () => controller.abort();
  }, [call, path, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const setData = useCallback<Dispatch<SetStateAction<T | null>>>((action) => {
    setState((prev) => ({
      ...prev,
      data: typeof action === 'function' ? (action as (value: T | null) => T | null)(prev.data) : action,
    }));
  }, []);

  const sameResource = state.path === path;
  return {
    data: sameResource ? state.data : null,
    error: sameResource && state.key === key ? state.error : null,
    loading: path !== null && state.key !== key,
    reload,
    setData,
  };
}
