import { describe, it, expect, vi } from 'vitest';
import { runAgent } from '../src/agent.js';
import type { AiProvider, GenerateResult, ModelUsage } from '@aibot/ai';
import { buildToolDeclarations, choicesMessage, BUILTIN_TOOLS } from '../src/tools/builtin.js';
import { whatsappCapabilities } from '@aibot/channels';
import type { ChannelCapabilities } from '@aibot/shared';

const noUsage: ModelUsage = {
  promptTokens: 100, outputTokens: 20, thoughtsTokens: 0, cachedTokens: 60, totalTokens: 120,
};

/** مزوّدٌ وهميّ يُعيد ردوداً مبرمَجة — النواة تُختبر بلا شبكةٍ ولا قاعدة. */
function stubProvider(script: Array<Partial<GenerateResult>>): AiProvider {
  let i = 0;
  return {
    name: 'stub',
    async generate() {
      const s = script[Math.min(i++, script.length - 1)] ?? {};
      return {
        text: s.text ?? '',
        toolCalls: s.toolCalls ?? [],
        usage: s.usage ?? noUsage,
        rawParts: s.rawParts ?? [{ text: s.text ?? '' }],
        finishReason: 'STOP',
      };
    },
    async embed() { return []; },
  };
}

const guard = {
  allowedLinkHosts: ['baitalsham.jo'],
  maxLen: 900,
  lastOutboundText: null,
  toolNames: ['check_availability', 'handoff_to_human'],
};

const base = {
  apiKey: 'k',
  model: 'gemini-2.5-flash',
  system: 'أنت شام.',
  contents: [{ role: 'user' as const, parts: [{ text: 'مرحبا' }] }],
  tools: [],
  maxLoops: 3,
  guard,
  fallbackText: 'ما قدرت أجاوب، بحوّلك لموظّف.',
};

describe('حلقة الوكيل', () => {
  it('ردٌّ نصّيّ بلا أدوات: نداءٌ واحد', async () => {
    const r = await runAgent({
      ...base,
      provider: stubProvider([{ text: 'مرحبتين! كيف أساعدك؟' }]),
      execTool: async () => ({ result: {} }),
    });
    expect(r.calls).toBe(1);
    expect(r.text).toBe('مرحبتين! كيف أساعدك؟');
    expect(r.toolsUsed).toEqual([]);
  });

  it('ينفّذ الأداة ثمّ يردّ — ويجمع التوكنز عبر النداءين', async () => {
    const exec = vi.fn(async () => ({ result: { open: true } }));
    const r = await runAgent({
      ...base,
      provider: stubProvider([
        { toolCalls: [{ id: 'c1', name: 'check_availability', args: { d: 'خميس' }, raw: { functionCall: {} } }] },
        { text: 'متاح الخميس 8:30' },
      ]),
      execTool: exec,
    });
    expect(exec).toHaveBeenCalledOnce();
    expect(r.calls).toBe(2);
    expect(r.usage.promptTokens).toBe(200);
    expect(r.usage.cachedTokens).toBe(120);
    expect(r.toolsUsed).toEqual(['check_availability']);
  });

  it('يعيد أجزاء ردّ النموذج حرفيّاً — تجريدها يُفشل النداء التالي', async () => {
    const marker = { functionCall: { name: 'check_availability', thoughtSignature: 'SIG-XYZ' } };
    const seen: unknown[] = [];
    const provider: AiProvider = {
      name: 'spy',
      async generate(input) {
        seen.push(structuredClone(input.contents));
        return seen.length === 1
          ? { text: '', toolCalls: [{ id: 'c', name: 'check_availability', args: {}, raw: marker }],
              usage: noUsage, rawParts: [marker], finishReason: null }
          : { text: 'تمّ', toolCalls: [], usage: noUsage, rawParts: [{ text: 'تمّ' }], finishReason: 'STOP' };
      },
      async embed() { return []; },
    };
    await runAgent({ ...base, provider, execTool: async () => ({ result: {} }) });
    const second = seen[1] as Array<{ role: string; parts: unknown }>;
    const modelTurn = second.find((c) => c.role === 'model')!;
    expect(modelTurn.parts).toEqual([marker]); // بما فيها thoughtSignature
  });

  it('الاستدعاءات المتوازية تُنفَّذ معاً وتُعاد بنفس الترتيب', async () => {
    const order: string[] = [];
    const r = await runAgent({
      ...base,
      provider: stubProvider([
        { toolCalls: [
          { id: '1', name: 'check_availability', args: {}, raw: {} },
          { id: '2', name: 'handoff_to_human', args: {}, raw: {} },
        ] },
        { text: 'تمّ' },
      ]),
      execTool: async (c) => {
        // الأولى أبطأ — لو كان التنفيذ تسلسليّاً لاختلف الترتيب
        if (c.name === 'check_availability') await new Promise((r) => setTimeout(r, 20));
        order.push(c.name);
        return { result: { ok: c.name }, handoff: c.name === 'handoff_to_human' };
      },
    });
    expect(order).toEqual(['handoff_to_human', 'check_availability']); // انتهت الثانية أوّلاً
    expect(r.toolsUsed).toEqual(['check_availability', 'handoff_to_human']); // الترتيب الأصليّ محفوظ
    expect(r.flags.handoff).toBe(true);
  });

  it('تسريب أداةٍ قبل تنفيذ أيّ أداة ⟵ إعادة صياغةٍ واحدة', async () => {
    const r = await runAgent({
      ...base,
      provider: stubProvider([
        { text: 'خليني أشوف check_availability(date="خميس")' },
        { text: 'خليني أتأكّد من التوفّر للخميس' },
      ]),
      execTool: async () => ({ result: {} }),
    });
    expect(r.calls).toBe(2);
    expect(r.flags.leak).toBe(true);
    expect(r.text).toBe('خليني أتأكّد من التوفّر للخميس');
  });

  it('تسريبٌ بعد تنفيذ أداة ⟵ تنظيفٌ بلا إعادة صياغة، فلا تضيع نتيجة الأداة', async () => {
    const r = await runAgent({
      ...base,
      provider: stubProvider([
        { toolCalls: [{ id: 'c', name: 'check_availability', args: {}, raw: {} }] },
        { text: 'متاح check_availability(x) الخميس' },
      ]),
      execTool: async () => ({ result: { ok: true } }),
    });
    expect(r.calls).toBe(2); // لا نداء ثالث
    expect(r.flags.leak).toBe(true);
    expect(r.text).not.toContain('check_availability');
    expect(r.text).toContain('متاح');
  });

  it('بلوغ آخر دورة: الأدوات تُسحب فيُجبَر النموذج على نصّ — ولا صمت', async () => {
    const r = await runAgent({
      ...base,
      maxLoops: 1,
      provider: stubProvider([
        { toolCalls: [{ id: 'a', name: 'check_availability', args: {}, raw: {} }] },
        { toolCalls: [{ id: 'b', name: 'check_availability', args: {}, raw: {} }] },
      ]),
      execTool: async () => ({ result: {} }),
    });
    expect(r.flags.maxLoops).toBe(true);
    expect(r.text).toBe(base.fallbackText);
  });

  it('فشل أداةٍ يُرفع علماً ولا يُسقط الردّ', async () => {
    const r = await runAgent({
      ...base,
      provider: stubProvider([
        { toolCalls: [{ id: 'c', name: 'check_availability', args: {}, raw: {} }] },
        { text: 'صار في مشكلة تقنيّة، بحوّلك لموظّف.' },
      ]),
      execTool: async () => { throw new Error('المصدر لا يستجيب'); },
    });
    expect(r.flags.fail).toBe(true);
    expect(r.text).toContain('بحوّلك لموظّف');
  });

  it('«لا أعرف» تُرفع علماً — منها تُبنى شاشة فجوات المعرفة', async () => {
    const r = await runAgent({
      ...base,
      provider: stubProvider([{ text: 'ما عندي هذي المعلومة، بحوّلك لموظّف.' }]),
      execTool: async () => ({ result: {} }),
    });
    expect(r.flags.unknown).toBe(true);
  });
});

