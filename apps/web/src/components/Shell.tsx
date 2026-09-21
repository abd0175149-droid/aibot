'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { post, setToken } from '@/lib/api';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: number;
  /** يُخفى إن لم يملك المستخدم الصلاحيّة — لا يُعرض معطَّلاً. */
  needs?: 'settings' | 'billing' | 'console';
}

export function Shell({
  nav, children, footer,
}: { nav: NavItem[]; children: ReactNode; footer?: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { me, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (!me) { router.replace(`/login?next=${encodeURIComponent(path)}`); return; }

    /* 🔴 مالك المنصّة بلا مستأجر، فكلّ مسار في /app يردّ 403 عليه **بحقّ**:
       المستأجر يُشتقّ من التوكن، وتوكنه بلا tenantId. الخادم كان محقّاً
       والواجهة هي التي أخطأت بإبقائه هناك.
       وحين ينتحل عميلاً يصير له tenant فيُسمح له — ولذلك الشرط على
       وجود المستأجر لا على الدور. */
    if (!me.tenant && path.startsWith('/app')) { router.replace('/console'); return; }
    if (!me.permissions.console && path.startsWith('/console')) router.replace('/app');
  }, [loading, me, path, router]);

  if (loading) {
    return (
      <div className="shell">
        <nav className="side" aria-label="القائمة" />
        <main className="main">
          <div className="skel" style={{ width: 200, height: 22, marginBottom: 18 }} />
          <div className="tiles">
            {[0, 1, 2, 3].map((i) => (
              <div className="tl" key={i}><div className="skel" style={{ width: 70, height: 24 }} /></div>
            ))}
          </div>
        </main>
      </div>
    );
  }
  if (!me) return null;

  const visible = nav.filter((n) => !n.needs || me.permissions[n.needs]);

  async function logout() {
    await post('/auth/logout').catch(() => undefined);
    setToken(null);
    router.replace('/login');
  }

  return (
    <div className="shell">
      <nav className="side" aria-label="القائمة">
        <div className="brand">
          <b>AiBot</b>
          <span>{me.tenant?.name ?? 'لوحة المالك'}</span>
        </div>

        {visible.map((n) => (
          <Link
            key={n.href} href={n.href} className="navi"
            aria-current={path === n.href || path.startsWith(n.href + '/') ? 'page' : undefined}
          >
            <span aria-hidden="true" style={{ width: 16, textAlign: 'center' }}>{n.icon}</span>
            <span>{n.label}</span>
            {n.badge ? <span className="bdg">{n.badge}</span> : null}
          </Link>
        ))}

        <div className="side-foot">
          {footer}
          <div style={{ marginTop: 8 }}>{me.user.name}</div>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={logout}>خروج</button>
        </div>
      </nav>

      <main className="main">
        {me.impersonating && (
          <div className="note w" style={{ marginTop: 0 }}>
            <b>انتحال نشط — قراءةٌ فقط.</b> كلّ فعلٍ كاتبٍ مرفوض، والجلسة 30 دقيقة،
            والأمر مسجَّلٌ <b>ويراه العميل في سجلّه</b>.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

/** الحالات الثلاث التي يجب أن يملكها كلّ عنصر بيانات. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skel" key={i} style={{ marginBottom: 10, width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card">
      <div className="empty">
        <b>{title}</b>
        {hint}
        {action && <div className="act">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="note c" role="alert">
      {message}
      {onRetry && (
        <button className="btn sm" style={{ marginInlineStart: 10 }} onClick={onRetry}>أعِد المحاولة</button>
      )}
    </div>
  );
}
