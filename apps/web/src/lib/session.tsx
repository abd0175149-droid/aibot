'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { bootstrap, get, watchExpired, watchResumed } from './api';
import { SessionGate } from '@/components/SessionGate';

export interface Me {
  user: {
    id: string; name: string; email: string;
    role: 'platform_owner' | 'tenant_owner' | 'tenant_agent';
    /** ★ كلمةٌ مؤقّتةٌ يعرفها من عيّنها — والقشرةُ تحبس صاحبَها في شاشة التغيير. */
    mustChangePassword: boolean;
  };
  tenant: { id: string; name: string; status: string; capabilities: Record<string, boolean> } | null;
  permissions: { write: boolean; settings: boolean; billing: boolean; console: boolean };
  impersonating: string | null;
  /** أجلُ الانتحال (ISO) — القشرةُ تعدّ تنازليّاً وتخرج قبله بقليل. */
  impersonationExpiresAt: string | null;
  /**
   * ★ حالةُ العامل الثاني — ثلاثٌ لا علَمٌ ثنائيّ.
   *  · `pending` لم يُسجّل بعد ⟶ شاشةُ التسجيل.
   *  · `stale`   سجَّل وهذا التوكن لم يخطُ الخطوةَ الثانية ⟶ دخولٌ من جديد.
   *  · `ok`      اللوحة مفتوحة.
   * وجمعُ الأوّلَين في `false` يقول لمن سجَّل «سجِّل» — وتلك أسرعُ طريقٍ إلى
   * إطفاء الميزة.
   */
  mfa: 'ok' | 'stale' | 'pending';
}

interface Ctx {
  me: Me | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const SessionCtx = createContext<Ctx>({ me: null, loading: true, reload: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * ★★★ **انتهاءُ الجلسة صار لوحاً فوق الشاشة لا تحميلاً يمحوها.**
   *
   *   `api.ts` كان يكتب `location.href` عند فشل التجديد، فيضيع كلُّ ما كُتب
   *   ولم يُحفَظ — ومن استقصاءٍ في الخلفيّة غالباً، أي على من لم يلمس شيئاً.
   */
  const [expired, setExpired] = useState(false);

  /* ★ وتبويبٌ آخر يستأنف الجلسة يُزيل اللوحَ هنا: الكوكي مشتركٌ بين
     التبويبات، فبلا هذا يبقى لوحٌ ميّتٌ فوق جلسةٍ حيّة لا مخرجَ منه إلّا
     إعادةُ كتابة الكلمة (فتُنشأ جلسةٌ زائدة) أو الخروج. */
  useEffect(() => watchExpired(() => setExpired(true)), []);
  useEffect(() => watchResumed(() => setExpired(false)), []);

  const load = async () => {
    try {
      // الجلسة تُستأنف من كوكي التحديث — لا توكن في التخزين المحلّيّ
      if (await bootstrap()) setMe(await get<Me>('/me'));
      else setMe(null);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <SessionCtx.Provider value={{ me, loading, reload: load }}>
      {children}
      {/* ⚠️ البوّابةُ **بعد** الأبناء في الشجرة: `position: fixed` تُغطّيهم
          وهم باقون مرسومين — وهذا كلُّ الغرض. ولا تُرسم قبل أن نعرف من هو،
          فبريدُه هو ما تستأنف به الجلسة. */}
      {expired && me && (
        <SessionGate email={me.user.email} onDone={() => { setExpired(false); void load(); }} />
      )}
    </SessionCtx.Provider>
  );
}

export const useSession = () => useContext(SessionCtx);

/**
 * الصلاحيّة تُفحص في الواجهة **للعرض فقط**.
 * الفحص الحقيقيّ في الخادم — إخفاء زرٍّ ليس أماناً، وإظهاره ليس ثغرة.
 */
export function useCan(): Me['permissions'] & { readOnly: boolean } {
  const { me } = useSession();
  const p = me?.permissions ?? { write: false, settings: false, billing: false, console: false };
  return { ...p, readOnly: Boolean(me?.impersonating) };
}
