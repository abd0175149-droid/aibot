'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { EMPTY_DRAFT, type ToolDraft } from '@/components/ToolBuilder';
import { ApiError, del, patch, post, put } from '@/lib/api';
import { useCan } from '@/lib/session';
import { decideKbMode as decideMode } from '@/lib/terms';
import { fmt, useApi, useToast } from '@/lib/useApi';
import { Button } from '@/components/ui';
import { Amount, Ask, BotState, Busy, KB, TABS, TOOL_FORMS, TabId, Tool, Ver, fileUnitsOf, isTabId, lineDelta, readUnits, usePoll } from './parts';

/**
 * ★ #83: كان `BotPage` مكوّناً واحداً من ١٨٧٢ سطراً — أربعُ شاشاتٍ و١٢ حالةً
 *   وستّةُ تأثيرات. هنا الحالةُ ومعالجاتُها (`useBotState`)، ثمّ ما يُشتقّ منها
 *   بعد وصول البيانات (`deriveBotView`)، والشاشاتُ الخمس في ملفّاتها تقرأ
 *   `BotCtx` واحداً مُنمَّطاً — فلا حالةَ مكرّرةً ولا «props» تُكتب باليد.
 *   (والقصُّ آليٌّ: لا سطرَ JSX تغيّر، فالسلوكُ نفسُه بالتعريف.)
 */
export function useBotState() {
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
   * ★★★ **تعارضُ المسوّدة — وموضعُ الخُطّاف هو العطل.**
   *
   *   كان معرَّفاً **تحت** الارتدادَين المبكّرَين (`bot.loading && !bot.data`):
   *   فالرسمُ الأوّلُ يرتدّ هيكلاً بعددٍ من الخُطّافات، والرسمُ التالي — لحظةَ
   *   وصول `/bot` — يمرّ فيستدعي خُطّافاً إضافيّاً. وReact ترفض ذلك رفضاً
   *   قاطعاً («خُطّافاتٌ أكثرُ من الرسم السابق») فتسقط شاشةُ البوت كلُّها إلى
   *   حدّ الخطأ لحظةَ وصول بياناتها — أي **دائماً**.
   *
   *   ولذلك يسكن هنا مع بقيّة الخُطّافات، بلا شرطٍ قبله.
   */
  const [conflict, setConflict] = useState(false);
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

  /**
   * ★ **وِجهةٌ من شاشةٍ أخرى — والرابطُ كان يَحمل ولا يُقرأ.**
   *
   *   «افتح المعرفة» في الرئيسيّة (وكلُّ صفِّ سؤالٍ عجز عنه بوتك) و«معرفتُها»
   *   و«أدواتُها» في الساحة كلُّها تؤدّي إلى هنا بـ`?tab=kb` أو `?tab=tools`،
   *   وهذه الشاشةُ كانت تُفتح على «الشخصيّة» في كلّ مرّة. فمن ضغط «افتح
   *   المعرفة» وهو يقرأ سؤالاً عجز عنه بوتُه يجد نفسَه في حقلٍ آخر ويبحث عن
   *   التبويب بنفسه — وتلك حلقةُ المنتج الأساسيّة: «أخطأ ← أضِف ← جرّب ← انشر».
   *
   * ⚠️ ويُقرأ المرشّح **بعد** التركيب لا في أثناء الرسم: قراءةُ `location` في
   *    الرسم تُخالف ما رسمه الخادمُ فيسقط الترطيب. ولا وميضَ من ذلك هنا:
   *    أوّلُ رسمٍ هيكلٌ عظميّ، والتبويبُ مضبوطٌ قبل أن يظهر أيُّ محتوى.
   */
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (isTabId(t)) setTab(t);
  }, []);

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

  /* ★ مفتاحُ الهروب صار داخل `Sheet` نفسِها (`ui/index.tsx`) ومعه نقلُ
     التركيز وحبسُه وإرجاعُه. وكان مكتوباً هنا وفي شاشتَين أُخريَين ومنسيّاً
     في الباقية: قاعدةٌ كتبها تعليقٌ في الإطار ثمّ تُركت لكلّ شاشةٍ تُعيد
     كتابتها — فاختلف سلوكُ الأوراق في المنتج الواحد. */

  /**
   * ★ الهيكلُ للتحميل **الأوّل** وحده، والخطأُ الكاملُ حين لا بيانات.
   *
   * وإلّا فالاستقصاء يمحو الشاشة كلّ خمس ثوانٍ: `reload` يرفع `loading`، فيرتدّ
   * الرسمُ إلى هيكلٍ ثمّ يعود — وميضٌ يُقرأ عطلاً، ويسرق التركيز من الحقل الذي
   * يكتب فيه المستخدم. فما دامت البيانات في اليد، تبقى الشاشة مرسومةً أثناء
   * التحديث، ويُقال الخطأُ العابر في مكانه بلا أن يهدم ما حوله.
   */
  return { tab, setTab, editing, setEditing, persona, setPersona, knowledge, setKnowledge, server, setServer, pending, setPending, busy, setBusy, busyTool, setBusyTool, ask, setAsk, conflict, setConflict, toast, node, can, bot, kb, tools, vers, saving, dirtyRef, cfg, pub, pubVersion, newer, embedding, embedFailed, pendingRow, clientPending, pendingVersion, pendingEmbed, failedVersion, publishedAt, fileSources, filesPending, embedStalled, filesStalled, readyRef };
}

