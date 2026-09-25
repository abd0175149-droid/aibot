import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★★★ **بوّابةُ الجودة — ولم يكن في المستودع بوّابةٌ واحدة.**
 *
 *   الإنتاج يشغّل **مصادر TypeScript** عبر `tsx`، و`tsx` يُسقط الأنواع ولا
 *   يفحصها: لا `dist` ولا `tsc` في أيّ مرحلة. فخطأُ نوعٍ لا يظهر في البناء
 *   ولا في الإقلاع — يظهر عند أوّل استدعاءٍ لتلك الدالّة، على زبونٍ حقيقيّ،
 *   بعد النشر بساعات. و`deploy.sh` كان يسحب master ويبني ما فيه أيّاً كان.
 *
 *   وبوّابتان لا واحدة، عمداً: واحدةٌ في GitHub على كلّ دفعة، وواحدةٌ في
 *   `deploy.sh` على المضيف. فبوّابةٌ واحدةٌ في CI يتخطّاها الدفعُ المباشر إلى
 *   master، وبوّابةٌ واحدةٌ في النشر لا تُخبر الكاتبَ إلّا بعد أن ينشر.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8');

describe('بوّابةُ CI على كلّ دفعة', () => {
  const path = '.github/workflows/ci.yml';

  it('★ الملفّ موجودٌ أصلاً', () => {
    expect(existsSync(join(REPO, path)), 'لا CI — و«deploy.sh يبني ما في master أيّاً كان»').toBe(true);
  });

  const yml = existsSync(join(REPO, path)) ? read(path) : '';

  it('★ تعمل على master وعلى طلبات الدمج', () => {
    expect(yml).toMatch(/branches:\s*\[master\]/);
    expect(yml, 'بلا طلبات الدمج تُكتشف الأعطالُ بعد الدمج لا قبله').toContain('pull_request:');
  });

  it('★★ وتفحص الأنواع — وهذا ما لا يفحصه شيءٌ آخر في المسار', () => {
    expect(yml).toContain('tsc -p');
    expect(yml).toContain('--noEmit');
    /* والواجهةُ من ضمنها: `next build` وحده لا يكفي وأخطاءُ الأنواع فيه
       تُخفَّض إلى تحذيراتٍ في إعداداتٍ كثيرة. */
    expect(yml).toContain('apps/web');
  });

  it('★ وتشغّل الاختبارات وتبني الواجهة', () => {
    expect(yml).toContain('vitest run');
    expect(yml).toContain('@aibot/web run build');
  });

  it('★ والقفلُ مجمَّد — وإلّا ثُبِّت على الخادم غيرُ ما اختُبر', () => {
    expect(yml).toContain('--frozen-lockfile');
  });

  it('★ والإصدارات مثبَّتةٌ لا عائمة', () => {
    /* `pnpm@latest` يُغيّر حلَّ الاعتماديّات يوماً ما فتنكسر البوّابةُ على
       تغييرٍ لم يكتبه أحدٌ هنا — وبوّابةٌ حمراءُ بلا سببٍ تُعلَّم أن تُتجاهل. */
    expect(yml).not.toContain('version: latest');
    expect(yml).toMatch(/version: 9/);
    expect(yml).toMatch(/node-version: 22/);
  });

  it('★ وبسقفِ وقتٍ صريح', () => {
    expect(yml, 'وظيفةٌ معلّقةٌ ست ساعاتٍ تحجب الطابور').toContain('timeout-minutes:');
  });
});

describe('بوّابةُ الجودة داخل deploy.sh', () => {
  const sh = read('deploy.sh');

  it('★★★ تقع **قبل** وسم الصور والتسليح — فالفشلُ لا يحتاج تراجعاً', () => {
    const gate = sh.indexOf('say "بوّابة الجودة"');
    const tag = sh.indexOf('say "وسم الصور الحاليّة للتراجع"');
    const arm = sh.indexOf('\narm_rollback\n');
    const build = sh.indexOf('docker compose build');
    expect(gate, 'لا بوّابةَ جودةٍ في النشر').toBeGreaterThan(0);
    expect(tag).toBeGreaterThan(0);
    /* 🔴 بوّابةٌ بعد الاستبدال تُصلح بالتراجع ما كان يمكن ألّا يقع. وأرخصُ
       عطلٍ ما لم يقع: هنا لم يُبنَ شيءٌ ولم تُمسّ حاويةٌ عاملة. */
    expect(gate, 'البوّابة بعد وسم الصور').toBeLessThan(tag);
    expect(gate, 'البوّابة بعد التسليح').toBeLessThan(arm);
    expect(gate, 'البوّابة بعد البناء — بُني ما لا يُنشر').toBeLessThan(build);
  });

  it('★ وبعد `git pull` — وإلّا فحصت النسخة القديمة', () => {
    const pull = sh.indexOf('git pull origin master');
    const gate = sh.indexOf('say "بوّابة الجودة"');
    expect(pull).toBeGreaterThan(0);
    expect(gate, 'تفحص ما قبل السحب — أي شيئاً آخر').toBeGreaterThan(pull);
  });

  it('★ وتفحص الأنواع والاختبارات معاً', () => {
    const at = sh.indexOf('say "بوّابة الجودة"');
    const block = sh.slice(at, sh.indexOf('say "وسم الصور', at));
    expect(block).toContain('--noEmit');
    expect(block).toContain('vitest run');
    /* الفشلُ يوقف: `exit 1` لا سطرُ تحذير. */
    expect((block.match(/exit 1/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('★★ والتبعيّاتُ تُثبَّت إن تغيّر القفل', () => {
    const at = sh.indexOf('say "بوّابة الجودة"');
    const block = sh.slice(at, sh.indexOf('say "وسم الصور', at));
    /* 🔴 `node_modules` على المضيف تبقى من نشرةٍ سابقة، فحزمةٌ أُضيفت في
       master تجعل الاختبارات تفشل على غيابها لا على عطلٍ حقيقيّ — إنذارٌ
       كاذبٌ يُعلّم الناسَ تخطّي البوّابة، وبوّابةٌ تُتخطّى ليست بوّابة. */
    expect(block).toContain('pnpm-lock.yaml');
    expect(block).toContain('--frozen-lockfile');
  });

  it('★ والتخطّي ممكنٌ لكنّه **صاخب**', () => {
    /* طارئٌ حقيقيٌّ قد يحتاج نشراً واختبارٌ مكسور. لكنّ تخطّياً صامتاً يصير
       عادةً — فيُعلَن بسطرَين ويُطلب إرجاعُه. */
    expect(sh).toContain('AIBOT_SKIP_GATE');
    const at = sh.indexOf('AIBOT_SKIP_GATE');
    expect(sh.slice(at, at + 400)).toContain('⚠⚠');
  });
});
