import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateRange, MAX_RANGE_DAYS } from '../../web/src/lib/range';

/**
 * ★ **ذيلُ الموجة الثامنة — أربعةُ انحرافاتٍ صغيرةٍ لا يُظهرها التطوير.**
 *
 *   ① `usage_daily` (#43): جدولٌ لم يكتبه أحدٌ قطّ ووثيقةُ الحالة تعلنه ✅ — أُزيل.
 *   ② التسعير (#38): تعليقٌ وترحيلٌ يَعِدان بأثرٍ رجعيٍّ لا يقع — صُحّح الوعدُ،
 *      وصار الأثرُ الرجعيُّ أداةً صريحةً مسجَّلة (`ops/reprice.ts`).
 *   ③ التنسيق (#11): «30d» في شريحةٍ عربيّة، وخمسُ منازلَ للدولار، ومدًى مخصَّصٌ
 *      بلا تحقّق.
 *   ④ العقدُ المشترك (#82): `Me` و`Overview` كانا نسختين يدويّتين في الواجهة.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8').replace(/\r\n/g, '\n');
const bare = (p: string): string => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('★ المدى المخصَّص — قواعدُ خالصةٌ تُنفَّذ', () => {
  const today = new Date(2026, 8, 26); // ٢٦ أيلول ٢٠٢٦ محلّيّاً

  it('يرفض الناقصَ والمقلوبَ والمستقبلَ والطويل — برسالةٍ تقول ما يُفعل', () => {
    expect(validateRange('', '2026-09-20', today)).toMatchObject({ ok: false });
    expect(validateRange('2026-09-20', '2026-09-10', today)).toMatchObject({ ok: false, message: expect.stringContaining('اقلبهما') });
    expect(validateRange('2026-09-20', '2026-10-01', today)).toMatchObject({ ok: false, message: expect.stringContaining('المستقبل') });
    expect(validateRange('2024-01-01', '2026-09-01', today)).toMatchObject({ ok: false, message: expect.stringContaining(String(MAX_RANGE_DAYS)) });
    expect(validateRange('2026-09-x1', '2026-09-20', today)).toMatchObject({ ok: false });
  });

  it('ويقبل مدًى صالحاً ويعدّ أيّامَه شاملاً الطرفين', () => {
    expect(validateRange('2026-09-01', '2026-09-26', today)).toEqual({ ok: true, days: 26 });
    expect(validateRange('2026-09-26', '2026-09-26', today)).toEqual({ ok: true, days: 1 });
  });

  it('★ وشاشةُ التقارير تناديه، والشريحةُ بالعربيّة، والمالُ بـ`fmt.money`', () => {
    const page = bare('apps/web/src/app/app/reports/page.tsx');
    expect(page).toContain('const v = validateRange(draftFrom, draftTo);');
    expect(page).toContain('`${preset} يوماً`');
    expect(page).not.toContain('`${preset}d`');
    expect(page).toContain('${fmt.money(cost.total)}');
    expect(page).not.toContain('cost.total.toFixed(4)');
  });

  it('و`fmt.money` ثلاثُ منازلَ تحت الدولار لا خمس — والصغيرُ لا يُقرأ صفراً', () => {
    const src = bare('apps/web/src/lib/useApi.tsx');
    expect(src).toContain('const digits = v >= 1 ? 2 : v >= 0.001 || v === 0 ? 3 : 4;');
    expect(src).not.toContain('Number(n) < 1 ? 5 : 2');
  });
});

describe('★ usage_daily — أُزيل من كلّ موضع', () => {
  it('لا `DROP` في ترحيلٍ يُعاد كلَّ نشرة: أُزيل من 0001/0002 والمخطَّط واللقطة والاختبار', () => {
    /* حارسُ `migrations.test` يمنع DROP TABLE عن حقّ — فالإزالةُ من المصدر الذي
       كان يُنشئه، والحذفُ الفعليُّ مرّةً واحدةً على الخادم بيدٍ لا بترحيل. */
    expect(existsSync(join(REPO, 'packages/db/migrations/0015_drop_usage_daily.sql'))).toBe(false);
    expect(read('packages/db/migrations/0001_tables.sql')).not.toContain('usage_daily');
    expect(read('packages/db/migrations/0002_rls.sql')).not.toContain('usage_daily');
    expect(bare('packages/db/src/schema.ts')).not.toContain('usage_daily');
    expect(bare('packages/db/src/schema/ops.ts')).not.toContain('usageDaily');
    expect(read('packages/db/migrations/meta/0000_snapshot.json')).not.toContain('"public.usage_daily"');
    expect(bare('packages/db/test/schema.test.ts')).not.toContain('usage_daily');
  });

  it('والوثيقتان تقولان إنّه أُزيل لا إنّه ✅', () => {
    const status = read('docs/plan/17-status-audit.md');
    expect(status).toMatch(/`usage_daily` \| ❌ أُزيل/);
    expect(status).not.toMatch(/`usage_daily` \+ شاشة الاستهلاك \+ CSV \| ✅/);
    expect(read('docs/plan/06-data-model.md')).toContain('**أُزيل** (٢٦ أيلول ٢٠٢٦');
  });
});

