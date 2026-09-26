import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  foldContacts, undoPatch, encodeCursor, decodeCursor, nameKey, phoneTail,
  type ContactCore,
} from '../src/routes/contacts.js';

/**
 * ★ الدمج فعلٌ لا رجعةَ فيه بطبعه — فكلُّ قرارٍ فيه يُختبَر قبل أن يمسّ صفّاً.
 *
 * وما يُختبَر هنا ليس «هل يعمل» بل **ما يُفقد لو عُكس القرار**: رقمُ هاتف،
 * وسمٌ، أو **عدولٌ عن الاشتراك** — وهذا الأخيرُ خسارتُه ليست بياناً بل
 * مراسلةُ من طلب أن يُترك. ولذلك صار قرارُ الدمج دالّةً خالصةً: فرعٌ داخل
 * معاملةٍ لا يُختبَر إلّا بقاعدةٍ حيّة، وهذا يُختبَر في ملّي ثانية.
 */

const T0 = '2025-01-01T00:00:00.000Z';
const T1 = '2025-06-01T00:00:00.000Z';
const T2 = '2025-09-01T00:00:00.000Z';

function core(over: Partial<ContactCore> = {}): ContactCore {
  return {
    phone: null,
    displayName: null,
    attributes: {},
    tags: [],
    optedOutAt: null,
    blockedAt: null,
    firstSeenAt: T1,
    lastSeenAt: T1,
    ...over,
  };
}

describe('دمجُ حقلَي بطاقتين — الباقيةُ تفوز، والمُدمَجةُ تسدّ الفراغ', () => {
  it('لا يستبدل اسماً ولا رقماً موجوداً — ويُبلّغ عن التعارض في المراجعة', () => {
    const { patch, notes } = foldContacts(
      core({ phone: '0790000001', displayName: 'أبو محمد' }),
      core({ phone: '0790000002', displayName: 'محمد الشامي' }),
    );
    expect(patch.phone).toBeUndefined();
    expect(patch.displayName).toBeUndefined();
    // التعارضُ يُقال ولا يُنفَّذ: المراجعةُ تعرضه سطراً يقرؤه صاحب الحساب
    expect(notes.map((n) => n.k).sort()).toEqual(['displayName', 'phone']);
    expect(notes.find((n) => n.k === 'phone')!.why).toContain('0790000002');
  });

  it('يسدّ الفراغ وحده — بطاقةٌ بلا اسمٍ تأخذ اسم المُدمَجة', () => {
    const { patch } = foldContacts(
      core({ phone: null, displayName: null }),
      core({ phone: '0790000002', displayName: 'محمد' }),
    );
    expect(patch.phone).toBe('0790000002');
    expect(patch.displayName).toBe('محمد');
  });

  it('الوسوم اتّحادٌ بلا تكرارٍ وبترتيبٍ مستقرّ', () => {
    const { patch } = foldContacts(
      core({ tags: ['vip', 'مطعم'] }),
      core({ tags: ['مطعم', 'متأخّر'] }),
    );
    expect(patch.tags).toEqual(['vip', 'مطعم', 'متأخّر']);
  });

  it('لا رقعةَ وسومٍ حين لا جديد — فلا كتابةٌ بلا تغيير', () => {
    const { patch } = foldContacts(core({ tags: ['vip'] }), core({ tags: ['vip'] }));
    expect('tags' in patch).toBe(false);
  });

  it('السماتُ تُدمَج والباقيةُ تغلب عند التعارض', () => {
    const { patch } = foldContacts(
      core({ attributes: { city: 'عمّان', lang: 'ar' } }),
      core({ attributes: { city: 'إربد', table: '4' } }),
    );
    expect(patch.attributes).toEqual({ city: 'عمّان', lang: 'ar', table: '4' });
  });

  it('★ العدولُ عن الاشتراك يَسري بعد الدمج ولو كان على المُدمَجة وحدها', () => {
    const { patch, notes } = foldContacts(core(), core({ optedOutAt: T1 }));
    expect(patch.optedOutAt).toBe(T1);
    expect(notes.find((n) => n.k === 'optedOutAt')).toBeDefined();
  });

  it('★ والأسبقُ يفوز — لا يُؤخَّر عدولٌ سابقٌ بعدولٍ لاحق', () => {
    const { patch } = foldContacts(core({ optedOutAt: T2 }), core({ optedOutAt: T0 }));
    expect(patch.optedOutAt).toBe(T0);
  });

  it('الحجبُ كالعدول — الأسبقُ يفوز', () => {
    const { patch } = foldContacts(core({ blockedAt: null }), core({ blockedAt: T0 }));
    expect(patch.blockedAt).toBe(T0);
  });

  it('أوّلُ ظهورٍ أقدمُهما وآخرُ نشاطٍ أحدثُهما', () => {
    const { patch } = foldContacts(
      core({ firstSeenAt: T1, lastSeenAt: T1 }),
      core({ firstSeenAt: T0, lastSeenAt: T2 }),
    );
    expect(patch.firstSeenAt).toBe(T0);
    expect(patch.lastSeenAt).toBe(T2);
  });

  it('بطاقتان متطابقتان: رقعةٌ فارغةٌ — ولا تحديثَ يُكتب', () => {
    const same = core({ phone: '0790000001', displayName: 'محمد', tags: ['vip'] });
    expect(foldContacts(same, { ...same })).toEqual({ patch: {}, notes: [] });
  });
});

