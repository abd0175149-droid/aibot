import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * ★ البوّابة الثانية ليست زينة — وهذا الاختبار يُثبت أنّنا نستعملها.
 *
 * العطل الذي وُلد منه هذا الملفّ: `handleReply` كان يستعلم على `getDb()`
 * المجرّد ليستنتج المستأجر من `conversationId`. تحت RLS يرجع الاستعلام
 * **صفر صفوف بلا خطأ**، فيخرج العامل صامتاً في ثماني مِلّي: لا سجلّ، لا
 * حادثة، لا ردّ. بوتٌ ميّتٌ تماماً بينما كلّ شاشةٍ في المنصّة خضراء.
 * وكان معه ستّة مواضع أخرى بنفس الشكل.
 *
 * ولماذا اختبارٌ ساكن لا اختبار تكامل: الشكل هو العطل. استعلامٌ على المقبض
 * المجرّد **خطأٌ دائماً** في طبقة التطبيق، سواءٌ أصابَ صفوفاً اليوم أم لا.
 * واختبار التكامل يمسك الحالة التي جرّبها فقط؛ هذا يمسك الشكل كلّه.
 *
 * القاعدة: كلّ استعلامٍ في `apps/**` يمرّ بـ`tx` من `withTenant` أو
 * `withPlatform`. والاستثناء الوحيد المقبول جدولٌ عامّ خارج RLS، ويُعلَن
 * صراحةً بعلامةٍ في السطر نفسه أو السطر السابق:
 *
 *     // rls-exempt: sessions جدولٌ عامّ، مفتاحه user_id
 */

/* `ops/` مشمولٌ عمداً: سكربتات التشغيل تضرب نفس القاعدة بنفس الدور، فتسقط
   في نفس الفخّ بصمت — وأسوأ، لأنّها تُشغَّل يدويّاً مرّةً ولا يلاحظ أحدٌ أنّها
   لم تكتب شيئاً. (كُشفت `ops/testing/seed-channel.ts` بهذا التوسيع.) */
const ROOTS = ['apps/worker/src', 'apps/api/src', 'ops'];
const REPO = join(__dirname, '..', '..', '..');

