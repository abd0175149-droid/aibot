import { describe, it, expect } from 'vitest';
import {
  BotToolUpsert, BotToolPatch, isGeminiParamsSchema, RESERVED_TOOL_KEYS, TOOL_KEY_RE,
} from '../src/api.js';

/**
 * ★ **مخطّطُ أداةٍ واحدٌ خاطئ يُسكت كلَّ ردود البوت.**
 *
 * إعلاناتُ الأدوات تذهب إلى المزوّد في **مصفوفةٍ واحدة**، فعنصرٌ مشوَّهٌ يُبطل
 * الطلبَ كلَّه بـ400 `INVALID_ARGUMENT`. والنتيجةُ ليست «أداةٌ لا تعمل» بل
 * **لا ردَّ إطلاقاً** على كلّ رسالةٍ تصل هذا المستأجر — حتّى يعدّل أحدٌ الصفَّ
 * بيده. وكان المسارُ يقبل أيّ JSON.
 *
 * ★ والتوازنُ مقصود: **أضيقُ عند الكتابة، وأوسعُ عند القراءة.** عقدٌ صارمٌ
 *   أكثرَ ممّا يفرضه المزوّد يمنع المالكَ من **تصحيح** أداةٍ معطوبة — أي من
 *   الخروج من العطل نفسه.
 */

const okTool = {
  key: 'check_stock',
  titleAr: 'تحقّق من التوفّر',
  description: 'يتحقّق من توفّر صنفٍ في المخزن بالرقم أو بالاسم.',
  paramsSchema: {
    type: 'object',
    properties: { sku: { type: 'string', description: 'رقم الصنف' } },
    required: ['sku'],
  },
  http: { method: 'GET' as const, url: 'https://api.example.com/stock' },
};

describe('مخطّطُ المدخلات من مجموعة المزوّد', () => {
  it('الشكلُ المعتاد يمرّ', () => {
    expect(isGeminiParamsSchema(okTool.paramsSchema)).toBe(true);
    expect(isGeminiParamsSchema({ type: 'object', properties: {} })).toBe(true);
  });

  it('★ ونوعٌ لا يعرفه المزوّد يُرفَض — وهو أشيعُ ما يُكتب بالخطأ', () => {
    expect(isGeminiParamsSchema({ type: 'str' })).toBe(false);
    expect(isGeminiParamsSchema({ type: 'text' })).toBe(false);
    expect(isGeminiParamsSchema({ type: 'null' })).toBe(false);
  });

  it('★ و`required` يسمّي حقلاً لا وجود له — رفضٌ من المزوّد بلا سببٍ ظاهر', () => {
    expect(isGeminiParamsSchema({
      type: 'object', properties: { a: { type: 'string' } }, required: ['b'],
    })).toBe(false);
  });

  it('ومصفوفةٌ بلا `items` لا تُقبَل', () => {
    expect(isGeminiParamsSchema({ type: 'array' })).toBe(false);
    expect(isGeminiParamsSchema({ type: 'array', items: { type: 'string' } })).toBe(true);
  });

  it('وما ليس كائناً أصلاً', () => {
    expect(isGeminiParamsSchema('hello')).toBe(false);
    expect(isGeminiParamsSchema(null)).toBe(false);
    expect(isGeminiParamsSchema([{ type: 'string' }])).toBe(false);
    expect(isGeminiParamsSchema(undefined)).toBe(false);
  });

  it('★ والتداخلُ العميقُ يُقطَع — مخطّطٌ متعاودٌ يستهلك الذاكرة لا يُرفَض برسالة', () => {
    let deep: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 9; i += 1) deep = { type: 'object', properties: { x: deep } };
    expect(isGeminiParamsSchema(deep)).toBe(false);
  });

  it('والمتداخلُ المعقول يمرّ', () => {
    expect(isGeminiParamsSchema({
      type: 'object',
      properties: {
        order: {
          type: 'object',
          properties: { items: { type: 'array', items: { type: 'string' } } },
          required: ['items'],
        },
      },
    })).toBe(true);
  });
});

