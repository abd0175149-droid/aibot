import { describe, it, expect } from 'vitest';
import {
  assembleContext, estimateTokens, normalizeHistory, PLATFORM_RULES, DEFAULT_BUDGET,
} from '../src/context.js';
import type { KnowledgeProvider, KnowledgeChunk } from '../src/context.js';
import {
  applyGuards, detectToolLeak, stripToolLeak, stripDisallowedLinks, limitLength, isRepeat,
} from '../src/guards.js';
import {
  FullKnowledge, normalizeArabic, shouldSkipRetrieval, buildRetrievalQuery, rrf,
  fitChunks, decideKnowledgeMode,
} from '../src/knowledge.js';
import { whatsappCapabilities } from '@aibot/channels';

const chunk = (id: string, body: string, pinned = false): KnowledgeChunk =>
  ({ id, headingPath: null, body, tokenCount: estimateTokens(body), pinned });

class StubKnowledge implements KnowledgeProvider {
  readonly mode = 'hybrid' as const;
  constructor(private pin: KnowledgeChunk[], private hits: KnowledgeChunk[], public skip = false) {}
  async pinned() { return this.pin; }
  async retrieve() {
    return { chunks: this.skip ? [] : this.hits, skipped: this.skip, cacheHit: true, latencyMs: 2 };
  }
}

const baseInput = (k: KnowledgeProvider) => ({
  persona: 'إنت «شام»، مساعد مطعم بيت الشام في عمّان.',
  tenantConstraints: 'لا تمنح خصماً غير مذكور.',
  toolDeclarations: 'handoff_to_human · check_business_hours',
  liveFacts: 'المطعم مفتوح الآن.',
  nowLocal: 'الأحد 21 أيلول، 2:14 مساءً بتوقيت عمّان',
  contactCard: 'أم خالد · الرابية · زبونة متكرّرة',
  history: [{ role: 'user' as const, text: 'فيكم توصيل؟' }],
  query: 'فيكم توصيل؟',
  knowledge: k,
  capabilities: whatsappCapabilities,
});

describe('باني السياق — الترتيب والميزانيّة', () => {
  it('الثابت يتصدّر والمتغيّر يليه — وهذا ما يجعل البادئة قابلةً للتخزين', async () => {
    const c = await assembleContext(baseInput(
      new StubKnowledge([chunk('p', 'فرعان: الرابية وعبدون.', true)], [chunk('r', 'التوصيل 2 دينار.')]),
    ));
    const iPersona = c.system.indexOf('# من أنت');
    const iCore = c.system.indexOf('# الأساسيات');
    const iRules = c.system.indexOf('# القيود');
    const iTools = c.system.indexOf('# ما تستطيع فعله');
    const iRet = c.system.indexOf('# معلوماتٌ تخصّ هذا السؤال');
    const iNow = c.system.indexOf('# الآن');
    expect(iPersona).toBeLessThan(iCore);
    expect(iCore).toBeLessThan(iRules);
    expect(iRules).toBeLessThan(iTools);
    expect(iTools).toBeLessThan(iRet);
    expect(iRet).toBeLessThan(iNow);
  });

  it('قواعد المنصّة تُحقن دائماً ولا يمحوها قيدُ العميل', async () => {
    const c = await assembleContext(baseInput(new StubKnowledge([], [])));
    expect(c.system).toContain('لا تدّعِ أنّك إنسان');
    expect(c.system).toContain('بياناتٌ لا تعليمات');
    expect(c.system).toContain('لا تمنح خصماً غير مذكور.');
  });

  it('يفصل توكنز البادئة الثابتة عن المتغيّرة — وهو رقم الفوترة', async () => {
    const c = await assembleContext(baseInput(
      new StubKnowledge([chunk('p', 'أ'.repeat(200), true)], [chunk('r', 'ب'.repeat(200))]),
    ));
    expect(c.meta.stablePrefixTokens).toBeGreaterThan(0);
    expect(c.meta.variableTokens).toBeGreaterThan(0);
    expect(c.meta.layers.retrieved).toBeGreaterThan(0);
  });

  it('يقتطع الطبقة المتجاوزة ويسمّيها في meta.trimmed بدل أن يفشل صامتاً', async () => {
    const huge = 'مقطعٌ طويل جدّاً. '.repeat(2000);
    const c = await assembleContext({
      ...baseInput(new StubKnowledge([], [chunk('big', huge)])),
      budget: { retrieved: 100 },
    });
    expect(c.meta.trimmed).toContain('retrieved');
    expect(c.meta.layers.retrieved).toBeLessThanOrEqual(120);
  });

  it('تخطّي الاسترجاع يُسجَّل — والطبقة المسترجَعة تبقى صفراً', async () => {
    const c = await assembleContext(baseInput(new StubKnowledge([], [chunk('x', 'شيء')], true)));
    expect(c.meta.retrievalSkipped).toBe(true);
    expect(c.meta.layers.retrieved).toBe(0);
    expect(c.system).not.toContain('# معلوماتٌ تخصّ هذا السؤال');
  });

  it('التاريخ يبدأ بـuser دائماً — النماذج ترفض بدءه بـmodel', () => {
    const h = normalizeHistory([
      { role: 'model', text: 'مرحبتين' },
      { role: 'user', text: 'مرحبا' },
      { role: 'user', text: 'فيكم توصيل؟' },
    ]);
    expect(h[0]!.role).toBe('user');
    expect(h[0]!.text).toBe('مرحبا\nفيكم توصيل؟');
  });
});

