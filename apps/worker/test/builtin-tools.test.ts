import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_TOOLS } from '@aibot/core';

/**
 * ★ **أدواتٌ تَعِد بما لا تفعل — وهو أسوأ من أداةٍ غائبة.**
 *
 * الأداةُ الغائبة يكتشفها المالك فيبني بديلاً. والأداةُ التي تَعِد وتُخلف
 * تُخبر النموذجَ «تمّ»، فيقول للزبون «سجّلت بياناتك» و«نحن مفتوحون» — ولا
 * يبقى رقمٌ يُتّصل به، ولا يكون النشاطُ مفتوحاً.
 *
 * وثلاثُ أدواتٍ من أربعٍ كانت تُسقط وسيطاً **مطلوباً** في إعلانها: النموذج
 * مُلزَمٌ بتأليفه في كلّ نداء، ثمّ يُرمى.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*/gm, ' ');

const TOOLS = code('apps/worker/src/tools.ts');
const PG = code('apps/worker/src/playground.ts');

/** جسمُ حالةٍ في مُبدِّل المنفِّذ — من `case 'x'` إلى التي تليها. */
function caseBody(src: string, key: string): string {
  const at = src.indexOf(`case '${key}'`);
  if (at < 0) return '';
  const next = src.indexOf("\n    case '", at + 5);
  return src.slice(at, next < 0 ? at + 3000 : next);
}

