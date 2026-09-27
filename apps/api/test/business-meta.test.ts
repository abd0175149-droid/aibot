import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BusinessProfileSchema, businessUrls, isProfileComplete, profileIssues } from '@aibot/shared';
import { detectDeletionRequest, detectOptOut } from '@aibot/core';
import { sendUrl } from '../../../packages/channels/src/instagram';

/**
 * ★★ ملفُّ النشاط وصفحاتُ ميتا وربطُ إنستجرام — ما يُختبر هنا قرارٌ لا شكل.
 */
const ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const bare = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*/gm, ' ');

const SAMPLE = {
  tradeAr: 'نسك الذهبية', tradeEn: 'Nusk Golden',
  legalAr: 'شركة نسك الذهبية للسياحة والسفر ذ.م.م', legalEn: 'Nusk Golden Travel LLC',
  cr: '', country: 'الأردن', city: 'عمّان', address: 'شارع مثال، بناية 10',
  addressEn: '10 Example St, Amman, Jordan', phone: '+962 79 000 0000', email: 'Info@Nusk-Example.jo',
  site: '', category: '', description: '', logo: '',
};

describe('ملفُّ النشاط', () => {
  it('★ ملفٌّ كاملٌ يُقبل، والبريدُ يُصغَّر', () => {
    const r = BusinessProfileSchema.parse(SAMPLE);
    expect(r.email).toBe('info@nusk-example.jo');
    expect(isProfileComplete(SAMPLE)).toBe(true);
  });

  it('★★ وما تطلبه ميتا مطلوبٌ هنا: الاسم الإنجليزيّ والعنوانان والبريد والهاتف', () => {
    const miss = profileIssues({ ...SAMPLE, tradeEn: 'نسك', addressEn: '', email: 'x', phone: '12' });
    expect(Object.keys(miss).sort()).toEqual(['addressEn', 'email', 'phone', 'tradeEn']);
  });

  it('★ والشعارُ صورةٌ مرمَّزةٌ صغيرة — لا رابطٌ خارجيّ ولا ملفٌّ ضخم', () => {
    expect(profileIssues({ ...SAMPLE, logo: 'https://evil.example/x.png' }).logo).toBeTruthy();
    expect(profileIssues({ ...SAMPLE, logo: `data:image/png;base64,${'A'.repeat(300_000)}` }).logo).toBeTruthy();
    expect(profileIssues({ ...SAMPLE, logo: 'data:image/png;base64,iVBORw0KGgo=' }).logo).toBeUndefined();
  });

  it('★★ والموقعُ https وحده — رابطٌ يُنشر على صفحةٍ عامّة', () => {
    expect(profileIssues({ ...SAMPLE, site: 'javascript:alert(1)' }).site).toBeTruthy();
    expect(profileIssues({ ...SAMPLE, site: 'http://nusk.jo' }).site).toBeTruthy();
    expect(profileIssues({ ...SAMPLE, site: 'https://nusk.jo' }).site).toBeUndefined();
  });

  it('★ الروابطُ مساراتٌ على الدومين نفسِه — مصدرٌ واحد', () => {
    expect(businessUrls('https://aibot.masaros.net/', 'nuskjo')).toEqual({
      profile: 'https://aibot.masaros.net/b/nuskjo',
      privacy: 'https://aibot.masaros.net/b/nuskjo/privacy',
      terms: 'https://aibot.masaros.net/b/nuskjo/terms',
      deletion: 'https://aibot.masaros.net/b/nuskjo/data-deletion',
    });
  });
});

describe('طلبُ حذف البيانات من الزبون', () => {
  it('★ العبارةُ المنشورة في الصفحة تُكشف، بالعربيّة والإنجليزيّة', () => {
    for (const t of ['احذف بياناتي', 'احذفوا بياناتي لو سمحت', 'امسحوا رقمي', 'Delete my data', 'احذفوني']) {
      expect(detectDeletionRequest(t), t).toBe(true);
    }
  });

  it('★★ وطلبُ خدمةٍ ليس طلبَ حذف', () => {
    for (const t of ['احذف الطلب', 'احذف الحجز الثاني', 'كيف احذف الموعد؟', 'delete the order', 'بياناتي صحيحة؟']) {
      expect(detectDeletionRequest(t), t).toBe(false);
    }
  });

  it('★ والعاملُ يسجّل الطلبَ ويكتم الزبونَ كالعادل', () => {
    const inbound = bare('apps/worker/src/inbound.ts');
    expect(inbound).toContain('const wantsDeletion = detectDeletionRequest(m.text);');
    expect(inbound).toMatch(/insert\(deletionRequests\)/);
    expect(inbound).toContain('(wantsDeletion || detectOptOut(m.text))');
    /* والعدولُ القديمُ باقٍ كما هو */
    expect(detectOptOut('احذفوا رقمي')).toBe(true);
  });
});

