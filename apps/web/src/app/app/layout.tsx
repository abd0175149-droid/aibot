'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { OverviewDTO } from '@aibot/shared';
import { Shell, type NavItem } from '@/components/Shell';
import { Meter, Pill, Skeleton, Button } from '@/components/ui';
import { useApi, fmt } from '@/lib/useApi';
import { useSession, useCan } from '@/lib/session';

/**
 * تخطيط لوحة العميل.
 *
 * ★ الموظّف يرى الإنبوكس وجهات الاتّصال فقط — والبنود الأخرى **تُخفى** لا
 *   تُعرض معطَّلة. عنصرٌ معطَّلٌ يدعو للضغط ويُنتج سؤالاً؛ وعنصرٌ غائبٌ لا يُلاحظ.
 *   (الإخفاء يقع في `Shell` عبر `needs` — والفحص الحقيقيّ في الخادم.)
 *
 * ★ وعدّاد السقف صار **رابطاً** إلى الاستهلاك. كان نصّاً: يقول «قاربتَ السقف»
 *   ولا يُوصِل إلى تفصيله، فيُشخّص ولا يُعالج — وهو أوّل ما يُبحث عنه في
 *   اللحظة التي يظهر فيها. والوِجهة واحدةٌ لا خيار: جدول النوافذ نفسه الذي
 *   يُفوتَر عليه.
 *
 * ★ وكان يرسم شريطه بيده بنمطٍ مضمَّن — ثالثَ تعريفٍ لـ`.meter` في المشروع،
 *   وبلا عتبةِ «خطير» (95٪) التي يعرفها `Meter`، وبلا أرضيّةِ الشريط المرئيّة.
 *   فصار يستعمل المكوّن، وعتباتُه واحدةٌ في كلّ الشاشات.
 *
 * ★ والعدّاد يقع في ذيل `Shell` — وهو ذيلٌ يعمل في تخطيطَين: عمودٌ في الشريط
 *   الجانبيّ على الحاسوب، وصفٌّ ملتفٌّ داخل شريط التنقّل الأفقيّ على الهاتف
 *   (حيث يسكن **زرّ الخروج الوحيد** في التطبيق). فالأصناف تعالج الحالتين، ولا
 *   شيء هنا يفترض عرضاً.
 */

/** ما نستعمله من `/reports/overview` — لا أكثر، فالعقد ما يُقرأ لا ما يُرسَل. */
type Overview = Pick<OverviewDTO, 'windowsUsed' | 'windowsLimit' | 'needsAttention'>;

