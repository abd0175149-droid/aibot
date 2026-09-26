import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nameKey, phoneTail, likePattern, AR_FROM, AR_TO } from '../src/search.js';

/**
 * ★ **بحثُ الموظّف عن زبونٍ كان يفشل في نصف الحالات — وثلاثةُ أسبابٍ معاً.**
 *
 *   والأسوأُ أنّ الفشل **جزئيّ**: شاشةُ جهات الاتّصال تُطابق ذيلَ الرقم
 *   وتُهرّب محارف البدل، والإنبوكس لا يفعل واحدةً منهما. فيتعلّم الموظّف أنّ
 *   «البحث أحياناً يشتغل» ويكفّ عن الوثوق به — وهو أسوأ من بحثٍ لا يعمل
 *   إطلاقاً، لأنّه لا يدفعه إلى الشكوى.
 */

describe('تسويةُ الاسم قبل المقارنة', () => {
  it('★ «أحمد» و«احمد» اسمٌ واحد — والزبون يكتبه في واتساب كما يشاء', () => {
    expect(nameKey('أحمد')).toBe(nameKey('احمد'));
    expect(nameKey('أحمَد')).toBe(nameKey('احمد'));
  });

  it('والتاءُ المربوطة والألفُ المقصورة والتطويل', () => {
    expect(nameKey('فاطمة')).toBe(nameKey('فاطمه'));
    expect(nameKey('ليلى')).toBe(nameKey('ليلي'));
    expect(nameKey('مــرحــبا')).toBe('مرحبا');
    expect(nameKey('إبراهيم')).toBe(nameKey('ابراهيم'));
    expect(nameKey('آمنة')).toBe(nameKey('امنه'));
  });

  it('واللاتينيُّ يُسوّى بالحالة والفراغ — «Ahmad  Q» و«ahmad q»', () => {
    expect(nameKey('Ahmad  Q')).toBe('ahmad q');
    expect(nameKey('  مطعم   الشام  ')).toBe('مطعم الشام');
  });

  it('ولا يخلط أسماءً مختلفة', () => {
    expect(nameKey('أحمد')).not.toBe(nameKey('محمد'));
    expect(nameKey('سارة')).not.toBe(nameKey('سمر'));
  });

  it('والفراغُ يبقى فراغاً — لا يصير مطابِقاً للكلّ', () => {
    expect(nameKey(null)).toBe('');
    expect(nameKey('   ')).toBe('');
  });

  it('★ وخريطةُ التسوية متّسقةٌ في طرفَيها — وإلّا حُذفت محرفةٌ بصمت', () => {
    /* `AR_TO` أقصرُ من `AR_FROM` عمداً: ما بعد طوله (الحركاتُ والتطويل)
       يُحذف. والحارسُ يُثبّت هذا قصداً لا صدفةً. */
    expect(AR_TO.length).toBeLessThan(AR_FROM.length);
    for (const ch of AR_FROM.slice(AR_TO.length)) {
      expect(nameKey(`ا${ch}ب`), `${ch} يجب أن تُحذف لا أن تبقى`).toBe('اب');
    }
  });
});

describe('ذيلُ الرقم — 07 يجد 9627', () => {
  it('★ الرقمُ المحلّيُّ يطابق الدوليَّ — وهو أشيعُ ما يُكتب', () => {
    expect(phoneTail('0791234567')).toBe(phoneTail('962791234567'));
    expect(phoneTail('+962 79 123 4567')).toBe(phoneTail('0791234567'));
  });

  it('ولا يطابق رقماً آخر', () => {
    expect(phoneTail('0791234567')).not.toBe(phoneTail('0781234567'));
  });

  it('وما هو أقصرُ من أن يكون رقماً لا يُنتج ذيلاً — وإلّا طابق كلَّ شيء', () => {
    expect(phoneTail('079')).toBe('');
    expect(phoneTail('أحمد')).toBe('');
    expect(phoneTail(null)).toBe('');
  });
});

describe('تهريبُ محارف البدل', () => {
  it('★ «50%» بلا تهريبٍ يطابق كلَّ شيء', () => {
    expect(likePattern('50%')).toBe('%50\\%%');
    expect(likePattern('a_b')).toBe('%a\\_b%');
    expect(likePattern('c\\d')).toBe('%c\\\\d%');
  });

  it('والنصُّ العاديُّ يمرّ كما هو', () => {
    expect(likePattern(' أحمد ')).toBe('%أحمد%');
  });
});

const CODE = (rel: string) => readFileSync(join(__dirname, '..', 'src', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*/gm, ' ');

describe('الشاشتان تقرآن القطعةَ نفسَها', () => {
  it('★ لا نسخةَ ثانيةٌ من التسوية في مسارٍ آخر', () => {
    for (const rel of ['routes/inbox.ts', 'routes/contacts.ts', 'contacts-query.ts', 'contacts-merge.ts']) {
      const c = CODE(rel);
      expect(c, `${rel} يكتب تسويتَه بنفسه — نسختان تتباعدان`)
        .not.toMatch(/translate\(coalesce/);
      expect(c, `${rel} يبني نمطَ البحث بيده بدل likePattern`)
        .not.toMatch(/`%\$\{[^}]*\.trim\(\)/);
    }
  });

  it('وكلتاهما تنادي المطابقةَ المسوّاة وذيلَ الرقم', () => {
    /* #84: بحثُ جهات الاتّصال انتقل مع بُناة الاستعلام إلى `contacts-query.ts`. */
    for (const rel of ['routes/inbox.ts', 'contacts-query.ts']) {
      const c = CODE(rel);
      expect(c, `${rel} لا يسوّي الاسم`).toContain('nameMatch(');
      expect(c, `${rel} لا يطابق ذيل الرقم`).toContain('phoneTail(');
      expect(c).toContain('likePattern(');
    }
  });

  it('★ وتسويةُ SQL مرآةُ تسوية TS — نفسُ الخريطة حرفاً بحرف', () => {
    const s = readFileSync(join(__dirname, '..', 'src', 'search.ts'), 'utf8');
    expect(s).toContain(`translate(coalesce(\${col}, ''), \${AR_FROM}, \${AR_TO})`);
    /* `[[:space:]]` لا `\s`: قالبُ JS يأكل الشرطة المائلة فيصل إلى القاعدة
       `'s+'` — تعبيرٌ يستبدل **حرف s** بمسافة. عطلٌ صامتٌ على كلّ اسمٍ لاتينيّ. */
    expect(s).toContain('[[:space:]]+');
    expect(s).not.toMatch(/regexp_replace\([^)]*'\s\+'/);
  });
});
