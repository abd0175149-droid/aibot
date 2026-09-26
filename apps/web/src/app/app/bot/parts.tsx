'use client';

import { MODE_THRESHOLD, RAG_THRESHOLD, READ_UNIT as UNIT } from '@/lib/terms';
import { useEffect, useRef, useState } from 'react';
import { fmt } from '@/lib/useApi';
import { type ToolDraft } from '@/components/ToolBuilder';


/**
 * شاشة البوت — الشاشة التي يقف عليها وعد المنتج: «اضبطه بنفسك».
 *
 * ★ القرار الذي أُعيد البناء من أجله: **لا نشرَ على العمياء.** كان شريط
 *   المسوّدة يقول «لديك تغييرات غير منشورة» ثمّ يعطيك زرّ «نشر» — والعميل
 *   يعدّل شخصيّةً من ثلاثين سطراً على ثلاث جلسات ثمّ ينشر وهو **لا يذكر ما
 *   غيّره**. فالفرق يُرسَم **قبل** الزرّ لا بعده: ملخَّصُه حاضرٌ دائماً،
 *   وسطراً سطراً تحت طيّةٍ، ومرّةً ثالثةً في ورقة النشر نفسها.
 *
 * ★ وثلاثة أعطالٍ صامتة أُغلقت هنا سابقاً وما زالت مغلقة:
 *   ① **النشر كان ينشر غير ما على الشاشة.** الحفظ يقع عند مغادرة الحقل،
 *      فمن كتب ثمّ ضغط «نشر» بالماوس مباشرةً نشر النصّ **السابق**. صار النشر
 *      ممتنعاً ما دام على الشاشة تغييرٌ غير محفوظ، والسبب مكتوبٌ على الزرّ.
 *   ② **الشريط لا يختفي بعد النشر.** الخادم لا يمحو المسوّدة عند النشر،
 *      فكان `dirty` يعود `true` بعد إعادة الجلب. المعيار الآن **فرقٌ حقيقيّ**
 *      عن المنشورة لا وجود صفٍّ في القاعدة.
 *   ③ **الموظّف كان يُرسَل إلى 403.** كلّ مسارات الكتابة هنا تطلب صلاحيّة
 *      الإعدادات (مالك الحساب)، وكانت الشاشة تعطّل عند الانتحال وحده.
 *
 * ★ وما تبنّته هذه المرحلة من بنى التصميم المعتمَد، وعلّةُ كلٍّ منه:
 *
 *   ① **الرصيف السفليّ**: فعلُ الشاشة الأوّل (احفظ ← انشر) كان مدفوناً داخل
 *      بطاقةٍ في وسط الصفحة، فيهرب مع التمرير في الحقلَين الطويلَين اللذين
 *      تُفتح الشاشة من أجلهما. صار صفّاً لاصقاً في ذيل الصفحة — في مدى
 *      الإبهام على كلّ ارتفاع، وبلا `position: fixed` (انظر `bot.css`).
 *
 *   ② **الأفعال الخطرة تُميَّز**: «أوقف البوت» كان `quiet` — أضعفَ زرٍّ في
 *      الشاشة — يُسكت البوت عن **كلّ** زبائن المستأجر بنقرةٍ واحدةٍ بلا
 *      تأكيدٍ ولا ذكرٍ لما يحدث للرسائل الواصلة. صار `danger` وخلفه ورقةٌ
 *      تقول العاقبة. وكذلك حذفُ الأداة (كان غائباً رغم وجود المسار) وحذفُ
 *      ملفّ المعرفة (كان بنقرةٍ واحدة على خمسة بكسلاتٍ من «عايِن»).
 *
 *   ③ **المصطلح التقنيّ يخرج**: «توكن» كانت مكشوفةً ثلاث مرّاتٍ لصاحب مطعم،
 *      والمشروع يعلن القاعدة نفسها. صارت «وحدة قراءة» في كلّ موضع. والعدد
 *      كان يُعرض مرّتين بصياغتين وحجمين تحت نفس الحقل — صار مرّةً واحدة.
 *
 *   ④ **مقياسٌ لا يكذب**: كان `Meter` يقيس **الحقل وحده** والشارةُ بجواره
 *      تقيس **كلّ المصادر**، وكلاهما منسوبٌ إلى عتبةٍ واحدة (8,000) والنسبة
 *      مقصورةٌ عند 1 — فيستوي من عنده 8,000 بمن عنده 80,000. والعتبة الثانية
 *      (40,000) غائبةٌ تماماً. صار سلّماً واحداً على محورٍ واحد بعتبتَيه
 *      ظاهرتَين، ونصُّ المعرفة وملفّاتها صفَّان متمايزان لكلٍّ عاقبتُه.
 *
 *   ⑤ **الوعد صار له منفّذ**: «تُحدَّث تلقائيّاً عند الجهوز» كانت جملةً بلا
 *      استقصاءٍ ولا سوكِت، و«قيد المعالجة» لا تنتهي بذاتها أبداً. الآن
 *      استقصاءٌ **محدودُ المدّة** للحالتَين، وحين ينقضي يُقال ذلك ويُعطى
 *      زرُّ تحديثٍ حقيقيّ. ونسخةٌ فشل تضمينُها كانت **لا أثرَ لها في الشاشة**
 *      إطلاقاً — صارت حالةً معلنة، لأنّ `/bot/versions` يحمل `embedStatus`.
 *
 * ★ ولا مونو على عربيّ: «IBM Plex Mono» بلا تغطيةٍ عربيّة، فالمفتاح والمسار
 *   واسم النموذج — سلاسلُ آلة — وحدها تأخذه، ومطويّةً لأنّها لا يُتّخذ عليها
 *   قرار. وكلّ نصٍّ كتبه العميل يحمل `dir="auto"`.
 */