describe('★ التسعير — وعدٌ مصحَّحٌ وأداةٌ صريحة', () => {
  it('التعليقان لا يَعِدان بأثرٍ رجعيٍّ تلقائيّ', () => {
    const pricing = read('packages/ai/src/pricing.ts');
    expect(pricing).toContain('لحظة النداء');
    expect(pricing).not.toContain('فتصحيح سعرٍ يصحّح التاريخ كلّه');
    const m5 = read('packages/db/migrations/0005_price_gemini_3_5_flash_lite.sql');
    expect(m5).toContain('ops/reprice.ts');
    expect(m5).not.toContain('فتُصحَّح كلفتها بأثرٍ رجعيّ');
    expect(read('packages/db/src/schema/bot.ts')).not.toContain('فتصحيح سعرٍ يصحّح التاريخ كلّه');
  });

  it('★ و`ops/reprice.ts` تجربةٌ جافّةٌ افتراضاً، تكتب بـAPPLY=1، وتجمع النوافذَ وتسجّل', () => {
    const src = bare('ops/reprice.ts');
    expect(src).toContain("const APPLY = process.env.APPLY === '1';");
    const dry = src.indexOf('if (!APPLY)');
    const write = src.indexOf('UPDATE ai_runs r SET cost_usd');
    expect(dry).toBeGreaterThan(0);
    expect(dry).toBeLessThan(write);
    expect(src).toContain('UPDATE conversation_windows w SET ai_cost_usd');
    expect(src).toContain("'platform.reprice'");
    /* ولا `await` في المستوى الأعلى — tsx على الخادم يُحوّل إلى CJS. */
    expect(src).toMatch(/\nmain\(\)\s*\n\s*\.then\(\(\) => closeDb\(\)\)/);
    expect(src).not.toMatch(/^await /m);
  });
});

describe('★ العقدُ المشترك — Me وOverview من موضعٍ واحد', () => {
  it('الخادمُ يُعلن، والواجهةُ تستورد', () => {
    expect(bare('packages/shared/src/dto.ts')).toContain('export interface MeDTO');
    expect(bare('packages/shared/src/dto.ts')).toContain('export interface OverviewDTO');
    expect(bare('apps/api/src/auth.ts')).toContain("async (req): Promise<MeDTO> =>");
    expect(bare('apps/api/src/routes/reports.ts')).toContain("async (req): Promise<OverviewDTO> =>");
    expect(bare('apps/web/src/lib/session.tsx')).toContain('export type Me = MeDTO;');
    expect(bare('apps/web/src/lib/session.tsx')).not.toContain('export interface Me {');
    expect(bare('apps/web/src/app/app/layout.tsx')).toContain("type Overview = Pick<OverviewDTO, 'windowsUsed' | 'windowsLimit' | 'needsAttention'>;");
    expect(bare('apps/web/src/app/app/page.tsx')).toContain('type Overview = OverviewDTO;');
    expect(bare('apps/web/src/app/app/page.tsx')).not.toContain('interface Overview {');
  });
});