describe('التراجع — يستعيد ما لم يتغيّر بعده وحده', () => {
  it('يستعيد حين تكون القيمة الحاليّة هي التي كتبها الدمج', () => {
    const before = { displayName: null, tags: ['vip'] };
    const after = { displayName: 'محمد', tags: ['vip', 'مطعم'] };
    const current = core({ displayName: 'محمد', tags: ['vip', 'مطعم'] });
    const { patch, skipped } = undoPatch(before, after, current);
    expect(patch).toEqual({ displayName: null, tags: ['vip'] });
    expect(skipped).toEqual([]);
  });

  it('★ لا يمحو تحريراً جرى بعد الدمج — يتخطّاه ويُسجّله', () => {
    const before = { displayName: null };
    const after = { displayName: 'محمد' };
    const current = core({ displayName: 'محمد الشامي' }); // حُرِّر بعد الدمج
    const { patch, skipped } = undoPatch(before, after, current);
    expect('displayName' in patch).toBe(false);
    expect(skipped).toEqual(['displayName']);
  });

  it('يقارن المصفوفات بقيمتها لا بهويّتها', () => {
    const { skipped } = undoPatch({ tags: [] }, { tags: ['a'] }, core({ tags: ['a'] }));
    expect(skipped).toEqual([]);
  });
});

describe('مؤشّرُ الصفحة — حقلان لا حقلٌ واحد', () => {
  const id = '018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6b';

  it('يدور ويعود كما هو', () => {
    const c = decodeCursor(encodeCursor(new Date(T1), id));
    expect(c).toEqual({ ts: T1, id });
  });

  it('يرفض المشوّه بلا رمي — فمؤشّرٌ مزوَّرٌ لا يُسقط القائمة', () => {
    for (const bad of [undefined, '', 'x', '|', `${T1}|not-a-uuid`, `nope|${id}`]) {
      expect(decodeCursor(bad)).toBeNull();
    }
  });
});

describe('تسويةُ الاسم العربيّ — نصفُ عمل الترشيح', () => {
  it('الهمزةُ والتاءُ المربوطةُ والحركاتُ والتطويل لا تفرّق شخصاً عن نفسه', () => {
    expect(nameKey('أحمد')).toBe(nameKey('احمد'));
    expect(nameKey('اَحـمد')).toBe('احمد');
    expect(nameKey('فاطمة')).toBe(nameKey('فاطمه'));
    expect(nameKey('يحيى')).toBe(nameKey('يحيي'));
  });

  it('يطوي المسافات ويُسقط الأطراف ويُصغّر اللاتينيّ', () => {
    expect(nameKey('  أبو   محمد ')).toBe('ابو محمد');
    expect(nameKey('Abu Ali')).toBe('abu ali');
  });

  it('ولا يوحّد اسمَين مختلفَين', () => {
    expect(nameKey('محمد')).not.toBe(nameKey('محمود'));
  });

  it('الفراغ فراغ — فلا تتشابه بطاقتان بلا اسم', () => {
    expect(nameKey(null)).toBe('');
    expect(nameKey('   ')).toBe('');
  });
});