export default function AppLayout({ children }: { children: ReactNode }) {
  const { me } = useSession();
  /**
   * ★ **عدّادُ السقف كان رابطاً لمن لا يملك فتحَ وجهته.**
   *
   *   `/app/usage` محجوبةٌ في التنقّل بـ`needs: 'billing'`، و`GET /usage` يردّ
   *   ٤٠٣ لغير صاحب الفوترة. والعدّادُ في ذيل الشريط لم يكن محجوباً بشيء: فموظّفٌ
   *   يرى «بلغتَ السقف» ويضغط، فيهبط على شاشةٍ تردّ صندوقَ خطأ — طريقٌ مسدودٌ
   *   صنعناه نحن في اللحظة التي يبحث فيها عن تفسير.
   *
   *   فالعدّادُ يبقى مرئيّاً له (هو يحتاج أن يعرف لماذا صمت البوت) ويسقط عنه
   *   الرابطُ وسهمُه. والتفسيرُ يُقال له حيث يقع العطل فعلاً: في الإنبوكس.
   */
  const can = useCan();
  const hasTenant = Boolean(me?.tenant);
  // لا نداء قبل وجود مستأجر — وإلّا فـ403 مستحقّ على مالك المنصّة
  const { data, error, loading, reload } = useApi<Overview>(hasTenant ? '/reports/overview' : null);

  const nav: NavItem[] = [
    { href: '/app', label: 'الرئيسيّة', icon: '⌂', needs: 'settings' },
    { href: '/app/inbox', label: 'الإنبوكس', icon: '✉', badge: data?.needsAttention },
    { href: '/app/bot', label: 'البوت', icon: '✦', needs: 'settings' },
    { href: '/app/channels', label: 'القنوات', icon: '⇄', needs: 'settings' },
    { href: '/app/usage', label: 'الاستهلاك', icon: '▤', needs: 'billing' },
    { href: '/app/playground', label: 'الساحة', icon: '◐', needs: 'settings' },
    { href: '/app/contacts', label: 'جهات الاتّصال', icon: '☰' },
    { href: '/app/reports', label: 'التقارير', icon: '◫', needs: 'billing' },
    { href: '/app/team', label: 'الفريق', icon: '◇', needs: 'settings' },
  ];

  /* كسرٌ لا نسبةٌ مئويّة: `Meter` يملك العتبات (80/95/100) وأرضيّة الشريط
     المرئيّة، فلا تُعاد حسابها هنا بأرقامٍ أخرى. */
  const pct = data?.windowsLimit ? data.windowsUsed / data.windowsLimit : 0;

  /* الحالات الثلاث في القشرة أيضاً — بحجم القشرة:
     ① تحميل: هيكلٌ بمكان العدّاد، فلا يقفز الشريط عند وصول الرقم.
     ② خطأ: **يُقال** ومعه طريقٌ للأمام. والصمت هنا كان أسوأ من الخطأ: عدّادٌ
        غائبٌ يُقرأ «لا سقف عليك» — وهو بالضبط الخبر السارّ الكاذب عند الفشل.
        و`ErrorBox` صندوقٌ بعنوانٍ لا يسكن شريط تنقّلٍ بعرض 210px، فالسطرُ
        المضغوط يحمل نفس العقد: نصٌّ بشريّ + إعادةُ محاولةٍ حقيقيّة.
     ③ فارغ: سقفٌ = 0 يعني بلا باقةٍ فاعلة — لا رقم يُعرض، وهو سلوكٌ محفوظ. */
  let capFooter: ReactNode = null;
  if (!hasTenant) {
    capFooter = null;
  } else if (loading) {
    capFooter = <div className="cap-load"><Skeleton rows={1} height={30} /></div>;
  } else if (error) {
    capFooter = (
      <div className="cap-err">
        <span>تعذّر جلب عدّاد النوافذ.</span>
        <Button size="sm" onClick={reload}>أعِد المحاولة</Button>
      </div>
    );
  } else if (data?.windowsLimit) {
    const capBody = (
      <>
        <span className="cap-h">
          {/* عزلٌ اتجاهيّ على «12 / 1500»: بلاه ترتفع الشرطة المائلة إلى R
              فيُقلب الرقمان بصريّاً — رقمٌ مقلوبٌ لا قبيح. */}
          <span className="cap-n num">{fmt.num(data.windowsUsed)} / {fmt.num(data.windowsLimit)}</span>
          <span className="cap-u">نافذة</span>
          <span className="num">{fmt.pct(pct)}</span>
          {/* ولا معنى باللون وحده: العتبة تُقال نصّاً لا بلون الشريط فقط */}
          {pct >= 0.8 && (
            <Pill
              tone={pct >= 1 ? 'crit' : pct >= 0.95 ? 'serious' : 'warn'}
              label={pct >= 1 ? 'بلغتَ السقف' : 'قاربتَ السقف'}
            />
          )}
          {can.billing && <span aria-hidden="true" className="cap-go">←</span>}
        </span>
        <Meter pct={pct} />
      </>
    );
    capFooter = can.billing
      ? <Link className="cap" href="/app/usage">{capBody}</Link>
      : <div className="cap">{capBody}</div>;
  }

  return <Shell nav={nav} footer={capFooter}>{children}</Shell>;
}
