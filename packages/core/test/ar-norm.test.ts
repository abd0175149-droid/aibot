import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeArabic } from '../src/knowledge.js';

/**
 * ★ **التطبيعُ مرآتان يجب أن تتطابقا.**
 *
 *   الاسترجاعُ الهجين يطبّع سؤالَ الزبون في JS (`normalizeArabic`) ويطبّع نصَّ
 *   المستند في القاعدة (`ar_norm` في `0007_kb_chunks_tsv.sql`، وعليها يُبنى
 *   العمودُ المولَّد `kb_chunks.tsv` وفهرسُ الثلاثيّات). فأيُّ فرقٍ بينهما
 *   يُفقد المطابقةَ على صنفٍ كاملٍ من الكلمات — لا على حالةٍ شاذّة.
 *
 *   ولا يظهر الفرقُ خطأً أبداً: الاستعلام ينجح ويعود بصفر صفوف، فيُقرأ الأمر
 *   «المعرفةُ لا تحتوي الجواب». وتصحيحُ إحداهما وحدها هو الشكلُ الأشيع
 *   للانحراف: يُضاف شكلُ همزةٍ جديدٌ في JS، ويبقى العمودُ المولَّد على ما كان
 *   — ولا يُعاد توليدُه إلّا بترحيلٍ يكتبه أحدٌ يعلم بالأمر.
 *
 *   ولذلك يُقرأ نصُّ SQL من الملفّ وتُنفَّذ **دلالتُه** هنا: بلا قاعدةٍ، ومع
 *   ذلك يُمسَك الانحرافُ ساعةَ يُكتب.
 */

const SQL = readFileSync(
  join(__dirname, '..', '..', 'db', 'migrations', '0007_kb_chunks_tsv.sql'),
  'utf8',
);

/**
 * الوسائطُ الثلاثة التي تُعرّف `ar_norm` — تُستخرج من نصّ الترحيل نفسه.
 *
 * وتُستخرج بالدلالة لا بالموضع: تُقرأ كلُّ نصوص الدالّة المُقتبَسة بالترتيب،
 * ثمّ يُعرَّف كلُّ وسيطٍ بشكله — صنفُ محارفٍ يُحذف (`[…]`)، وصنفُ ترقيمٍ
 * يصير فراغاً (`[…]+`)، وزوجُ خريطةٍ عربيٌّ متساوي الطول. ومحلّلٌ يعدّ
 * الاقتباسات يكسره أوّلُ تعديلٍ على شكل الدالّة.
 */
function sqlParams(): { strip: string; from: string; to: string; punct: string } {
  const body = /FUNCTION ar_norm[\s\S]*?AS \$\$([\s\S]*?)\$\$/.exec(SQL)?.[1];
  expect(body, 'جسمُ ar_norm غيرُ مقروءٍ من الترحيل').toBeTruthy();
  const lits = [...body!.matchAll(/'([^']*)'/g)].map((m) => m[1]!);

  /* وتُسلَخ الأقواسُ المعقوفة: الوسيطُ صنفٌ لا نمطٌ كامل، ولفُّه مرّةً
     أخرى في `[…]` يُنتج صنفاً متداخلاً يُطابق القوسَ نفسه. */
  const inner = (re: RegExp) => {
    for (const l of lits) { const m = re.exec(l); if (m) return m[1]!; }
    return undefined;
  };
  const punct = inner(/^\[(.+)\]\+$/);
  const strip = inner(/^\[(.+)\]$/);
  const arabic = (l: string) => /^[؀-ۿ]+$/.test(l);
  let from = '';
  let to = '';
  for (let i = 0; i < lits.length - 1; i++) {
    const a = lits[i]!;
    const b = lits[i + 1]!;
    if (arabic(a) && arabic(b) && a.length === b.length) { from = a; to = b; break; }
  }

  expect(strip, 'صنفُ المحارف المحذوفة غيرُ مقروءٍ من الترحيل').toBeTruthy();
  expect(punct, 'صنفُ الترقيم غيرُ مقروءٍ من الترحيل').toBeTruthy();
  expect(from, 'خريطةُ translate غيرُ مقروءةٍ من الترحيل').not.toBe('');
  return { strip: strip!, from, to, punct: punct! };
}

