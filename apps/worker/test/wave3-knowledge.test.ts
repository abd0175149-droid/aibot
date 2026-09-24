import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ حرّاسُ الدفعة الثالثة — **البوت يعرف ما رفعه المالك**.
 *
 * هذه هي الميزةُ التي يُشترى المنتج لأجلها، وكانت مقطوعةً في أربعة مواضع من
 * سلسلةٍ واحدة: الرفعُ ينجح · الاستخراجُ ينجح · التقطيعُ يُنتج مقطعاً لا
 * يُسترجَع · والحقنُ يُقصّ بصمت. وكلُّ حلقةٍ تقول «تمّ» فيبدو الطريقُ سليماً
 * من طرفَيه ولا شيءَ يصل.
 *
 * والحرّاس هنا ساكنون: كلُّ عطلٍ كان **شكلاً** — عمودٌ غير موجود · شرطٌ
 * يجعل النصّ والملفّ بديلَين · ميزانيّةٌ ثابتة · مهمّةٌ تُدفع قبل الإيداع.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

/**
 * ★ الشيفرةُ بلا تعليقاتها.
 *
 *   الدرسُ من حارسٍ سابق: حارسٌ يبحث عن نمطٍ ممنوعٍ في الملفّ كلّه يُمسك
 *   **شرحَ إصلاحه** — فيُدفَع صاحبُه إلى حذف الشرح ليمرّ الحارس. والتعليقُ
 *   هو الموضعُ الوحيد الذي يجب أن يُذكر فيه النمطُ الممنوع.
 */
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

/** ونصُّ SQL بلا تعليقات `--`. */
const sqlCode = (rel: string) => read(rel).replace(/^\s*--.*$/gm, ' ');