describe('تعريفات الأدوات مشروطةٌ بالقدرات', () => {
  const all = new Set(BUILTIN_TOOLS.map((t) => t.key));

  it('واتساب: الموقع والخيارات معاً', () => {
    const d = buildToolDeclarations(whatsappCapabilities, all);
    const names = d.map((x) => x.name);
    expect(names).toContain('send_location');
    expect(names).toContain('send_quick_options');
  });

  it('قناةٌ بلا موقع: الأداة تختفي من التعريفات — لا تُعطَّل', () => {
    const ig: ChannelCapabilities = { ...whatsappCapabilities, buttons: 0, quickReplies: 13, location: false };
    const names = buildToolDeclarations(ig, all).map((x) => x.name);
    expect(names).not.toContain('send_location');
    // الردود السريعة تكفي للخيارات وإن غابت الأزرار
    expect(names).toContain('send_quick_options');
  });

  it('قناةٌ بلا أزرارٍ ولا ردودٍ سريعة: لا تأكيدَ بالزرّ أصلاً', () => {
    const poor: ChannelCapabilities = { ...whatsappCapabilities, buttons: 0, quickReplies: 0 };
    const names = buildToolDeclarations(poor, all).map((x) => x.name);
    expect(names).not.toContain('ask_confirmation');
    expect(names).toContain('handoff_to_human'); // لا تحتاج قدرةً
  });

  it('الأداة المعطَّلة لا تظهر ولو كانت القناة تدعمها', () => {
    const names = buildToolDeclarations(whatsappCapabilities, new Set(['handoff_to_human'])).map((x) => x.name);
    expect(names).toEqual(['handoff_to_human']);
  });

  it('عنوان الخيار يُقصّ عند حدّ القناة — ميتا ترفض الرسالة كاملةً لو طال', () => {
    const m = choicesMessage('اختر', ['عنوانٌ طويلٌ جدّاً يتجاوز عشرين حرفاً بسهولة'], whatsappCapabilities);
    expect(m.kind).toBe('choices');
    if (m.kind === 'choices') expect(m.options[0]!.title.length).toBeLessThanOrEqual(20);
  });
});
