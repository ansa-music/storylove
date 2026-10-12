import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { api } from '@/lib/api';

import { defaultSiteData, normalizeSiteResponse, type SiteData } from './siteData';

export type SiteDataStatus = 'loading' | 'ready' | 'error';

export interface SiteDataValue extends SiteData {
  status: SiteDataStatus;
}

const SiteDataContext = createContext<SiteDataValue>({ ...defaultSiteData(), status: 'loading' });

// Один запрос на приложение: провайдер может смонтироваться повторно
// (StrictMode, возврат из админки) — ответ переиспользуется.
let sitePromise: Promise<SiteData | null> | null = null;

function loadSiteData(): Promise<SiteData | null> {
  if (!sitePromise) {
    sitePromise = api<unknown>('/api/public/site')
      .then(normalizeSiteResponse)
      .catch(() => {
        // Сервер недоступен — сайт остаётся на значениях по умолчанию;
        // следующая загрузка страницы попробует снова.
        sitePromise = null;
        return null;
      });
  }
  return sitePromise;
}

export function SiteDataProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<SiteDataValue>(() => ({ ...defaultSiteData(), status: 'loading' }));

  useEffect(() => {
    let cancelled = false;
    void loadSiteData().then((data) => {
      if (cancelled) return;
      setValue(data ? { ...data, status: 'ready' } : { ...defaultSiteData(), status: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <SiteDataContext.Provider value={value}>{children}</SiteDataContext.Provider>;
}

export function useSiteData(): SiteDataValue {
  return useContext(SiteDataContext);
}