export interface BotState {
  config: {
    enabled: boolean; pauseMinutes: number; maxToolLoops: number;
    contextMessages: number; failMessage: string | null; outsideHoursMessage: string | null;
    /** ساعاتُ الدوام — بلاها يردّ البوت في كلّ وقتٍ ولا تُستعمل رسالةُ خارج الدوام */
    businessHours?: { tz?: string; days?: Record<string, unknown> } | null;
    /** ★ إيقافٌ من فريق المنصّة — ما دام مكتوباً يرفض الخادم «شغّل». */
    platformLockedAt?: string | null;
    platformLockReason?: string | null;
  } | null;
  published: {
    version: number; persona: string; knowledgeBase: string;
    knowledgeMode: 'full' | 'hybrid' | 'rag'; embedStatus: string; model: string;
    /** مجموع أحرف الملفّات التي دخلت النسخة المنشورة — ومنه يُعرف أنّ ملفّاً رُفع بعدها. */
    sourceChars?: number;
  } | null;
  /** المسوّدة jsonb — وهذه الشاشة تكتب حقلَين منها، والخادم يدمج الباقي. */
  draft: { persona?: string; knowledgeBase?: string } | null;
  /** طابعُ المسوّدة ساعةَ جُلبت — يُعاد عند الحفظ فيُكتشف من كتب بعدنا. */
  draftUpdatedAt: string | null;
}

export interface KB {
  sources: Array<{ id: string; kind: string; title: string; charCount: number; status: string; createdAt: string; error?: string | null }>;
  chunks: number; chars: number; tokens: number;
  suggestedMode: 'full' | 'hybrid' | 'rag';
}

export interface Tool {
  id: string; key: string; titleAr: string; description: string;
  enabled: boolean; kind: string; hasSecrets: boolean;
  requiresCapabilities: string[]; disabledReason: string | null;
  paramsSchema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] } | null;
  http?: { method?: string; url?: string; headers?: Record<string, string>; bodyTemplate?: string } | null;
  responseMap?: Record<string, string> | null;
  confirmRequired?: boolean; confirmTemplate?: string | null;
}

