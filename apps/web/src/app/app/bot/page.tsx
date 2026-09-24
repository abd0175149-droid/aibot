'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { put, post, patch, del, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { ToolBuilder, EMPTY_DRAFT, type ToolDraft } from '@/components/ToolBuilder';
import { KnowledgeFiles, type KbSource } from '@/components/KnowledgeFiles';
import {
  PageHead, Tabs, Card, Grid, Stack, Row, Stat, Pill, Tag, Note, Button, Field, TextArea,
  Skeleton, Empty, ErrorBox, DataView, DiffView, Sheet, Dock,
} from '@/components/ui';

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

interface BotState {
  config: {
    enabled: boolean; pauseMinutes: number; maxToolLoops: number;
    contextMessages: number; failMessage: string | null; outsideHoursMessage: string | null;
    /** ساعاتُ الدوام — بلاها يردّ البوت في كلّ وقتٍ ولا تُستعمل رسالةُ خارج الدوام */
    businessHours?: { tz?: string; days?: Record<string, unknown> } | null;
  } | null;
  published: {
    version: number; persona: string; knowledgeBase: string;
    knowledgeMode: 'full' | 'hybrid' | 'rag'; embedStatus: string; model: string;
    /** مجموع أحرف الملفّات التي دخلت النسخة المنشورة — ومنه يُعرف أنّ ملفّاً رُفع بعدها. */
    sourceChars?: number;
  } | null;
  /** المسوّدة jsonb — وهذه الشاشة تكتب الحقلَين معاً دائماً. */
  draft: { persona?: string; knowledgeBase?: string } | null;
}

interface KB {
  sources: Array<{ id: string; kind: string; title: string; charCount: number; status: string; createdAt: string; error?: string | null }>;
  chunks: number; chars: number; tokens: number;
  suggestedMode: 'full' | 'hybrid' | 'rag';
}