/** دلالةُ `ar_norm` منفَّذةً في JS من وسائطها المستخرَجة. */
function arNorm(t: string): string {
  const { strip, from, to, punct } = sqlParams();
  let out = t.replace(new RegExp(`[${strip}]`, 'g'), '');
  out = [...out].map((ch) => {
    const i = from.indexOf(ch);
    return i === -1 ? ch : to[i]!;
  }).join('');
  return out.replace(new RegExp(`[${punct}]+`, 'g'), ' ');
}

/* نصوصٌ من نوع ما يُكتب فعلاً: سؤالُ زبونٍ ونصُّ مالكٍ. */
const CORPUS = [
  'كم سعر الغرفة؟',
  'بِكَمْ السِّعْرُ؟',
  'سعر الغرفة المفردة ٤٥ ديناراً والمزدوجة ٦٥ ديناراً',
  'أهلاً وسهلاً، عندكم توصيل لإربد؟',
  'مــرحــبا، مواعيد العمل من ٩ صباحاً حتى ١٠ مساءً.',
  'هل الحلاقة للأطفال متوفّرة؟ وكم أجرتها،',
  'الخصم على الفاتورة: ١٠٪ للطلبات فوق ٢٠ ديناراً!',
  'مصطفى ابو علياء — استشارة أسنان',
  'ىىى أأأ ةةة',
  '؟؟؟',
  '',
];

describe('ar_norm في القاعدة مرآةُ normalizeArabic في JS', () => {
  it('★ تتطابقان على كلّ نصٍّ من الحقل — بعد توحيد الفراغ', () => {
    /* الفرقُ الوحيدُ المقصود: JS يضمّ الفراغَ ويقصّ الطرفَين، وSQL لا تفعل.
       وهو غيرُ مؤثّر: `to_tsvector` تُقطّع على الفراغ، و`pg_trgm` كذلك.
       فالمقارنةُ بعد توحيده — ومع ذلك تُمسَك كلُّ محرفةٍ تُطبَّع في أحدهما. */
    const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
    for (const t of CORPUS) {
      expect(flat(arNorm(t)), `انحرافٌ على: «${t}»`).toBe(flat(normalizeArabic(t)));
    }
  });

  it('وكلُّ محرفةٍ يُطبّعها JS مذكورةٌ في الترحيل', () => {
    const { strip, from, punct } = sqlParams();
    /* المحارفُ التي يحذفها JS أو يُبدلها — مستخرَجةً بالتجربة لا بالقراءة. */
    for (const ch of ['ً', 'ُ', 'ْ', 'ٰ', 'ـ']) {
      expect(new RegExp(`[${strip}]`).test(ch), `المحرفة ${ch.charCodeAt(0)} تُحذف في JS ولا في SQL`).toBe(true);
    }
    for (const ch of ['أ', 'إ', 'آ', 'ٱ', 'ى', 'ة']) {
      expect(from.includes(ch), `${ch} تُبدَل في JS ولا في SQL`).toBe(true);
    }
    for (const ch of ['؟', '?', '!', '.', ',', '،', ';', ':']) {
      expect(punct.includes(ch), `${ch} يصير فراغاً في JS ولا في SQL`).toBe(true);
    }
  });

  it('★ والماسحُ يمسك الانحرافَ فعلاً — وإلّا فهو اختبارٌ يمرّ دائماً', () => {
    /* لو غابت التاءُ المربوطة عن خريطة SQL لانحرف «الغرفة» — تُحاكى الحالة. */
    const { strip, from, to, punct } = sqlParams();
    const broken = (t: string) => {
      const i = from.indexOf('ة');
      const f2 = from.slice(0, i) + from.slice(i + 1);
      const t2 = to.slice(0, i) + to.slice(i + 1);
      let out = t.replace(new RegExp(`[${strip}]`, 'g'), '');
      out = [...out].map((ch) => {
        const j = f2.indexOf(ch);
        return j === -1 ? ch : t2[j]!;
      }).join('');
      return out.replace(new RegExp(`[${punct}]+`, 'g'), ' ').replace(/\s+/g, ' ').trim();
    };
    expect(broken('كم سعر الغرفة؟')).not.toBe(normalizeArabic('كم سعر الغرفة؟'));
  });
});