describe('مفتاحُ الأداة اسمُ دالّةٍ يناديها النموذج', () => {
  it('★ لا مسافاتٌ ولا عربيّةٌ ولا حروفٌ كبيرة', () => {
    /* الاسمُ يُنادى في نصّ النموذج، واختلافُ الحالة بين `Send_SMS` و`send_sms`
       يُنتج نداءً لا يطابق شيئاً — فيُقال «تمّ» ولا يُنفَّذ. */
    expect(TOOL_KEY_RE.test('check_stock')).toBe(true);
    expect(TOOL_KEY_RE.test('check stock')).toBe(false);
    expect(TOOL_KEY_RE.test('تحقّق')).toBe(false);
    expect(TOOL_KEY_RE.test('Check_Stock')).toBe(false);
    expect(TOOL_KEY_RE.test('9check')).toBe(false);
    expect(TOOL_KEY_RE.test('a')).toBe(false);
  });

  it('★ واسمُ أداةٍ مدمجةٍ لا يُنتحَل', () => {
    /* مبدِّلُ المنفِّذ يطابق الحالةَ المدمجة أوّلاً، فأداةٌ مخصَّصةٌ تسمّي نفسها
       `collect_lead` تُعلَن للنموذج ثمّ يُنفَّذ غيرُها — وعدٌ صامتٌ بغير ما يقع. */
    for (const k of RESERVED_TOOL_KEYS) {
      expect(BotToolUpsert.safeParse({ ...okTool, key: k }).success, k).toBe(false);
    }
  });
});

describe('العقدُ عند الكتابة', () => {
  it('أداةٌ سليمةٌ تمرّ', () => {
    expect(BotToolUpsert.safeParse(okTool).success).toBe(true);
  });

  it('★ و`String(b.key)` كانت تحويلاً لا تحقّقاً', () => {
    /* `undefined` تصير النصّ «undefined»، وكائنٌ يصير «[object Object]» —
       وكلاهما اسمُ دالّةٍ يرفضه المزوّد. */
    expect(BotToolUpsert.safeParse({ ...okTool, key: undefined }).success).toBe(false);
    expect(BotToolUpsert.safeParse({ ...okTool, key: { a: 1 } }).success).toBe(false);
  });

  it('والوصفُ ليس زينة — هو ما يقرؤه النموذج ليقرّر متى ينادِيها', () => {
    expect(BotToolUpsert.safeParse({ ...okTool, description: 'قصير' }).success).toBe(false);
    expect(BotToolUpsert.safeParse({ ...okTool, description: 'x'.repeat(301) }).success).toBe(false);
  });

  it('★ وطريقةٌ لا ينفّذها المنفِّذ تُرفَض عند الكتابة', () => {
    /* `PUT` مقبولةٌ في ذهن الكاتب ومرفوضةٌ عند التنفيذ، فتُعرَض على النموذج
       أداةٌ تفشل في كلّ نداء — وقاطعُ الدائرة يُعطّلها بعد خمسٍ فيقرأ المالك
       «عُطِّلت آليّاً» بلا أن يعرف لماذا. */
    expect(BotToolUpsert.safeParse({
      ...okTool, http: { method: 'PUT', url: 'https://x.com/a' },
    }).success).toBe(false);
  });

  it('وعنوانٌ ليس رابطاً', () => {
    expect(BotToolUpsert.safeParse({
      ...okTool, http: { method: 'GET', url: 'not a url' },
    }).success).toBe(false);
  });

  it('★ ومخطّطٌ مشوَّهٌ يُرفَض برسالةٍ بدل أن يُسكت البوت', () => {
    expect(BotToolUpsert.safeParse({
      ...okTool, paramsSchema: { type: 'object', properties: { a: { type: 'nope' } } },
    }).success).toBe(false);
  });
});

describe('العقدُ عند التعديل', () => {
  it('★ `key` مقبولٌ وإن لم يُكتب — الباني يرسل الحمولة كاملةً في كلّ حفظ', () => {
    /* ورفضُه يمنع المالكَ من تصحيح أداةٍ معطوبة، أي من الخروج من العطل
       الذي وُجد هذا العقدُ لمنعه. */
    const r = BotToolPatch.safeParse({ key: 'check_stock', titleAr: 'اسمٌ جديد' });
    expect(r.success).toBe(true);
  });

  it('وحقلٌ واحدٌ يكفي', () => {
    expect(BotToolPatch.safeParse({ enabled: false }).success).toBe(true);
  });

  it('وحمولةٌ فارغةٌ ليست تعديلاً', () => {
    expect(BotToolPatch.safeParse({}).success).toBe(false);
  });

  it('★ والقيمُ الخاطئةُ ترفَض في التعديل كما في الإنشاء — وهو طريقُ عودة العطل', () => {
    expect(BotToolPatch.safeParse({ paramsSchema: { type: 'str' } }).success).toBe(false);
    expect(BotToolPatch.safeParse({ http: { method: 'DELETE', url: 'https://x.com' } }).success).toBe(false);
  });
});
