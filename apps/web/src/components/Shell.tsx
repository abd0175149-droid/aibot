'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { bootstrap, post, setToken } from '@/lib/api';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Skeleton, Note, Button } from '@/components/ui';

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
  const { me, loading, reload } = useSession();

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
        <main className="main"><Skeleton rows={5} /></main>
      </div>
    );
  }
  if (!me) return null;

  const visible = nav.filter((n) => !n.needs || me.permissions[n.needs]);

  /**
   * ★ شاشةٌ مثبَّتة: الصفحة نفسها لا تمرّ، والتمرير داخل ألواحها وحدها.
   *
   * العطل الذي وُلد منه هذا: الإنبوكس كان يخمّن ارتفاعه بـ
   * `calc(100vh - 150px)` داخل حاوٍ بحشو، فينتج **تمريران متداخلان** —
   * وأسوأ: المُنشئ وشريط التدخّل يُدفعان خارج الصندوق فيختفيان تماماً.
   * والتثبيت يُلغي السبب من أصله: لا ارتفاعَ يُخمَّن ولا حشوَ يُطرح.
   */
  const pinned = path === '/app/inbox';

  /* ★ بندٌ نشطٌ **واحد**. كان الشرط `path === href || path.startsWith(href + '/')`،
     و`/app/inbox` يبدأ بـ`/app/` — فكان بندان يُوسمان aria-current معاً،
     ويُضاءان معاً. الصحيح أطول بادئةٍ مطابقة وحدها. */
  const activeHref = visible
    .filter((n) => path === n.href || path.startsWith(n.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

  async function logout() {
    await post('/auth/logout').catch(() => undefined);
    setToken(null);
    router.replace('/login');
  }

  /**
   * إنهاء الانتحال.
   *
   * لا نقطةَ نهايةٍ جديدة ولا حاجة: توكن الانتحال يحمل مطالبة `imp`، و
   * `/auth/refresh` يوقّع توكناً جديداً من **جلستك أنت** بـ`sub` و`tid`
   * و`role` وحدها — بلا `imp`. فاستئناف الجلسة هو الخروج بعينه.
   *
   * وإن فشل التجديد فالجلسة نفسها انتهت، والمخرج الصادق هو صفحة الدخول
   * لا شاشةٌ عالقةٌ بزرٍّ لا يفعل شيئاً.
   */
  async function leaveImpersonation() {
    if (await bootstrap()) {
      await reload();
      router.replace('/console/tenants');
    } else {
      setToken(null);
      router.replace('/login');
    }
  }

  return (
    <div className={`shell${pinned ? ' pinned' : ''}`}>
      <nav className="side" aria-label="القائمة">
        <div className="brand">
          <b>AiBot</b>
          <span>{me.tenant?.name ?? 'لوحة المالك'}</span>
        </div>

        {visible.map((n) => (
          <Link
            key={n.href} href={n.href} className="navi"
            aria-current={n.href === activeHref ? 'page' : undefined}
          >
            <span aria-hidden="true" className="navi-i">{n.icon}</span>
            <span>{n.label}</span>
            {n.badge ? <span className="bdg">{n.badge}</span> : null}
          </Link>
        ))}

        {/* ★ كان هذا الذيل كلّه `display:none` تحت 700px — ومعه **زرّ الخروج
            الوحيد في التطبيق** وعدّاد السقف واسم الحساب. أي أنّه لم تكن هناك
            طريقةُ خروجٍ من الهاتف إطلاقاً. صار يبقى ظاهراً ويلتفّ. */}
        <div className="side-foot">
          {footer}
          <ThemeToggle compact />
          <div className="side-user">{me.user.name}</div>
          <Button size="sm" onClick={() => void logout()}>خروج</Button>
        </div>
      </nav>

      <main className={`main${pinned ? ' pinned' : ''}`}>
        {me.impersonating && (
          <Note tone="warn">
            <b>انتحال نشط — قراءةٌ فقط.</b> كلّ فعلٍ كاتبٍ مرفوض، والجلسة 30 دقيقة،
            والأمر مسجَّلٌ <b>ويراه العميل في سجلّه</b>.
            {/* ★ كانت اللافتة تُخبر بالحبس ولا تدلّ على بابٍ للخروج: لا زرّ
                ولا رابط، فالمخرج الوحيد تسجيل خروجٍ كامل أو انتظار ثلاثين
                دقيقة. ومن لا يعرف أنّه منتحِل يقرأ «حسابك للقراءة فقط» على
                كلّ زرٍّ ويظنّ حسابه معطوباً — وهذا ما حدث بالضبط.
                و`/auth/refresh` يوقّع توكناً جديداً بلا `imp` أصلاً
                (auth.ts)، فالخروج استئنافُ جلستك أنت لا نقطةَ نهايةٍ جديدة. */}
            <Button size="sm" onClick={() => void leaveImpersonation()}>
              إنهاء الانتحال والعودة لحسابي
            </Button>
          </Note>
        )}
        {children}
      </main>
    </div>
  );
}

/**
 * ★ الحالات الثلاث كانت مُعرَّفةً **مرّتين بمنطقين مختلفين**: هنا داخل بطاقة
 *   وبـ`.note c`، وفي `ui/index.tsx` بلا بطاقة وبـ`.errbox`. فالخطأ في شاشةٍ
 *   صندوقٌ أحمر بعنوان وفي أخرى شريطٌ مائل، ولا يعرف المستخدم أنّهما الشيء
 *   نفسه. التعريف الآن واحد، وهذه إعادةُ تصديرٍ تُبقي الاستيرادات القديمة عاملة.
 */
export { Skeleton as Loading, Empty, ErrorBox } from '@/components/ui';
