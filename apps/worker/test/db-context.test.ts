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

const ROOTS = ['apps/worker/src', 'apps/api/src'];
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

interface Offence { file: string; line: number; text: string }

function scan(): Offence[] {
  const offences: Offence[] = [];
  for (const root of ROOTS) {
    for (const file of walk(join(REPO, root))) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((text, i) => {
        if (!BARE_QUERY.test(text)) return;
        // العلامة تُقبل في السطر نفسه أو السطر السابق
        if (EXEMPT.test(text) || EXEMPT.test(lines[i - 1] ?? '')) return;
        offences.push({
          file: relative(REPO, file).replace(/\\/g, '/'),
          line: i + 1,
          text: text.trim(),
        });
      });
    }
  }
  return offences;
}

describe('سياق المستأجر — البوّابة الثانية مُستعملةٌ فعلاً', () => {
  it('لا استعلامَ على مقبضٍ مجرّد خارج withTenant/withPlatform', () => {
    const offences = scan();
    // الرسالة تحمل الموضع والسطر — فالمُصلح لا يبحث
    expect(
      offences.map((o) => `${o.file}:${o.line} → ${o.text}`),
      'استعلامٌ بلا سياق مستأجر يرجع صفر صفوف بلا خطأ. '
      + 'مرّره بـtx من withTenant (المستأجر معروف) أو withPlatform (عابرٌ بطبيعته)، '
      + 'أو أعلن الاستثناء بـ«// rls-exempt: السبب» إن كان الجدول خارج RLS.',
    ).toEqual([]);
  });

  it('الماسح يمسك الشكل فعلاً — وإلّا فهو اختبارٌ يمرّ دائماً', () => {
    // لو صار النمط لا يُطابق شيئاً لصار الاختبار أعلى قيمةً مزيّفة
    expect(BARE_QUERY.test('  const r = await db.select().from(x);')).toBe(true);
    expect(BARE_QUERY.test('  await getDb().update(y).set({});')).toBe(true);
    expect(BARE_QUERY.test('  await tx.select().from(x);')).toBe(false);
    expect(BARE_QUERY.test('  await this.tx.select().from(x);')).toBe(false);
    expect(BARE_QUERY.test('  await ctx.tx.update(x);')).toBe(false);
    // `db.transaction` ليس استعلاماً — withTenant نفسها تستعمله
    expect(BARE_QUERY.test('  return db.transaction(async (tx) => {')).toBe(false);
  });
});
