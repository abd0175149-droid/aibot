import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REFRESH_GRACE_MS } from '../src/auth.js';

/**
 * ★ **عطلان في الهويّة، وكلاهما يقع على مستخدمٍ لم يفعل شيئاً خاطئاً.**
 *
 *  ① تبويبان مفتوحان يُسقطانه من الحساب. وفتحُ شاشتين هو ما يفعله الموظّف
 *    كلَّ يوم: إنبوكسٌ وجهةُ اتّصال.
 *  ② وكلمةٌ مؤقّتةٌ **يعرفها من أنشأ الحساب** تبقى صالحةً إلى الأبد، لأنّ
 *    «الإلزام» كان ستّةَ محارفَ في شريط العنوان.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*/gm, ' ');

const AUTH = code('apps/api/src/auth.ts');

describe('تدويرُ الجلسة عبارةٌ واحدةٌ ذرّيّة', () => {
  it('★ لا قراءةٌ ثمّ كتابة — متسابقان كانا يمرّان معاً', () => {
    /* فيُصدر كلٌّ منهما توكناً ويُخزَّن آخرُهما وحده، فيحمل كوكي أحدِهما
       توكناً لا يطابق شيئاً ويسقط في التجديد التالي. */
    const at = AUTH.indexOf('export async function rotateSession');
    expect(at).toBeGreaterThan(0);
    const fn = AUTH.slice(at, AUTH.indexOf('export async function revokeSession'));

    expect(fn, 'ما زالت قراءةً منفصلةً على refreshHash ثمّ تحديثاً بالمعرّف')
      .not.toMatch(/select\(\)\.from\(sessions\)/);
    expect(fn, 'التدويرُ تحديثٌ مشروطٌ بالتجزئة نفسِها')
      .toMatch(/update\(sessions\)[\s\S]{0,600}eq\(sessions\.refreshHash, hash\)/);
    expect(fn, 'ويُعيد الصفَّ الفائز — فلا استعلامَ ثانٍ يُعيد فتحَ السباق')
      .toMatch(/\.returning\(\{ id: sessions\.id, userId: sessions\.userId \}\)/);
  });

  it('★ والخاسرُ لا يُطرَد: التجزئةُ السابقة مقبولةٌ في نافذةٍ قصيرة', () => {
    const fn = AUTH.slice(AUTH.indexOf('export async function rotateSession'));
    expect(fn).toMatch(/eq\(sessions\.prevRefreshHash, hash\)/);
    expect(fn, 'بلا حدٍّ زمنيٍّ يبقى التوكن السابق صالحاً إلى الأبد')
      .toMatch(/gt\(sessions\.rotatedAt, new Date\(now\.getTime\(\) - REFRESH_GRACE_MS\)\)/);
  });

  it('★★ والخاسرُ لا يُرسل كوكي — وإلّا أصاب كوكي الفائز بتوكنٍ ميّت', () => {
    /* والكوكي مشتركٌ بين التبويبات كلِّها، فترويسةٌ من الخاسر تصل أخيراً
       تُسقط التبويبَ الذي نجح. */
    expect(AUTH).toMatch(/refresh: string \| null/);
    expect(AUTH).toContain('if (rotated.refresh === null) return reply.send({ access });');
  });

  it('والنافذةُ قصيرةٌ عمداً — مدى تسابقٍ بين تبويبين لا عمرُ توكنٍ مسروق', () => {
    expect(REFRESH_GRACE_MS).toBeGreaterThan(0);
    expect(REFRESH_GRACE_MS).toBeLessThanOrEqual(60_000);
  });

  it('★ والتجزئةُ السابقة سرٌّ يُحجَب من السجلّ', () => {
    expect(read('packages/crypto/src/index.ts')).toContain("'*.prevRefreshHash'");
  });

  it('وللعمودين فهرسٌ — البحثُ عليهما في كلّ تجديد', () => {
    const m = read('packages/db/migrations/0009_session_refresh_grace.sql');
    expect(m).toContain('ADD COLUMN IF NOT EXISTS prev_refresh_hash');
    expect(m).toContain('ADD COLUMN IF NOT EXISTS rotated_at');
    expect(m, 'ولا فهرسَ كان على refresh_hash أصلاً').toMatch(/CREATE INDEX IF NOT EXISTS sessions_refresh_hash_idx/);
  });

  it('★ والترحيلُ بنهاياتِ أسطرٍ LF — الحارسُ القائم يرفض CR', () => {
    expect(read('packages/db/migrations/0009_session_refresh_grace.sql')).not.toContain('\r');
  });
});

describe('بوّابةُ الكلمة المؤقّتة', () => {
  it('★ `/me` يحمل العلم — وكان يعيش في ردّ الدخول وحده', () => {
    /* فاستئنافُ الجلسة من كوكي التحديث يُعيد بطاقةً بلا علَم، ولا تملك
       القشرةُ ما تحرس به. */
    const at = AUTH.indexOf("app.get('/me'");
    expect(at).toBeGreaterThan(0);
    expect(AUTH.slice(at, at + 1400)).toContain('mustChangePassword: user.mustChangePassword');
  });

  it('★★ والقشرةُ تحبس صاحبَه — لا مُعامِلٌ في شريط العنوان', () => {
    /* `?first=1` كان يضعه تحويلُ الدخول وحده: حذفُ ستّة محارف يقلب الإلزامَ
       إلى لوحِ إعداداتٍ يُغلَق بزرّ، وكلمةٌ يعرفها من أنشأ الحساب تبقى
       صالحةً إلى الأبد. */
    const shell = code('apps/web/src/components/Shell.tsx');
    expect(shell).toMatch(/me\.user\.mustChangePassword && !me\.impersonating && !onPasswordGate/);
    expect(shell).toMatch(/router\.replace\('\/app\/password'\)/);
  });

  it('★ وشاشةُ الكلمة مستثناةٌ من تحويل «بلا مستأجر»', () => {
    /* صفُّ مالك المنصّة بلا `tenant_id`، والسطرُ الذي يحرس `/app` كان يقذفه
       إلى `/console` — ولا `/console/password` هناك. فمن رُفع علَمُه لم يبقَ
       له طريقٌ إلى تغيير كلمته إطلاقاً. */
    const shell = code('apps/web/src/components/Shell.tsx');
    expect(shell).toContain("const onPasswordGate = path === '/app/password'");
    expect(shell).toMatch(/!me\.tenant && path\.startsWith\('\/app'\) && !onPasswordGate/);
  });

  it('★ والترتيبُ يهمّ: فحصُ الكلمة قبل فحص المستأجر', () => {
    const shell = code('apps/web/src/components/Shell.tsx');
    const pw = shell.indexOf('me.user.mustChangePassword');
    const tn = shell.indexOf("!me.tenant && path.startsWith('/app')");
    expect(pw).toBeGreaterThan(0);
    expect(tn).toBeGreaterThan(0);
    expect(pw, 'المستأجرُ يُفحص أوّلاً فيُقذف مالكُ المنصّة قبل أن يبلغ بوّابته')
      .toBeLessThan(tn);
  });

  it('والشاشةُ تقرأ العلم لا المُعامِل — والمُعامِلُ يبقى مقبولاً', () => {
    const pg = code('apps/web/src/app/app/password/page.tsx');
    expect(pg).toMatch(/Boolean\(me\?\.user\.mustChangePassword\) \|\| params\.get\('first'\) === '1'/);
  });

  it('★ والانتحالُ مستثنًى — زرُّه الوحيد يردّ ٤٠٣ دائماً', () => {
    expect(code('apps/web/src/components/Shell.tsx')).toContain('!me.impersonating');
  });
});
