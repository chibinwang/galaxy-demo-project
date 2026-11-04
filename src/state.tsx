import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Product, Settings, StageDef } from '../shared/types';
import { api } from './api';

export interface Meta {
  today: string;
  latestDate: string | null;
  demoData: boolean;
  settings: Settings;
  stages: StageDef[];
  shifts: string[];
  products: Product[];
  downtimeReasons: string[];
  issueTypes: Record<string, string>;
  supervisors: string[];
  counts: Record<string, number>;
}

interface Toast {
  id: number;
  kind: 'success' | 'error';
  text: string;
}

interface AppState {
  meta: Meta | null;
  /** Increments after every data change so pages re-fetch. */
  version: number;
  changed: () => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  toasts: Toast[];
  /** Reporting date shared by Overview, Exceptions and Daily Brief. Defaults to the latest date with data. */
  reportDate: string | null;
  setReportDate: (d: string) => void;
}

const Ctx = createContext<AppState>(null as unknown as AppState);

export function AppProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [chosenDate, setReportDate] = useState<string | null>(null);
  const reportDate = chosenDate ?? meta?.latestDate ?? meta?.today ?? null;

  useEffect(() => {
    api.get<Meta>('/api/meta').then(setMeta).catch(() => setMeta(null));
  }, [version]);

  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const toast = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  return <Ctx.Provider value={{ meta, version, changed, toast, toasts, reportDate, setReportDate }}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);

/** Fetch JSON and re-fetch when the URL or the global data version changes. */
export function useFetch<T>(url: string | null) {
  const { version } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    api
      .get<T>(url)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [url, version, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
