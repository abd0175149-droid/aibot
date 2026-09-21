'use client';

import type { ReactNode } from 'react';
import { Shell, type NavItem } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { useSession } from '@/lib/session';

interface Overview {
  windowsUsed: number;
  windowsLimit: number;
  needsAttention: number;
}

/**
 * لوحة العميل.
 *
 * الموظّف يرى الإنبوكس وجهات الاتّصال فقط — والبنود الأخرى **تُخفى** لا
 * تُعرض معطَّلة. عنصرٌ معطَّل يدعو للضغط ويُنتج سؤالاً؛ وعنصرٌ غائب لا يُلاحظ.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const { data } = useApi<Overview>(me ? '/reports/overview' : null);

  const nav: NavItem[] = [
    { href: '/app', label: 'الرئيسيّة', icon: '⌂', needs: 'settings' },
    { href: '/app/inbox', label: 'الإنبوكس', icon: '✉', badge: data?.needsAttention },
    { href: '/app/bot', label: 'البوت', icon: '✦', needs: 'settings' },
    { href: '/app/channels', label: 'القنوات', icon: '⇄', needs: 'settings' },
    { href: '/app/usage', label: 'الاستهلاك', icon: '▤', needs: 'billing' },
  ];

  const pct = data?.windowsLimit ? Math.round((data.windowsUsed / data.windowsLimit) * 100) : 0;

  return (
    <Shell
      nav={nav}
      footer={
        data?.windowsLimit ? (
          <div>
            <span className="num">{data.windowsUsed} / {data.windowsLimit}</span> نافذة
            <div className={`meter ${pct >= 95 ? 'crit' : pct >= 80 ? 'warn' : ''}`}>
              <i style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
          </div>
        ) : null
      }
    >
      {children}
    </Shell>
  );
}