export type BotStateCtx = ReturnType<typeof useBotState>;

/** ما يُشتقّ بعد وصول البيانات — يُنادى بعد حارسَي التحميل والخطأ. */
export function deriveBotView(s: BotStateCtx) {
  const { persona, knowledge, fileSources, pub, can, cfg, kb, server, dirtyRef, pendingEmbed, pendingVersion, saving, setBusy, bot, setServer, setConflict, toast, busy, conflict, setAsk, setPending, vers, setBusyTool, tools, setEditing, setTab, failedVersion, embedStalled, publishedAt, tab } = s;

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
  /* ★★ وسببٌ ثالثٌ من الخادم لا من الصلاحيّة: أوقفته المنصّةُ. زرٌّ يُضغط ويردّ
     ٤٠٩ في كلّ مرّةٍ يكسر الثقة — فيُعطَّل ويُقال لماذا، والسببُ ما كتبه فريقُنا. */
  const platformLock = cfg?.platformLockedAt
    ? `أوقف فريقُ المنصّة بوتك${cfg.platformLockReason ? ` — ${cfg.platformLockReason}` : ''}. لا يعود إلّا بقرارٍ منهم — تواصل مع الدعم.`
    : null;
  const locked = Boolean(lockReason) || Boolean(platformLock);

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
  /**
   * ★ سببُ منع التراجع — والثاني منه ليس تجميلاً: `embed.ts` يكتب النسخةَ
   *   الحيّةَ بلا شرطٍ عند الجهوز، فتراجعٌ الآن يُمحى بعد دقيقةٍ بلا رسالة.
   */
  const rollbackReason = lockReason
    ?? (pendingEmbed
      ? `v${pendingVersion} تُجهَّز معرفتها الآن — والتراجع يُتاح بعد جهوزها.`
      : null);

  /**
   * ★ **الحفظُ يُرسل ما تعرفه هذه الشاشة، ويحمل معه طابعَ ما قرأته.**
   *
   *   المسوّدةُ واحدةٌ لكلّ مستأجر، وتكتب فيها هذه الشاشةُ **والساحةُ** معاً.
   *   فبلا طابعٍ يفوز آخرُ كاتبٍ بصمت: تصحيحٌ أضافه المالك من الساحة يُمحى
   *   بحفظٍ تلقائيٍّ من تبويبٍ آخرَ ما زال مفتوحاً — والساحةُ قالت «أُضيف».
   *   ثمّ يعود البوتُ إلى الخطأ نفسه أمام الزبون، فتنكسر حلقةُ «أخطأ ← أضِف
   *   ← جرّب ← انشر» كلُّها، وهي حلقةُ المنتج الأساسيّة.
   *
   * ⚠️ و`conflict` معرَّفٌ مع بقيّة الخُطّافات في أعلى المكوّن لا هنا: خُطّافٌ
   *    بعد ارتدادٍ مبكّرٍ يُسقط الشاشة كلَّها.
   */
  async function saveDraft(force = false) {
    if (saving.current) return;
    saving.current = true;
    setBusy('save');
    try {
      await put('/bot/draft', {
        persona,
        knowledgeBase: knowledge,
        /* و`null` تعني «لا تفحص»: هو ما يُرسَل حين يقرّر المالك الكتابةَ
           فوق ما كُتب — وإلّا رُفض الحفظُ ثانيةً بنفس الطابع البائت. */
        expectedUpdatedAt: force ? null : (bot.data?.draftUpdatedAt ?? null),
      });
      setServer({ persona, knowledge, full: true });
      setConflict(false);
      await bot.reload();
      toast('حُفظت المسوّدة — والبوت الحيّ ما زال على النسخة المنشورة');
    } catch (e) {
      /* ★ التعارضُ ليس فشلاً عابراً يُعاد: هو خبرٌ يوقف الحفظ التلقائيّ
         حتّى يقرّر المالك — وإلّا كتبت الشاشةُ فوق عمل غيرها في المحاولة
         التالية بعد ثوانٍ. */
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        toast('تغيّرت المسوّدة من مكانٍ آخر — حمّل الأحدث قبل أن تحفظ');
      } else {
        toast(e instanceof ApiError ? e.message : 'تعذّر الحفظ');
      }
    } finally {
      saving.current = false;
      setBusy(null);
    }
  }

  /**
   * حمّل الأحدث: يُسقط ما على الشاشة ويأخذ ما في القاعدة — بقرارٍ صريح.
   * و`dirtyRef` يُطفأ أوّلاً وإلّا تخطّت المزامنةُ البياناتِ الواصلة — فهي
   * مصمَّمةٌ ألّا تمسح ما يكتبه المستخدم الآن، وهنا يُراد مسحُه بطلبه.
   */
  async function takeLatest() {
    setConflict(false);
    dirtyRef.current = false;
    await bot.reload();
    toast('حُمّلت المسوّدة الأحدث');
  }

  /**
   * حفظٌ عند مغادرة الحقل — و`onBlur` على الحاوي لا على الحقل: `focusout`
   * يتصعّد في React، وطبقة المكوّنات لا تُثقَل بمعالجٍ لأجل شاشةٍ واحدة.
   */
  function autoSave() {
    // على فرق النصّ وحده — لا على «لا مسوّدة في القاعدة»
    /* ولا حفظَ تلقائيَّ ما دام التعارضُ قائماً: أوّلُ `blur` بعده يمحو
       عملَ غيرك بلا أن تلمس شيئاً. */
    if (!locked && textChanged && !busy && !conflict) void saveDraft();
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
  /**
   * ★ **الإيقافُ المؤقّت — وكان المخرجُ الوحيد الحذف.**
   *
   *   الشاشةُ تنصح بالتعطيل عند الشكّ، ولا زرَّ له: فمن أراد إسكاتَ أداةٍ
   *   ساعةً اضطرّ إلى حذفها **بسرّها** ثمّ بنائها من جديد. والمسارُ يقبل
   *   `enabled` منذ كُتب.
   */
  async function setToolEnabled(id: string, enabled: boolean) {
    setBusyTool(id);
    try {
      await patch(`/bot/tools/${id}`, { enabled });
      toast(enabled
        ? 'شُغّلت، وصُفّر عدّاد الإخفاق — ويراها بوتك من الآن'
        : 'أُوقفت مؤقّتاً — لا يراها بوتك، وسرُّها ومسارُها محفوظان');
      await tools.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر التغيير');
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

  /**
   * ★ **التراجع — المسارُ في الخادم منذ كُتب ولم يكن له زرٌّ في أيّ شاشة.**
   *
   *   `POST /bot/versions/:id/rollback` قائمٌ ومحصَّنٌ (يرفض `pending` و`failed`)،
   *   و`/bot/versions` كان يُجلَب ليُشتقّ منه حالُ التضمين وحدَه — فالصفوفُ لا
   *   تُعرض، ولا نسخةَ غيرُ الحيّة تُسمّى ولا تُختار من أيّ شاشة. والتعليقُ نفسُه
   *   في هذا الملفّ كان يقول «فقدٌ لا يستطيع العميل التراجع عنه من هذه الشاشة».
   *
   *   وهو **نشرُ نسخةٍ قديمة** لا تعديلٌ في مكانه: لا تُحذف نسخةٌ ولا يُفقد
   *   تاريخ. ولا يمسّ المسوّدة — فما على الشاشة يبقى، ويُنشر متى شاء المالك.
   */
  async function rollback(id: string, version: number) {
    setBusy('rollback');
    try {
      await post(`/bot/versions/${id}/rollback`);
      setAsk(null);
      /* وذاكرةُ «نسخةٌ تُجهَّز» تُطفأ: بقاؤها يُعطّل زرَّ النشر بحجّةٍ زالت. */
      setPending(null);
      toast(`عاد بوتك إلى v${version} — وهي التي تردّ على زبائنك الآن`);
      await bot.reload();
      await vers.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر التراجع');
    } finally { setBusy(null); }
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
  } else if (platformLock) {
    bandTone = 'crit';
    bandMark = '■';
    bandTitle = 'أوقف فريقُ المنصّة بوتك — لا يردّ على أحد';
    bandSub = (
      <>
        {cfg.platformLockReason ? <>السبب: <span dir="auto">{cfg.platformLockReason}</span>. </> : null}
        لا يعود بزرّ «شغّل» — يرفعه فريقُ المنصّة بعد التواصل، ثمّ تشغّله أنت.
        {pub ? <> ونسختك <span className="num">{`v${pub.version}`}</span> محفوظةٌ كما هي.</> : null}
      </>
    );
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
  } else if (tab === 'versions') {
    /* ولا `dockPrimary` هنا: الفعلُ في صفّ النسخة نفسِها لا في الرصيف —
       فعلٌ لكلّ سطرٍ لا فعلٌ واحدٌ للشاشة. */
    dockHint = 'التراجع نشرُ نسخةٍ قديمة — لا يُحذف شيءٌ، ومسوّدتك على الشاشة تبقى كما هي.';
  } else if (tab === 'behave') {
    dockHint = 'لا شيء في هذا التبويب يُعدَّل من هنا — وما تُعدّله أنت في «الشخصيّة» و«المعرفة».';
    dockPrimary = <Button onClick={() => setTab('persona')}>اذهب إلى الشخصيّة</Button>;
  } else {
    dockHint = pub
      ? 'لا تغييرَ معلَّق — ما تقرؤه هنا هو نفسه ما يخدم زبائنك الآن.'
      : 'لا نسخةَ منشورةَ بعد: اكتب الشخصيّة والمعرفة ثمّ انشر.';
  }

  return { ...s, personaUnits, kbUnits, fileChars, fileUnits, draftMode, liveMode, lockReason, platformLock, locked, personaChanged, kbChanged, readyChars, publishedFileChars, filesChanged, changed, textChanged, unsaved, personaDelta, kbDelta, publishReason, saveReason, rollbackReason, toolList, brokenTools, okTools, tabs, newToolBtn, saveBtn, publishBtn, bandTone, bandMark, bandTitle, bandSub, bandAction, dockPrimary, dockSecondary, dockHint, saveDraft, takeLatest, autoSave, publish, toggleBot, setToolEnabled, deleteTool, rollback };
}

export type BotCtx = ReturnType<typeof deriveBotView>;
