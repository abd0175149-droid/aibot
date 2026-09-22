'use client';

import { useTheme, type ThemeChoice } from '@/lib/theme';

/**
 * مفتاح النمط — ثلاث حالاتٍ لا اثنتان.
 *
 * ★ لماذا ثلاث: «اتبع النظام» ليست غياب اختيار بل اختيارٌ قائم. هاتف العميل
 *   يبدّل نفسه عند الغروب، ومفتاحٌ ثنائيّ يُجمّده على ما كان وقت الضغط —
 *   فيفتح شاشةً فاتحةً في الظلام ويظنّ النظام معطوباً.
 *
 * ★ ولماذا ثلاثة أزرارٍ ظاهرة لا زرٌّ يدور: الزرّ الدوّار يُخفي الحالة الحاليّة
 *   ويجعل الوصول إلى «النظام» تخميناً. ومجموعةٌ من ثلاثة تُظهر أين أنت وأين
 *   تستطيع أن تذهب في نظرةٍ واحدة — وهي أصغر من أن تكلّف مساحة.
 *
 * والدلالة للقارئ الصوتيّ: `radiogroup` لا أزرارٌ متفرّقة، فالثلاثة خيارٌ واحد.
 */

const OPTIONS: Array<{ id: ThemeChoice; label: string; mark: string; title: string }> = [
  { id: 'light', label: 'فاتح', mark: '☀', title: 'فاتحٌ دائماً' },
  { id: 'system', label: 'النظام', mark: '◐', title: 'يتبع إعداد جهازك ويتبدّل معه' },
  { id: 'dark', label: 'داكن', mark: '☾', title: 'داكنٌ دائماً' },
];

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { choice, resolved, set } = useTheme();

  return (
    <div
      className={`theme-sw${compact ? ' compact' : ''}`}
      role="radiogroup"
      aria-label={`نمط العرض — المعروض الآن ${resolved === 'dark' ? 'داكن' : 'فاتح'}`}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={choice === o.id}
          title={o.title}
          className="theme-opt"
          onClick={() => set(o.id)}
        >
          <span aria-hidden="true" className="theme-mark">{o.mark}</span>
          <span className="theme-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
