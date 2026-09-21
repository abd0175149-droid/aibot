import type { KnowledgeChunk, KnowledgeProvider } from './context.js';
import { estimateTokens } from './context.js';

/**
 * التنفيذ الأوّل من منفذ المعرفة: **الحقن الكامل**.
 * يُستعمل تحت 8,000 توكن — حيث تكلفة الاسترجاع (مقاطعُ متغيّرة تُفوتَر كاملةً)
 * تتجاوز تكلفة بادئةٍ ثابتة تُخزَّن في الكاش بخصم.
 */
export class FullKnowledge implements KnowledgeProvider {
  readonly mode = 'full' as const;
  constructor(private readonly text: string) {}

  async pinned(): Promise<KnowledgeChunk[]> {
    if (!this.text.trim()) return [];
    return [{
      id: 'full',
      headingPath: null,
      body: this.text,
      tokenCount: estimateTokens(this.text),
      pinned: true,
    }];
  }

  async retrieve(): Promise<{ chunks: KnowledgeChunk[]; skipped: boolean; cacheHit: boolean; latencyMs: number }> {
    // المعرفة كلّها في الطبقة الثابتة أصلاً — لا استرجاع ولا نداء تضمين.
    return { chunks: [], skipped: true, cacheHit: false, latencyMs: 0 };
  }
}

/**
 * تطبيعٌ عربيّ قبل كلّ شيء.
 * يرفع إصابة كاش التضمين كثيراً — «بكم السعر» و«بكم السّعر؟» و«بكم السعر»
 * تصير مفتاحاً واحداً — ويحسّن المسار اللفظيّ في الاسترجاع الهجين.
 */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْٰ]/g, '')   // تشكيل
    .replace(/ـ/g, '')                   // تطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[؟?!.,،;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** تحيّاتٌ وردودٌ قصيرة لا تحتاج معرفةً — يُتخطّى الاسترجاع ونداء التضمين معاً. */
/**
 * ⚠️ لا تستعمل `\b` هنا: حدّ الكلمة في JavaScript معرَّفٌ بـ`[A-Za-z0-9_]`، فلا
 *    يتحقّق أبداً بين حرفٍ عربيٍّ ومسافة. النمط يفشل **صامتاً** على كلّ تحيّةٍ
 *    متبوعةٍ بكلمة («شكرا كتير») فيُستدعى استرجاعٌ لا لزوم له مع كلّ شكر.
 *    البديل: مسافةٌ صريحة أو نهاية النصّ.
 */
const GREETING = /^(مرحبا|مرحبتين|السلام|هلا|اهلا|هاي|صباح|مساء|شكرا|تسلم|يعطيك|اوك|تمام|ماشي|طيب|نعم|حسنا)(\s|$)/;

export function shouldSkipRetrieval(query: string): boolean {
  const q = normalizeArabic(query);
  if (!q) return true;
  const words = q.split(' ').filter((w) => w.length > 1);
  if (words.length < 2) return true;
  return GREETING.test(q) && words.length <= 3;
}

/**
 * بناء نصّ الاستعلام من المحادثة.
 * سؤال الزبون بالعاميّة قصيرٌ جدّاً («فيكم توصيل؟»)، فيُدمج بآخر دورَين
 * ليحمل موضوعه — بلا نداء نموذجٍ لإعادة الصياغة. تُقاس الحاجة إليه لاحقاً.
 */
export function buildRetrievalQuery(
  current: string,
  history: Array<{ role: 'user' | 'model'; text: string }>,
): string {
  const prevUser = history.filter((h) => h.role === 'user').slice(-2).map((h) => h.text).join(' ');
  return normalizeArabic(`${prevUser} ${current}`).slice(0, 400);
}

/** دمج الترتيبين بـReciprocal Rank Fusion — لا يحتاج معايرة أوزان. */
export function rrf<T extends { id: string }>(
  lists: T[][],
  k = 60,
  topN = 6,
): Array<{ item: T; score: number }> {
  const scores = new Map<string, { item: T; score: number }>();
  for (const list of lists) {
    list.forEach((item, i) => {
      const cur = scores.get(item.id);
      const add = 1 / (k + i + 1);
      if (cur) cur.score += add;
      else scores.set(item.id, { item, score: add });
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, topN);
}

/** يقتطع المقاطع عند ميزانيّة التوكنز — الأعلى ترتيباً أوّلاً. */
export function fitChunks(chunks: KnowledgeChunk[], budgetTokens: number): KnowledgeChunk[] {
  const out: KnowledgeChunk[] = [];
  let used = 0;
  for (const c of chunks) {
    if (used + c.tokenCount > budgetTokens) continue;
    out.push(c);
    used += c.tokenCount;
  }
  return out;
}

/**
 * العتبة التي تقرّر وضع المعرفة.
 * 8,000 لا 20,000 — راجع ٠٨.٦: الحقن الكامل يجلس في بادئةٍ ثابتة فيُخزَّن بخصم،
 * والمسترجَع يتغيّر مع كلّ سؤالٍ فيُفوتَر كاملاً. التعادل بين 3,500 و7,700
 * حسب كثافة حركة العميل (وفوتُ الكاش هو الحالة الشائعة عند العميل الصغير).
 */
export function decideKnowledgeMode(kbTokens: number): 'full' | 'hybrid' | 'rag' {
  if (kbTokens < 8_000) return 'full';
  if (kbTokens <= 40_000) return 'hybrid';
  return 'rag';
}
