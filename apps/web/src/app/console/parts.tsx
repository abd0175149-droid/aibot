'use client';

import type { ReactNode } from 'react';
import { fmt } from '@/lib/useApi';

/**
 * ما يخصّ لوحة المالك وحدها.
 *
 * ★ كان هذا الملفّ يحمل أيضاً `Hero` و`MetricRow` و`Delta` و`Section` —
 *   بتوقيعاتٍ تخالف توقيعاتِ نفس الأسماء الأربعة في `app/app/_parts.tsx`.
 *   وقد **وُحِّدت في `@/components/screen`** وحارسٌ في
 *   `test/design-system.test.ts` يمنع عودتها: لا اسمَ مكوّنٍ يُصدَّر من
 *   ملفَّين. وما بقي هنا بنيتان لا تستعملهما شاشةٌ أخرى — والتوحيدُ يرفع ما
 *   يُتقاسَم لا كلَّ ما جاور.
 */

/**
 * مجموعةُ إلحاحٍ برأسٍ لاصقٍ يحمل عددها.
 *
 * ★ **التجميعُ بالإلحاح قبل الزمن.** سيلٌ مرتَّبٌ بآخر ظهورٍ يخلط الحرجَ
 *   بالمعلومة، فتُقرأ مئةُ بطاقةٍ متساوية الوزن. والرأسُ اللاصقُ يمنع العطلَ
 *   المقابل: قائمةٌ طويلةٌ تفقد رأسَها بعد ثلاثة صفوفٍ فيُقرأ «هادئ» على أنّه
 *   «يحتاجك» — والعدُّ قبل التمرير يقول إن كان النزولُ يستحقّ.
 */
export function Group({ title, count, attn, children }: {
  title: string; count: number; attn?: boolean; children: ReactNode;
}) {
  return (
    <div className="ugrp">
      <div className={attn ? 'grp attn' : 'grp'}>
        <span>{title}</span>
        {/* العدّادُ حاويةٌ بلا عازل، والعازلُ مدًى داخلَها — وإلّا دفع
            `margin-inline-start: auto` مع `direction: ltr` الرقمَ إلى
            الطرف الخطأ في RTL. */}
        <span className="grp-c"><span className="num">{fmt.num(count)}</span></span>
      </div>
      <div className="cn-list">{children}</div>
    </div>
  );
}

/**
 * شريطٌ واحدٌ على المقياس المشترك.
 *
 * ★ النسبة في **سمة** SVG لا في `style` — والسمة تقبل `%` فتقرأها من عرض
 *   العنصر نفسه، بلا `viewBox` فلا يتشوّه شيء. والتعبئة بصنفٍ لأنّ `var()`
 *   لا تعمل داخل سمات SVG.
 * ★ و«من اليمين»: `x = 100 - w` يُنمي الشريط من حدّ القراءة لا نحوه.
 * ★ وأرضيّةٌ مرئيّة: كلفةٌ ضئيلةٌ موجبة تُرسم أثراً — والصفر وحده يبقى فارغاً،
 *   فالفرق بين «لا كلفة» و«كلفةٌ بالكاد» معلومةٌ لا زينة.
 * ★ و`goal` علامةُ الحدّ بنفس المقياس: الكلفةُ التي يصير عندها الهامشُ هدفَه.
 *   فما تجاوزها فهامشُه دون الهدف — يُقرأ من الشريط بلا حسابٍ في الرأس.
 */
export function Bar({ value, scale, kind, goal }: {
  value: number; scale: number; kind: 'rev' | 'cst'; goal?: number;
}) {
  const raw = (value / scale) * 100;
  const w = value <= 0 ? 0 : Math.min(100, Math.max(raw, 1.5));
  const g = goal != null && goal > 0 && goal <= scale ? (goal / scale) * 100 : null;
  return (
    <svg className="mg-bar" height="9" aria-hidden="true" focusable="false">
      <rect className="trk" x="0" y="0" width="100%" height="9" rx="2" />
      <rect className={kind} x={`${100 - w}%`} y="0" width={`${w}%`} height="9" rx="2" />
      {g != null && <rect className="mg-goal" x={`${100 - g}%`} y="0" width="2" height="9" />}
    </svg>
  );
}
