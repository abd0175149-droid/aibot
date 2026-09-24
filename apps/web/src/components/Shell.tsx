'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { useVisualViewport } from '@/lib/viewport';
import { bootstrap, post, setToken } from '@/lib/api';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PushToggle } from '@/components/PushToggle';
import { Skeleton, Note, Button, Sheet } from '@/components/ui';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: number;
  /** يُخفى إن لم يملك المستخدم الصلاحيّة — لا يُعرض معطَّلاً. */
  needs?: 'settings' | 'billing' | 'console';
}

/**
 * ★ سقف الهاتف: **خمسة بنودٍ** لا أكثر.
 *
 * الرقم ليس ذوقاً: شريطٌ بعرض 390 بكسلاً مقسوماً على ستّةٍ يعطي 62 بكسلاً
 * للبند — أضيقُ من أرضيّة اللمس (44) بعد الحشو، وأضيقُ من أن تُقرأ فيه كلمة.
 * والخامسُ **مِصرف**: زرُّ «المزيد» يبتلع ما زاد عن أربعةٍ ويفتحه في ورقةٍ
 * صاعدة. فلوحةُ العميل (خمسة بنود) تصير أربعةً + مِصرفاً يحمل «الاستهلاك»،
 * ولوحةُ المالك (ثلاثة) تبقى ثلاثةً + مِصرفاً يحمل الحساب وحده.
 *
 * والمِصرف موجودٌ **على كلّ عرض** لا على الهاتف وحده: هو مسكن الحساب
 * (الاسم · النمط · الخروج)، وحذفُه فوق 1100 يعني شجرتَين تتبادلان الظهور —
 * وهو بالضبط ما يمنعه الاتّجاه المعتمَد.
 */
const SLOTS = 5;