/** أفعال الاستعلام على مقبضٍ مجرّد — `db.` أو `getDb().` مباشرةً. */
const BARE_QUERY = /(?:^|[^.\w])(?:getDb\(\)|db)\.(select|insert|update|delete|execute)\s*\(/;
const EXEMPT = /\/\/\s*rls-exempt:\s*\S/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function sources(): Array<{ file: string; src: string }> {
  const out: Array<{ file: string; src: string }> = [];
  for (const root of ROOTS) {
    for (const file of walk(join(REPO, root))) {
      out.push({ file: relative(REPO, file).replace(/\\/g, '/'), src: readFileSync(file, 'utf8') });
    }
  }
  return out;
}

describe('سياق المستأجر — البوّابة الثانية مُستعملةٌ فعلاً', () => {
  it('لا استعلامَ على مقبضٍ مجرّد خارج withTenant/withPlatform', () => {
    const offences: string[] = [];
    for (const { file, src } of sources()) {
      const lines = src.split(/\r?\n/);
      lines.forEach((text, i) => {
        if (!BARE_QUERY.test(text)) return;
        // العلامة تُقبل في السطر نفسه أو السطر السابق
        if (EXEMPT.test(text) || EXEMPT.test(lines[i - 1] ?? '')) return;
        offences.push(`${file}:${i + 1} → ${text.trim()}`);
      });
    }
    // الرسالة تحمل الموضع والسطر — فالمُصلح لا يبحث
    expect(
      offences,
      'استعلامٌ بلا سياق مستأجر يرجع صفر صفوف بلا خطأ. '
      + 'مرّره بـtx من withTenant (المستأجر معروف) أو withPlatform (عابرٌ بطبيعته)، '
      + 'أو أعلن الاستثناء بـ«// rls-exempt: السبب» إن كان الجدول خارج RLS.',
    ).toEqual([]);
  });

  it('الماسح يمسك الشكل فعلاً — وإلّا فهو اختبارٌ يمرّ دائماً', () => {
    // لو صار النمط لا يُطابق شيئاً لصار الاختبار طمأنينةً كاذبة
    expect(BARE_QUERY.test('  const r = await db.select().from(x);')).toBe(true);
    expect(BARE_QUERY.test('  await getDb().update(y).set({});')).toBe(true);
    expect(BARE_QUERY.test('  await tx.select().from(x);')).toBe(false);
    expect(BARE_QUERY.test('  await this.tx.select().from(x);')).toBe(false);
    expect(BARE_QUERY.test('  await ctx.tx.update(x);')).toBe(false);
    // `db.transaction` ليس استعلاماً — withTenant نفسها تستعمله
    expect(BARE_QUERY.test('  return db.transaction(async (tx) => {')).toBe(false);
  });
});

/**
 * ★ الحرس الثاني: **لا إرسالَ داخل معاملة.**
 *
 * العطل: عامل الردّ كان يحدّث كلفة النافذة (فيقفل صفّها) ثمّ ينادي الإرسال
 * **داخل نفس المعاملة**. والإرسال يفتح معاملةً ثانية على اتّصالٍ آخر ليختم
 * الفوترة على الصفّ نفسه، فينتظر قفلاً لا يُفرَج عنه إلّا بانتهاء الأولى —
 * وهي تنتظره. تجمّدت المهمّة في `active` بلا خطأ ولا فشلٍ ولا إعادة محاولة،
 * وهذا أسوأ من الانهيار: الانهيار يُعيد المحاولة، والتجمّد لا.
 *
 * ولماذا هذا النمط تحديداً لا «أيّ نداء شبكة»: الإرسال يكتب في **نفس
 * الصفوف** التي تقفلها معاملة الردّ. فهو ليس بطئاً بل قفلٌ متبادلٌ حتميّ.
 */
const SEND_CALL = /\b(?:safeSend|sendOutbound)\s*\(/;

/** يُعيد نصّ كلّ كتلة `withTenant(...)` / `withPlatform(...)` بمطابقة الأقواس. */
export function contextBlocks(src: string): string[] {
  const out: string[] = [];
  const open = /\bwith(?:Tenant|Platform)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(src))) {
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let i = start;
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(start, i + 1));
  }
  return out;
}

describe('لا إرسالَ داخل معاملة — القفل الذاتيّ لا يعود', () => {
  it('لا نداء safeSend/sendOutbound داخل withTenant أو withPlatform', () => {
    const offences = sources()
      .filter(({ src }) => contextBlocks(src).some((b) => SEND_CALL.test(b)))
      .map(({ file }) => file);

    expect(
      offences,
      'الإرسال يكتب في صفوف النافذة نفسها التي تقفلها المعاملة ⟵ قفلٌ متبادل '
      + 'يُجمّد المهمّة في active بلا خطأ. اجعل المعاملة تُرجع خطّة إرسال، وأرسِل بعد الإيداع.',
    ).toEqual([]);
  });

  it('ماسح الكتل يطابق الأقواس فعلاً', () => {
    const inside = 'withTenant(db, t, async (tx) => { await safeSend({ a: f(1) }); })';
    expect(contextBlocks(inside).some((b) => SEND_CALL.test(b))).toBe(true);

    // النداء الذي **بعد** الكتلة لا يُحسب داخلها — وإلّا كان الاختبار كاذباً
    const after = 'await withTenant(db, t, async (tx) => { await f(g(1)); });\nawait safeSend({});';
    const blocks = contextBlocks(after);
    expect(blocks).toHaveLength(1);
    expect(SEND_CALL.test(blocks[0]!)).toBe(false);
  });
});