interface Tool {
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
interface Ver {
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
function toDraft(t: Tool): ToolDraft {
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

const TABS = [
  { id: 'persona', label: 'الشخصيّة' },
  { id: 'kb', label: 'المعرفة' },
  { id: 'tools', label: 'الأدوات' },
  { id: 'behave', label: 'السلوك' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * ★ **«توكن» لا تُكتب في واجهة صاحب مطعم.** الوحدة المعروضة «وحدة قراءة»،
 *   وهي نفسها التي يحسبها الخادم — تغيّر الاسمُ لا الرقم.
 */
const UNIT = 'وحدة قراءة';

/** العتبتان مكتوبتان في `decideKnowledgeMode` — ومعروضتان هنا بعينهما. */
const MODE_THRESHOLD = 8_000;
const RAG_THRESHOLD = 40_000;
/** الحدّ الموصى به لطول الشخصيّة: تُقرأ مع كلّ سؤال. */
const PERSONA_LIMIT = 800;

/**
 * الأوضاع الثلاثة بلغةٍ تقول **ما يحدث** لا ما اسمه.
 * (‏`decideKnowledgeMode` في `packages/core/src/knowledge.ts`.)
 */
const MODE: Record<string, { label: string; how: string }> = {
  full: {
    label: 'يقرأ نصَّك كاملاً',
    how: 'دون العتبة الأولى، يُرسَل نصُّ معرفتك كاملاً مع كلّ سؤالٍ يصل.',
  },
  hybrid: {
    label: 'أساسيّات + استرجاع',
    how: 'فوق العتبة الأولى، لا يُرسَل إليه إلّا الأساسيّات وما يرتبط بالسؤال — أوفرُ وأدقّ.',
  },
  rag: {
    label: 'استرجاعٌ كامل',
    how: 'فوق العتبة الثانية، لا يُرسَل إلّا ما يرتبط بالسؤال — فمعرفةٌ بعشرة أضعافٍ لا تكلّفك عشرة أضعاف.',
  },
};

/** مرآةُ `decideKnowledgeMode` — حرفاً بحرف، والعتبتان أعلاه. */
const decideMode = (units: number): 'full' | 'hybrid' | 'rag' =>
  (units < MODE_THRESHOLD ? 'full' : units <= RAG_THRESHOLD ? 'hybrid' : 'rag');

/**
 * ★ اسمُ النموذج **سلسلةُ آلة**، وكان يُعرض خاماً بالمونو لصاحب مطعم في
 *   بطاقةٍ عنوانُها «الحدود». فالمعروض أثرُه عليه — سرعةٌ وكلفة — والسلسلةُ
 *   نفسها مطويّةٌ لمن يسأل الدعم عنها.
 */
const MODEL: Record<string, string> = {
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
const readUnits = (s: string) => {
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
const fileUnitsOf = (chars: number) => Math.ceil(chars / 2.5);

/** عددُ الأقسام ذات العنوان — وهو ما يرفع دقّة الاسترجاع فعلاً. */
const headingsOf = (s: string) =>
  s.split('\n').filter((l) => /^\s*#/.test(l) || /[:：]\s*$/.test(l.trim())).length;

/** فرقٌ بالأسطر — نفسُ مقارنة `DiffView` سطراً بسطر، فالملخَّصُ لا يخالف التفصيل. */
function lineDelta(before: string, after: string) {
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
type Forms = [string, string, string, string];

function Amount({ n, forms }: { n: number; forms: Forms }) {
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
function amountText(n: number, forms: Forms): string {
  if (n === 1) return forms[0];
  if (n === 2) return forms[1];
  return `${fmt.num(n)} ${n % 100 >= 3 && n % 100 <= 10 ? forms[2] : forms[3]}`;
}

const TOOL_FORMS: Forms = ['أداةٌ واحدة', 'أداتان', 'أدواتٍ', 'أداةً'];
const LINE_ADD: Forms = ['سطرٌ أُضيف', 'سطران أُضيفا', 'أسطرٍ أُضيفت', 'سطراً أُضيف'];
const LINE_DEL: Forms = ['سطرٌ حُذف', 'سطران حُذفا', 'أسطرٍ حُذفت', 'سطراً حُذف'];
const HEAD_FORMS: Forms = ['قسمٌ واحدٌ بعنوان', 'قسمان بعنوان', 'أقسامٍ بعنوان', 'قسماً بعنوان'];

/**
 * ★ سلّمُ المعرفة — **عتبتان على محورٍ واحد**.
 *
 * `Meter` يرسم نسبةً من سقفٍ واحدٍ ويصبغ التجاوز حرجاً، وهذا المقياس ليس
 * سقفاً: تجاوزُ العتبة **تحوُّلُ وضعٍ** لا خطأ. فالمحور من صفر إلى العتبة
 * الثانية، والعتبتان مرسومتان بأرقامهما، واللونُ حبرٌ صلبٌ لا لونَ حالة.
 */
function KbScale({ units }: { units: number }) {
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
function usePoll(active: boolean, ms: number, max: number, fn: () => void): boolean {
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

type Busy = 'save' | 'publish' | 'toggle' | null;
/** ورقةُ تأكيدٍ مفتوحة — واحدةٌ لا أكثر. */
type Ask =
  | null
  | { k: 'stop' }
  | { k: 'publish' }
  | { k: 'tool'; id: string; name: string };

export default function BotPage() {
  const can = useCan();
  const { toast, node } = useToast();
  const bot = useApi<BotState>('/bot');
  const kb = useApi<KB>('/bot/knowledge');
  const tools = useApi<Tool[]>('/bot/tools');
  const vers = useApi<Ver[]>('/bot/versions');

  const [tab, setTab] = useState<TabId>('persona');
  /* المسوّدة المفتوحة في الباني. `null` = مغلق. */
  const [editing, setEditing] = useState<ToolDraft | null>(null);
  const [persona, setPersona] = useState('');
  const [knowledge, setKnowledge] = useState('');
  /**
   * ما هو **محفوظٌ على الخادم** الآن — مرجعُ «غير محفوظ».
   * و`full` تعني أنّ المسوّدة تحمل الحقلَين: النشر يقرأ `draft.knowledgeBase`
   * وينشر فراغاً إن غاب، فمسوّدةٌ ناقصةٌ تُعالَج معالجةَ «احفظ أوّلاً».
   */
  const [server, setServer] = useState({ persona: '', knowledge: '', full: false });
  /** رقم نسخةٍ نُشرت في هذه الجلسة وتنتظر تضمين معرفتها — ريثما يقولها السجلّ. */
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  /* معرّفُ الأداة لا علمٌ عامّ: علمٌ واحد كان يُظهر «…» ويعطّل الزرّ في
     **كلّ** أداةٍ معطَّلة، فيُقرأ أنّ النظام يعمل على السبعة. */
  const [busyTool, setBusyTool] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  /**
   * قفلٌ متزامن على الحفظ. الضغط على «احفظ المسوّدة» يُخرج التركيز من الحقل
   * أوّلاً، فيقع حفظُ المغادرة ثمّ حفظُ النقرة في نفس الدورة — طلبان ورسالتان
   * لفعلٍ واحد. و`busy` حالةٌ لا تُقرأ قبل إعادة الرسم، فالمرجع هو ما يمنعه.
   */
  const saving = useRef(false);
  /**
   * ★ هل على الشاشة نصٌّ لم يُحفظ بعد؟ — مرجعٌ لا حالة.
   *
   * لأنّ الاستقصاء صار يعيد جلب `/bot` كلّ بضع ثوانٍ أثناء تجهيز المعرفة،
   * ومزامنةُ الحقول مع كلّ وصولِ بيانات كانت **تمسح ما يكتبه المستخدم الآن**:
   * يكتب سطراً، يصل ردُّ الاستقصاء، فيعود الحقل إلى نصّ الخادم تحت يده.
   * فالمزامنة تقع حين لا يكون على الشاشة تغييرٌ غير محفوظ وحدها.
   */
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (dirtyRef.current) return;
    const d = bot.data?.draft ?? null;
    const p = d?.persona ?? bot.data?.published?.persona ?? '';
    const k = d?.knowledgeBase ?? bot.data?.published?.knowledgeBase ?? '';
    setPersona(p);
    setKnowledge(k);
    setServer({
      persona: p,
      knowledge: k,
      full: Boolean(d && typeof d.persona === 'string' && typeof d.knowledgeBase === 'string'),
    });
  }, [bot.data]);

  /* ── ما يُحسب قبل أيّ ارتدادٍ مبكّر: الخُطّافات لا تُشترَط ── */
  const cfg = bot.data?.config ?? null;
  const pub = bot.data?.published ?? null;
  const pubVersion = pub?.version ?? 0;

  /**
   * نسخةٌ أحدثُ من المنشورة وحالتُها في السجلّ:
   *  · `pending` ⟶ تُجهَّز معرفتها، والقديمة تخدم حتّى تجهز.
   *  · `failed`  ⟶ **فشل التجهيز**، والقديمة تخدم بلا نهاية. وهذه الحالة لم
   *    يكن لها أثرٌ في الشاشة إطلاقاً: نُشر ولا شيء تغيّر ولا شيء قيل.
   */
  const newer = (vers.data ?? []).filter((v) => v.version > pubVersion);
  /* السجلّ مرتّبٌ تنازليّاً، فأوّلُ ما يُوافِق هو الأحدث. */
  const embedding = newer.find((v) => v.embedStatus === 'pending') ?? null;
  const embedFailed = newer.find((v) => v.embedStatus === 'failed') ?? null;
  /**
   * ★ ذاكرةُ الجلسة تُصدَّق **ما لم يقل السجلّ غيرها**.
   *
   * وإلّا وقع هذا: نُشرت نسخةٌ وفشل تضمينُها، فيبقى `pending` في الذاكرة
   * ويبقى زرُّ النشر معطَّلاً بحجّة «تُجهَّز معرفتها الآن» — فلا يستطيع
   * العميل إعادة المحاولة **أبداً** بعد إخفاقٍ واحد. فإن ورد صفُّها في
   * السجلّ فهو الحَكَم، وإن لم يرد بعد (لحظةَ النشر) فالذاكرة.
   */
  const pendingRow = pending === null
    ? undefined
    : (vers.data ?? []).find((v) => v.version === pending);
  const clientPending = pending !== null && pubVersion < pending
    && (!pendingRow || pendingRow.embedStatus === 'pending')
    ? pending
    : null;
  const pendingVersion = embedding?.version ?? clientPending;
  const pendingEmbed = pendingVersion !== null;
  const failedVersion = !embedding && embedFailed ? embedFailed.version : null;
  const publishedAt = (vers.data ?? []).find((v) => v.version === pubVersion)?.publishedAt ?? null;

  const fileSources = (kb.data?.sources ?? []).filter((s) => s.kind === 'file');
  const filesPending = fileSources.some((s) => s.status === 'pending');

  /**
   * ★ الوعدان صار لهما منفّذ — ومدّةٌ محدودةٌ لكلٍّ منهما.
   *
   * والاستقصاء يسأل **السجلّ** وحده لا `/bot`: لأنّ وصولَ `/bot` يُعيد ملء
   * حقلَي الشخصيّة والمعرفة، وردٌّ بطيءٌ انطلق قبل حفظِك يعيد إلى الشاشة نصّاً
   * قديماً تحت يدك. فالسجلّ يُسأل كلّ خمس ثوانٍ، و`/bot` يُنادى **مرّةً
   * واحدة** حين تجهز النسخة فعلاً.
   */
  const embedStalled = usePoll(pendingEmbed, 5_000, 60, () => { void vers.reload(); });
  const filesStalled = usePoll(filesPending, 4_000, 45, () => { void kb.reload(); });

  /** جهزت المعلَّقة: نداءٌ واحدٌ يُحدِّث المنشورة — والمرجعُ يمنع تكراره. */
  const readyRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingVersion === null) return;
    const v = (vers.data ?? []).find((x) => x.version === pendingVersion);
    if (v?.embedStatus === 'ready' && readyRef.current !== pendingVersion) {
      readyRef.current = pendingVersion;
      void bot.reload();
      void kb.reload();
    }
  }, [vers.data, pendingVersion, bot, kb]);

  /* حوارٌ `aria-modal` بلا مخرجٍ من لوحة المفاتيح مصيدة. */
  useEffect(() => {
    if (!ask) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAsk(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask]);

  /**
   * ★ الهيكلُ للتحميل **الأوّل** وحده، والخطأُ الكاملُ حين لا بيانات.
   *
   * وإلّا فالاستقصاء يمحو الشاشة كلّ خمس ثوانٍ: `reload` يرفع `loading`، فيرتدّ
   * الرسمُ إلى هيكلٍ ثمّ يعود — وميضٌ يُقرأ عطلاً، ويسرق التركيز من الحقل الذي
   * يكتب فيه المستخدم. فما دامت البيانات في اليد، تبقى الشاشة مرسومةً أثناء
   * التحديث، ويُقال الخطأُ العابر في مكانه بلا أن يهدم ما حوله.
   */
  if (bot.loading && !bot.data) return <Skeleton rows={5} />;
  if (bot.error && !bot.data) return <ErrorBox message={bot.error} onRetry={bot.reload} />;

  const personaUnits = readUnits(persona);
  const kbUnits = readUnits(knowledge);
  const fileChars = fileSources.reduce((a, s) => a + s.charCount, 0);
  const fileUnits = fileUnitsOf(fileChars);
  const draftMode = decideMode(kbUnits);
  const liveMode = pub?.knowledgeMode ?? null;

  /**
   * سببُ القفل — سببان متمايزان لا سببٌ واحد:
   * الانتحال قراءةٌ فقط (يرفضه الخادم لأيّ فعلٍ كاتب)، والموظّف لا يملك
   * صلاحيّة الإعدادات أصلاً. وإخفاء الفرق يجعل الموظّف يظنّ الشاشة معطوبة.
   */
  const lockReason = can.readOnly
    ? 'أنت تشاهد بهويّة العميل — والانتحال قراءةٌ فقط.'
    : !can.settings
      ? 'ضبط البوت لمالك الحساب. اطلب الصلاحيّة منه — وحسابك يقرأ كلّ شيء هنا.'
      : null;
  const locked = Boolean(lockReason);

  const personaChanged = persona !== (pub?.persona ?? '');
  const kbChanged = knowledge !== (pub?.knowledgeBase ?? '');
  /** ★ المعيار فرقٌ حقيقيّ عن المنشورة — لا وجودُ صفّ مسوّدةٍ في القاعدة. */
  /* ★ والملفّات طرفٌ في الفرق — ولم تكن.
     كان `changed` يُقاس على الشخصيّة ونصّ الحقل وحدهما، فرفعُ ملفٍّ بعد
     آخر نشرٍ لا يفتح زرّ النشر: الملاحظة تقول «انشر من جديد» والزرّ يقول
     «لا شيء لتنشره» — طريقٌ مسدودٌ بنصَّين متناقضَين.
     والمقارنة بمجموع أحرف الملفّات الجاهزة مقابل ما دخل النسخة المنشورة. */
  const readyChars = (kb.data?.sources ?? [])
    .filter((x) => x.status === 'ready')
    .reduce((n, x) => n + (x.charCount ?? 0), 0);
  const publishedFileChars = pub?.sourceChars ?? null;
  const filesChanged = publishedFileChars !== null && readyChars !== publishedFileChars;
  const changed = personaChanged || kbChanged || filesChanged;
  /**
   * ★ «غير محفوظ» = **فرقٌ عن نصّ القاعدة**، لا غيابُ صفّ مسوّدة.
   *
   * كان الشرط يحمل `|| !server.full`، فالعميل الجديد (لا مسوّدة في القاعدة —
   * وهو حاله تماماً) يُفتح له الشريط «لديك تغييرٌ غير محفوظ» **بلا أن يكتب
   * حرفاً**. ونقصُ المسوّدة يُلزِم الحفظ **فقط حين يوجد ما يُنشَر**.
   */
  const textChanged = persona !== server.persona || knowledge !== server.knowledge;
  const unsaved = textChanged || (changed && !server.full);
  /* المرجع يُحدَّث في الرسم ويُقرأ في أثر المزامنة — فلا يكتب الاستقصاء فوق يدٍ تكتب */
  dirtyRef.current = textChanged;

  const personaDelta = lineDelta(pub?.persona ?? '', persona);
  const kbDelta = lineDelta(pub?.knowledgeBase ?? '', knowledge);

  const publishReason = lockReason
    ?? (pendingEmbed
      ? `v${pendingVersion} تُجهَّز معرفتها الآن — انتظر جهوزها قبل نشرٍ جديد.`
      : null)
    ?? (!changed ? 'لا فرق عن النسخة المنشورة — لا شيء لتنشره.' : null)
    ?? (unsaved ? 'على الشاشة تغييرٌ غير محفوظ. احفظ المسوّدة أوّلاً — النشر ينشر المحفوظة.' : null);
  const saveReason = lockReason ?? (!unsaved ? 'لا تغييرَ غير محفوظ.' : null);

  async function saveDraft() {
    if (saving.current) return;
    saving.current = true;
    setBusy('save');
    try {
      await put('/bot/draft', { persona, knowledgeBase: knowledge });
      setServer({ persona, knowledge, full: true });
      toast('حُفظت المسوّدة — والبوت الحيّ ما زال على النسخة المنشورة');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر الحفظ');
    } finally {
      saving.current = false;
      setBusy(null);
    }
  }

  /**
   * حفظٌ عند مغادرة الحقل — و`onBlur` على الحاوي لا على الحقل: `focusout`
   * يتصعّد في React، وطبقة المكوّنات لا تُثقَل بمعالجٍ لأجل شاشةٍ واحدة.
   */
  function autoSave() {
    // على فرق النصّ وحده — لا على «لا مسوّدة في القاعدة»
    if (!locked && textChanged && !busy) void saveDraft();
  }

  /**
   * ★ النشر **لا يكتمل فوراً** فوق عتبة المعرفة.
   *
   * حين `mode !== 'full'` **لا يُحدَّث `publishedVersionId` إطلاقاً** — تُوسم
   * النسخة `pending` ويُدفع التضمين للطابور، ولا تصير المنشورةَ إلّا حين
   * يُنهي العامل. والمعيار هنا فرقٌ عن **المنشورة**، فكان يقع هذا:
   *   · الشريط «لديك تغييرات غير منشورة» يبقى بحاله **بعد نشرٍ ناجح**،
   *   · وزرّ «انشر» يُعاد تسليحه، فنقرةٌ ثانية تُنشئ نسخة N+2 ومهمّةَ
   *     تضمينٍ ثانية — على معرفةٍ كبيرة، أي على عميلك الجدّيّ تحديداً.
   * فنتذكّر رقم النسخة المعلَّقة، **والسجلّ يتذكّرها بعدنا** فلا تضيع الحالة
   * مع تحديث الصفحة.
   */
  async function publish() {
    setBusy('publish');
    try {
      const r = await post<{
        version: { version: number }; knowledgeMode: string; embedding: boolean; kbTokens: number;
        live: boolean;
      }>('/bot/publish', { note: null });

      setAsk(null);
      if (r.embedding) {
        setPending(r.version.version);
        toast(`نُشرت v${r.version.version} — تُجهَّز معرفتها الآن، والنسخة السابقة تخدم حتّى تجهز.`);
      } else {
        setPending(null);
        /* ★ التوستة تقرأ `live` من الخادم ولا تفترض.
           كانت تقول «بوتك يردّ بها من الآن» في كلّ حال — بينما البوت قد يكون
           مطفأً فلا يردّ بشيء. وإعلانُ نجاحٍ لم يقع هو العطل الذي يدفع ثمنَه
           العميلُ حين يكتشف من شكوى زبون. */
        toast(r.live
          ? 'نُشرت النسخة الجديدة — بوتك يردّ بها من الآن'
          : 'نُشرت النسخة الجديدة — وبوتك متوقّف، فلن يردّ حتّى تشغّله.');
      }
      await bot.reload();
      await kb.reload();
      await vers.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر النشر');
    } finally { setBusy(null); }
  }

  /**
   * ★ **إيقاف البوت فعلٌ على كلّ زبائنك** — لا على هذه الشاشة.
   *   فالإطفاء يمرّ بورقةٍ تقول العاقبة، والتشغيل لا يحتاجها: إعادةُ خدمةٍ
   *   لا سلبُها. (تأكيدُ الخطر بخطوتين، ومكانُ الخطوة الثانية الورقة.)
   */
  async function toggleBot(next: boolean) {
    setBusy('toggle');
    try {
      await post('/bot/toggle', { enabled: next });
      setAsk(null);
      toast(next
        ? 'عاد بوتك يردّ على زبائنك'
        : 'أُوقف بوتك — كلّ رسالةٍ تصل تنتظر موظّفاً الآن');
      await bot.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر تغيير حالة البوت');
    } finally { setBusy(null); }
  }

  /** التفعيل اليدويّ يُصفّر قاطع الدائرة — العميل أصلح الخلل عند نظامه. */
  async function reenableTool(id: string) {
    setBusyTool(id);
    try {
      await patch(`/bot/tools/${id}`, { enabled: true });
      toast('أُعيد تفعيلها، وصُفّر عدّاد الإخفاق');
      await tools.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر إعادة التفعيل');
    } finally { setBusyTool(null); }
  }

  /**
   * ★ حذفُ أداة — `DELETE /bot/tools/:id` موجودٌ في الخادم ولم يكن له زرٌّ
   *   في الشاشة إطلاقاً. وهو فعلٌ لا يُسحب: يمحو المسار والمعاملات والسرّ.
   */
  async function deleteTool(id: string, name: string) {
    setBusyTool(id);
    try {
      await del(`/bot/tools/${id}`);
      setAsk(null);
      toast(`حُذفت أداة «${name}» — ولن يناديها بوتك بعد الآن`);
      await tools.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر الحذف');
    } finally { setBusyTool(null); }
  }

  /* شارةُ التبويب للمعطَّل آليّاً وحده: عددُ الأدوات ليس تنبيهاً، والتعطيل هو. */
  const toolList = tools.data ?? [];
  const brokenTools = toolList.filter((t) => t.disabledReason);
  const okTools = toolList.filter((t) => !t.disabledReason);
  const tabs = TABS.map((t) => (t.id === 'tools' ? { ...t, badge: brokenTools.length } : t));

  const newToolBtn = (wide: boolean) => (
    <Button
      variant="primary"
      wide={wide}
      disabled={locked}
      reason={lockReason ?? undefined}
      onClick={() => setEditing({ ...EMPTY_DRAFT })}
    >
      + أداةٌ جديدة
    </Button>
  );

  const saveBtn = (wide: boolean) => (
    <Button
      onClick={() => void saveDraft()}
      wide={wide}
      variant={wide ? 'primary' : 'quiet'}
      busy={busy === 'save'}
      disabled={Boolean(saveReason)}
      reason={saveReason ?? undefined}
    >
      احفظ المسوّدة
    </Button>
  );

  const publishBtn = (wide: boolean) => (
    <Button
      variant="primary"
      wide={wide}
      onClick={() => setAsk({ k: 'publish' })}
      busy={busy === 'publish'}
      disabled={Boolean(publishReason)}
      reason={publishReason ?? undefined}
    >
      انشر للزبائن
    </Button>
  );

  /* ═══════════ لافتةُ الحالة: جملةٌ واحدةٌ تقول ما يجري ببوتك ═══════════ */
  /* الترتيب إلحاحٌ لا زمن: المتوقّف أوّلاً، ثمّ أداةٌ عاطلة، ثمّ تجهيزٌ فاشل،
     ثمّ تجهيزٌ جارٍ، ثمّ تغييرٌ لم يُنشر، ثمّ الطمأنينة. */
  let bandTone: 'crit' | 'warn' | 'ok' | 'info' = 'ok';
  let bandMark = '●';
  let bandTitle = 'بوتك يعمل';
  let bandSub: ReactNode = null;
  let bandAction: ReactNode = null;

  if (!cfg) {
    bandTone = 'info';
    bandMark = '○';
    bandTitle = 'لم يُضبط بوتك بعد';
    bandSub = <>اكتب شخصيّته ومعرفته ثمّ انشرهما — ولا يردّ على زبونٍ قبل أن تنشر.</>;
  } else if (!cfg.enabled) {
    bandTone = 'crit';
    bandMark = '■';
    bandTitle = 'بوتك متوقّف — لا يردّ على أحد';
    bandSub = (
      <>
        كلّ رسالةٍ تصل تنتظر موظّفاً، ولا يعلم زبونك أنّ أحداً سيردّ.
        {pub ? <> ونسختك <span className="num">{`v${pub.version}`}</span> محفوظةٌ كما هي.</> : null}
        {' '}ويعود بضغطة «شغّل البوت».
      </>
    );
  } else if (brokenTools.length > 0) {
    bandTone = 'crit';
    bandMark = '■';
    bandTitle = 'أداةٌ عُطِّلت آليّاً — بوتك يجيب بلا نظامك';
    bandSub = (
      <>
        <Amount n={brokenTools.length} forms={TOOL_FORMS} /> من{' '}
        <Amount n={toolList.length} forms={['أداةٍ واحدة', 'أداتَين', 'أدوات', 'أداةً']} />{' '}
        توقّفت بعد إخفاقاتٍ متتالية عند نظامك. وحتّى تُصلحها، يجيب بوتك من نصّ معرفتك
        وحده — وقد يُعطي سعراً قديماً.
      </>
    );
    bandAction = <Button size="sm" onClick={() => setTab('tools')}>افتح الأدوات</Button>;
  } else if (failedVersion !== null) {
    bandTone = 'crit';
    bandMark = '■';
    bandTitle = 'تعذّر تجهيز معرفة النسخة الجديدة';
    bandSub = (
      <>
        <span className="num">{`v${failedVersion}`}</span> نُشرت ولم يكتمل تجهيز معرفتها، فبقيت{' '}
        {pub ? <span className="num">{`v${pub.version}`}</span> : 'النسخة السابقة'} تخدم زبائنك بلا انقطاع.
        راجِع معرفتك وانشر من جديد — وإن تكرّر فأبلِغنا.
      </>
    );
  } else if (pendingEmbed) {
    bandTone = 'warn';
    bandMark = '▲';
    bandTitle = 'نُشرت نسختك — وتُجهَّز معرفتها الآن';
    bandSub = (
      <>
        معرفتك فوق العتبة الأولى، فتُقطَّع وتُضمَّن قبل أن تصير النسخةَ الحيّة.
        و{pub ? <span className="num">{`v${pub.version}`}</span> : 'النسخة السابقة'} تخدم زبائنك
        حتّى تجهز — بلا انقطاع.
        {embedStalled
          ? ' وقد تأخّر التجهيز أكثر من المعتاد — حدِّث الحالة أو عُد بعد قليل.'
          : ' وتُحدَّث هذه اللافتة من نفسها عند الجهوز.'}
      </>
    );
    if (embedStalled) {
      bandAction = (
        <Button size="sm" onClick={() => { void bot.reload(); void vers.reload(); }}>
          حدِّث الحالة
        </Button>
      );
    }
  } else if (changed) {
    bandTone = 'warn';
    bandMark = '▲';
    bandTitle = 'تغييراتك لم تصل زبائنك بعد';
    bandSub = (
      <>
        {unsaved
          ? 'على الشاشة تغييرٌ غير محفوظ — احفظ المسوّدة أوّلاً. '
          : 'محفوظةٌ كمسوّدة. '}
        {pub
          ? <>وبوتك ما زال يردّ بـ<span className="num">{`v${pub.version}`}</span> حتّى تنشر،
            فلا تُقطع محادثةٌ جارية.</>
          : <>ولا نسخةَ منشورةَ بعد: لا يصل زبائنك شيءٌ ممّا كتبتَه حتّى تنشر.</>}
      </>
    );
  } else {
    bandTone = 'ok';
    bandMark = '●';
    bandTitle = pub ? 'بوتك يعمل — وما تقرؤه هنا هو ما يخدم زبائنك' : 'بوتك يعمل';
    bandSub = (
      <>
        {pub
          ? <>النسخة <span className="num">{`v${pub.version}`}</span> هي التي تردّ على زبائنك
            {publishedAt ? <> · نُشرت {fmt.when(publishedAt)}</> : null} · لا تغييرَ معلَّق.</>
          : <>لا نسخةَ منشورةَ بعد: اكتب الشخصيّة والمعرفة ثمّ انشر.</>}
      </>
    );
  }

  /* ═══════════ الرصيف: فعلُ الشاشة الأوّل في مدى الإبهام ═══════════ */
  let dockPrimary: ReactNode = null;
  let dockSecondary: ReactNode = null;
  let dockHint: string;

  if (unsaved) {
    dockPrimary = saveBtn(true);
    dockHint = 'الحفظ لا يمسّ زبوناً: يبقى بوتك على نسخته المنشورة حتّى تنشر.';
    if (tab === 'tools') dockSecondary = newToolBtn(false);
  } else if (changed) {
    dockPrimary = publishBtn(true);
    dockHint = pendingEmbed
      ? 'نسخةٌ تُجهَّز معرفتها الآن — والنشر يُتاح بعد جهوزها.'
      : 'النشر يُبدّل النسخة التي تخدم زبائنك — ولا يقطع محادثةً جارية.';
    if (tab === 'tools') dockSecondary = newToolBtn(false);
  } else if (tab === 'tools') {
    dockPrimary = newToolBtn(true);
    dockHint = 'كلّ أداةٍ نداءٌ إلى نظامك — والبوت يستعملها بوصفها، فالوصف نصف الأداة.';
  } else if (tab === 'behave') {
    dockHint = 'لا شيء في هذا التبويب يُعدَّل من هنا — وما تُعدّله أنت في «الشخصيّة» و«المعرفة».';
    dockPrimary = <Button onClick={() => setTab('persona')}>اذهب إلى الشخصيّة</Button>;
  } else {
    dockHint = pub
      ? 'لا تغييرَ معلَّق — ما تقرؤه هنا هو نفسه ما يخدم زبائنك الآن.'
      : 'لا نسخةَ منشورةَ بعد: اكتب الشخصيّة والمعرفة ثمّ انشر.';
  }

  return (
    <div className="bot-page">
      {node}

      <PageHead
        title="البوت"
        sub="خمسة أشياء تجعل بوتك مختلفاً — وكلّها بياناتٌ تضبطها أنت."
        actions={(
          <Row gap="sm">
            <Pill
              tone={cfg?.enabled ? 'ok' : 'crit'}
              label={cfg?.enabled ? 'يردّ على زبائنك' : 'متوقّف'}
            />
            {pub && <Pill tone="neutral" label={`المنشورة v${pub.version}`} mark={false} />}
            {/* ★ `pub.embedStatus === 'pending'` لا يشتعل أبداً: العامل يكتب
                `ready` و`publishedVersionId` في معاملةٍ واحدة. فالحالة الموجودة
                فعلاً — نسخةٌ نُشرت وتُجهَّز — هي التي لم يكن لها مؤشّر. */}
            {pendingEmbed && <Pill tone="warn" label={`v${pendingVersion} تُجهَّز معرفتها…`} />}
            {/* ★ أخطرُ فعلٍ في الشاشة لا يكون أضعفَ زرٍّ فيها: الإطفاء `danger`
                وخلفه ورقةٌ تقول ما يحدث لرسائل زبائنك. والتشغيل بلا ورقة. */}
            <Button
              variant={cfg?.enabled ? 'danger' : 'primary'}
              busy={busy === 'toggle'}
              disabled={locked}
              reason={lockReason ?? undefined}
              onClick={() => { if (cfg?.enabled) setAsk({ k: 'stop' }); else void toggleBot(true); }}
            >
              {cfg?.enabled ? 'أوقف البوت' : 'شغّل البوت'}
            </Button>
          </Row>
        )}
      />

      {/* خطأٌ عابرٌ على بياناتٍ موجودة: يُقال ولا يهدم الشاشة — وما يُعرض
          تحته آخرُ ما وصلنا لا الحقيقةَ اللحظيّة. */}
      {bot.error && bot.data && (
        <Note tone="warn">
          <b>تعذّر تحديث حالة بوتك الآن.</b> ما تراه أدناه آخرُ ما وصلنا.{' '}
          <Button size="sm" onClick={() => { void bot.reload(); void vers.reload(); }}>
            أعِد المحاولة
          </Button>
        </Note>
      )}

      <div className={`bot-band ${bandTone}`} role="status">
        <span className="bot-band-m" aria-hidden="true">{bandMark}</span>
        <div className="bot-band-t">
          <b>{bandTitle}</b>
          <span>{bandSub}</span>
        </div>
        {bandAction && <div className="bot-band-a">{bandAction}</div>}
      </div>

      {/* ═══ ما سيصل زبائنك: الملخَّص حاضرٌ دائماً، والتفصيل تحت طيّة ═══ */}
      {changed && !pendingEmbed && (
        <div className="sect">
          <div className="sect-h">
            <h2>ما سيصل زبائنك عند النشر</h2>
            <span className="sect-c">مقارنةً بالنسخة التي تخدمهم الآن</span>
          </div>

          <div className="rows bot-rows">
            {personaChanged && (
              <div className="row-m">
                <span className="rm-k">
                  الشخصيّة
                  <span className="rm-note">من هو بوتك، ونبرته، وما يرفض الحديث فيه</span>
                </span>
                <span className="rm-v">
                  <span className="num">{fmt.num(personaUnits)}</span> <small>{UNIT}</small>
                </span>
                <span className="rm-c">
                  {personaDelta.added > 0 && (
                    <Tag tone="ok" label={amountText(personaDelta.added, LINE_ADD)} mark={false} />
                  )}
                  {personaDelta.removed > 0 && (
                    <Tag tone="crit" label={amountText(personaDelta.removed, LINE_DEL)} mark={false} />
                  )}
                </span>
              </div>
            )}
            {kbChanged && (
              <div className="row-m">
                <span className="rm-k">
                  نصّ المعرفة
                  <span className="rm-note">الأسعار والساعات والخدمات — وما يجيب به بوتك</span>
                </span>
                <span className="rm-v">
                  <span className="num">{fmt.num(kbUnits)}</span> <small>{UNIT}</small>
                </span>
                <span className="rm-c">
                  {kbDelta.added > 0 && (
                    <Tag tone="ok" label={amountText(kbDelta.added, LINE_ADD)} mark={false} />
                  )}
                  {kbDelta.removed > 0 && (
                    <Tag tone="crit" label={amountText(kbDelta.removed, LINE_DEL)} mark={false} />
                  )}
                  {draftMode !== liveMode && (
                    <Tag tone="cool" label={`وضع القراءة يتغيّر إلى: ${MODE[draftMode]!.label}`} />
                  )}
                </span>
              </div>
            )}
          </div>

          {unsaved && (
            <Note tone="warn">
              <b>على الشاشة تغييرٌ غير محفوظ.</b> النشر ينشر المسوّدة المحفوظة على الخادم،
              لا ما تراه الآن. احفظ أوّلاً ليدخل ما كتبته في هذه النسخة.
            </Note>
          )}

          <details className="bot-more">
            <summary>أرِني الفرق سطراً سطراً</summary>
            <div className="bot-more-b">
              {personaChanged && (
                <div>
                  <span className="bot-diff-h">الشخصيّة — الفرق عن المنشورة</span>
                  {/* نصٌّ كتبه العميل: الاتّجاه من محتواه */}
                  <div className="bot-diff" dir="auto">
                    <DiffView before={pub?.persona ?? ''} after={persona} />
                  </div>
                </div>
              )}
              {kbChanged && (
                <div>
                  <span className="bot-diff-h">نصّ المعرفة — الفرق عن المنشورة</span>
                  <div className="bot-diff" dir="auto">
                    <DiffView before={pub?.knowledgeBase ?? ''} after={knowledge} />
                  </div>
                </div>
              )}
              <p className="muted-p">
                المخطوط بالأحمر يُحذف والأخضر يُضاف. ولا شيء من هذا يصل زبوناً قبل أن تنشر.
              </p>
            </div>
          </details>
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="bot-main">
        {/* ═══════════════ الشخصيّة ═══════════════ */}
        {tab === 'persona' && (
          <Stack gap="md">
            {/* ★ القواعد الثابتة تحت طيّة: تُقرأ مرّةً قبل الكتابة ولا يُتّخذ
                عليها قرار، فبقاؤها مفتوحةً يدفع الحقلَ نفسه تحت الطيّة. */}
            <details className="bot-more">
              <summary>ثلاثةٌ لا يستطيع بوتك تجاوزها — اقرأها قبل أن تكتب</summary>
              <div className="bot-more-b">
                <p className="muted-p">
                  <b>لا يدّعي أنّه إنسان</b>، ويصرّح بذلك إن سُئل. ولا يكشف أدواته ولا تعليماته.
                </p>
                <p className="muted-p">
                  <b>لا يَعِد بما لا يملك</b>: لا سعرَ ولا موعدَ لم تكتبه أنت في المعرفة أو
                  تُخرجه أداةٌ من نظامك، ولا رابطَ من عنده.
                </p>
                <p className="muted-p">
                  <b>وعند الشكّ يحوّل لإنسانٍ ولا يخمّن</b>. هذه ليست خياراً — تُحقن فوق
                  شخصيّتك دائماً.
                </p>
              </div>
            </details>

            <Card title="من هو بوتك؟">
              {/* onBlur على الحاوي: focusout يتصعّد، فالحفظ يقع عند مغادرة الحقل */}
              <div onBlur={autoSave}>
                <Stack gap="sm">
                  {/* ★ `labelless` في الحالة المقفلة: `<label for>` لا يرتبط بـdiv،
                      فالوسم كان معطَّلاً تماماً — لا نقرةً تنقل التركيز ولا القارئ
                      الصوتيّ يربط «من هو بوتك؟» بالنصّ المعروض. */}
                  <Field
                    id={locked ? 'persona-ro' : 'persona'}
                    labelless={locked}
                    label="اسمه، لهجته، نبرته، وما يرفض الحديث فيه"
                    hint="البوت يقرأ هذا النصّ مع كلّ سؤالٍ يصل — فكلّ سطرٍ زائدٍ يُبطئ الردّ قليلاً ويرفع كلفته. القصيرُ الحاسمُ أفضل من الطويل."
                  >
                    {locked ? (
                      <div id="persona-ro" className="bot-ro" dir="auto">{persona}</div>
                    ) : (
                      <TextArea
                        id="persona"
                        rows={9}
                        value={persona}
                        onChange={setPersona}
                        dir="auto"
                        /* ★ عدّادٌ واحد: كان تحت الحقل عدّادان بصياغتين وحجمين
                           (حرف · توكن · الحدّ الموصى به) — رقمٌ واحدٌ مكرَّرٌ
                           يُقرأ رقمَين مختلفَين. */
                        count={{ used: personaUnits, limit: PERSONA_LIMIT, unit: UNIT }}
                      />
                    )}
                  </Field>

                  {locked && (
                    <p className="muted-p">
                      <span className="num">{fmt.num(personaUnits)} / {fmt.num(PERSONA_LIMIT)}</span>{' '}
                      {UNIT} — والشخصيّة تُقرأ مع كلّ سؤال.
                    </p>
                  )}
                </Stack>
              </div>
            </Card>
          </Stack>
        )}

        {/* ═══════════════ المعرفة ═══════════════ */}
        {tab === 'kb' && (
          <Stack gap="lg">
            {/* الهيكلُ للتحميل الأوّل وحده — والاستقصاء يعيد الجلب كلّ أربع
                ثوانٍ ما دام ملفٌّ قيد المعالجة، فلا يومض الجدول معه. */}
            {kb.loading && !kb.data && <Skeleton rows={3} />}
            {/* ★ فشل النداء لا يُعرض خبراً ساراً: بلا فحص الخطأ هنا تُرسم
                «لا ملفّات» على نداءٍ فشل — وطمأنينةٌ كاذبة أسوأ من خطأٍ ظاهر.
                وصندوقُ خطأٍ **واحد** لنداءٍ واحد: تكراره مرّتين يُقرأ عطلَين. */}
            {kb.error && <ErrorBox message={kb.error} onRetry={kb.reload} />}

            {kb.data && !kb.error && (
              <>
                {/* ★ الرقمُ البطوليُّ الواحد في هذه الشاشة: حجمُ نصّ معرفتك —
                    وهو ما يقرّر وضعَ القراءة عند النشر (‏`estimateTokens` على
                    حقل المسوّدة، لا على مجموع المصادر). ومعه سياقُه ملاصقاً:
                    تركيبُه، وسلّمُ عتبتَيه، وما يعنيه موقعُه عليه. */}
                <div className="bot-hero">
                  <Stat
                    hero
                    value={fmt.num(kbUnits)}
                    unit={UNIT}
                    label="في نصّ معرفتك — وهو ما يقرّر كيف يقرأ بوتك معرفته"
                  />
                  <KbScale units={kbUnits} />
                  <p className="muted-p">
                    <b>{MODE[draftMode]!.label}.</b> {MODE[draftMode]!.how}{' '}
                    والعلامتان على السلّم هما العتبتان التي يتحوّل عندهما الوضع.
                  </p>
                </div>

                <div className="sect">
                  <div className="sect-h">
                    <h2>كيف يقرأ بوتك معرفته</h2>
                    <span className="sect-c">المسوّدة مقابل ما يخدم زبائنك الآن</span>
                  </div>
                  <div className="rows bot-rows">
                    <div className="row-m">
                      <span className="rm-k">
                        وضعُ مسوّدتك
                        <span className="rm-note">ما سيصير عليه بوتك عند أوّل نشر</span>
                      </span>
                      <span className="rm-c">
                        <Tag tone="cool" label={MODE[draftMode]!.label} />
                      </span>
                    </div>
                    <div className="row-m">
                      <span className="rm-k">
                        الوضع الذي يخدم زبائنك الآن
                        <span className="rm-note">
                          {pub ? 'من النسخة المنشورة، لا من المسوّدة' : 'لا نسخةَ منشورةَ بعد'}
                        </span>
                      </span>
                      <span className="rm-c">
                        {liveMode
                          ? <Tag line label={MODE[liveMode]!.label} />
                          : <Tag line label="لم يُنشر بعد" />}
                        {liveMode && liveMode === draftMode && <Tag line label="لا فرق" />}
                      </span>
                    </div>
                    <div className="row-m">
                      <span className="rm-k">
                        ملفّاتك
                        <span className="rm-note">
                          {fileSources.length === 0
                            ? 'لا ملفّات — نصُّك وحده معرفتُه'
                            : liveMode === 'full'
                              ? 'في وضع «يقرأ نصَّك كاملاً» لا تدخل ردودَه — يُرسَل نصُّك وحده'
                              : liveMode
                                ? 'منها يستخرج بوتك ما يرتبط بالسؤال'
                                : 'تدخل معرفته عند أوّل نشرٍ يتجاوز العتبة الأولى'}
                        </span>
                      </span>
                      <span className="rm-v">
                        <span className="num">{fmt.num(fileUnits)}</span> <small>{UNIT}</small>
                      </span>
                      <span className="rm-c">
                        <Tag
                          line
                          label={fileSources.length === 0
                            ? 'لا ملفّات'
                            : amountText(fileSources.length, ['ملفٌّ واحد', 'ملفّان', 'ملفّات', 'ملفّاً'])}
                        />
                        {liveMode !== 'full' && kb.data && kb.data.chunks > 0 && (
                          <Tag line label={`${fmt.num(kb.data.chunks)} مقطعاً مُضمَّناً`} />
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ★ عاقبةٌ لا حالة: في وضع «يقرأ نصَّك كاملاً» **لا تُقرأ
                    الملفّات إطلاقاً** — العامل لا يُضمِّنها أصلاً، وعاملُ الردّ
                    يُرسل النصّ وحده. وعميلٌ رفع كتيّب خدماتٍ وظنّ بوته يقرؤه
                    يكتشف ذلك من ردٍّ خاطئٍ أمام زبون. */}
                {liveMode === 'full' && fileSources.length > 0 && (
                  <Note tone="warn">
                    <b>ملفّاتك لا تدخل ردود بوتك في الوضع الحاليّ.</b> دون العتبة الأولى يُرسَل
                    نصُّ معرفتك كاملاً ويكفيه، فلا يستخرج من الملفّات. انقل ما يجب أن يعرفه
                    منها إلى نصّ المعرفة أدناه — أو أبقِها حتّى يتجاوز نصُّك العتبة.
                  </Note>
                )}

                {/* ★ والوجه الآخر للعملة نفسها، وهو الأخطر لأنّه معكوسُ التوقّع:
                    فوق العتبة تُبنى معرفةُ النسخة من **الملفّات الجاهزة**، ولا
                    يُقطَّع نصُّ الحقل ما دام لها نصٌّ مستخرَج. فمن كتب سعراً في
                    الحقل ورفع كتيّباً يظنّ الاثنين يعملان — وواحدٌ منهما فقط. */}
                {liveMode !== null && liveMode !== 'full'
                  && fileSources.some((s) => s.status === 'ready' && s.charCount > 0) && (
                  <Note tone="warn">
                    <b>في الوضع الحاليّ يجيب بوتك من ملفّاتك، لا من نصّ المعرفة.</b> فوق العتبة
                    الأولى تُبنى معرفتُه من ملفّاتك الجاهزة وحدها، ويبقى النصّ أدناه مسوّدةً
                    لا يقرأها. فضَع ما يجب أن يعرفه في ملفّاتك — أو احذفها ليعود نصُّك هو
                    المصدر.
                  </Note>
                )}

                {/* ملفٌّ جاهزٌ رُفع بعد آخر نشر: مقاطعُ المعرفة تُبنى لكلّ نسخةٍ
                    عند نشرها، فما رُفع بعدها ليس فيها. */}
                {draftMode !== 'full' && publishedAt
                  && fileSources.some((s) => s.status === 'ready' && s.createdAt > publishedAt) && (
                  <Note tone="warn">
                    <b>رفعتَ ملفّاً بعد آخر نشر.</b> معرفةُ كلّ نسخةٍ تُبنى لحظةَ نشرها،
                    فلا يدخل هذا الملفّ ردودَ بوتك قبل أن تنشر من جديد.
                  </Note>
                )}
              </>
            )}

            <Card title="نصّ المعرفة">
              <div onBlur={autoSave}>
                <Stack gap="sm">
                  <Field
                    id={locked ? 'kb-text-ro' : 'kb-text'}
                    labelless={locked}
                    label="ماذا يعرف بوتك عن نشاطك؟"
                    hint="ابدأ كلّ قسمٍ بسطر عنوانٍ ينتهي بنقطتين — فالبوت يستخرج بالأقسام، والعنوان يرفع دقّة ما يجده."
                  >
                    {locked ? (
                      <div id="kb-text-ro" className="bot-ro" dir="auto">{knowledge}</div>
                    ) : (
                      <TextArea id="kb-text" rows={14} value={knowledge} onChange={setKnowledge} dir="auto" />
                    )}
                  </Field>

                  {/* لا تكرارَ لرقم الرقم البطوليّ أعلاه: هنا ما لا يقوله هو —
                      عددُ الأقسام المعنونة، وهو ما يرفع دقّة الاسترجاع. */}
                  <p className="muted-p">
                    <Amount n={headingsOf(knowledge)} forms={HEAD_FORMS} />
                    {headingsOf(knowledge) === 0
                      ? ' — أضِف عناوين («الأسعار:» · «ساعات العمل:») ترفع دقّة بوتك كثيراً.'
                      : ' — وكلّ قسمٍ بعنوانه يُسترجَع وحدةً واحدة.'}
                  </p>
                </Stack>
              </div>
            </Card>

            {/* لا قائمةَ ملفّاتٍ على نداءٍ فشل: صندوق الخطأ أعلاه يحمل «أعِد
                المحاولة»، وقائمةٌ فارغةٌ تحته تقول «لا ملفّات لديك» وهي كاذبة. */}
            {!kb.error && (
              /* ★ **لا `.sect` حول هذا الجزء** — والسبب بنيويّ لا ذوقيّ:
                  `.sect` حاويةٌ مسمّاة (`container-type: inline-size`)، ومواصفةُ
                  الاحتواء تنصّ على أنّ احتواء التخطيط يجعل العنصر **كتلةً حاويةً
                  لكلّ `position: fixed` بداخله**. وهذا الجزء يفتح نافذة معاينةٍ
                  وورقةَ حذفٍ كلتاهما `fixed`: لو سرى ذلك لحُبستا في صندوق القسم
                  بدل أن تغطّيا الشاشة.
                  وقِسته في كروم 153: لا يُطبِّقها على `container-type` (يُطبّقها
                  على `contain: layout` و`paint` صراحةً) — فالعطل لا يظهر هنا
                  اليوم، وقد يظهر في متصفّحٍ آخر أو إصدارٍ لاحق. وثمنُ تجنّبه
                  صفر: الرأسُ وحده يُؤخذ من القسم، والمحتوى في عمودٍ عاديّ. */
              <div className="stack md" id="kb-files">
                <div className="sect-h">
                  <h2>ملفّاتك</h2>
                  <span className="sect-c">نستخرج نصّها وتعاينه قبل أن تنشر</span>
                </div>
                <KnowledgeFiles
                  sources={(kb.data?.sources ?? []) as KbSource[]}
                  loading={kb.loading && !kb.data}
                  readOnly={locked}
                  lockReason={lockReason ?? undefined}
                  stalled={filesStalled}
                  onChanged={() => void kb.reload()}
                />
              </div>
            )}
          </Stack>
        )}

        {/* ═══════════════ الأدوات ═══════════════ */}
        {tab === 'tools' && (
          <Stack gap="lg">
            {editing && (
              <ToolBuilder
                initial={editing}
                onClose={() => setEditing(null)}
                onSaved={() => { setEditing(null); void tools.reload(); }}
              />
            )}

            {/* الحالات الثلاث مفروضةً بالنوع: `DataView` لا تُترجم بلا `empty` */}
            <DataView
              state={tools}
              skeletonRows={3}
              empty={{
                when: (list) => list.length === 0,
                title: 'لا أدوات مخصَّصة بعد',
                hint: 'بوتك يستعمل الأدوات الجاهزة (تحويل لموظّف، ملاحظات، خيارات سريعة). أضِف أداةً حين يكون عندك نظامٌ يستعلم منه — أسعارٌ، مخزونٌ، مواعيد، أو حساب زبون.',
                action: newToolBtn(false),
              }}
            >
              {(list) => {
                const broken = list.filter((t) => t.disabledReason);
                const fine = list.filter((t) => !t.disabledReason);

                const card = (t: Tool) => (
                  <Card
                    key={t.id}
                    // اسمٌ كتبه العميل — اتّجاهه من محتواه
                    title={<span dir="auto">{t.titleAr}</span>}
                    actions={(
                      <>
                        {t.disabledReason && <Pill tone="crit" label="معطَّلة آليّاً" />}
                        {/* ★ «مخصَّصة» ليست تحذيراً: كانت `warn` فكلّ أداةٍ بناها
                            العميل تبدو عطلاً دائماً. وسمٌ بصيغة الخطّ — بلا سطحٍ
                            فلا يُقرأ حالة. */}
                        <Tag line label={t.kind === 'http' ? 'مخصَّصة' : 'جاهزة'} />
                        {t.hasSecrets && <Tag tone="violet" label="لها سرٌّ محفوظ" />}
                      </>
                    )}
                  >
                    <Stack gap="sm">
                      <p className="muted-p" dir="auto">{t.description}</p>

                      {t.disabledReason && (
                        <Note tone="crit">
                          <span dir="auto">{t.disabledReason}</span>{' '}
                          <b>وحتّى تُصلح ذلك، يجيب بوتك من نصّ معرفتك وحده.</b>
                        </Note>
                      )}

                      {!!t.requiresCapabilities.length && (
                        <p className="muted-p">
                          تُخفى تلقائيّاً على قناةٍ لا تدعم ما تحتاجه — والقنوات التي تدعمه
                          تراها كما هي.
                        </p>
                      )}

                      {/* ★ سلاسلُ الآلة مطويّة: المفتاح والمسار لا يُتّخذ عليهما
                          قرار، وصاحب المطعم لا يعرفهما — ومن يسأل الدعم يجدهما. */}
                      <details className="bot-more">
                        <summary>تفاصيلُ تقنيّة — لا يُتّخذ عليها قرار</summary>
                        <div className="bot-more-b">
                          <p className="muted-p">
                            الاسم الذي يناديها به بوتك:{' '}
                            <span className="mono bot-toolkey">{t.key}</span>
                          </p>
                          {t.http?.url && (
                            <p className="muted-p">
                              تنادي:{' '}
                              <span className="mono bot-toolkey">
                                {`${t.http.method ?? 'GET'} ${t.http.url}`}
                              </span>
                            </p>
                          )}
                          {!!t.requiresCapabilities.length && (
                            <p className="muted-p">
                              تحتاج من القناة:{' '}
                              {t.requiresCapabilities.map((c, i) => (
                                <span key={c}>
                                  {i > 0 && '، '}
                                  <span className="mono">{c}</span>
                                </span>
                              ))}
                            </p>
                          )}
                        </div>
                      </details>

                      <div className="bot-acts">
                        <Button
                          size="sm"
                          disabled={locked}
                          reason={lockReason ?? undefined}
                          onClick={() => setEditing(toDraft(t))}
                        >
                          عدّلها وجرّبها
                        </Button>
                        {t.disabledReason && (
                          <Button
                            size="sm"
                            variant="primary"
                            busy={busyTool === t.id}
                            disabled={locked}
                            reason={lockReason ?? undefined}
                            onClick={() => void reenableTool(t.id)}
                          >
                            أعِد تفعيلها
                          </Button>
                        )}
                        {/* ★ الحذف موجودٌ في الخادم ولم يكن له زرّ. وهو فعلٌ لا
                            يُسحب، فيُنفى إلى نهاية الصفّ وخلفه ورقةُ تأكيد.
                            ★ وللمخصَّصة وحدها: الجاهزةُ لا يبنيها الباني، فحذفُها
                            فقدٌ **لا يستطيع العميل التراجع عنه من هذه الشاشة
                            أصلاً** — والخادم يسمح به، والشاشة لا تعرضه. */}
                        {t.kind === 'http' && (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={locked}
                            reason={lockReason ?? undefined}
                            onClick={() => setAsk({ k: 'tool', id: t.id, name: t.titleAr })}
                          >
                            احذفها
                          </Button>
                        )}
                      </div>
                    </Stack>
                  </Card>
                );

                return (
                  <Stack gap="lg">
                    {/* ★ التجميع بالإلحاح قبل الزمن، والرأسُ يحمل عدده: من
                        يفتح هذا التبويب يفتحه لأنّ أداةً توقّفت. */}
                    {broken.length > 0 && (
                      <div className="sect">
                        <div className="sect-h">
                          <h2>عُطِّلت آليّاً — بوتك يجيب بلا نظامك</h2>
                          <span className="sect-c">
                            <Amount n={broken.length} forms={TOOL_FORMS} />
                            {' '}من <span className="num">{fmt.num(list.length)}</span>
                          </span>
                        </div>
                        <Grid min={400}>{broken.map(card)}</Grid>
                      </div>
                    )}

                    {fine.length > 0 && (
                      <div className="sect">
                        <div className="sect-h">
                          <h2>تعمل بسلام</h2>
                          <span className="sect-c">
                            <Amount n={fine.length} forms={TOOL_FORMS} />
                          </span>
                        </div>
                        <Grid min={400}>{fine.map(card)}</Grid>
                      </div>
                    )}

                    <details className="bot-more">
                      <summary>حدودٌ مفروضةٌ بالكود لا بالشاشة</summary>
                      <div className="bot-more-b">
                        <p className="muted-p">
                          HTTPS فقط · رفض العناوين الداخليّة بعد حلّ الاسم وعند كلّ تحويل ·
                          مهلة <span className="num">8</span> ثوانٍ · <span className="num">256</span>{' '}
                          كيلوبايت للردّ · وتعطيلٌ آليّ بعد <span className="num">5</span> إخفاقاتٍ
                          متتالية مع إشعارك.
                        </p>
                      </div>
                    </details>
                  </Stack>
                );
              }}
            </DataView>
          </Stack>
        )}

        {/* ═══════════════ السلوك ═══════════════ */}
        {tab === 'behave' && (
          cfg ? (
            <Stack gap="lg">
              <div className="sect">
                <div className="sect-h">
                  <h2>بعد أن يتدخّل موظّفك</h2>
                </div>
                <div className="rows bot-rows">
                  <div className="row-m">
                    <span className="rm-k">
                      يسكت بوتك عن تلك المحادثة
                      <span className="rm-note">
                        أقصرُ من اللازم يقطع على موظّفك كلامه، وأطولُ منه يترك الزبون بلا ردّ.
                      </span>
                    </span>
                    <span className="rm-v">
                      <span className="num">{fmt.num(cfg.pauseMinutes)}</span> <small>دقيقة</small>
                    </span>
                    <span className="rm-c">
                      <Tag line label="ثمّ يُستأنف من نفسه" />
                    </span>
                  </div>
                </div>
              </div>

              <div className="sect">
                <div className="sect-h">
                  <h2>ما يقوله حين يعجز</h2>
                  <span className="sect-c">نصٌّ يقرؤه زبونك بحرفه</span>
                </div>
                {cfg.failMessage
                  ? <p className="bot-quote" dir="auto">{cfg.failMessage}</p>
                  : (
                    <p className="muted-p">
                      لم يُكتب نصٌّ خاصٌّ بك: يعتذر برسالةٍ افتراضيّةٍ مهذّبة ثمّ يحوّل المحادثة.
                    </p>
                  )}
                <p className="muted-p">
                  وبعدها تُحوَّل المحادثة إلى موظّف وتظهر في الإنبوكس بوسم «تحتاج تدخّلك».
                </p>
              </div>

              <div className="sect">
                <div className="sect-h">
                  <h2>وما يقوله خارج دوامك</h2>
                </div>
                {!cfg.businessHours?.days
                  ? (
                    <p className="muted-p">
                      لا ساعاتِ دوامٍ مضبوطة، فبوتك يردّ في كلّ وقت — وهذه الرسالة لا تُستعمل.
                    </p>
                  )
                  : cfg.outsideHoursMessage
                    ? <p className="bot-quote" dir="auto">{cfg.outsideHoursMessage}</p>
                    : (
                      <p className="muted-p">
                        لا رسالةَ خارج الدوام: يصمت بوتك عن الرسائل الواصلة خارج ساعات دوامك،
                        وتنتظر في الإنبوكس حتّى تفتح.
                      </p>
                    )}
              </div>

              {/* ★ التبويب كان ثلاثَ بطاقاتِ قراءةٍ بلا جملةٍ تقول من أين تُضبط،
                  وأرقاماً بلا وحدةٍ ولا عاقبة («دورات الأدوات: 3»). فما لا يُعدَّل
                  من هنا يُقال صريحاً ويُطوى، وكلّ رقمٍ معه عاقبتُه. */}
              <details className="bot-more">
                <summary>ثلاثةٌ يضبطها فريق المنصّة معك — لا تُعدَّل من هذه الشاشة</summary>
                <div className="bot-more-b">
                  <div className="sect">
                    <div className="rows bot-rows">
                      <div className="row-m">
                        <span className="rm-k">
                          النموذج الذي يفكّر به
                          <span className="rm-note">
                            {MODEL[pub?.model ?? ''] ?? 'النموذج الذي نشغّله لحسابك'}
                          </span>
                        </span>
                        <span className="rm-c">
                          {pub?.model
                            ? <span className="mono bot-toolkey">{pub.model}</span>
                            : <Tag line label="لم يُنشر بعد" />}
                        </span>
                      </div>
                      <div className="row-m">
                        <span className="rm-k">
                          كم مرّةً يسأل نظامك في الردّ الواحد
                          <span className="rm-note">
                            وبعدها يجيب بما عنده ولا يسأل مرّةً أخرى — سقفٌ يمنع الدوران.
                          </span>
                        </span>
                        <span className="rm-v">
                          <span className="num">{fmt.num(cfg.maxToolLoops)}</span>{' '}
                          <small>على الأكثر</small>
                        </span>
                      </div>
                      <div className="row-m">
                        <span className="rm-k">
                          كم رسالةً من المحادثة يتذكّر
                          <span className="rm-note">
                            آخرُ الرسائل وحدها تُرسَل معه — فما قبلها لا يذكره.
                          </span>
                        </span>
                        <span className="rm-v">
                          <span className="num">{fmt.num(cfg.contextMessages)}</span>{' '}
                          <small>رسالة</small>
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="muted-p">
                    هذه الثلاثة تُضبط معك عند التهيئة، ولو احتجت تغيير واحدةٍ منها فاطلبها من
                    فريقنا — ولا تُعدَّل من هنا لأنّ لها أثراً على كلفة كلّ ردّ.
                  </p>
                </div>
              </details>
            </Stack>
          ) : (
            <Empty
              title="لا سلوكَ محفوظاً بعد"
              hint="هذه الحدود تُنشأ مع أوّل نشرٍ لشخصيّة بوتك: مدّة سكوته بعد تدخّل موظّف، وكم مرّةً يسأل نظامك، وما يقوله حين يعجز. اكتب الشخصيّة وانشرها لتظهر."
              action={<Button onClick={() => setTab('persona')}>اذهب إلى الشخصيّة</Button>}
            />
          )
        )}
      </div>

      {/* ═══ الرصيف: آخرُ صفٍّ في العمود، لاصقٌ بأسفل المُمرِّر ═══ */}
      <div className="bot-dock">
        <Dock hint={dockHint}>
          {dockPrimary}
          {dockSecondary}
        </Dock>
      </div>

      {/* ═══ أوراقُ التأكيد: الخطوة الثانية لكلّ فعلٍ لا يُسحب ═══ */}
      <Sheet
        open={ask?.k === 'stop'}
        title="أوقف بوتك عن كلّ زبائنك؟"
        onClose={() => setAsk(null)}
        hint="ولا يمسّ هذا محادثةً يكتب فيها موظّفك — بوتك ساكتٌ عنها أصلاً."
        footer={(
          <Row gap="sm">
            <Button
              variant="danger"
              wide
              busy={busy === 'toggle'}
              onClick={() => void toggleBot(false)}
            >
              أوقفه الآن
            </Button>
            <Button onClick={() => setAsk(null)}>أبقِه يعمل</Button>
          </Row>
        )}
      >
        <p className="muted-p">
          <b>كلّ رسالةٍ تصل بعد الإيقاف تنتظر موظّفاً</b> — لا ردَّ آليّ، ولا يعلم زبونك
          أنّ أحداً سيردّ عليه.
        </p>
        <p className="muted-p">
          والأثر على قنواتك كلّها معاً، لا على محادثةٍ واحدة.
          {pub ? <> ونسختك <span className="num">{`v${pub.version}`}</span> تبقى محفوظةً كما هي،
            ويعود بوتك بضغطةٍ واحدة.</> : null}
        </p>
      </Sheet>

      <Sheet
        open={ask?.k === 'publish'}
        title="انشر للزبائن"
        onClose={() => setAsk(null)}
        hint="بعد النشر يردّ بوتك بالنسخة الجديدة على كلّ رسالةٍ قادمة — ولا تُقطع محادثةٌ جارية."
        footer={(
          <Row gap="sm">
            <Button
              variant="primary"
              wide
              busy={busy === 'publish'}
              disabled={Boolean(publishReason)}
              reason={publishReason ?? undefined}
              onClick={() => void publish()}
            >
              انشر الآن
            </Button>
            <Button onClick={() => setAsk(null)}>راجِع مرّةً أخرى</Button>
          </Row>
        )}
      >
        <div className="rows bot-rows">
          {personaChanged && (
            <div className="row-m">
              <span className="rm-k">الشخصيّة</span>
              <span className="rm-c">
                {personaDelta.added > 0 && (
                  <Tag tone="ok" mark={false} label={amountText(personaDelta.added, LINE_ADD)} />
                )}
                {personaDelta.removed > 0 && (
                  <Tag tone="crit" mark={false} label={amountText(personaDelta.removed, LINE_DEL)} />
                )}
              </span>
            </div>
          )}
          {kbChanged && (
            <div className="row-m">
              <span className="rm-k">نصّ المعرفة</span>
              <span className="rm-c">
                {kbDelta.added > 0 && (
                  <Tag tone="ok" mark={false} label={amountText(kbDelta.added, LINE_ADD)} />
                )}
                {kbDelta.removed > 0 && (
                  <Tag tone="crit" mark={false} label={amountText(kbDelta.removed, LINE_DEL)} />
                )}
              </span>
            </div>
          )}
        </div>
        {draftMode !== 'full' && (
          <p className="muted-p">
            معرفتك فوق العتبة الأولى، فتُقطَّع وتُضمَّن أوّلاً —
            و{pub ? <span className="num">{`v${pub.version}`}</span> : 'النسخة السابقة'} تخدم
            زبائنك حتّى تجهز الجديدة. قد يأخذ ذلك دقيقةً أو أكثر.
          </p>
        )}
        {draftMode !== liveMode && (
          <p className="muted-p">
            ووضعُ القراءة يتغيّر إلى <b>{MODE[draftMode]!.label}</b>: {MODE[draftMode]!.how}
          </p>
        )}
      </Sheet>

      <Sheet
        open={ask?.k === 'tool'}
        title="احذف هذه الأداة؟"
        onClose={() => setAsk(null)}
        hint="الحذف لا يُسحب: يمحو المسار والمعاملات والسرّ المحفوظ معها."
        footer={(
          <Row gap="sm">
            <Button
              variant="danger"
              wide
              busy={ask?.k === 'tool' && busyTool === ask.id}
              onClick={() => { if (ask?.k === 'tool') void deleteTool(ask.id, ask.name); }}
            >
              احذفها نهائيّاً
            </Button>
            <Button onClick={() => setAsk(null)}>أبقِها</Button>
          </Row>
        )}
      >
        <p className="muted-p">
          {ask?.k === 'tool' ? <><b dir="auto">«{ask.name}»</b> — </> : null}
          بعد الحذف يجيب بوتك من نصّ معرفتك وحده في كلّ سؤالٍ كانت تجيبه، وقد يُعطي سعراً
          قديماً أو يقول «لا أعرف» ويحوّل لموظّف.
        </p>
        <p className="muted-p">
          وإن كان العطل مؤقّتاً عند نظامك فالأفضل تعطيلها لا حذفها — تعود بنقرةٍ بعد الإصلاح.
        </p>
      </Sheet>
    </div>
  );
}
