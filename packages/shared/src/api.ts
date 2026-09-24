import { z } from 'zod';

export const Role = z.enum(['platform_owner', 'tenant_owner', 'tenant_agent']);
export type Role = z.infer<typeof Role>;

export const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export const SendMessageBody = z.object({
  text: z.string().min(1).max(4096).optional(),
  choices: z.object({
    body: z.string().min(1),
    options: z.array(z.object({ id: z.string(), title: z.string() })).min(1).max(13),
  }).optional(),
}).refine((v) => !!v.text || !!v.choices, { message: 'text أو choices مطلوب' });

export const HealthResponse = z.object({
  service: z.literal('aibot'),
  rev: z.string(),
  db: z.boolean(),
  redis: z.boolean(),
  queues: z.record(z.number()).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/* ══════════════ عقدُ الأداة المخصَّصة ══════════════ */

/**
 * ★ **مخطّطُ أداةٍ واحدٌ خاطئ يُسكت كلَّ ردود البوت.**
 *
 *   إعلاناتُ الأدوات تذهب إلى Gemini في **مصفوفةٍ واحدة**، فعنصرٌ واحدٌ
 *   مشوَّهٌ يُبطل الطلبَ كلَّه بـ400 `INVALID_ARGUMENT` — لا «أداةٌ لا تعمل»
 *   بل **لا ردَّ إطلاقاً** على كلّ رسالةٍ تصل هذا المستأجر. و`POST /bot/tools`
 *   كان يقبل أيّ JSON: مفتاحٌ بأيّ محارف، `paramsSchema` بأيّ شكل، `http`
 *   بأيّ طريقة.
 *
 *   والمُخفِّفُ الذي هبط سابقاً في `reply.ts` يوقف النزيف (أربعُ محاولاتٍ
 *   مدفوعةٍ لكلّ رسالة) ولا يُصلح السبب: بوتُ المستأجر يبقى أبكمَ حتّى يعدّل
 *   أحدٌ الصفَّ بيده. فالمنعُ عند الكتابة.
 *
 * ⚠️ والتحقّقُ **أوسعُ عند القراءة وأضيقُ عند الكتابة**: ما هو مخزَّنٌ اليوم
 *    لا يُرفَض إلّا إن كان Gemini يرفضه فعلاً — وإلّا صار المالكُ عاجزاً عن
 *    **تصحيح** الأداة المعطوبة، أي عن الخروج من العطل نفسه.
 */

/** الأنواعُ التي يقبلها Gemini في `parameters` — مجموعةٌ فرعيّةٌ من OpenAPI. */
const GEMINI_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

/**
 * فحصٌ تعاوديٌّ **بلا zod**: `z.lazy` على نوعٍ يشير إلى نفسه يُسقط `tsc`
 * بـTS7022، والحلُّ بالتعليق يمنع `.extend()` بعده. فالدالّةُ عاديّةٌ
 * و`z.custom` تغلّفها.
 */
export function isGeminiParamsSchema(v: unknown, depth = 0): boolean {
  if (depth > 5 || !v || typeof v !== 'object' || Array.isArray(v)) return false;
  const n = v as Record<string, unknown>;
  if (typeof n.type !== 'string' || !GEMINI_TYPES.has(n.type)) return false;

  if (n.description !== undefined && typeof n.description !== 'string') return false;
  if (n.enum !== undefined && (!Array.isArray(n.enum) || n.enum.some((x) => typeof x !== 'string'))) {
    return false;
  }

  if (n.type === 'object') {
    const props = n.properties;
    if (props !== undefined) {
      if (!props || typeof props !== 'object' || Array.isArray(props)) return false;
      for (const child of Object.values(props as Record<string, unknown>)) {
        if (!isGeminiParamsSchema(child, depth + 1)) return false;
      }
    }
    /* ★ `required` يسمّي حقلاً لا وجود له = رفضٌ من المزوّد. */
    if (n.required !== undefined) {
      if (!Array.isArray(n.required) || n.required.some((x) => typeof x !== 'string')) return false;
      const known = new Set(Object.keys((props ?? {}) as Record<string, unknown>));
      if ((n.required as string[]).some((k) => !known.has(k))) return false;
    }
  }

  if (n.type === 'array') {
    if (n.items === undefined) return false;
    if (!isGeminiParamsSchema(n.items, depth + 1)) return false;
  }

  return true;
}

/**
 * ★ اسمُ الدالّة كما يقبله Gemini: `^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$`.
 *   ونُضيّقه إلى الحروف الصغيرة والشرطة السفليّة: الاسمُ يُنادى في نصّ
 *   النموذج، واختلافُ الحالة بين `Send_SMS` و`send_sms` يُنتج نداءً لا يُطابق
 *   شيئاً — فيُقال للزبون «تمّ» ولا يُنفَّذ.
 */
export const TOOL_KEY_RE = /^[a-z][a-z0-9_]{1,40}$/;

/** أسماءُ الأدوات المدمجة — لا تُنتحَل. */
export const RESERVED_TOOL_KEYS = [
  'handoff_to_human', 'save_note', 'set_contact_attribute', 'send_quick_options',
  'ask_confirmation', 'check_business_hours', 'collect_lead', 'search_knowledge',
  'escalate_complaint', 'send_location',
] as const;

export const ToolHttp = z.object({
  /* ★ الطرائقُ التي ينفّذها `execHttpTool` وحدها: `PUT` مقبولةٌ في النموذج
     ومرفوضةٌ عند التنفيذ، فتُعرَض على النموذج أداةٌ تفشل دائماً. */
  method: z.enum(['GET', 'POST']),
  url: z.string().url('العنوان ليس رابطاً صالحاً').max(2048),
  headers: z.record(z.string().max(80), z.string().max(2048)).optional(),
  bodyTemplate: z.string().max(4000).optional(),
  timeoutMs: z.number().int().min(1000).max(15_000).optional(),
}).strict();

export const BotToolUpsert = z.object({
  key: z.string().regex(TOOL_KEY_RE, 'المفتاح حروفٌ صغيرةٌ وشرطةٌ سفليّة، من حرفين إلى ٤١')
    .refine((k) => !(RESERVED_TOOL_KEYS as readonly string[]).includes(k),
      'هذا الاسم لأداةٍ مدمجة — اختر غيره'),
  titleAr: z.string().min(1).max(60),
  description: z.string().min(5, 'الوصفُ هو ما يقرؤه النموذج ليقرّر متى ينادِيها').max(300),
  requiresCapabilities: z.array(z.string().max(40)).max(8).optional(),
  paramsSchema: z.custom<Record<string, unknown>>(
    (v) => isGeminiParamsSchema(v),
    'مخطّطُ المدخلات ليس من مجموعة OpenAPI التي يقبلها المزوّد',
  ).optional(),
  http: ToolHttp.nullable().optional(),
  responseMap: z.record(z.string().max(60), z.string().max(200)).nullable().optional(),
  secrets: z.record(z.string().max(60), z.string().max(4000)).optional(),
  confirmRequired: z.boolean().optional(),
  confirmTemplate: z.string().max(300).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type BotToolUpsert = z.infer<typeof BotToolUpsert>;

/**
 * ★ و`key` يبقى **مقبولاً** في التعديل وإن كان لا يُكتب.
 *   الباني يرسل الحمولة كاملةً في كلّ حفظ، فرفضُ المفتاح يمنع المالكَ من
 *   تصحيح أداةٍ معطوبة — أي من الخروج من العطل الذي وُجد هذا العقدُ لمنعه.
 */
export const BotToolPatch = BotToolUpsert.partial()
  .refine((v) => Object.keys(v).length > 0, 'لا شيءَ لتغييره');
export type BotToolPatch = z.infer<typeof BotToolPatch>;
