import type { ReactNode } from 'react';
import { supportMailto } from '@/lib/support';

/**
 * ★ رابطُ تواصلٍ **حقيقيّ** — وكان النصُّ «راسلنا» في ثلاث شاشاتٍ بلا `href`.
 *
 *   و`className` اختياريّ كي يصلح نصّاً في فقرة (`sc-link`) وفعلاً في رصيف
 *   (`btn primary lg wide sc-link`) بلا صنفٍ جديد — فالصنفُ غير المعرَّف في CSS
 *   يسقط صامتاً، وحارسُ «لا صنفَ ميّت» يرفضه.
 */
export function SupportLink({ subject, body, className, children }: {
  subject: string;
  body?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a className={className ?? 'sc-link'} href={supportMailto(subject, body)}>
      {children}
    </a>
  );
}
