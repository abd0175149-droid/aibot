import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★★★ **زرٌّ يُرسَل ولا معالجَ له = وعدٌ للزبون لا يملكه أحد.**
 *
 *   أداةُ `ask_confirmation` ترسل ثلاثةَ أزرار: «أكّد» و«عدّل» و«إلغاء».
 *   وكان المعالجُ الحتميّ في `reply.ts` يعرف اثنَين. فزرُّ «عدّل» يسقط إلى
 *   النموذج كرسالةٍ نصُّها «عدّل» — والأخطرُ أنّ `pendingAction` يبقى قائماً
 *   ساعةً كاملة، فضغطةٌ على «أكّد» في الرسالة القديمة (وهي تبقى قابلةً للضغط
 *   في واتساب) تُنفّذ الطلبَ **بالوسائط التي طلب الزبونُ تعديلها**.
 *
 *   والحارسُ هنا ليس على «عدّل» وحدها: يستخرج **كلَّ** بادئةِ زرٍّ تُرسلها
 *   الأدوات ويطالب `reply.ts` بمعالجٍ لكلّ واحدةٍ منها. فزرٌّ رابعٌ يُضاف غداً
 *   بلا معالجٍ يُمسَك هنا لا على زبونٍ حقيقيّ.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8').replace(/\r\n/g, '\n');

