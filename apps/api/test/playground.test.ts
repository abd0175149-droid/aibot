import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendKnowledge, pickPresets } from '../src/routes/playground.js';

/**
 * ★ حرّاسُ الساحة في طبقة الـAPI.
 *
 * والمُحرَس هنا شيئان: **دالّةٌ تكتب في معرفة عميل** (فخطؤها يمحو معرفةً أو
 * يُنتج مقطعاً بلا عنوان)، و**شكلُ المسار** (فبوّابةُ صلاحيّةٍ ناقصةٌ أو
 * استعلامٌ بلا سياق مستأجرٍ لا يفشل بالعين).
 */

const SRC = readFileSync(join(__dirname, '..', 'src', 'routes', 'playground.ts'), 'utf8');

describe('إلحاقُ المعرفة — لا يمحو ما قبله ولا يلصق كتلتَه', () => {
  it('نصٌّ فارغ: كتلةٌ واحدةٌ بعنوانٍ وسطرٍ أخير', () => {
    expect(appendKnowledge('', 'في توصيل؟', 'نعم، داخل عمّان.'))
      .toBe('## في توصيل؟\nنعم، داخل عمّان.\n');
  });

  it('★ نصٌّ **بلا سطرٍ أخير**: يُفصَل بسطرٍ فارغٍ ولا يُلصَق بآخر سطر', () => {
    /* هذا بعينه ما أنتج `;;` في ملفّ ترحيلٍ اليوم: إلحاقٌ على ملفٍّ بلا سطرٍ
       أخير. وهنا أثرُه أخفى: تذوب الكتلةُ في المقطع السابق فيحمل عنوانَه. */
    const out = appendKnowledge('## الأسعار\nالمشاوي 12 ديناراً.', 'وين موقعكم؟', 'شارع المدينة.');
    expect(out).toBe('## الأسعار\nالمشاوي 12 ديناراً.\n\n## وين موقعكم؟\nشارع المدينة.\n');
    expect(out.startsWith('## الأسعار\nالمشاوي 12 ديناراً.')).toBe(true);
  });

  it('لا تتراكم الأسطر مع كلّ إضافة', () => {
    const once = appendKnowledge('أساس.', 'س١', 'ج١');
    const twice = appendKnowledge(once, 'س٢', 'ج٢');
    expect(twice).not.toMatch(/\n{3}/);
    expect(twice).toBe('أساس.\n\n## س١\nج١\n\n## س٢\nج٢\n');
  });

  it('★ المعرفةُ القائمة تعود حرفيّاً — فلا تمحو إضافةٌ سطراً واحداً منها', () => {
    const base = 'سطر ١\nسطر ٢\n\n## عنوان\nنصّ';
    const out = appendKnowledge(base, 'س', 'ج');
    expect(out.slice(0, base.length)).toBe(base);
  });

  it('العنوانُ سطرٌ واحدٌ مهما كان السؤال، ومحدودُ الطول', () => {
    const out = appendKnowledge('', 'سؤال\nمن\nثلاثة أسطر', 'ج');
    expect(out.split('\n')[0]).toBe('## سؤال من ثلاثة أسطر');

    const long = appendKnowledge('', 'ط'.repeat(300), 'ج');
    expect(long.split('\n')[0]!.length).toBe(123); // «## » + 120
  });
});

describe('الأسئلة الجاهزة — من رسائل الزبائن لا من الخيال', () => {
  it('يُسقط المكرّر ولو اختلفت مسافاتُه أو حالةُ حروفه', () => {
    expect(pickPresets(['بكم السعر؟', '  بكم   السعر؟ ', 'بكم السعر؟'])).toEqual(['بكم السعر؟']);
    expect(pickPresets(['Delivery?', 'delivery?'])).toEqual(['Delivery?']);
  });

  it('يُسقط ما لا يصلح سؤالاً: القصيرَ جدّاً والطويلَ جدّاً', () => {
    expect(pickPresets(['تمام', 'اوك'])).toEqual([]);
    expect(pickPresets(['ش'.repeat(121)])).toEqual([]);
    expect(pickPresets(['ش'.repeat(120)])).toHaveLength(1);
  });

  it('يتجاوز الفراغَ والغياب بلا انهيار', () => {
    expect(pickPresets([null, undefined, '', '   ', 'سؤالٌ صالح؟'])).toEqual(['سؤالٌ صالح؟']);
  });

  it('يحترم السقفَ ويحفظ الترتيب — والأحدثُ أوّلاً كما يأتي من القاعدة', () => {
    const many = Array.from({ length: 20 }, (_, i) => `سؤال رقم ${i}`);
    const out = pickPresets(many, 6);
    expect(out).toHaveLength(6);
    expect(out[0]).toBe('سؤال رقم 0');
  });
});

describe('شكلُ المسار — ما لا تمسكه المراجعة', () => {
  it('★ كلُّ مسارٍ في الملفّ محميٌّ بـsettings — والجرّب يُنفِق مال العميل', () => {
    /* بندُ التنقّل يُخفي الشاشة عن الموظّف، و**إخفاءُ بندٍ ليس أماناً**:
       المسارُ يُكتب بالأصابع. والحدُّ الحقيقيّ في الخادم. */
    const routes = [...SRC.matchAll(/app\.(?:get|post|put|patch|delete)[\s\S]{0,400}?'(\/playground[^']*)'/g)]
      .map((m) => m[1]!);
    const guarded = [...SRC.matchAll(/preHandler:\s*auth\b/g)].length;

    expect(routes.sort()).toEqual(['/playground', '/playground/knowledge', '/playground/run']);
    // حارسٌ لكلّ مسارٍ بالعدد — فمسارٌ خامسٌ بلا `preHandler` يُسقط الاختبار
    expect(guarded, 'مسارٌ في الملفّ بلا preHandler: auth').toBe(routes.length);
    expect(SRC).toContain("const auth = requireAuth({ settings: true })");
    // ولا مسارٌ يستعمل حارساً أضعف
    expect(SRC).not.toMatch(/preHandler:\s*requireAuth\(\)/);
  });

  it('★ لا withPlatform في الملفّ — الجرّب ليس فعلاً عابراً للمستأجرين', () => {
    expect(SRC).not.toContain('withPlatform');
  });

  it('★ ولا إرسالَ ولا طابورَ صادرٍ من هذه الشاشة', () => {
    /* القيدُ الحاكم: الساحة لا تُرسل شيئاً إلى قناةٍ أبداً. وشكلُه في الكود
       هو الحدّ — لا نيّةُ من كتبه. */
    for (const forbidden of ['enqueueOutbound', 'sendOutbound', 'enqueueReply', 'conversationWindows']) {
      expect(SRC, `${forbidden} في مسار الساحة`).not.toContain(forbidden);
    }
  });

  it('سقفُ الدقيقة محسوبٌ من ai_runs لا من عدّادٍ في الذاكرة', () => {
    // نسختان من الـAPI تُضاعفان عدّادَ الذاكرة بصمت — والصفوفُ لا تكذب
    expect(SRC).toContain("eq(aiRuns.source, 'playground')");
    expect(SRC).toContain("interval '1 minute'");
  });
});