/**
 * نسخةٌ في السجلّ. تُجلَب لسببَين لا ثالث لهما:
 *  ① **حالةُ التضمين** — بها وحدها يُعرف أنّ نسخةً نُشرت وتنتظر تجهيز
 *     معرفتها، أو أنّ تجهيزها **فشل**. وبلاها كانت المعرفة الوحيدة حالةً في
 *     ذاكرة المتصفّح تموت مع أوّل تحديثٍ للصفحة، فيعود زرُّ النشر مسلَّحاً
 *     على نسخةٍ قيد التجهيز — وتلك نسخةٌ ثانيةٌ ومهمّةُ تضمينٍ ثانية.
 *  ② **تاريخُ النشر** — «نُشرت قبل يومين» سياقٌ ملاصقٌ لرقم النسخة.
 */
export interface Ver {
  id: string; version: number; note: string | null;
  publishedAt: string | null;
  knowledgeMode: 'full' | 'hybrid' | 'rag';
  embedStatus: string;
}

/**
 * صفُّ القاعدة ⟶ مسوّدة الباني.
 *
 * ★ السرّ **لا يُعاد أبداً** — حتّى وجوده يأتي علماً (`hasSecrets`) لا قيمة.
 *   فحقل السرّ يبدأ فارغاً، وتركه فارغاً يعني «أبقِ القديم» لا «امحُه».
 */
export function toDraft(t: Tool): ToolDraft {
  const props = t.paramsSchema?.properties ?? {};
  const required = new Set(t.paramsSchema?.required ?? []);
  return {
    id: t.id,
    key: t.key,
    titleAr: t.titleAr,
    description: t.description,
    params: Object.entries(props).map(([name, v]) => ({
      name,
      type: (v?.type as 'string') ?? 'string',
      desc: v?.description ?? '',
      required: required.has(name),
    })),
    method: (t.http?.method as 'GET') ?? 'GET',
    url: t.http?.url ?? '',
    bodyTemplate: t.http?.bodyTemplate ?? '',
    authHeader: t.http?.headers?.Authorization ?? '',
    secretValue: '',
    hasSecrets: t.hasSecrets,
    responseMap: Object.entries(t.responseMap ?? {}).map(([field, path]) => ({ field, path })),
    confirmRequired: Boolean(t.confirmRequired),
    confirmTemplate: t.confirmTemplate ?? '',
  };
}