export function Shell({
  nav, children, footer,
}: { nav: NavItem[]; children: ReactNode; footer?: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { me, loading, reload } = useSession();

  /* ★ الإطارُ ينكمش فوق لوحة مفاتيح الهاتف بدل أن يختفي تحتها.
     و`100dvh` لا تعرف اللوحة — تعرف شريطَ العنوان وحده. */
  useVisualViewport();

  /* ★ ورقةُ «المزيد» — الحالةُ الوحيدة في القشرة. ولا تفرّعَ على العرض معها:
     نفسُ الزرّ ونفسُ الورقة في النقاط الثلاث، وCSS وحده يقرّر أين تظهر. */
  const [more, setMore] = useState(false);

  /**
   * ★ المُمرِّر صار `.main` لا النافذة.
   *
   * وهذا يُبطل تمريرَ المتصفّح التلقائيّ إلى الأعلى عند تغيير المسار: الموجِّه
   * يمرّر `window`، و`window` لا يمرّ. فمن ينتقل من أسفل جدولٍ طويلٍ إلى شاشةٍ
   * أخرى يجدها **مفتوحةً في وسطها** — وهو عطلٌ يُقرأ «الصفحة لم تُحمَّل».
   */
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    /* والورقةُ تُغلق مع الانتقال: بندٌ في «المزيد» يُوصِل إلى شاشةٍ، فلو بقيت
       مفتوحةً لغطّت الشاشةَ التي طلبها المستخدم بالضبط. */
    setMore(false);
  }, [path]);

  /* Escape يُغلق: حوارٌ `aria-modal` بلا مخرجٍ من لوحة المفاتيح مصيدة. */
  useEffect(() => {
    if (!more) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [more]);

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
    /* الهيكلُ يحمل **نفس مناطق الإطار الثلاث**: لو رُسم بشبكةٍ أخرى لقفز
       الرصيفُ والترويسةُ لحظةَ وصول الجلسة. */
    return (
      <div className="shell">
        <header className="shell-top"><div className="brand"><b>AiBot</b></div></header>
        <main className="main"><Skeleton rows={5} /></main>
        <nav className="side" aria-label="القائمة" />
      </div>
    );
  }
  if (!me) return null;

  const visible = nav.filter((n) => !n.needs || me.permissions[n.needs]);

  /**
   * ★ شاشةٌ مثبَّتة: الصفحة نفسها لا تمرّ، والتمرير داخل ألواحها وحدها.
   *
   * وقد صار هذا **سلوكَ الإطار كلّه** لا استثناءَ شاشةٍ: `.shell` ارتفاعُها
   * `100dvh` والرصيفُ صفٌّ فيها، فالمُمرِّر `.main` وحده. وما بقي لـ`.pinned`
   * عملٌ واحد: تُلغي تمريرَ `.main` وحشوَه فيملأ الإنبوكس المنطقة بلوحَيه.
   */
  const pinned = path === '/app/inbox';

  /* ★ بندٌ نشطٌ **واحد**. كان الشرط `path === href || path.startsWith(href + '/')`،
     و`/app/inbox` يبدأ بـ`/app/` — فكان بندان يُوسمان aria-current معاً،
     ويُضاءان معاً. الصحيح أطول بادئةٍ مطابقة وحدها. */
  const activeHref = visible
    .filter((n) => path === n.href || path.startsWith(n.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

  /* التقسيم حسابٌ على طول القائمة لا على عرض الشاشة: `SLOTS - 1` لأنّ
     المِصرفَ نفسه يحتلّ خانة. ولا `matchMedia` ولا `innerWidth` في الملفّ. */
  const primary = visible.length > SLOTS - 1 ? visible.slice(0, SLOTS - 1) : visible;
  const rest = visible.slice(primary.length);
  /* شارةُ المِصرف مجموعُ ما خلفه: عددٌ مخفيٌّ وراء قائمةٍ لم يُبلَّغ. */
  const restBadge = rest.reduce((s, n) => s + (n.badge ?? 0), 0);

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
      {/* ══════ الترويسة: الهويّة والحالة — تُقرأ ولا تُضغط كلّ دقيقة ══════ */}
      <header className="shell-top">
        <div className="brand">
          <b>AiBot</b>
          <span>{me.tenant?.name ?? 'لوحة المالك'}</span>
        </div>
        {/* ★ عدّاد السقف صعد إلى الترويسة، ومكانُه هذا قرارٌ لا ترتيب: رقمٌ
            يقول «قاربتَ السقف» لا يجوز أن يسكن قائمةً تُفتح — وإلّا وصل
            الخبرُ بعد الحدّ. وهو ظاهرٌ الآن على **كلّ عرض** بدل أن يكون
            صفّاً ملتفّاً داخل شريطٍ أفقيٍّ على الهاتف. */}
        {footer ? <div className="shell-st">{footer}</div> : null}
      </header>

      {/* ══════ الشاشة: المُمرِّر الوحيد ══════ */}
      <main className={`main${pinned ? ' pinned' : ''}`} ref={mainRef}>
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

      {/* ══════ التنقّل — **نفس العنصر يدور**: شريطٌ سفليٌّ دون 1100، ورصيفٌ
          جانبيٌّ فوقها. لا عنصران يتبادلان الظهور، ولا شرطَ عرضٍ في JS.
          وموضعُه بعد `.main` في الشجرة مقصود: ترتيبُ القراءة والتنقّل
          بالمفتاح يمرّ على المحتوى قبل التنقّل، والشبكةُ تضعه حيث يجب. ══════ */}
      <nav className="side" aria-label="القائمة">
        {/* وسمُ العلامة في الرصيف الجانبيّ زينةٌ لا خبر: الترويسة تسمّي
            التطبيق أصلاً، فلا يُقرأ مرّتين. ودونه 1100 يُخفى بالعرض. */}
        <span className="side-mark" aria-hidden="true">AiBot</span>

        {primary.map((n) => (
          <Link
            key={n.href} href={n.href} className="navi"
            aria-current={n.href === activeHref ? 'page' : undefined}
          >
            <span className="navi-i">
              <span aria-hidden="true">{n.icon}</span>
              {n.badge ? <span className="bdg">{n.badge}</span> : null}
            </span>
            <span className="navi-l">{n.label}</span>
          </Link>
        ))}

        <span className="side-sep" aria-hidden="true" />

        <button
          type="button" className="navi navi-more"
          aria-haspopup="dialog" aria-expanded={more}
          /* المِصرفُ يُوسم نشطاً إن كانت الشاشةُ الحاليّةُ خلفه — فيبقى
             البندُ النشط **واحداً** في الشريط لا صفراً. */
          aria-current={rest.some((n) => n.href === activeHref) ? 'page' : undefined}
          onClick={() => setMore(true)}
        >
          <span className="navi-i">
            <span aria-hidden="true">···</span>
            {restBadge ? <span className="bdg">{restBadge}</span> : null}
          </span>
          <span className="navi-l">المزيد</span>
        </button>
      </nav>

      {/* ══════ مِصرفُ «المزيد»: ورقةٌ صاعدة — وعلى الفأرة فوق 1100 تصير
          حواراً مركزيّاً (نفس العقدة بهيئةٍ أخرى، `components.css`). ══════ */}
      <Sheet open={more} title="المزيد" onClose={() => setMore(false)}>
        {rest.length > 0 && (
          <div className="opts">
            {rest.map((n) => (
              <Link
                key={n.href} href={n.href} className="opt"
                aria-current={n.href === activeHref ? 'page' : undefined}
                onClick={() => setMore(false)}
              >
                <span className="opt-t">{n.label}</span>
                <span className="opt-e">
                  {/* عدّادٌ داخل عازلٍ اتجاهيّ — أرقامٌ خالصةٌ بلا حرفٍ عربيّ */}
                  {n.badge ? <span className="opt-c num">{n.badge}</span> : null}
                  {n.href === activeHref ? <span className="opt-ck" aria-hidden="true">✓</span> : null}
                </span>
              </Link>
            ))}
          </div>
        )}

        {/* ★ ذيلُ الحساب — وهو نفسُ `.side-foot` بنفس أصنافه، سكنَ الورقةَ بدل
            الشريط. والسبب أنّه يعمل هكذا على **كلّ عرض** بنسخةٍ واحدةٍ في
            الشجرة: لو بقي في الرصيف فوق 1100 وانتقل إلى الورقة دونها لصار
            `ThemeToggle` وزرُّ الخروج مرسومَين مرّتين — شجرتان لا شجرة.
            وزرُّ الخروج يبقى **الوحيد** في التطبيق وقابلاً للطَّرق من الهاتف،
            وهو العطلُ الذي أُصلح سابقاً ولا يعود. */}
        {/* ★ الإشعارات تسكن هنا لا في شاشةِ إعداداتٍ مستقلّة: هي إعدادُ
            **جهاز** لا إعدادُ حساب، وذيلُ الحساب هو الموضع الوحيد الذي يعمل
            على كلّ عرضٍ بنسخةٍ واحدةٍ في الشجرة. */}
        <PushToggle />

        <div className="side-foot">
          <div className="side-user">{me.user.name}</div>
          <ThemeToggle />
          <Button size="sm" onClick={() => void logout()}>خروج</Button>
        </div>
      </Sheet>
    </div>
  );
}

/* ★ وكانت هنا إعادةُ تصديرٍ (`Skeleton as Loading` · `Empty` · `ErrorBox`) تُبقي استيراداتٍ
   قديمةً عاملةً حين وُحّدت الحالات الثلاث في `ui/index.tsx`. ولم يبقَ من يستوردها
   من هنا — فحُذفت: مساران لاستيراد المكوّن الواحد يعيدان السؤال الذي
   أُريد للتوحيد أن يُنهيه («من أين يُستورد `Empty`؟»)، وحارسُ التكرار يمنع عودتهما. */
