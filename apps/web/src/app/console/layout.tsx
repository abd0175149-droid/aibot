'use client';

import type { ReactNode } from 'react';
import { Shell, type NavItem } from '@/components/Shell';
import { useApi } from '@/lib/useApi';

const NAV: NavItem[] = [
  { href: '/console', label: 'العملاء', icon: '▦', needs: 'console' },
  { href: '/console/incidents', label: 'الحوادث', icon: '!', needs: 'console' },
  { href: '/console/margin', label: 'الهامش', icon: '%', needs: 'console' },
];

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const inc = useApi<Array<{ id: string; severity: string }>>('/console/incidents');
  const critical = inc.data?.filter((i) => i.severity === 'critical').length ?? 0;
  const nav = NAV.map((n) => (n.href === '/console/incidents' ? { ...n, badge: critical || undefined } : n));

  return (
    <Shell nav={nav} footer={<div>{inc.data?.length ?? 0} حادثة مفتوحة</div>}>
      {children}
    </Shell>
  );
}