describe('ذيلُ الرقم — 07 هو 9627', () => {
  it('يطابق الصيغةَ المحلّيّة بالدوليّة', () => {
    expect(phoneTail('0790000001')).toBe(phoneTail('+962790000001'));
    expect(phoneTail('962 79 000 0001')).toBe('790000001');
  });

  it('يُسقط ما هو أقصرُ من أن يكون رقماً — فلا يتشابه الناسُ برقم غرفة', () => {
    expect(phoneTail('4')).toBe('');
    expect(phoneTail('12345')).toBe('');
    expect(phoneTail(null)).toBe('');
  });

  it('ويعمل على مُعرِّف إنستجرام الرقميّ كما على الهاتف', () => {
    expect(phoneTail('17841400000000001')).toBe('000000001');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   ★ حارسُ الترتيب: **لا حذفَ قبل نقلِ كلّ ما يتسلسل.**

   العطل الذي وُلد منه هذا الحارس كان حيّاً في نقطة الدمج: مقبضٌ واحدٌ
   يُنقل ثمّ `DELETE` على البطاقة — و`channel_identities` و`conversations`
   و`conversation_windows` تتسلسل من `contacts`، و`messages` من
   `conversations`. فكلّ ما لم يُنقل يُمحى بلا خطأ ولا سجلّ.

   ولا تمسكه المراجعة: السطران صحيحان كلٌّ وحده، والخطأُ في **ترتيبهما**.
   ولا يمسكه اختبارُ وحدةٍ: الأثرُ في القاعدة لا في القيمة المُعادة.
   ═══════════════════════════════════════════════════════════════════════ */

/* ★ #84: الدمجُ وتراجعُه انتقلا من `routes/contacts.ts` إلى `contacts-merge.ts` —
   والحارسُ يقرأ حيث تعيش الكتلةُ فعلاً، وإلّا مرّ على الفراغ. */
const SRC = readFileSync(join(__dirname, '..', 'src', 'contacts-merge.ts'), 'utf8');
const APPLY = SRC.slice(SRC.indexOf('export async function applyMerge'), SRC.indexOf('export async function undoMerge'));

describe('تنفيذُ الدمج — الشكلُ مفروضٌ لا مرجوّ', () => {
  it('الكتلة مقروءةٌ فعلاً — وإلّا فالحارس يمرّ على الفراغ', () => {
    expect(APPLY.length).toBeGreaterThan(400);
    expect(APPLY).toContain('.delete(contacts)');
  });

  it('★ كلُّ جدولٍ يتسلسل يُنقل قبل الحذف', () => {
    const del = APPLY.indexOf('.delete(contacts)');
    for (const table of ['channelIdentities', 'conversations', 'conversationWindows']) {
      const move = APPLY.indexOf(`.update(${table})`);
      expect(move, `${table} لا يُنقل في الدمج — الحذفُ سيمحوه بالتسلسل`).toBeGreaterThan(0);
      expect(move, `${table} يُنقل بعد الحذف — أي أنّه لا يُنقل`).toBeLessThan(del);
    }
  });

  it('★ والدمجُ يُسجَّل في audit_log بصورةٍ تكفي للتراجع', () => {
    expect(APPLY).toContain('.insert(auditLog)');
    expect(APPLY).toContain("action: 'contact.merge'");
    // الصورةُ تحمل ما يُعاد: الصفُّ المحذوف، وما تحرّك، وقيمُ الباقية قبلَه
    for (const key of ['absorbed:', 'moved:', 'before,']) {
      expect(APPLY, `صورةُ السجلّ بلا «${key}» لا تكفي للتراجع`).toContain(key);
    }
  });

  it('★ والتراجعُ لا يُنفَّذ مرّتين — الثانيةُ تُرفض بسجلّها', () => {
    const undo = SRC.slice(SRC.indexOf('export async function undoMerge'));
    expect(undo).toContain("'contact.merge_undo'");
    expect(undo).toContain("diff->>'ofAuditId'");
  });
});
