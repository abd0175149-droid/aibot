'use client';

import type { ReactNode } from 'react';
import { Shell, type NavItem } from '@/components/Shell';
import { useApi } from '@/lib/useApi';

const NAV: NavItem[] = [
  { href: '/console', label: 'العملاء', icon: '▦', needs: 'console' },
  { href: '/console/incidents', label: 'الحوادث', icon: '!', needs: 'console' },
  { href: '/console/margin', label: 'الهامش', icon: '%', needs: 'console' },
];

/**
 * ★ الذيل يحمل **ثلاث حالات** لا واحدة.
 *
 *   كان يُرسم `{inc.data?.length ?? 0} حادثة مفتوحة`: فشلُ الجلب وأثناءُ
 *   التحميل كلاهما يُقرأ **«0 حادثة مفتوحة»** — أي أنّ اللحظة التي تكون فيها
 *   المنصّة معطوبةً فعلاً هي بالضبط اللحظة التي يقرأ فيها مالكها أنّ كلّ شيء
 *   هادئ. والشارةُ تختفي معه فلا إشارةَ ثانية. وهذه الكذبةُ نفسها أُزيلت من
 *   داخل شاشة الحوادث وبقيت في القشرة التي تعلو **كلّ** شاشةٍ في اللوحة.
 *
 *   والعدّاد يُشبِع عند سقف الجلب (100 صفّ)، فيُقال «+100» لا «100» — وإلّا
 *   قرأ المالكُ سقفَ الاستعلام رقماً حقيقيّاً.
 */
const FETCH_CAP = 100;

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const inc = useApi<Array<{ id: string; severity: string }>>('/console/incidents');
  const critical = inc.data?.filter((i) => i.severity === 'critical').length ?? 0;
  // الشارةُ لا تُرسم على بياناتٍ غائبة: صفرٌ مجهولٌ ليس صفراً معلوماً
  const nav = NAV.map((n) => (n.href === '/console/incidents'
    ? { ...n, badge: inc.data ? (critical || undefined) : undefined }
    : n));

  const n = inc.data?.length ?? 0;
  const footer = inc.error
    ? <div className="cl-foot bad">تعذّر جلب الحوادث — العدّاد غير معروف</div>
    : !inc.data
      ? <div className="cl-foot muted">…يُجلب عدّاد الحوادث</div>
      : <div className="cl-foot">{n >= FETCH_CAP ? `+${FETCH_CAP}` : n} حادثة مفتوحة</div>;

  return <Shell nav={nav} footer={footer}>{children}</Shell>;
}