export const TABS = [
  { id: 'persona', label: 'الشخصيّة' },
  { id: 'kb', label: 'المعرفة' },
  { id: 'tools', label: 'الأدوات' },
  { id: 'behave', label: 'السلوك' },
  /* ★ والسجلُّ بيتٌ ثابت: إلحاقُه بتبويب الشخصيّة يدفع الحقلَ الذي تُفتح
     الشاشةُ لأجله تحت الطيّة. */
  { id: 'versions', label: 'النسخ' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

/**
 * ★ معرّفٌ واردٌ من **خارج** الشاشة (‏`?tab=`) يُقاس على القائمة أعلاه.
 *   رابطٌ قديمٌ أو مصنوعٌ بقيمةٍ لا نعرفها كان سيضع الشاشة على تبويبٍ لا وجود
 *   له: لا يُرسم شيءٌ تحت الشريط — شاشةٌ فارغةٌ بلا خطأٍ في أيّ سجلّ.
 */
export const isTabId = (v: string | null): v is TabId =>
  v !== null && TABS.some((t) => t.id === v);



/**
 * ★ اسمُ النموذج **سلسلةُ آلة**، وكان يُعرض خاماً بالمونو لصاحب مطعم في
 *   بطاقةٍ عنوانُها «الحدود». فالمعروض أثرُه عليه — سرعةٌ وكلفة — والسلسلةُ
 *   نفسها مطويّةٌ لمن يسأل الدعم عنها.
 */
export const MODEL: Record<string, string> = {
  'gemini-2.5-flash': 'سريعٌ واقتصاديّ — يردّ في ثانيتَين تقريباً',
  'gemini-2.5-pro': 'أدقُّ وأبطأ قليلاً — لمعرفةٍ طويلةٍ متشابكة',
};

/**
 * ★ صيغة الخادم **حرفاً بحرف** — منقولةٌ من `packages/core/src/context.ts`
 *   (‏`estimateTokens`)، و`apps/web` لا تستورد `@aibot/core` عمداً فلا
 *   تُسحب `crypto` و`dns` إلى حزمة المتصفّح.
 *
 * وكان هنا `length / 2.5` وتعليقٌ يزعم أنّه «تقدير الخادم نفسه». والفرق
 * ليس تجميليّاً: معرفةٌ فيها روابطُ وأسعارٌ وأكواد منتجاتٍ تُقدَّر أعلى بنحو
 * ٦٠٪ من الحقيقة، و`decideKnowledgeMode` يعمل على رقم **الخادم**. فكان
 * المقياس يقول «تجاوزتَ العتبة» والخادم يبقى على `full`. مؤشّرٌ يكذب أسوأ
 * من غياب مؤشّر.
 *
 * ⚠️ إن تغيّرت صيغة الخادم فغيّرها هنا — لا مرجعَ مشتركٌ يربطهما.
 */
export const readUnits = (s: string) => {
  if (!s) return 0;
  const arabic = (s.match(/[؀-ۿ]/g) ?? []).length;
  return Math.ceil(arabic / 2.5 + (s.length - arabic) / 4);
};

/**
 * ★ وحدةُ قياس الملفّات هي **صيغة الخادم للملفّات** لا صيغةُ النصّ:
 *   `/bot/knowledge` يحسب `chars / 2.5` على كلّ المصادر. ومحاسبةُ الملفّات
 *   بصيغةٍ ومحاسبةُ النصّ بأخرى ليست تناقضاً بل نقلٌ أمينٌ لما يفعله الخادم —
 *   والرقمان يظهران في صفَّين متمايزَين لا مجموعَين في مقياسٍ واحد.
 */
export const fileUnitsOf = (chars: number) => Math.ceil(chars / 2.5);

/** عددُ الأقسام ذات العنوان — وهو ما يرفع دقّة الاسترجاع فعلاً. */
export const headingsOf = (s: string) =>
  s.split('\n').filter((l) => /^\s*#/.test(l) || /[:：]\s*$/.test(l.trim())).length;

/** فرقٌ بالأسطر — نفسُ مقارنة `DiffView` سطراً بسطر، فالملخَّصُ لا يخالف التفصيل. */
export function lineDelta(before: string, after: string) {
  const a = before.split('\n');
  const b = after.split('\n');
  const max = Math.max(a.length, b.length);
  let added = 0;
  let removed = 0;
  for (let i = 0; i < max; i += 1) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) removed += 1;
    if (b[i] !== undefined) added += 1;
  }
  return { added, removed };
}

/**
 * عددٌ بصيغته العربيّة الصحيحة — والرقمُ معزولٌ والكلمةُ خارج العازل.
 * («ملفٌّ واحد» · «ملفّان» · «٣ ملفّات» · «١١ ملفّاً» — والخطأ فيها يُقرأ ترجمةً آليّة.)
 */
export type Forms = [string, string, string, string];

export function Amount({ n, forms }: { n: number; forms: Forms }) {
  if (n === 1) return <>{forms[0]}</>;
  if (n === 2) return <>{forms[1]}</>;
  const w = n % 100 >= 3 && n % 100 <= 10 ? forms[2] : forms[3];
  return <><span className="num">{fmt.num(n)}</span> {w}</>;
}

/**
 * ونفسُها نصّاً — لوسم `Tag` الذي يأخذ سلسلةً لا شجرة.
 * ولا عزلَ هنا: رقمٌ مفردٌ في أوّل سلسلةٍ عربيّة يبقى في موضعه، والعازلُ
 * لو وُضع على السلسلة كلّها دخلت العربيّةُ فيه — وذاك ممنوعٌ بالعقد.
 */
export function amountText(n: number, forms: Forms): string {
  if (n === 1) return forms[0];
  if (n === 2) return forms[1];
  return `${fmt.num(n)} ${n % 100 >= 3 && n % 100 <= 10 ? forms[2] : forms[3]}`;
}

export const TOOL_FORMS: Forms = ['أداةٌ واحدة', 'أداتان', 'أدواتٍ', 'أداةً'];
export const LINE_ADD: Forms = ['سطرٌ أُضيف', 'سطران أُضيفا', 'أسطرٍ أُضيفت', 'سطراً أُضيف'];
export const LINE_DEL: Forms = ['سطرٌ حُذف', 'سطران حُذفا', 'أسطرٍ حُذفت', 'سطراً حُذف'];
export const HEAD_FORMS: Forms = ['قسمٌ واحدٌ بعنوان', 'قسمان بعنوان', 'أقسامٍ بعنوان', 'قسماً بعنوان'];

/**
 * ★ سلّمُ المعرفة — **عتبتان على محورٍ واحد**.
 *
 * `Meter` يرسم نسبةً من سقفٍ واحدٍ ويصبغ التجاوز حرجاً، وهذا المقياس ليس
 * سقفاً: تجاوزُ العتبة **تحوُّلُ وضعٍ** لا خطأ. فالمحور من صفر إلى العتبة
 * الثانية، والعتبتان مرسومتان بأرقامهما، واللونُ حبرٌ صلبٌ لا لونَ حالة.
 */
export function KbScale({ units }: { units: number }) {
  const frac = Math.min(units / RAG_THRESHOLD, 1);
  const pct = Math.round(frac * 1000) / 10;
  return (
    <div className="bot-scale">
      <span
        className="bot-scale-b"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={RAG_THRESHOLD}
        aria-valuenow={Math.min(units, RAG_THRESHOLD)}
        aria-valuetext={`${fmt.num(units)} من ${fmt.num(RAG_THRESHOLD)} ${UNIT}`}
      >
        {/* style-ok: طولُ الشريط نسبةٌ محسوبةٌ من المحور — لا يُمثَّل بصنفٍ ثابت */}
        <i className={`bot-scale-f${units > 0 ? ' floor' : ''}`} style={{ width: `${pct}%` }} />
      </span>
      {/* العتبتان مخفيّتان عن القارئ الصوتيّ: نصُّ السلّم يقولهما بالكلام أسفله،
          فتكرارُهما رقمَين عارِيَين ضجيجٌ لا خبر. */}
      <span className="bot-tick t1" aria-hidden="true">
        <span className="bot-tick-l num">{fmt.num(MODE_THRESHOLD)}</span>
      </span>
      <span className="bot-tick t2" aria-hidden="true">
        <span className="bot-tick-l num">{fmt.num(RAG_THRESHOLD)}</span>
      </span>
    </div>
  );
}

/**
 * ★ استقصاءٌ **محدود** لا دوّامة.
 *
 * الشاشة كانت تَعِد «تُحدَّث تلقائيّاً عند الجهوز» بلا استقصاءٍ ولا سوكِت،
 * و«قيد المعالجة» لا تنتهي من نفسها أبداً. والاستقصاء بلا حدٍّ أسوأ من غيابه:
 * تبويبٌ منسيٌّ يضرب الخادم إلى الأبد. فالمدّة محدودةٌ، وحين تنقضي يُقال
 * ذلك ويُعطى زرُّ تحديثٍ حقيقيّ — لا صمتٌ ولا دوران.
 */
export function usePoll(active: boolean, ms: number, max: number, fn: () => void): boolean {
  const ref = useRef(fn);
  ref.current = fn;
  const [ticks, setTicks] = useState(0);
  /* العدّاد يعود صفراً حين تزول الحالة، فحالةٌ ثانيةٌ تجد استقصاءً كاملاً */
  useEffect(() => { if (!active) setTicks(0); }, [active]);
  useEffect(() => {
    if (!active || ticks >= max) return undefined;
    const t = setTimeout(() => { setTicks((n) => n + 1); ref.current(); }, ms);
    return () => clearTimeout(t);
  }, [active, ticks, max, ms]);
  return active && ticks >= max;
}

export type Busy = 'save' | 'publish' | 'toggle' | 'rollback' | null;
/** ورقةُ تأكيدٍ مفتوحة — واحدةٌ لا أكثر. */
export type Ask =
  | null
  | { k: 'stop' }
  | { k: 'publish' }
  | { k: 'rollback'; id: string; version: number }
  | { k: 'tool'; id: string; name: string };
