'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { get, ApiError } from './api';
import { useSession } from './session';

/**
 * جلبٌ بالحالات الثلاث.
 * كلّ عنصر بياناتٍ في الواجهة يملك تحميلاً وفراغاً وخطأً — لا دوّامةٌ أبديّة،
 * ولا شاشةٌ بيضاء عند الفشل.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const { me } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!path || !me) return;
    setLoading(true);
    setError(null);
    try {
      const r = await get<T>(path);
      if (alive.current) setData(r);
    } catch (e) {
      if (alive.current) setError(e instanceof ApiError ? e.message : 'تعذّر جلب البيانات.');
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, me, ...deps]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3600);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? <div className="toast" role="status">{msg}</div> : null;
  return { toast: setMsg, node };
}

/** تنسيق موحَّد — أرقام غربيّة في كلّ مكان لأنّ الجداول تُقرأ رقميّاً. */
export const fmt = {
  num: (n: number | string | null | undefined) =>
    n == null ? '—' : Number(n).toLocaleString('en-US'),
  money: (n: number | string | null | undefined, cur = '$') =>
    n == null ? '—' : `${cur}${Number(n).toFixed(Number(n) < 1 ? 5 : 2)}`,
  pct: (n: number) => `${Math.round(n * 100)}%`,
  when: (iso: string | null | undefined) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'الآن';
    if (mins < 60) return `قبل ${mins} د`;
    if (mins < 1440) return `قبل ${Math.round(mins / 60)} س`;
    return new Intl.DateTimeFormat('ar-JO', { day: 'numeric', month: 'short' }).format(d);
  },
  clock: (iso: string | null | undefined) =>
    iso ? new Intl.DateTimeFormat('ar-JO', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '',
  /** مؤقّت النافذة — يُعرض قبل أن يكتب الموظّف لا بعد أن يُرفض. */
  remaining: (iso: string | null | undefined) => {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return null;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h ? `${h} س ${m} د` : `${m} د`;
  },
};
