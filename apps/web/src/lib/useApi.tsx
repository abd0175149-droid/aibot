'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, ApiError } from './api';
import { useSession } from './session';

/**
 * جلبٌ بالحالات الثلاث.
 * كلّ عنصر بياناتٍ في الواجهة يملك تحميلاً وفراغاً وخطأً — لا دوّامةٌ أبديّة،
 * ولا شاشةٌ بيضاء عند الفشل.
 *
 * 🔴 علّةٌ كلّفت حلقةَ طلبٍ لا نهائيّة في أوّل تشغيلٍ حقيقيّ:
 *    كانت `deps: unknown[] = []` تُنشئ **مصفوفةً جديدة في كلّ رسم**، فيُعيد
 *    `useCallback` بناء `load`، فيُعيد `useEffect` الجلب، فتتغيّر الحالة،
 *    فيُعاد الرسم — ودار الأمر بلا توقّف. ولم تظهر في أيّ اختبارٍ لأنّها
 *    تحتاج شجرةً حقيقيّة تُعاد رسمها.
 *    الحلّ: مفتاحٌ **نصّيّ** مستقرّ بدل هويّة المصفوفة، و`me.user.id` بدل
 *    كائن `me` كاملاً (وهو أيضاً يتغيّر هويّةً مع كلّ تحديثٍ للجلسة).
 */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const { me } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const alive = useRef(true);

  const depKey = useMemo(() => JSON.stringify(deps), [deps]);
  const userId = me?.user.id ?? null;

  const load = useCallback(async () => {
    if (!path || !userId) return;
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
  }, [path, userId, depKey]);

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

/**
 * تنسيق موحَّد.
 *
 * ★ **`ar-JO` وحدها تُخرج أرقاماً هنديّة** — «٣:٤٥ م» و«٢٠ أيلول» — وهو نقضٌ
 *   مباشر لقيدٍ ثابتٍ في هذا المشروع: أرقام لاتينيّة 0-9 في كلّ مكان، لأنّ
 *   الهنديّة تكسر المحاذاة الرقميّة في الجداول. الامتداد `-u-nu-latn` يُصلحها.
 *
 * ★ والإصلاح **هنا لا في مواضع الاستدعاء**: `Intl` يتسرّب من كلّ نداءٍ جديدٍ
 *   يُكتب بعد ستّة أشهر، ونقطةُ عنقٍ واحدة تمنع ذلك بنيويّاً. ولذلك
 *   `AR_LOCALE` ثابتٌ مصدَّر: من يحتاج `Intl` يأخذه منها.
 */
export const AR_LOCALE = 'ar-JO-u-nu-latn';

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
    return new Intl.DateTimeFormat(AR_LOCALE, { day: 'numeric', month: 'short' }).format(d);
  },
  clock: (iso: string | null | undefined) =>
    iso ? new Intl.DateTimeFormat(AR_LOCALE, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '',
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