describe('كلُّ زرٍّ يُرسَل له معالج', () => {
  const tools = read('apps/worker/src/tools.ts');
  const reply = read('apps/worker/src/reply.ts');

  /** بادئاتُ المعرّفات في `id: \`prefix:${…}\`` — أي ما يعود إلينا كضغطة. */
  const prefixes = [...tools.matchAll(/id: `([a-z_]+):\$\{/g)].map((m) => m[1]!);

  it('الماسحُ يجد بادئاتٍ فعلاً (فحصٌ ذاتيّ)', () => {
    /* ماسحٌ يُرجع صفراً يجعل كلَّ ما بعده يمرّ على لا شيء. */
    expect(prefixes.length).toBeGreaterThanOrEqual(3);
    expect(new Set(prefixes)).toContain('confirm');
    expect(new Set(prefixes)).toContain('edit');
    expect(new Set(prefixes)).toContain('cancel');
  });

  for (const p of new Set(prefixes)) {
    it(`★ «${p}:» له معالجٌ حتميّ في reply.ts`, () => {
      expect(
        reply.includes(`press.startsWith('${p}:')`),
        `الأداةُ ترسل زرّاً بالبادئة «${p}:» ولا معالجَ له — يسقط إلى النموذج`,
      ).toBe(true);
    });
  }

  it('★ و«عدّل» يمسح الإجراءَ المعلَّق قبل أن يطلب التعديل', () => {
    const at = reply.indexOf("press.startsWith('edit:')");
    expect(at).toBeGreaterThan(0);
    const branch = reply.slice(at, reply.indexOf('    }', at));
    /* 🔴 بلا المسح تبقى الوسائطُ القديمةُ قابلةً للتنفيذ ساعةً كاملة. */
    expect(branch, 'الإجراءُ المعلَّق لا يُمسح — «أكّد» القديم ينفّذ ما طُلب تعديله')
      .toContain('pendingAction: null');
  });

  it('★ ولا زرَّ تأكيدٍ بلا إجراءٍ معلَّق يُسجَّل معه', () => {
    /* الأداةُ ترسل `confirm:<action>` والمعالجُ يقرأ `pendingAction`؛ فبلا
       دفعٍ إلى `deferred` تصل كلُّ ضغطةٍ بـ`pending` فارغٍ فتُرفض كأنّها
       منتهيةُ الصلاحيّة — على زرٍّ ضُغط للتوّ. والزبونُ يدور في حلقة. */
    const at = tools.indexOf("case 'ask_confirmation':");
    expect(at).toBeGreaterThan(0);
    /* الحدُّ هو `case` التالي: الفرعُ فيه عوداتٌ مبكّرةٌ عدّة فلا يصلح
       أوّلُ `return` حدّاً. */
    const block = tools.slice(at, tools.indexOf("    case '", at + 10));
    expect(block.length, 'الحدُّ لم يُوجد — الشريحةُ فارغة').toBeGreaterThan(200);
    expect(block).toContain('ctx.deferred.push(');
    const push = block.indexOf('ctx.deferred.push(');
    const emit = block.indexOf('emits.push(');
    expect(emit).toBeGreaterThan(0);
    expect(push, 'الأزرارُ تُرسل قبل تسجيل الإجراء').toBeLessThan(emit);
  });

  it('★ و`action` يُطابق أداةً مفعَّلةً — لا اسماً يخترعه النموذج', () => {
    const at = tools.indexOf("case 'ask_confirmation':");
    const block = tools.slice(at, at + 2500);
    /* 🔴 مفتاحٌ مخترع ⟶ الزبونُ يضغط «أكّد» ⟶ تنفيذٌ يفشل ⟶ «خلل تقني،
       حوّلتك لموظّف». تحويلٌ بشريٌّ عن عطلٍ لم يقع. */
    expect(block, 'لا تحقّقَ من أنّ الإجراء أداةٌ قائمة').toContain('ctx.tools.find(');
    expect(block).toContain('t.enabled');
    const check = block.indexOf('ctx.tools.find(');
    expect(check, 'التحقّقُ بعد إرسال الأزرار — الوعدُ قُطع قبل فحصه')
      .toBeLessThan(block.indexOf('emits.push('));
  });
});

describe('خطأُ المزوّد الدائم — لا صمتٌ في وجه الزبون', () => {
  const reply = read('apps/worker/src/reply.ts');

  it('★ الخطأُ غيرُ القابل للإعادة لا يُعاد', () => {
    /* طبقةُ المزوّد تميّز بعنايةٍ بين عابرٍ ودائم، وكان عاملُ الردّ يرمي كلَّ
       شيء: 400 يُعاد أربعَ مرّاتٍ بتراجعٍ أُسّيّ لكلّ رسالةٍ لكلّ زبون. */
    expect(reply).toMatch(/e instanceof AiError && !e\.retryable/);
  });

  it('★★ ويُقال للزبون، وتُوسَم المحادثة', () => {
    const at = reply.indexOf('e instanceof AiError && !e.retryable');
    expect(at).toBeGreaterThan(0);
    const branch = reply.slice(at, reply.indexOf('throw e;', at));
    /* 🔴 كان يُرمى `UnrecoverableError` وحدها: الحادثةُ تُسجَّل والزبونُ ينتظر
       صامتاً، ولا الموظّفُ يعلم أنّ زبوناً ينتظر. مخطّطُ أداةٍ معطوبٌ يُسكِت
       البوت عن كلّ زبونٍ إلى أن يلاحظ المالكُ الحادثة. */
    expect(branch, 'لا رسالةَ للزبون').toContain('botConfigs.failMessage');
    expect(branch, 'المحادثةُ لا تُوسَم فلا يعلم الموظّف').toContain('needsAttention: true');
    /* والرسالةُ تمرّ من الصندوق الصادر كأيّ خطّة — فلا تُرسل مرّتَين. */
    expect(branch).toContain('sends:');
  });

  it('★ ولا تُعاد الرسالةُ نفسُها مرّتَين على التوالي', () => {
    const at = reply.indexOf('e instanceof AiError && !e.retryable');
    const branch = reply.slice(at, reply.indexOf('throw e;', at));
    /* العطلُ دائم، فكلُّ رسالةٍ من الزبون تمرّ من هنا: أوّلُ مرّةٍ خبرٌ
       والثانيةُ بوتٌ يبدو عاطلاً. ونفسُ نمطِ «خارج ساعات العمل». */
    expect(branch).toMatch(/lastOut\?\.body\?\.trim\(\) === body/);
  });

  it('★ والحادثةُ تُرفع قبل ذلك كلِّه', () => {
    const inc = reply.indexOf("kind: 'ai_error'");
    const branch = reply.indexOf('e instanceof AiError && !e.retryable');
    expect(inc).toBeGreaterThan(0);
    expect(inc, 'الحادثةُ بعد الخروج من الفرع — أثرٌ لا يُكتب').toBeLessThan(branch);
  });
});
