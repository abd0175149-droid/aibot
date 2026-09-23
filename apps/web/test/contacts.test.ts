import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDuplicates, sidesOf, DUP_CRIT, type DupFacts } from '../src/lib/contacts';

/**
 * ★ شاشةُ جهات الاتّصال — ما يُختبَر منها **قرارٌ** لا شكل.
 *
 * وقراران بعينهما:
 *  ① **متى يُقال «نظيف»** — والعطل الذي وُلد منه هذا الملفّ وقع في أوّل
 *    تجميع: القائمة تصل من نقطةٍ والفحصُ من أخرى والفحصُ أبطأ، فكان الشريطُ
 *    يقرأ «صفر مرشَّحين» قبل أن يُفحَص شيء فيضيء **أخضرَ** ويقول «لا بطاقةَ
 *    مرشَّحةً للدمج». إطمئنانٌ كاذبٌ يُقرأ في نصف ثانيةٍ ويُغلَق عليه، وهو
 *    أسوأُ من الصمت.
 *  ② **لا دمجَ بلا مراجعة** — وهو قيدٌ بنيويٌّ لا نصيحة، فيُفحَص في الملفّ
 *    نفسِه: نقطةُ الدمج تُستدعى من موضعٍ واحدٍ لا يُدخَل إلّا بخطّةٍ مجلوبةٍ
 *    من الخادم.
 */

const facts = (o: Partial<DupFacts> = {}): DupFacts => ({
  loading: false, error: false, scan: null, total: 100, ...o,
});

describe('قراءةُ فحص التكرار — ثلاثُ حالاتٍ لا اثنتان', () => {
  it('★ «يُفحَص» ليست «نظيفاً»: لا أخضرَ ولا رقمَ قبل أن يصل الفحص', () => {
    const r = readDuplicates(facts({ loading: true }));
    expect(r.state).toBe('scanning');
    expect(r.sev).toBe('plain');
    // `null` لا صفر — والواجهةُ ترسم «—» فلا يُقرأ غيابُ الخبر خبراً ساراً
    expect(r.records).toBeNull();
  });

  it('★ وفشلُ الفحص لا يُقرأ نظافةً — وينبّه ولا يطمئن', () => {
    const r = readDuplicates(facts({ error: true }));
    expect(r.state).toBe('failed');
    expect(r.sev).toBe('warn');
    expect(r.records).toBeNull();
  });

  it('والخطأُ يسبق الانتظار حين يقعان معاً — فحصٌ سقط لا يعود', () => {
    expect(readDuplicates(facts({ loading: true, error: true })).state).toBe('failed');
  });

  it('ولا سكونَ صامت: بلا تحميلٍ ولا خطأٍ ولا بيانٍ تبقى الحالةُ «يُفحَص»', () => {
    expect(readDuplicates(facts()).state).toBe('scanning');
  });

  it('صفرُ مرشَّحين بعد فحصٍ فعليّ = نظيفٌ أخضر', () => {
    const r = readDuplicates(facts({ scan: { records: 0, pairs: 0 } }));
    expect(r.state).toBe('clean');
    expect(r.sev).toBe('good');
    expect(r.records).toBe(0);
  });

  it('مرشَّحٌ واحدٌ يكفي ليصير الشريطُ تحذيراً', () => {
    const r = readDuplicates(facts({ scan: { records: 1, pairs: 1 } }));
    expect(r.state).toBe('dirty');
    expect(r.sev).toBe('warn');
    expect(r.records).toBe(1);
  });

  it('★ وعتبةُ «خطير» شاملةٌ لحدّها — عُشرُ القاعدة خطيرٌ عند العُشر لا بعده', () => {
    expect(readDuplicates(facts({ total: 100, scan: { records: 10, pairs: 10 } })).sev).toBe('bad');
    expect(readDuplicates(facts({ total: 100, scan: { records: 9, pairs: 9 } })).sev).toBe('warn');
    // والعتبةُ رقمٌ واحدٌ مصدَّر — لا ثلاثُ نسخٍ في ثلاثة فروع
    expect(DUP_CRIT).toBe(0.1);
  });

  it('ولا قسمةَ على صفر — قاعدةٌ فارغةٌ لا تُنتج NaN في الشريط', () => {
    const r = readDuplicates(facts({ total: 0, scan: { records: 0, pairs: 0 } }));
    expect(r.pct).toBe(0);
    expect(r.state).toBe('clean');
  });

  it('وعددُ الأزواج يُنقل كما هو — فهو سياقُ الرقم لا الرقم', () => {
    expect(readDuplicates(facts({ scan: { records: 2, pairs: 3 } })).pairs).toBe(3);
  });
});