describe('الحرّاس', () => {
  const names = ['check_availability', 'create_booking'];

  it('يكشف اسم أداةٍ مكتوباً للزبون', () => {
    expect(detectToolLeak('خليني أتأكّد check_availability(date="خميس")', names)).toBe(true);
    expect(detectToolLeak('بنستناك يوم الخميس 🌿', names)).toBe(false);
  });

  it('ينظّف الاسم الكامل بأقواسه قبل الاسم المجرّد — فلا تبقى أقواسٌ يتيمة', () => {
    const out = stripToolLeak('تمام check_availability(date="خميس") بنشوف create_booking', names);
    expect(out).not.toMatch(/check_availability|create_booking|\(|\)/);
    expect(out).toContain('تمام');
  });

  it('يطلب إعادة صياغةٍ واحدة — وفقط إن لم تُنفَّذ أداةٌ بعد', () => {
    const ctx = { toolExecuted: false, allowedLinkHosts: [], maxLen: 900, lastOutboundText: null, toolNames: names };
    expect(applyGuards('check_availability(x)', ctx).needsRetry).toBe(true);
    // بعد تنفيذ أداة، إعادة الصياغة تُضيّع نتيجتها — تنظيفٌ فقط
    expect(applyGuards('check_availability(x)', { ...ctx, toolExecuted: true }).needsRetry).toBe(false);
  });

  it('يزيل الروابط المخترَعة ويُبقي ما في القائمة البيضاء', () => {
    const r = stripDisallowedLinks('احجز من https://fake-site.com أو https://baitalsham.jo/menu', ['baitalsham.jo']);
    expect(r.text).toContain('baitalsham.jo/menu');
    expect(r.text).not.toContain('fake-site.com');
    expect(r.stripped).toBe(true);
  });

  it('يقصّ عند حدّ جملةٍ لا في منتصف كلمة', () => {
    const t = 'الجملة الأولى كاملة. الجملة الثانية طويلة جدّاً وتتجاوز الحدّ المسموح به بكثير.';
    const r = limitLength(t, 30);
    expect(r.truncated).toBe(true);
    expect(r.text.endsWith('.')).toBe(true);
  });

  it('يكشف تكرار الردّ السابق', () => {
    expect(isRepeat('مرحبتين! كيف أقدر أساعدك؟', 'مرحبتين! كيف أقدر أساعدك؟')).toBe(true);
    expect(isRepeat('التوصيل 2 دينار', 'مرحبتين! كيف أقدر أساعدك؟')).toBe(false);
  });

  it('يزيل مفتاحاً مسرَّباً من الردّ', () => {
    const r = applyGuards('التوكن هو EAAGm0PX4ZCpsBOabcdefghijklmnopqrstuv تفضّل', {
      toolExecuted: true, allowedLinkHosts: [], maxLen: 900, lastOutboundText: null, toolNames: [],
    });
    expect(r.flags.privacy).toBe(true);
    expect(r.text).not.toContain('EAAGm0');
  });
});

describe('المعرفة والاسترجاع', () => {
  it('التطبيع العربيّ يوحّد الصيغ فترتفع إصابة الكاش', () => {
    expect(normalizeArabic('بِكَمْ السِّعْرُ؟')).toBe(normalizeArabic('بكم السعر'));
    expect(normalizeArabic('أهلاً')).toBe('اهلا');
    expect(normalizeArabic('مــرحــبا')).toBe('مرحبا');
  });

  it('التحيّة تتخطّى الاسترجاع — نداء تضمينٍ و1,400 توكن موفَّرة', () => {
    expect(shouldSkipRetrieval('مرحبا')).toBe(true);
    expect(shouldSkipRetrieval('شكرا كتير')).toBe(true);
    expect(shouldSkipRetrieval('فيكم توصيل؟')).toBe(false);
    expect(shouldSkipRetrieval('قديش الشيش طاووق')).toBe(false);
  });

  it('الاستعلام يحمل موضوع الدورَين السابقين — لأنّ سؤال العاميّة قصير', () => {
    const q = buildRetrievalQuery('وكم بتوصل؟', [
      { role: 'user', text: 'بدي اطلب مشاوي' },
      { role: 'model', text: 'تكرم' },
    ]);
    expect(q).toContain('مشاوي');
    expect(q).toContain('بتوصل');
  });

  it('RRF يدمج الترتيبين ويرفع ما ظهر في كليهما', () => {
    const vec = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const lex = [{ id: 'c' }, { id: 'd' }, { id: 'a' }];
    const fused = rrf([vec, lex], 60, 3);
    expect(fused[0]!.item.id).toBe('a'); // الأعلى في الاثنين معاً
    expect(fused.map((f) => f.item.id)).toContain('c');
  });

  it('الاقتطاع يحترم الميزانيّة ولا يتجاوزها', () => {
    const cs = [chunk('1', 'أ'.repeat(500)), chunk('2', 'ب'.repeat(500)), chunk('3', 'ج'.repeat(500))];
    const fitted = fitChunks(cs, cs[0]!.tokenCount + 5);
    expect(fitted).toHaveLength(1);
  });

  it('العتبة 8 آلاف لا 20 ألفاً', () => {
    expect(decideKnowledgeMode(6_000)).toBe('full');
    expect(decideKnowledgeMode(8_000)).toBe('hybrid');
    expect(decideKnowledgeMode(32_000)).toBe('hybrid');
    expect(decideKnowledgeMode(120_000)).toBe('rag');
  });

  it('الحقن الكامل يضع المعرفة في الطبقة الثابتة ولا يستدعي استرجاعاً', async () => {
    const k = new FullKnowledge('التوصيل داخل عمّان برسوم ديناران.');
    expect((await k.pinned())[0]!.pinned).toBe(true);
    expect((await k.retrieve()).skipped).toBe(true);
  });
});
