'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { bootstrap, get } from './api';

export interface Me {
  user: { id: string; name: string; email: string; role: 'platform_owner' | 'tenant_owner' | 'tenant_agent' };
  tenant: { id: string; name: string; status: string; capabilities: Record<string, boolean> } | null;
  permissions: { write: boolean; settings: boolean; billing: boolean; console: boolean };
  impersonating: string | null;
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
