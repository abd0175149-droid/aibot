'use client';

import { useEffect, useRef, useState } from 'react';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { put, post, patch, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { ToolBuilder, EMPTY_DRAFT, type ToolDraft } from '@/components/ToolBuilder';
import { KnowledgeFiles, type KbSource } from '@/components/KnowledgeFiles';
import {
  PageHead, Tabs, Card, Grid, Stack, Row, Stat, Pill, Note, Button, Field, TextArea,
  Skeleton, Empty, ErrorBox, DataView, DiffView, KV, KVRow,
} from '@/components/ui';

/**
 * شاشة البوت — الشاشة التي يقف عليها وعد المنتج: «اضبطه بنفسك».
 *
 * ★ القرار الذي أُعيد البناء من أجله: **لا نشرَ على العمياء.** كان شريط
 *   المسوّدة يقول «لديك تغييرات غير منشورة» ثمّ يعطيك زرّ «نشر» — والعميل
 *   يعدّل شخصيّةً من ثلاثين سطراً على ثلاث جلسات ثمّ ينشر وهو **لا يذكر ما
 *   غيّره**. فالفرق صار يُرسَم سطراً سطراً **قبل** الزرّ لا بعده، ومكوّن
 *   `DiffView` كان مبنيّاً في طبقة المكوّنات ولم يُستعمل قطّ.
 *
 * ★ وثلاثة أعطالٍ صامتة أُغلقت هنا:
 *   ① **النشر كان ينشر غير ما على الشاشة.** الحفظ يقع عند مغادرة الحقل،
 *      فمن كتب ثمّ ضغط «نشر» بالماوس مباشرةً نشر النصّ **السابق**. صار النشر
 *      ممتنعاً ما دام على الشاشة تغييرٌ غير محفوظ، والسبب مكتوبٌ على الزرّ.
 *   ② **الشريط لا يختفي بعد النشر.** الخادم لا يمحو المسوّدة عند النشر،
 *      فكان `dirty` يعود `true` بعد إعادة الجلب ويظلّ «لديك تغييرات غير
 *      منشورة» بعد نشرٍ ناجح. المعيار الآن **فرقٌ حقيقيّ** عن المنشورة لا
 *      وجود صفٍّ في القاعدة.
 *   ③ **الموظّف كان يُرسَل إلى 403.** كلّ مسارات الكتابة هنا تطلب صلاحيّة
 *      الإعدادات (مالك الحساب)، وكانت الشاشة تعطّل عند الانتحال وحده. صار
 *      السببان متمايزَين ومرسومَين.
 *
 * ★ ولا مونو على عربيّ: «IBM Plex Mono» بلا تغطيةٍ عربيّة، فالمفتاح والنموذج
 *   وحدهما — سلسلتا آلة — يأخذانه. وكلّ نصٍّ كتبه العميل يحمل `dir="auto"`:
 *   الشخصيّة والمعرفة ووصف الأداة مختلطةٌ عربيّ/لاتينيّ بطبيعتها.
 */

interface BotState {
  config: {
    enabled: boolean; pauseMinutes: number; maxToolLoops: number;
    contextMessages: number; failMessage: string | null; outsideHoursMessage: string | null;
  } | null;
  published: {
    version: number; persona: string; knowledgeBase: string;
    knowledgeMode: 'full' | 'hybrid' | 'rag'; embedStatus: string; model: string;
  } | null;
  /** المسوّدة jsonb — وهذه الشاشة تكتب الحقلَين معاً دائماً. */
  draft: { persona?: string; knowledgeBase?: string } | null;
}

interface KB {
  sources: Array<{ id: string; title: string; charCount: number; status: string }>;
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

const MODE_LABEL: Record<string, string> = {
  full: 'حقنٌ كامل', hybrid: 'أساسيات + استرجاع', rag: 'استرجاعٌ كامل',
};

/** العتبة التي يتحوّل عندها وضع المعرفة — مكتوبةٌ في الخادم، ومعروضةٌ هنا. */
const MODE_THRESHOLD = 8000;
/** الحدّ الموصى به لطول الشخصيّة: تُقرأ مع كلّ سؤال. */
const PERSONA_LIMIT = 800;

/**
 * ★ صيغة الخادم **حرفاً بحرف** — منقولةٌ من `packages/core/src/context.ts`
 *   (‏`estimateTokens`)، و`apps/web` لا تستورد `@aibot/core` عمداً فلا
 *   تُسحب `crypto` و`dns` إلى حزمة المتصفّح.
 *
 * وكان هنا `length / 2.5` وتعليقٌ يزعم أنّه «تقدير الخادم نفسه». والفرق
 * ليس تجميليّاً: معرفةٌ فيها روابطُ وأسعارٌ وأكواد منتجاتٍ تُقدَّر أعلى بنحو
 * ٦٠٪ من الحقيقة، و`decideKnowledgeMode` يعمل على رقم **الخادم**. فكان
 * المقياس يقول «تجاوزتَ العتبة» والخادم يبقى على `full`، وعدّاد الشخصيّة
 * يصرخ بالأحمر والعميل دون الحدّ فعلاً. مؤشّرٌ يكذب أسوأ من غياب مؤشّر.
 *
 * ⚠️ إن تغيّرت صيغة الخادم فغيّرها هنا — لا مرجعَ مشتركٌ يربطهما.
 */
const tokensOf = (s: string) => {
  if (!s) return 0;
  const arabic = (s.match(/[؀-ۿ]/g) ?? []).length;
  return Math.ceil(arabic / 2.5 + (s.length - arabic) / 4);
};

type Busy = 'save' | 'publish' | 'toggle' | null;

export default function BotPage() {
  const can = useCan();
  const { toast, node } = useToast();
  const bot = useApi<BotState>('/bot');
  const kb = useApi<KB>('/bot/knowledge');
  const tools = useApi<Tool[]>('/bot/tools');

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
  /** رقم نسخةٍ نُشرت وتنتظر تضمين معرفتها — تُمحى حين تلحقها المنشورة. */
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  /* معرّفُ الأداة لا علمٌ عامّ: علمٌ واحد كان يُظهر «…» ويعطّل الزرّ في
     **كلّ** أداةٍ معطَّلة، فيُقرأ أنّ النظام يعمل على السبعة. */
  const [busyTool, setBusyTool] = useState<string | null>(null);
  /**
   * قفلٌ متزامن على الحفظ. الضغط على «احفظ المسوّدة» يُخرج التركيز من الحقل
   * أوّلاً، فيقع حفظُ المغادرة ثمّ حفظُ النقرة في نفس الدورة — طلبان ورسالتان
   * لفعلٍ واحد. و`busy` حالةٌ لا تُقرأ قبل إعادة الرسم، فالمرجع هو ما يمنعه.
   */
  const saving = useRef(false);

  useEffect(() => {
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

  if (bot.loading) return <Skeleton rows={5} />;
  if (bot.error) return <ErrorBox message={bot.error} onRetry={bot.reload} />;

  const cfg = bot.data?.config ?? null;
  const pub = bot.data?.published ?? null;
  const personaTokens = tokensOf(persona);
  const kbTokens = tokensOf(knowledge);

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
  const changed = personaChanged || kbChanged;
  /**
   * ★ «غير محفوظ» = **فرقٌ عن نصّ القاعدة**، لا غيابُ صفّ مسوّدة.
   *
   * كان الشرط يحمل `|| !server.full`، فالعميل الجديد (لا مسوّدة في القاعدة —
   * وهو حاله تماماً) يُفتح له الشريط «لديك تغييرٌ غير محفوظ» **بلا أن يكتب
   * حرفاً**، وأيّ مغادرةٍ للتركيز تُطلق حفظاً وتُظهر «حُفظت المسوّدة».
   * رسالةٌ تقول شيئاً لم يحدث أسوأ من الصمت. ونقصُ المسوّدة يُلزِم الحفظ
   * **فقط حين يوجد ما يُنشَر**، وذاك ما يحمله `changed` أدناه.
   */
  const textChanged = persona !== server.persona || knowledge !== server.knowledge;
  const unsaved = textChanged || (changed && !server.full);

  /** نسخةٌ نُشرت ولم تلحقها المنشورة بعد — أي تضمينٌ جارٍ. */
  const pendingEmbed = pending !== null && (pub?.version ?? 0) < pending;

  const publishReason = lockReason
    ?? (pendingEmbed ? `v${pending} تُجهَّز معرفتها الآن — انتظر جهوزها قبل نشرٍ جديد.` : null)
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
   * قرأتُ مسار الخادم (`routes/bot.ts` و`worker/embed.ts`): حين
   * `mode !== 'full'` **لا يُحدَّث `publishedVersionId` إطلاقاً** — تُوسم
   * النسخة `pending` ويُدفع التضمين للطابور، ولا تصير المنشورةَ إلّا حين
   * يُنهي العامل. والمعيار هنا فرقٌ عن **المنشورة**، فكان يقع هذا:
   *   · الشريط «لديك تغييرات غير منشورة» يبقى بحاله **بعد نشرٍ ناجح**،
   *   · وزرّ «انشر» يُعاد تسليحه، فنقرةٌ ثانية تُنشئ نسخة N+2 ومهمّةَ
   *     تضمينٍ ثانية — على معرفةٍ كبيرة، أي على عميلك الجدّيّ تحديداً.
   * فنتذكّر رقم النسخة المعلَّقة حتّى تلحقها المنشورة.
   */
  async function publish() {
    setBusy('publish');
    try {
      const r = await post<{
        version: { version: number }; knowledgeMode: string; embedding: boolean; kbTokens: number;
      }>('/bot/publish', { note: null });

      if (r.embedding) {
        setPending(r.version.version);
        toast(`نُشرت v${r.version.version} — تُجهَّز معرفتها الآن، والنسخة السابقة تخدم حتّى تجهز.`);
      } else {
        setPending(null);
        toast('نُشرت النسخة الجديدة');
      }
      await bot.reload();
      await kb.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر النشر');
    } finally { setBusy(null); }
  }

  async function toggleBot() {
    setBusy('toggle');
    try {
      await post('/bot/toggle', { enabled: !cfg?.enabled });
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

  /* شارةُ التبويب للمعطَّل آليّاً وحده: عددُ الأدوات ليس تنبيهاً، والتعطيل هو. */
  const brokenTools = tools.data?.filter((t) => t.disabledReason).length ?? 0;
  const tabs = TABS.map((t) => (t.id === 'tools' ? { ...t, badge: brokenTools } : t));

  const saveButton = (
    <Button
      onClick={() => void saveDraft()}
      busy={busy === 'save'}
      disabled={Boolean(saveReason)}
      reason={saveReason ?? undefined}
    >
      احفظ المسوّدة
    </Button>
  );

  return (
    <Stack gap="lg">
      {node}

      <PageHead
        title="البوت"
        sub="خمسة أشياء تجعل بوتك مختلفاً — وكلّها بياناتٌ تضبطها أنت."
        actions={(
          <Row gap="sm">
            <Pill tone={cfg?.enabled ? 'ok' : 'neutral'} label={cfg?.enabled ? 'يعمل' : 'مطفأ'} />
            {pub && <Pill tone="neutral" label={`المنشورة v${pub.version}`} mark={false} />}
            {/* ★ `pub.embedStatus === 'pending'` لا يشتعل أبداً: العامل يكتب
                `ready` و`publishedVersionId` في معاملةٍ واحدة. فالحالة الموجودة
                فعلاً — نسخةٌ نُشرت وتُجهَّز — هي التي لم يكن لها مؤشّر. */}
            {pendingEmbed && <Pill tone="warn" label={`v${pending} تُجهَّز معرفتها…`} />}
            <Button
              variant={cfg?.enabled ? 'quiet' : 'primary'}
              busy={busy === 'toggle'}
              disabled={locked}
              reason={lockReason ?? undefined}
              onClick={() => void toggleBot()}
            >
              {cfg?.enabled ? 'أوقف البوت' : 'شغّل البوت'}
            </Button>
          </Row>
        )}
      />

      {/* ★ نسخةٌ نُشرت وتنتظر التضمين: لا شريطَ فرقٍ ولا زرّ نشرٍ مسلَّح —
          وإلّا بدا النشر كأنّه لم يقع، فنقرةٌ ثانية تُنشئ v+2 وتضميناً ثانياً. */}
      {pendingEmbed && (
        <Card title={`نُشرت v${pending} — تُجهَّز معرفتها الآن`}>
          <p className="muted-p">
            المعرفة فوق العتبة، فتُقطَّع وتُضمَّن قبل أن تصير النسخةَ الحيّة.
            و{pub ? `v${pub.version}` : 'النسخة السابقة'} تخدم زبائنك حتّى تجهز — بلا انقطاع.
            تُحدَّث هذه البطاقة تلقائيّاً عند الجهوز.
          </p>
        </Card>
      )}

      {/* ═══ شريط المسوّدة: الفرق **قبل** الزرّ لا بعده ═══ */}
      {changed && !pendingEmbed && (
        <Card title="لديك تغييرات غير منشورة">
          <Stack gap="md">
            <p className="muted-p">
              البوت الحيّ ما زال على {pub ? `v${pub.version}` : 'لا نسخةَ منشورةَ بعد'} —
              تعديلك لا يمسّ محادثةً جارية.
            </p>

            {unsaved && (
              <Note tone="warn">
                <b>على الشاشة تغييرٌ غير محفوظ.</b> النشر ينشر المسوّدة المحفوظة على الخادم،
                لا ما تراه الآن. احفظ أوّلاً ليدخل ما كتبته في هذه النسخة.
              </Note>
            )}

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
                <span className="bot-diff-h">المعرفة — الفرق عن المنشورة</span>
                <div className="bot-diff" dir="auto">
                  <DiffView before={pub?.knowledgeBase ?? ''} after={knowledge} />
                </div>
              </div>
            )}

            <p className="muted-p">
              المخطوط بالأحمر يُحذف والأخضر يُضاف. ولا شيء من هذا يصل زبوناً قبل أن تنشر.
            </p>

            <Row gap="sm">
              {saveButton}
              <Button
                variant="primary"
                onClick={() => void publish()}
                busy={busy === 'publish'}
                disabled={Boolean(publishReason)}
                reason={publishReason ?? undefined}
              >
                انشر
              </Button>
            </Row>
          </Stack>
        </Card>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {/* ═══════════════ الشخصيّة ═══════════════ */}
      {tab === 'persona' && (
        <Stack gap="md">
          <Card title="الشخصيّة">
            {/* onBlur على الحاوي: focusout يتصعّد، فالحفظ يقع عند مغادرة الحقل */}
            <div onBlur={autoSave}>
              <Stack gap="sm">
                {/* ★ `labelless` في الحالة المقفلة: `<label for>` لا يرتبط بـdiv،
                    فالوسم كان معطَّلاً تماماً — لا نقرةً تنقل التركيز ولا القارئ
                    الصوتيّ يربط «من هو بوتك؟» بالنصّ المعروض. */}
                <Field
                  id={locked ? 'persona-ro' : 'persona'}
                  labelless={locked}
                  label="من هو بوتك؟"
                  hint="اسمه، لهجته، نبرته، وما يرفض الحديث فيه"
                >
                  {locked ? (
                    <div id="persona-ro" className="bot-ro" dir="auto">{persona}</div>
                  ) : (
                    <TextArea
                      id="persona"
                      rows={8}
                      value={persona}
                      onChange={setPersona}
                      dir="auto"
                      count={{ used: personaTokens, limit: PERSONA_LIMIT, unit: 'توكن' }}
                    />
                  )}
                </Field>

                <p className="muted-p">
                  <span className="num">{fmt.num(persona.length)}</span> حرف ·{' '}
                  <span className="num">{fmt.num(personaTokens)}</span> توكن تقريباً ·
                  الحدّ الموصى به: <span className="num">{fmt.num(PERSONA_LIMIT)}</span> توكن —
                  الشخصيّة تُقرأ مع كلّ سؤال.
                </p>

                {!locked && <Row>{saveButton}</Row>}
              </Stack>
            </div>
          </Card>

          <Note>
            <b>ما لا تستطيع تعديله.</b> فوق شخصيّتك تُحقن قواعد ثابتة دائماً: لا يدّعي أنّه
            إنسان · لا يكشف أدواته · لا يكتب رابطاً من عنده · لا يَعِد بما لا يملك ·
            وعند الشكّ يحوّل لإنسانٍ ولا يخمّن. هذه ليست خياراً.
          </Note>
        </Stack>
      )}

      {/* ═══════════════ المعرفة ═══════════════ */}
      {tab === 'kb' && (
        <Stack gap="md">
          {kb.loading && <Skeleton rows={3} />}
          {!kb.loading && kb.error && <ErrorBox message={kb.error} onRetry={kb.reload} />}

          {/* ★ فشل النداء لا يُعرض خبراً ساراً: بلا فحص الخطأ هنا تُرسم
              «لا ملفّات» على نداءٍ فشل — وطمأنينةٌ كاذبة أسوأ من خطأٍ ظاهر.
              وصندوقُ خطأٍ **واحد** لنداءٍ واحد: تكراره مرّتين يُقرأ عطلَين. */}
          {!kb.loading && !kb.error && kb.data && (
            <>
              <Row gap="sm">
                <Pill tone="brand" mark={false} label={`الوضع: ${MODE_LABEL[kb.data.suggestedMode] ?? '—'}`} />
                <span className="muted-p">
                  يتحوّل تلقائيّاً فوق <span className="num">8</span> آلاف توكن
                </span>
              </Row>

              <Grid min={220}>
                <Stat
                  href="#kb-files"
                  value={fmt.num(kb.data.sources.length)}
                  label="مصدر معرفة ←"
                />
                <Stat
                  value={fmt.num(kbTokens)}
                  label={`توكن في نصّ معرفتك · عتبة الوضع ${fmt.num(MODE_THRESHOLD)}`}
                  meter={{ pct: kbTokens / MODE_THRESHOLD, tone: 'brand' }}
                />
                <Stat value={fmt.num(kb.data.chunks)} label="مقطع مُضمَّن" />
              </Grid>
            </>
          )}

          <Card title="نصّ المعرفة">
            <div onBlur={autoSave}>
              <Stack gap="sm">
                <Field
                  id={locked ? 'kb-text-ro' : 'kb-text'}
                  labelless={locked}
                  label="ماذا يعرف بوتك عن نشاطك؟"
                  hint="الأسعار، الساعات، الخدمات، وأكثر عشرة أسئلةٍ تسمعها يوميّاً"
                >
                  {locked ? (
                    <div id="kb-text-ro" className="bot-ro" dir="auto">{knowledge}</div>
                  ) : (
                    <TextArea id="kb-text" rows={14} value={knowledge} onChange={setKnowledge} dir="auto" />
                  )}
                </Field>

                <p className="muted-p">
                  <span className="num">{fmt.num(knowledge.length)}</span> حرف ·{' '}
                  <span className="num">{fmt.num(kbTokens)}</span> توكن تقريباً · استعمل عناوين
                  (سطرٌ يبدأ بـ# أو ينتهي بنقطتين) — تُحسّن دقّة البوت كثيراً.
                </p>

                {!locked && <Row>{saveButton}</Row>}
              </Stack>
            </div>
          </Card>

          <Note>
            <b>لماذا فاتورتك لا تكبر مع معرفتك.</b> فوق 8 آلاف توكن، البوت لم يعد يقرأ معرفتك
            كاملةً مع كلّ سؤال: يُرسَل إليه <b>الأساسيات والقيود وما يرتبط بالسؤال فقط</b>.
            فمعرفةٌ بحجم عشرة أضعاف لا تكلّفك عشرة أضعاف.
          </Note>

          {/* لا قائمةَ ملفّاتٍ على نداءٍ فشل: صندوق الخطأ أعلاه يحمل «أعِد
              المحاولة»، وقائمةٌ فارغةٌ تحته تقول «لا ملفّات لديك» وهي كاذبة. */}
          {!kb.error && (
            <div id="kb-files">
              <Card title="ملفّاتك">
                <KnowledgeFiles
                  sources={(kb.data?.sources ?? []) as KbSource[]}
                  loading={kb.loading}
                  readOnly={locked}
                  onChanged={() => void kb.reload()}
                />
              </Card>
            </div>
          )}
        </Stack>
      )}

      {/* ═══════════════ الأدوات ═══════════════ */}
      {tab === 'tools' && (
        <Stack gap="md">
          <Row end>
            <span className="muted-p">
              كلّ أداةٍ نداءٌ إلى نظامك. والبوت يستعملها <b>بوصفها</b> — فالوصف هو نصف الأداة.
            </span>
            <Button
              variant="primary"
              disabled={locked}
              reason={lockReason ?? undefined}
              onClick={() => setEditing({ ...EMPTY_DRAFT })}
            >
              + أداةٌ جديدة
            </Button>
          </Row>

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
              action: (
                <Button
                  variant="primary"
                  disabled={locked}
                  reason={lockReason ?? undefined}
                  onClick={() => setEditing({ ...EMPTY_DRAFT })}
                >
                  ابنِ أوّل أداة
                </Button>
              ),
            }}
          >
            {(list) => (
              <Grid min={400}>
                {list.map((t) => (
                  <Card
                    key={t.id}
                    // اسمٌ كتبه العميل — اتّجاهه من محتواه
                    title={<span dir="auto">{t.titleAr}</span>}
                    actions={(
                      <>
                        <Pill
                          tone={t.kind === 'http' ? 'warn' : 'neutral'}
                          label={t.kind === 'http' ? 'مخصَّصة' : 'جاهزة'}
                        />
                        {t.hasSecrets && <Pill tone="neutral" label="لها سرّ" />}
                        {t.disabledReason && <Pill tone="crit" label="معطَّلة آليّاً" />}
                      </>
                    )}
                  >
                    <Stack gap="sm">
                      <p className="muted-p" dir="auto">{t.description}</p>

                      {/* المفتاح سلسلةُ آلةٍ يناديها النموذج — مونو ومعزولٌ اتّجاهيّاً */}
                      <span className="mono bot-toolkey">{t.key}</span>

                      {t.disabledReason && (
                        <Note tone="crit">
                          <span dir="auto">{t.disabledReason}</span>
                        </Note>
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
                          {' '}— وتُخفى تلقائيّاً على قناةٍ لا تدعمها
                        </p>
                      )}

                      <Row gap="sm">
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
                      </Row>
                    </Stack>
                  </Card>
                ))}
              </Grid>
            )}
          </DataView>

          <Note tone="crit">
            <b>حدودٌ مفروضة بالكود لا بالشاشة.</b> HTTPS فقط · رفض العناوين الداخليّة بعد حلّ
            الاسم وعند كلّ تحويل · مهلة 8 ثوانٍ · 256 كيلوبايت · وتعطيلٌ آليّ بعد خمسة إخفاقاتٍ
            متتالية مع إشعارك.
          </Note>
        </Stack>
      )}

      {/* ═══════════════ السلوك ═══════════════ */}
      {tab === 'behave' && (
        cfg ? (
          <Grid min={280}>
            <Card title="الإيقاف بعد الموظّف">
              <KV>
                <KVRow k="المدّة">
                  <span className="num">{fmt.num(cfg.pauseMinutes)}</span> دقيقة
                </KVRow>
                <KVRow k="يُستأنف">تلقائيّاً أو بزرّ</KVRow>
              </KV>
            </Card>

            <Card title="الحدود">
              <KV>
                <KVRow k="دورات الأدوات">
                  <span className="num">{fmt.num(cfg.maxToolLoops)}</span>
                </KVRow>
                <KVRow k="رسائل السياق">
                  <span className="num">{fmt.num(cfg.contextMessages)}</span>
                </KVRow>
                {/* اسم النموذج سلسلةُ آلة — مونو ولاتينيّ */}
                <KVRow k="النموذج"><span className="mono">{pub?.model ?? '—'}</span></KVRow>
              </KV>
            </Card>

            <Card title="حين يعجز">
              <KV>
                <KVRow k="يقول">
                  <span dir="auto">{cfg.failMessage ?? 'رسالةٌ افتراضيّة ثمّ تحويل'}</span>
                </KVRow>
                <KVRow k="خارج الدوام">
                  <span dir="auto">{cfg.outsideHoursMessage ?? '—'}</span>
                </KVRow>
              </KV>
            </Card>
          </Grid>
        ) : (
          <Empty
            title="لا سلوكَ محفوظاً بعد"
            hint="هذه الحدود تُنشأ مع أوّل نشرٍ لشخصيّة بوتك: مدّة الإيقاف بعد تدخّل موظّف، وسقف دورات الأدوات، وما يقوله البوت حين يعجز. اكتب الشخصيّة وانشرها لتظهر."
            action={<Button onClick={() => setTab('persona')}>اذهب إلى الشخصيّة</Button>}
          />
        )
      )}
    </Stack>
  );
}
