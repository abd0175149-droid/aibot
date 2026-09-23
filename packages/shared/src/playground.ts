import type { OutboundMessage } from './channel.js';

/**
 * عقدُ الساحة — جرّبٌ جافٌّ للبوت، وسببُ ردّه معه.
 *
 * ★ **لماذا العقد هنا لا في أحد الطرفين.** الجرّب يجري في العامل حيث يسكن
 *   كلُّ ما يُشغّل البوت فعلاً: `RagKnowledge` والاسترجاع الهجين وكاش
 *   التضمين وحلقةُ الوكيل. والمسار في الـAPI. وهما **عمليّتان منفصلتان**
 *   لا تستوردان من بعضهما (`apps/api` لا يرى `apps/worker`)، فلو كُتب
 *   الشكلُ مرّتين لتباعدت النسختان عند أوّل حقلٍ يُضاف — وهو بعينه العطل
 *   الذي وُلد منه `events.ts` المجاور.
 *
 * ★ **والقيدُ الحاكم**: الساحة **لا تُرسل شيئاً إلى واتساب ولا إنستجرام
 *   أبداً**، ولا تُنشئ محادثةً ولا نافذةً مفوترة. ولذلك لا `conversationId`
 *   في هذا العقد ولا مكانَ له: ما يخرج منه **خطّةُ ردٍّ تُقرأ** لا خطّةُ
 *   إرسال. والتوكنز تُحاسَب لأنّ النداء حقيقيّ — وتُوسَم `source='playground'`
 *   في `ai_runs` فلا تُخلَط بالحيّ في أيّ تقرير.
 */

export interface PlaygroundJob {
  tenantId: string;
  /** رسالةُ الزبون التجريبيّة */
  text: string;
  /** أيّ نسخةِ بوتٍ تُجرَّب — وهذه أكبرُ قيمةِ الساحة: المسوّدة قبل نشرها */
  use: PlaygroundUse;
  /**
   * دورات الجلسة السابقة. تعيش في الشاشة وتُرسَل مع كلّ محاولة —
   * فلا صفَّ محادثةٍ يُخلَق، ولا أثرَ للجرّب في الإنبوكس.
   */
  history: Array<{ role: 'user' | 'model'; text: string }>;
}

export type PlaygroundUse = 'draft' | 'published';

/** مقطعُ معرفةٍ دخل السياق — ومن أين ولماذا. */
export interface PlaygroundChunk {
  id: string;
  heading: string | null;
  /** أوّلُ سطورِ المقطع — للحكم عليه بالعين لا لقراءته كلِّه */
  preview: string;
  tokens: number;
  /** درجةُ البحث الهجين. `null` في وضع الحقن الكامل — فلا استرجاعَ أصلاً. */
  score: number | null;
  /** مرتبتُه بعد الدمج (1 = الأعلى) */
  rank: number;
  /** الأساسيات تُحقن دائماً ولا تنافس على مقاعد الاسترجاع */
  pinned: boolean;
}

/** نداءُ أداةٍ في هذا الشوط — بوسائطه وما أعاد. */
export interface PlaygroundToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  ms: number;
  /**
   * هل نُفِّذ فعلاً؟ الأدواتُ التي تكتب في محادثةٍ أو جهةِ اتّصالٍ **تُمثَّل**
   * في الجرّب ولا تُنفَّذ — وإلّا وسم الجرّبُ محادثةً حقيقيّةً بأنّها تحتاج
   * موظّفاً، أو كتب ملاحظةً في بطاقة زبونٍ لم يكتب شيئاً.
   */
  ran: boolean;
  /** ما يُقال للمستخدم عن الفرق — لا كودٌ ولا اسمُ دالّة */
  note: string | null;
}

/** حارسٌ تدخّل على النصّ قبل أن يصل الزبون — ونصُّ عاقبته لا نصُّ حالته. */
export interface PlaygroundGuard {
  key: string;
  label: string;
  consequence: string;
}

/** طبقاتُ السياق بالتوكنز — ومنها تُقرأ الفاتورة. */
export interface PlaygroundLayers {
  persona: number;
  core: number;
  rules: number;
  tools: number;
  retrieved: number;
  live: number;
  history: number;
}

export interface PlaygroundTrace {
  /** صفُّ `ai_runs` الذي كُتب — `null` إن تعذّر كتابته */
  runId: string | null;
  use: PlaygroundUse;
  version: {
    /** «المسوّدة» أو «النسخة ٤» — نصٌّ جاهزٌ للعرض */
    label: string;
    number: number | null;
    provider: string;
    model: string;
    knowledgeMode: 'full' | 'hybrid' | 'rag';
    /** حالةُ التضمين للمنشورة — `null` للمسوّدة فلا تُضمَّن قبل النشر */
    embedStatus: string | null;
  };
  /** حدودُ القناة السارية — `maxTextLen` هو ما يقصّ الردّ فعلاً */
  channel: { kind: string; label: string; maxTextLen: number };
  /** ما **كان** سيُرسَل: نصُّ النموذج وما أنتجته الأدوات — بلا إرسال */
  reply: { text: string; emits: OutboundMessage[] };
  knowledge: {
    mode: 'full' | 'hybrid' | 'rag';
    /** تُخطّى على التحيّات والرسائل القصيرة — فلا نداء تضمينٍ بلا داعٍ */
    skipped: boolean;
    cacheHit: boolean;
    /** نصُّ الاستعلام الذي بُحث به فعلاً (مطبَّعٌ ومدموجٌ بآخر دورَين) */
    query: string;
    /** ما استُرجع لهذا السؤال */
    chunks: PlaygroundChunk[];
    /** الأساسيات — تُحقن دائماً */
    pinned: PlaygroundChunk[];
    /** كم مقطعاً في معرفة هذه النسخة كلِّها — مقامُ النسبة */
    chunksTotal: number;
    /** طبقةٌ تجاوزت ميزانيّتها فاقتُطعت — أخطرُ خبرٍ في اللوح */
    trimmed: string[];
    layers: PlaygroundLayers;
    stablePrefixTokens: number;
    variableTokens: number;
  };
  tools: PlaygroundToolCall[];
  /** كلُّ أداةٍ عُرضت على النموذج — فما لم يُعرَض لا يُنادى */
  toolsOffered: string[];
  cost: {
    promptTokens: number;
    outputTokens: number;
    thoughtsTokens: number;
    cachedTokens: number;
    totalTokens: number;
    usd: number;
    /** كاذبٌ إن لم يكن للنموذج صفُّ سعر — والكلفةُ تُحسب صفراً بصمت */
    priced: boolean;
    calls: number;
    latencyMs: number;
  };
  guards: PlaygroundGuard[];
  /** إفصاحاتٌ صريحةٌ عن فرق الجرّب عن الحيّ — تُعرض كما هي */
  notes: string[];
}

export type PlaygroundResult =
  | { ok: true; trace: PlaygroundTrace }
  /** فشلٌ متوقَّع يُقال بلغةٍ بشريّة — لا استثناءٌ يُترجم إلى «خطأ داخليّ» */
  | { ok: false; code: string; message: string };