describe('ترتيبُ طرفَي الزوج — من الخادم لا من الواجهة', () => {
  const a = { id: 'aaa' };
  const b = { id: 'bbb' };

  it('يقرأ `suggestKeep` ولا يعيد حسابه', () => {
    expect(sidesOf(a, b, 'aaa')).toEqual({ keep: a, absorb: b });
    expect(sidesOf(a, b, 'bbb')).toEqual({ keep: b, absorb: a });
  });

  it('واقتراحٌ لا يطابق أيّ طرف: الثاني يبقى، ولا عنصرَ مفقود', () => {
    // لا يرمي ولا يُعيد `undefined` — والشاشةُ ترسم زوجاً كاملاً دائماً
    const s = sidesOf(a, b, 'zzz');
    expect([s.keep.id, s.absorb.id].sort()).toEqual(['aaa', 'bbb']);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   ★ حارسُ القيد ①: **لا دمجَ بلا مراجعة.**

   والقيدُ لا يُحرَس بالعين: زرٌّ واحدٌ يُضاف في صفّ القائمة يُنادي النقطةَ
   مباشرةً فيسقط القيدُ كلُّه، والشاشةُ تبدو أسرعَ وأنظف. فيُقاس الشكل:
   نقطةُ الدمج تُنادى من **موضعٍ واحد**، وذاك الموضعُ لا يُدخَل إلّا بخطّةٍ
   مجلوبةٍ من الخادم.
   ══════════════════════════════════════════════════════════════════════ */

const SRC = readFileSync(
  join(__dirname, '..', 'src', 'app', 'app', 'contacts', 'page.tsx'), 'utf8',
);

describe('بنيةُ الشاشة — القيودُ مفروضةٌ في الشكل', () => {
  it('الملفّ مقروءٌ فعلاً — وإلّا فالحارس يمرّ على الفراغ', () => {
    expect(SRC.length).toBeGreaterThan(4000);
    expect(SRC).toContain('/contacts/merge-preview');
  });

  it('★ نقطةُ الدمج تُنادى من موضعٍ واحدٍ لا من صفّ قائمة', () => {
    const calls = SRC.match(/'\/contacts\/merge'/g) ?? [];
    expect(calls, 'استدعاءٌ ثانٍ لنقطة الدمج — القيدُ «مراجعةٌ قبل الدمج» يسقط بواحدٍ').toHaveLength(1);
  });

  it('★ وذاك الموضعُ لا يُنفّذ بلا خطّةٍ مجلوبة', () => {
    const fn = SRC.slice(SRC.indexOf('async function doMerge'), SRC.indexOf("'/contacts/merge'"));
    expect(fn).toContain('if (!plan) return;');
  });

  it('★ والتراجعُ موجودٌ في الشاشة لا في وثيقة', () => {
    expect(SRC).toContain('/contacts/merge-undo');
    // ويُقال قبل الضغط لا بعده — نصُّ الورقة يذكره
    expect(SRC).toContain('يمكن التراجع عنه');
  });

  it('★ ورقمٌ بطوليٌّ واحدٌ لا اثنان', () => {
    expect((SRC.match(/<Hero\b/g) ?? []).length).toBe(1);
  });

  it('★ وشريطٌ حاكمٌ واحدٌ أعلى الشاشة', () => {
    expect((SRC.match(/<Band\b/g) ?? []).length).toBe(1);
  });

  it('★ ومخرجٌ إلى المحادثة في الإنبوكس — وإلّا صار الملفُّ طريقاً مسدوداً', () => {
    expect(SRC).toContain('/app/inbox?c=$');
  });
});