describe('ترحيلُ الجدول الجديد قبل سياسة العزل', () => {
  it('★★★ `deletion_requests` يُنشأ في 0001 — و0002 يسمّيه، والنشرُ يطبّق بالترتيب', () => {
    expect(read('packages/db/migrations/0001_tables.sql')).toContain('CREATE TABLE IF NOT EXISTS "deletion_requests"');
    expect(read('packages/db/migrations/0002_rls.sql')).toContain('CREATE POLICY tenant_isolation ON deletion_requests');
    expect(read('packages/db/migrations/0015_business_profile.sql')).not.toContain('CREATE TABLE');
  });
});

describe('ربطُ إنستجرام عبر فيسبوك', () => {
  let ig: typeof import('../src/routes/instagram');
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-state';
    ig = await import('../src/routes/instagram');
  });

  it('★★ الحالةُ موقَّعة: تُقرأ كما كُتبت، وتُرفض إن عُبث بها أو انقضت', () => {
    const s = { t: 'tenant-1', u: 'user-1', n: 'a'.repeat(24), e: Date.now() + 60_000 };
    const raw = ig.signState(s);
    expect(ig.verifyState(raw)).toEqual(s);
    const [body, sig] = raw.split('.');
    const forged = Buffer.from(JSON.stringify({ ...s, t: 'tenant-2' })).toString('base64url');
    expect(ig.verifyState(`${forged}.${sig}`)).toBeNull();
    expect(ig.verifyState(`${body}.x${sig}`)).toBeNull();
    expect(ig.verifyState(ig.signState({ ...s, e: Date.now() - 1 }))).toBeNull();
  });

  it('★★ signed_request من ميتا يُتحقَّق من توقيعه بسرّ التطبيق', () => {
    const secret = 'app-secret';
    const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '123', issued_at: 1 })).toString('base64url');
    const sig = createHmac('sha256', secret).update(payload).digest('base64url');
    expect(ig.parseSignedRequest(`${sig}.${payload}`, secret)?.user_id).toBe('123');
    expect(ig.parseSignedRequest(`${sig}.${payload}`, 'other')).toBeNull();
    expect(ig.parseSignedRequest(`${sig}.${payload}`, '')).toBeNull();
  });

  it('★ بلا مفاتيح التطبيق يُعلَن «غيرُ متاح» — لا زرٌّ يفشل', () => {
    delete process.env.META_APP_ID;
    expect(ig.instagramAvailability().available).toBe(false);
  });

  it('★★★ الإرسالُ عبر الصفحة بتوكنها — لا عبر حساب إنستجرام', () => {
    expect(sendUrl({ config: { pageId: '1122334455' } })).toMatch(/\/1122334455\/messages$/);
    expect(sendUrl({ config: {} })).toMatch(/\/me\/messages$/);
    expect(sendUrl({ config: { pageId: '../x' } })).toMatch(/\/me\/messages$/);
    expect(bare('packages/channels/src/instagram.ts')).not.toContain('${creds.externalAccountId}/messages');
  });

  it('★★ ويبهوكُ المنصّة: تحدٍّ بتوكنٍ من البيئة، وتوقيعٌ بسرّ تطبيقنا', () => {
    const w = bare('apps/api/src/webhooks.ts');
    expect(w).toContain("'/webhooks/:channel',");
    expect(w).toContain('process.env.META_WEBHOOK_VERIFY_TOKEN');
    expect(w).toMatch(/kind === 'instagram'\s*\?\s*\(process\.env\.META_APP_SECRET/);
  });
});

describe('الصفحاتُ العامّة والمعالج', () => {
  it('★ أربعُ صفحاتٍ لكلّ عميل، من ملفّه', () => {
    for (const p of ['page.tsx', 'privacy/page.tsx', 'terms/page.tsx', 'data-deletion/page.tsx']) {
      expect(read(`apps/web/src/app/b/[slug]/${p}`)).toContain('loadBusiness(slug)');
    }
  });

  it('★★ ونقطتُها العامّة لا تنشر ملفّاً ناقصاً ولا عميلاً مؤرشَفاً', () => {
    const r = bare('apps/api/src/routes/business.ts');
    expect(r).toContain("t.status === 'archived' || !isProfileComplete(t.profile)");
  });

  it('★★ والمعالجُ: الملفُّ والحزمةُ قبل القنوات', () => {
    const o = read('apps/web/src/components/Onboarding.tsx');
    const order = ["label: 'النشاط'", "label: 'ملفّ النشاط'", "label: 'حزمة ميتا'", "label: 'القنوات'", "label: 'البوت'"]
      .map((x) => o.indexOf(x));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