describe('عمودُ البحث النصّيّ موجودٌ فعلاً', () => {
  it('الهجرة تُنشئ tsv وفهرسَه — والاستعلام كان يسأل عن عمودٍ لا وجود له', () => {
    const m = read('packages/db/migrations/0007_kb_chunks_tsv.sql');
    expect(m).toMatch(/ADD COLUMN IF NOT EXISTS tsv/);
    expect(m, 'مولَّدٌ مخزَّن — لا عمودٌ يُكتب فيه يدويّاً').toMatch(/GENERATED ALWAYS AS/);
    expect(m).toMatch(/kb_chunks_tsv_idx/);
    expect(m, 'GIN لا BTREE — الثاني لا يخدم tsvector').toMatch(/USING gin/i);
  });

  it('★ و`ar_norm` غيرُ متغيّرة — العمود المولَّد يرفض أيّ دالّةٍ سواها', () => {
    const m = read('packages/db/migrations/0007_kb_chunks_tsv.sql');
    expect(m).toMatch(/CREATE OR REPLACE FUNCTION ar_norm/);
    expect(m).toMatch(/IMMUTABLE/);
  });

  it('والاسترجاع يطبّقها على **طرفَي** المقارنة — لا على أحدهما', () => {
    const r = read('apps/worker/src/retrieval.ts');
    const lex = r.slice(r.indexOf('tsv'));
    expect((lex.match(/ar_norm\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('ولا يُعلَن العمود في drizzle — إعلانُه يجعل كلّ insert يكتب فيه فتُرفض', () => {
    expect(read('packages/db/src/schema/bot.ts')).not.toMatch(/tsv:\s*\w+\(/);
  });

  /**
   * ★ و`plainto_tsquery` تعطف بـAND، فسؤالٌ طبيعيٌّ لا يُطابق شيئاً.
   *
   *   مقيسٌ على الخادم الحيّ: مستندُ «سعر الغرفة المفردة ٤٥ ديناراً» والسؤالُ
   *   «كم سعر الغرفة؟» يُنتج `'كم' & 'سعر' & 'غرفه'`، و«كم» ليست في المستند
   *   — فالمطابقةُ `false`. أي أنّ كلمةَ استفهامٍ واحدةً تُبطل الفرعَ المعجميّ
   *   كلَّه، وهي بعينها ما يبدأ به الزبون كلامه. ولا يظهر خطأً: الفرعُ يعود
   *   بصفر صفوفٍ فيبقى المتّجهُ وحده، والهجينُ **يقول** إنّه فرعان.
   */
  it('★ العطفُ OR لا AND — لا plainto_tsquery في الاسترجاع', () => {
    const r = code('apps/worker/src/retrieval.ts');
    expect(r, 'plainto_tsquery تعطف بـAND فتُبطلها كلمةُ استفهامٍ واحدة')
      .not.toMatch(/plainto_tsquery/);
    expect(r).toMatch(/ar_tsq\(/);
  });

  it('و`ar_tsq` تُركَّب بلا اجتذارٍ ثانٍ — to_tsquery تجذّر اللفيظ مرّةً أخرى', () => {
    const m = sqlCode('packages/db/migrations/0008_ar_tsq.sql');
    expect(m).toMatch(/CREATE OR REPLACE FUNCTION ar_tsq/);
    expect(m, 'التحويلُ المباشر إلى tsquery بلا قاموس').toMatch(/::tsquery/);
    expect(m, 'to_tsquery بقاموس arabic تُعيد الاجتذار فتفقد المطابقة')
      .not.toMatch(/to_tsquery\s*\(\s*'arabic'/);
    expect(m, 'IMMUTABLE — وإلّا لم تصلح لفهرسٍ ولا لعمودٍ مولَّد').toMatch(/IMMUTABLE/);
  });

  it('والماسحُ يُسقط التعليقات فعلاً — وإلّا فالحارسُ يمرّ دائماً', () => {
    /* تُقاس على ملفٍّ حقيقيّ: النمطُ الممنوع مذكورٌ في تعليقه لا في شيفرته. */
    expect(read('apps/worker/src/retrieval.ts'), 'التعليقُ يشرح العطل فيذكر النمط')
      .toMatch(/plainto_tsquery/);
    expect(code('apps/worker/src/retrieval.ts'), 'والماسحُ لا يراه')
      .not.toMatch(/plainto_tsquery/);
    expect(read('packages/db/migrations/0008_ar_tsq.sql')).toMatch(/to_tsquery/);
    expect(sqlCode('packages/db/migrations/0008_ar_tsq.sql'))
      .not.toMatch(/to_tsquery\s*\(\s*'arabic'/);
  });

  it('★ والرتبةُ مُغلَّفةٌ بـcoalesce — سؤالُ ترقيمٍ يُنتج NULL يتقدّم في الترتيب', () => {
    expect(read('apps/worker/src/retrieval.ts'))
      .toMatch(/coalesce\(ts_rank\(/);
  });
});

describe('النصُّ والملفّات كلاهما يصل البوت', () => {
  const api = read('apps/api/src/routes/bot.ts');
  const emb = read('apps/worker/src/embed.ts');

  it('الميزانيّة تُحسب من الحقل **والملفّات** معاً', () => {
    expect(api, 'كان القياس على نصّ الحقل وحده، فملفٌّ بعشرين ألف توكن لا يُغيّر وضعَ الحقن')
      .toMatch(/estimateTokens\(kb\)\s*\+\s*estimateTokens\(fileText\)/);
  });

  it('★ وسقفُ الحقن الكامل يُقاس على المعرفة لا يبقى ثابتاً', () => {
    expect(api, 'كان `core: 1200` ثابتاً فتُقصّ المعرفة عند 1,200 توكن بصمت')
      .toMatch(/core:/);
    expect(api).toMatch(/effectiveKb/);
  });

  it('والتضمين يُقطّع الحقل والملفّات — لا أحدهما بديلاً عن الآخر', () => {
    expect(emb, 'كان `!pieces.length` يجعلهما بديلَين: ملفٌّ واحدٌ يُسقط نصّ الحقل كلَّه')
      .not.toMatch(/if\s*\(\s*!pieces\.length\s*\)/);
    expect(emb).toMatch(/chunkText\(ver\.knowledgeBase\)/);
    expect(emb).toMatch(/chunkText\(s\.extractedText/);
  });

  it('والتقطيع له قصٌّ صلبٌ ثلاثيُّ المستويات — أسطرٌ ثمّ جُمَلٌ ثمّ حروف', () => {
    expect(emb).toMatch(/function splitHard\(/);
  });
});

describe('مهمّةُ التضمين تصل بعد الإيداع وتُعاد عند التعثّر', () => {
  it('★ `enqueueEmbed` بعد إيداع المعاملة لا داخلها', () => {
    const api = read('apps/api/src/routes/bot.ts');
    /* داخل `withTenant(...)` كان العامل يسبق الإيداع فلا يجد النسخة، فيخرج
       «مكتملاً» بلا عمل وتبقى `embedStatus: pending` إلى الأبد — وبوّابةُ
       عامل الردّ تُسكت البوت على هذه الحالة بلا رجعة.
       ويُقاس هذا بالمسافة البادئة: النداءُ خارج المعاملة يسكن مستوى الدالّة
       (أربع مسافات)، وداخلَها يسكن ستّاً أو أكثر. */
    const isComment = (l: string) => /^\s*(?:\/\/|\/\*|\*)/.test(l);
    const calls = api.split(/\r?\n/)
      .filter((l) => l.includes('enqueueEmbed(') && !isComment(l));
    expect(calls, 'لا نداءَ enqueueEmbed إطلاقاً').not.toEqual([]);
    for (const l of calls) {
      const depth = /^([ ]*)/.exec(l)![1]!.length;
      expect(depth, `نداءُ enqueueEmbed على عمق ${depth} — داخل المعاملة`).toBeLessThanOrEqual(4);
    }
    expect(api, 'المهمّة تُحتجَز في متغيّرٍ ثمّ تُدفع بعد الإيداع').toMatch(/pendingEmbed/);
  });

  it('والمهمّة تُعاد ثلاثاً بتراجع — والعامل يحذف قبل أن يُدرج فالإعادة آمنة', () => {
    const q = read('apps/api/src/queues.ts');
    const at = q.indexOf("q(QUEUE.embed).add(");
    expect(at).toBeGreaterThan(0);
    const block = q.slice(at, at + 1200);
    expect(block, 'محاولةٌ واحدة تُثبّت النسخة على failed عند أيّ تعثّرٍ عابر')
      .toMatch(/attempts: 3/);
    expect(block, '`attempts` بلا `backoff` يعيد فوراً — ثلاثُ نداءاتٍ في ثانية')
      .toMatch(/backoff:/);
    expect(read('apps/worker/src/embed.ts'), 'الحذفُ قبل الإدراج هو ما يجعل الإعادة آمنة')
      .toMatch(/delete\(kbChunks\)\.where\(eq\(kbChunks\.versionId/);
  });

  it('★ والتراجع يرفض نسخةً فشل تضمينها — نشرُها بوتٌ يقول «لا أعرف» عن كلّ شيء', () => {
    const api = read('apps/api/src/routes/bot.ts');
    const at = api.indexOf("'/bot/versions/:id/rollback'");
    expect(at).toBeGreaterThan(0);
    expect(api.slice(at, at + 1800)).toMatch(/failed/);
  });
});

describe('الشاشة تقول الحقيقة عن الملفّات', () => {
  it('رفعُ ملفٍّ بعد النشر يفتح زرَّ النشر', () => {
    const page = read('apps/web/src/app/app/bot/page.tsx');
    expect(page, 'كانت المقارنة على النصّ والشخصيّة وحدهما، فالملفّ الجديد لا يُغيّر شيئاً')
      .toMatch(/filesChanged/);
    expect(page).toMatch(/changed\s*=\s*personaChanged \|\| kbChanged \|\| filesChanged/);
  });

  it('وملفٌّ استُخرج منه سطران لا يُوسَم أخضرَ «جاهز»', () => {
    const kf = read('apps/web/src/components/KnowledgeFiles.tsx');
    expect(kf, 'PDF ممسوحٌ يُخرج سطرَين ويُقال عنه استُخرج نصُّه').toMatch(/weak/);
    expect(kf, 'والخطأُ يُعرض في القائمة لا في نافذة المعاينة وحدها').toMatch(/error/);
  });
});

describe('التفكيرُ محدودٌ والإخراجُ يكفي', () => {
  it('★ سقفُ الإخراج وميزانيّةُ التفكير مضبوطان — وكان التفكير يأكل السقف فيخرج ردٌّ فارغٌ مفوتَر', () => {
    const g = read('packages/ai/src/google.ts');
    expect(g).toMatch(/maxOutputTokens: input\.maxOutputTokens \?\? 2048/);
    expect(g).toMatch(/thinkingBudget: input\.thinkingBudget \?\? 512/);
    expect(read('packages/ai/src/types.ts')).toMatch(/thinkingBudget\?: number/);
  });
});

describe('العجزُ يصل الموظّف', () => {
  it('★ `usedFallback` أو `unknown` يرفعان `needsAttention` في العامل', () => {
    const r = read('apps/worker/src/reply.ts');
    expect(r, 'نصُّ العجز يَعِد بالتحويل — والعلَمُ بلا مُنادٍ وعدٌ فارغ')
      .toMatch(/result\.flags\.usedFallback \|\| result\.flags\.unknown/);
    const at = r.indexOf('result.flags.usedFallback');
    expect(r.slice(at, at + 900)).toMatch(/needsAttention: true/);
  });

  it('ولا يوقف البوت — الإيقافُ للتحويل الصريح وحده', () => {
    const r = read('apps/worker/src/reply.ts');
    const at = r.indexOf('result.flags.usedFallback');
    expect(
      r.slice(at, at + 900),
      '«لا أعرف» عن سؤالٍ واحدٍ لا تُسكت البوت ربعَ ساعةٍ عن بقيّة الحوار',
    ).not.toMatch(/botPausedUntil/);
  });

  it('والعلَمُ معلَنٌ في نوع نتيجة الحلقة', () => {
    expect(read('packages/core/src/agent.ts')).toMatch(/usedFallback: boolean/);
  });
});