describe('كلُّ وسيطٍ مطلوبٍ في الإعلان له أثرٌ في التنفيذ', () => {
  /**
   * ★ الحارسُ يُولَّد من الإعلان نفسِه لا من قائمةٍ مكتوبةٍ بيد: أداةٌ تُضاف
   *   بوسيطٍ مطلوبٍ جديد تدخل الحرسَ تلقائيّاً بدل أن تُنسى.
   */
  const REQUIRED: Record<string, string[]> = Object.fromEntries(
    BUILTIN_TOOLS.map((t) => {
      const p = t.parameters as { required?: string[] };
      return [t.key, p.required ?? []];
    }),
  );

  it('الماسحُ يقرأ الإعلاناتِ فعلاً — وإلّا فالحارسُ يمرّ على الفراغ', () => {
    expect(Object.keys(REQUIRED).length).toBeGreaterThan(4);
    expect(REQUIRED.handoff_to_human, 'سببُ التحويل مطلوبٌ في الإعلان').toContain('reason');
    expect(REQUIRED.collect_lead).toContain('request');
    expect(REQUIRED.escalate_complaint).toContain('summary');
  });

  /* الأدواتُ التي تُنفَّذ في `tools.ts` — وما عداها يُرسل رسالةً أو يقرأ. */
  const WRITING = ['handoff_to_human', 'collect_lead', 'escalate_complaint'];

  for (const key of WRITING) {
    it(`★ ${key}: كلُّ وسيطٍ مطلوبٍ يُقرأ في جسم الحالة`, () => {
      const body = caseBody(TOOLS, key);
      expect(body, `لا جسمَ للحالة ${key}`).not.toBe('');
      for (const arg of REQUIRED[key] ?? []) {
        expect(
          body,
          `الوسيط «${arg}» مطلوبٌ في إعلان ${key} — يؤلّفه النموذج في كلّ نداء ثمّ يُرمى.`,
        ).toContain(`args.${arg}`);
      }
    });
  }

  it('★ والوسائطُ تُحفظ لا تُردّ صدًى: كلٌّ منها يمرّ بـ`note` أو بكتابةٍ في القاعدة', () => {
    for (const key of WRITING) {
      const body = caseBody(TOOLS, key);
      expect(body, `${key} لا يكتب شيئاً`).toMatch(/await note\(ctx,|tx\.update\(/);
    }
  });
});

describe('الملاحظةُ تُكتب حيث ينظر الموظّف', () => {
  it('★ في الحوار لا في خصائص الجهة — ولا شاشةَ ترسم الخصائص', () => {
    /* `contacts.attributes` يقرؤه **موجّهُ النموذج** وحده (`renderContactCard`).
       فسببُ تحويلٍ أو خلاصةُ شكوى تُكتب هناك تُحفظ حيث لا يقرؤها إنسان. */
    expect(TOOLS).toMatch(/async function note\(ctx: ExecCtx, body: string\)/);
    const fn = TOOLS.slice(TOOLS.indexOf('async function note('), TOOLS.indexOf('async function note(') + 900);
    expect(fn).toContain('insert(messages)');
    expect(fn, 'مصدرُ النظام يُرسَم فقاعةً منقّطةً في الحوار').toMatch(/source: 'system'/);
    expect(fn, 'ولا حالةَ تسليم: هذا إدراجٌ داخليٌّ لا إرسالٌ إلى الزبون')
      .toMatch(/status: null/);
    expect(fn, 'ولا معرّفَ خارجيّ — فلا يُخلط بردٍّ أُرسل فعلاً')
      .not.toContain('externalId');
  });

  it('وكلُّ نصٍّ من النموذج يُقصّ قبل أن يُخزَّن', () => {
    /* ما يُكتب في `attributes` يدخل موجّهَ النظام في **كلّ ردٍّ لاحق**: نصٌّ
       بلا سقفٍ كلفةٌ متكرّرةٌ وسطحُ حقنٍ يُعيد كلامَ الزبون إلى التعليمات. */
    expect(TOOLS).toMatch(/function short\(v: unknown, max = \d+\)/);
    expect(caseBody(TOOLS, 'collect_lead')).toContain('short(args.');
  });
});

describe('الهاتفُ الذي يُمليه الزبون لا يُكتب في عمود الهويّة', () => {
  it('★ `contacts.phone` هويّةُ القناة المتحقَّقة وحدها', () => {
    /* يُبنى على ذيلِ تسعِ خاناتٍ منه اقتراحُ دمج المكرّرين. فرقمٌ أملاه الزبون
       على النموذج يُنتج اقتراحَ دمجِ إنسانَين مختلفَين — وحينها تُخلَط
       محادثاتُهما ونفقاتُهما في شاشةٍ واحدة. */
    const body = caseBody(TOOLS, 'collect_lead');
    expect(body, 'الهاتفُ ما زال مُهمَلاً').toContain('args.phone');

    /* الدعوى على **أعمدة التحديث** لا على نصّ الحالة كلِّه: `phone` مفتاحٌ
       مشروعٌ داخل كائن `lead` المكتوبِ في الخصائص، وممنوعٌ في `set({…})`. */
    const set = body.slice(body.indexOf('update(contacts).set({'));
    const cols = set.slice(0, set.indexOf('}).where('));
    expect(cols, 'عمودُ الهويّة يُكتب من إملاء الزبون').not.toMatch(/(^|\s)phone:/);
    expect(cols, 'ويسكن الخصائصَ مع بقيّة بيانات الاهتمام').toContain("'{lead}'");
  });

  it('ولا وسمٌ مكرَّر من نداءَين في محادثةٍ واحدة', () => {
    expect(caseBody(TOOLS, 'collect_lead')).toContain('@> array[');
    expect(caseBody(TOOLS, 'escalate_complaint')).toContain('@> array[');
  });
});

describe('ساعاتُ الدوام تُقرأ من إعداد المالك', () => {
  it('★ لا `{ open: true }` ثابتةٌ في المنفّذ الحيّ', () => {
    const body = caseBody(TOOLS, 'check_business_hours');
    expect(body, 'ما زالت تكذب').not.toMatch(/open: true/);
    expect(body).toContain('hoursSnapshot(');
    expect(body).toContain('botConfigs.businessHours');
  });

  it('★ ولا في الساحة — وهي الموضعُ الذي يثبت فيه الخطأ', () => {
    /* الحيُّ تستره بوّابةُ الدوام في `reply.ts` (خارجَ الدوام لا تُبلَغ حلقةُ
       الأدوات)، والساحةُ بلا بوّابة: المالكُ يجرّب الثالثةَ فجراً فيُقال له
       «مفتوح» ويصدّق أنّ بوته سيقول ذلك لزبائنه. */
    const at = PG.indexOf("name === 'check_business_hours'");
    expect(at).toBeGreaterThan(0);
    const block = PG.slice(at, at + 1400);
    expect(block).not.toMatch(/done\(\{ open: true/);
    expect(block).toContain('hoursSnapshot(');
  });

  it('والحسابُ واحدٌ في `@aibot/core` — لا نسختان تتباعدان', () => {
    expect(TOOLS).toMatch(/hoursSnapshot[\s\S]{0,200}from '@aibot\/core'|from '@aibot\/core'/);
    expect(code('apps/worker/src/reply.ts'), 'النسخةُ المحلّيّة بقيت')
      .not.toMatch(/export function withinBusinessHours\(bh/);
  });

  it('★ وكشفُ الأثر في الساحة يصف ما يجري فعلاً', () => {
    /* كان «في الحيّ يُحفظ الاسم» — ووثّق الإسقاطَ بدقّة: الهاتفُ والطلبُ
       يُرميان. فكشفُ الأثر نفسُه كان صادقاً عن سلوكٍ كاذب. */
    const w = read('apps/worker/src/playground.ts');
    const at = w.indexOf('collect_lead:');
    expect(at).toBeGreaterThan(0);
    const line = w.slice(at, at + 260);
    expect(line).toContain('الهاتف');
    expect(line).toContain('يطلبه');
  });
});
