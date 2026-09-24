import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCursor } from '../src/routes/inbox.js';

/**
 * ★ **المؤشّرُ المركَّب — ومحادثاتٌ كانت تختفي من «المزيد» بلا أثر.**
 *
 *   طوابعُ واتساب بدقّة **الثانية**، وعشرُ رسائل في ثانيةٍ واحدة أمرٌ عاديٌّ
 *   في ساعة الذروة. وكان المؤشّر `lastMessageAt` وحده: تنتهي الصفحةُ في
 *   منتصف ثانيةٍ، ويقول المؤشّر «أقلّ من هذه الثانية»، فتُقفَز بقيّةُ صفوفها.
 *   محادثاتٌ تسقط من القائمة ولا شيء يقول إنّها كانت هناك — وهو أسوأ من
 *   الخطأ الظاهر: القائمةُ تبدو كاملةً وتنقصها صفوف.
 */
describe('مؤشّرُ الإنبوكس يقرأ الشكلين ولا ينكسر', () => {
  it('الشكلُ المركَّب: طابعٌ ومعرّف', () => {
    const c = parseCursor('2026-09-24T10:00:00.000Z|01a0c4a7-93b9-71ec-a161-143685c3738b');
    expect(c).toEqual({ at: '2026-09-24T10:00:00.000Z', id: '01a0c4a7-93b9-71ec-a161-143685c3738b' });
  });

  it('★ والشكلُ القديم (طابعٌ وحده) يبقى مقروءاً — تبويبةٌ مفتوحةٌ ساعةَ النشر لا تنكسر', () => {
    const c = parseCursor('2026-09-24T10:00:00.000Z');
    expect(c?.at).toBe('2026-09-24T10:00:00.000Z');
    /* وأصغرُ uuid: فيصير `(ts, id) < (ts, 0)` كاذباً لكلّ صفوف الثانية نفسها،
       أي الشرطَ القديم «أقلّ من هذا الطابع» حرفيّاً — ولا صفَّ يُعاد مرّتين.
       (وأكبرُ uuid كان سيُعيد صفوفَ تلك الثانية كلَّها: تكرارٌ مرئيٌّ.) */
    expect(c?.id).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('والمشوَّهُ يُهمَل فتُعاد الصفحةُ الأولى — لا 500 ولا Invalid Date في الاستعلام', () => {
    expect(parseCursor(undefined)).toBeNull();
    expect(parseCursor('')).toBeNull();
    expect(parseCursor('ليس تاريخاً')).toBeNull();
    expect(parseCursor('|01a0c4a7-93b9-71ec-a161-143685c3738b')).toBeNull();
  });

  it('★ ومعرّفٌ مشوّهٌ مع طابعٍ صالح لا يُمرَّر إلى ::uuid — وإلّا 500 على رابطٍ نُسخ', () => {
    const c = parseCursor('2026-09-24T10:00:00.000Z|drop-table');
    expect(c?.id).toBe('00000000-0000-0000-0000-000000000000');
  });
});

const SRC = readFileSync(join(__dirname, '..', 'src', 'routes', 'inbox.ts'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*/gm, ' ');

describe('القائمةُ تفرز فرزاً كلّيّاً وتعدّ من القاعدة', () => {
  it('الفرزُ بالطابع **ثمّ** المعرّف — وإلّا فالترتيبُ غيرُ محدَّدٍ داخل الثانية', () => {
    expect(CODE).toMatch(/orderBy\(desc\(conversations\.lastMessageAt\), desc\(conversations\.id\)\)/);
  });

  it('والمؤشّرُ المُعاد يحمل الاثنين', () => {
    expect(CODE).toMatch(/\$\{last\.lastMessageAt\.toISOString\(\)\}\|\$\{last\.id\}/);
  });

  it('★ و«يحتاجك الآن» يُعدّ باستعلامٍ لا يمسّه المؤشّر', () => {
    const at = CODE.indexOf('attnWhere');
    expect(at, 'لا عدَّ منفصل — فالرقم من الصفحة المحمَّلة').toBeGreaterThan(0);
    const block = CODE.slice(at, at + 900);
    expect(block).toContain('count(*)::int');
    expect(block, 'والأقدمُ أيضاً: من سقط خارج الصفحة هو أوّلُ من يستحقّ الردّ')
      .toContain('min(');
    expect(block, 'ولا مؤشّرَ في شرطه — وإلّا عاد العدُّ إلى الصفحة').not.toContain('cur');
  });
});

describe('التعيينُ يُكتب ويُقرأ', () => {
  it('القائمةُ تعيد المتولّي واسمَه', () => {
    expect(CODE).toContain('assignedUserId: conversations.assignedUserId');
    expect(CODE).toContain('assignedName: users.name');
    expect(CODE, 'وصلٌ أيسر: محادثةٌ بلا متولٍّ لا تختفي من القائمة')
      .toMatch(/leftJoin\(users/);
  });

  it('★ والتولّي يكتب اسمَ المتولّي — وكان إسكاتاً مجهولاً', () => {
    expect(CODE).toMatch(/set\.assignedUserId = req\.auth!\.sub/);
  });

  it('وإعادةُ البوت ترفع التعيين — انتهى عملُ الموظّف عليها', () => {
    expect(CODE).toMatch(/set\.assignedUserId = null/);
  });

  it('★ وأوّلُ ردٍّ يُعيّن صاحبَه — بشرط أنّها بلا صاحب', () => {
    const at = CODE.indexOf('isNull(conversations.assignedUserId)');
    expect(at, 'بلا `is null` يسرق كلُّ ردٍّ المحادثةَ من متولّيها').toBeGreaterThan(0);
  });

  it('ومسارُ التعيين يفحص العضويّة — لا تعيينَ إلى شبح', () => {
    const at = CODE.indexOf("'/conversations/:id/assign'");
    expect(at).toBeGreaterThan(0);
    const block = CODE.slice(at, at + 1400);
    expect(block, 'uuid مشوّهٌ يعطي 500 من القيد الخارجيّ بدل رسالةٍ مفهومة').toContain('isUuid(raw)');
    expect(block, 'والوجودُ داخل withTenant هو فحصُ العضويّة — RLS يحجب الغرباء')
      .toContain('from(users)');
    expect(block).toContain('withTenant(getDb()');
  });
});

describe('الحوارُ يحمل معرّفَ محادثته', () => {
  it('ردُّ /messages يعيد conversationId', () => {
    expect(CODE).toMatch(/conversationId: req\.params\.id,\s*\n\s*items: rows\.reverse\(\)/);
  });
});
