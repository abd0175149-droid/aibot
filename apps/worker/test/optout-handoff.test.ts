import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectOptOut, detectOptIn } from '../../../packages/core/src/optout';

/**
 * ★★★ **وعدان مكتوبان لم يُبنَ لهما شيء: العدولُ، وإشعارُ التحويل.**
 *
 *   ① `opted_out_at` و`blocked_at` وجدولُ `optouts` في المخطَّط منذ اليوم
 *      الأوّل، وصفحةُ الخصوصيّة تَعِد باحترامهما — ولا سطرَ في خطّ الأنابيب
 *      كان يقرؤها. زبونٌ كتب «توقف» حصل على ردٍّ ودّيٍّ من النموذج، ثمّ آخر.
 *   ② ستّةُ مواضعَ تكتب `needsAttention = true` وتقول للزبون «حوّلتك لموظّف»
 *      — ولا واحدٌ منها يُخبر موظّفاً. البثُّ اللحظيّ يصل من يحدّق في الإنبوكس
 *      تلك اللحظةَ وحده.
 *
 * والكاشفُ يُختبر **بالتنفيذ** لا بمسح نصّه: قائمةُ عباراتٍ لا تُثبت شيئاً عن
 * التطبيع ولا عن الحدود.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8').replace(/\r\n/g, '\n');
const bare = (p: string): string => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('كاشفُ العدول — تنفيذٌ لا نصّ', () => {
  it('★ يكشف العباراتِ الصريحة بأشكالها الإملائيّة', () => {
    for (const t of [
      'توقف', 'توقّف', 'تَوَقَّف', 'أوقفوا', 'لا تراسلوني', 'لا ترسلوا لي شي',
      'احذفوا رقمي', 'كفاية رسائل', 'STOP', 'Unsubscribe', 'stop all',
    ]) {
      expect(detectOptOut(t), `«${t}» يجب أن يُكشف`).toBe(true);
    }
  });

  it('★★ ولا يكشف سؤالاً فيه الكلمة — العدولُ الكاذب يُسكت البوتَ عن زبونٍ يسأل', () => {
    for (const t of [
      'متى تتوقف الحجوزات؟', 'هل توقف العرض؟', 'بدي اوقف الاشتراك الشهري في النادي كيف',
      'stop by tomorrow?', 'ممكن كفاية معلومات عن الرحلة', 'شو موعد التوقف عن العمل',
    ]) {
      expect(detectOptOut(t), `«${t}» سؤالٌ لا عدول`).toBe(false);
    }
  });

  it('★ ورسالةٌ طويلةٌ ليست عدولاً ولو بدأت بالعبارة', () => {
    /* «توقف عن ارسال الفاتورة القديمة وابعت الجديدة لو سمحت» طلبٌ لا عدول. */
    expect(detectOptOut('توقف عن ارسال الفاتورة القديمة وابعت الجديدة لو سمحت عشان المحاسب')).toBe(false);
  });

  it('★ والعودةُ أضيقُ من العدول — تُعلَن ولا تُخمَّن', () => {
    expect(detectOptIn('اشترك')).toBe(true);
    expect(detectOptIn('START')).toBe(true);
    expect(detectOptIn('بدي اشترك بالباقة الذهبية لو سمحت')).toBe(false);
    expect(detectOptIn(null)).toBe(false);
  });

  it('★ ولا `\\b` في الأنماط — حدُّ الكلمة لا يعمل مع العربيّة', () => {
    const src = bare('packages/core/src/optout.ts');
    expect(src).not.toMatch(/\\b/);
    expect(src).toContain('(\\\\s|$)');
  });
});

describe('★★ العدولُ يُقرأ في ثلاثة مواضع — لا واحد', () => {
  const inbound = bare('apps/worker/src/inbound.ts');
  const reply = bare('apps/worker/src/reply.ts');
  const outbound = bare('apps/worker/src/outbound.ts');

  it('الواردُ يكشف ويكتب الحقلَ والصفَّ معاً، ولا يفتح نافذةً لمكتوم', () => {
    expect(inbound).toContain('detectOptOut(m.text)');
    /* الحقلُ **والصفّ**: الدمجُ ينقل الصفَّ إلى البطاقة الباقية — فبلاه يضيع
       العدولُ مع أوّل دمج. */
    expect(inbound).toMatch(/set\(\{ optedOutAt: m\.at \}\)/);
    expect(inbound).toContain('insert(optouts)');
    expect(inbound).toContain('if (!muted) await openOrExtendWindow(');
    expect(inbound).toContain('if (!muted && !optingOut) toReply.add(conv.id);');
  });

  it('★ والرسالةُ تُحفظ قبل الفحص — طلبُ الإيقاف دليلٌ يجب أن يبقى', () => {
    const insertAt = inbound.indexOf('.insert(messages)');
    const detectAt = inbound.indexOf('detectOptOut(m.text)');
    expect(insertAt).toBeGreaterThan(0);
    expect(detectAt, 'الكشفُ قبل الحفظ — الدليلُ يضيع').toBeGreaterThan(insertAt);
  });

  it('والردُّ يتوقّف عند العدول أو الحجب قبل أيّ نداءِ نموذج', () => {
    const gate = reply.indexOf('cflags?.optedOutAt || cflags?.blockedAt');
    const model = reply.indexOf('await runAgent(');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(model);
  });

  it('★★★ والإرسالُ يرفض — وهو الحارسُ الذي لا التفافَ عليه', () => {
    expect(outbound).toContain('export class ContactOptedOutError');
    expect(outbound).toContain("throw new ContactOptedOutError('blocked')");
    expect(outbound).toContain("throw new ContactOptedOutError('opted_out')");
    /* بعد حالة الحساب وقبل النافذة: الترتيبُ هو الترتيبُ. */
    const tenant = outbound.indexOf('throw new TenantBlockedError()');
    const contact = outbound.indexOf("throw new ContactOptedOutError('blocked')");
    const window = outbound.indexOf('throw new WindowClosedError(');
    expect(contact).toBeGreaterThan(tenant);
    expect(contact).toBeLessThan(window);
  });

  it('والعدولُ في safeSend ليس فشلاً: لا حادثةَ ولا إعادة', () => {
    const at = reply.indexOf('async function safeSend');
    const body = reply.slice(at);
    expect(body).toContain('if (e instanceof ContactOptedOutError) return;');
    /* وقبل الفرع العامّ الذي يرفع حادثةً ويعيد. */
    expect(body.indexOf('ContactOptedOutError')).toBeLessThan(body.indexOf('throw e;'));
  });
});

describe('★★ التحويلُ إلى موظّفٍ يُبلَّغ — ولم يكن', () => {
  const reply = bare('apps/worker/src/reply.ts');
  const notify = bare('apps/worker/src/notify.ts');

  it('★★★ كلُّ موضعٍ يكتب needsAttention في الردّ يُسمّي سبباً', () => {
    /* ستّةُ مواضع. وموضعٌ سابعٌ يُضاف غداً بلا سببٍ هو الصمتُ نفسُه يعود. */
    const sets = (reply.match(/needsAttention: true/g) ?? []).length;
    const reasons = (reply.match(/attention = /g) ?? []).length;
    expect(sets).toBeGreaterThanOrEqual(5);
    expect(reasons, `${sets} موضعاً يوسم و${reasons} فقط يُسمّي سبباً`).toBeGreaterThanOrEqual(sets);
  });

  it('★ ويُبلَّغ بعد الإيداع وقبل فحص الخطّة', () => {
    /* سقفٌ بلا رسالةِ فشلٍ يوسم ويُنهي بلا خطّة — والموظّفُ يجب أن يعلم في
       هذه الحالة تحديداً. فالإبلاغُ قبل `if (!plan) return`. */
    const notifyAt = reply.indexOf('await notifyHandoff(');
    const planGuard = reply.indexOf('if (!plan) return;');
    const catchEnd = reply.indexOf('} catch (e: unknown) {');
    expect(notifyAt).toBeGreaterThan(catchEnd);
    expect(notifyAt).toBeLessThan(planGuard);
  });

  it('★ والمُبلَّغون فريقُ المستأجر النشِطُ كلُّه', () => {
    expect(notify).toContain('export async function notifyHandoff');
    const at = notify.indexOf('export async function notifyHandoff');
    const body = notify.slice(at);
    expect(body).toContain("inArray(users.role, ['tenant_owner', 'tenant_agent'])");
    expect(body).toContain('eq(users.isActive, true)');
    /* وسمٌ لكلّ محادثة: ستّةُ أسبابٍ متتاليةٍ على المحادثة نفسِها إشعارٌ واحدٌ حيّ. */
    expect(body).toContain('tag: `attention:${conversationId}`');
    expect(body).toContain('url: `/app/inbox?c=${conversationId}`');
  });

  it('★ ولا نداءَ إشعارٍ داخل معاملة — يدفع عبر الشبكة', () => {
    const at = notify.indexOf('export async function notifyHandoff');
    const body = notify.slice(at);
    const txEnd = body.indexOf(')));');
    const handle = body.indexOf('handleNotify({');
    expect(handle).toBeGreaterThan(txEnd);
  });
});

describe('★ الزرّان في البطاقة والمساراتُ خلفهما', () => {
  const api = read('apps/api/src/routes/contacts.ts');
  const page = read('apps/web/src/app/app/contacts/page.tsx');

  it('أربعةُ أفعالٍ مقيَّدةٌ بالاسم — لا معاملٌ حرّ', () => {
    expect(api).toContain("'/contacts/:id/:action'");
    for (const a of ['block', 'unblock', 'optout', 'optin']) expect(api).toContain(`${a}:`);
    expect(api).toContain('req.params.action in CONTACT_FLAG_ACTIONS');
  });

  it('★ وكلُّ فعلٍ صفٌّ في audit_log وبثٌّ بعد الإيداع', () => {
    const at = api.indexOf("'/contacts/:id/:action'");
    const body = api.slice(at, at + 3500);
    expect(body).toContain('insert(auditLog)');
    expect(body).toContain("emitToTenant(tenantId, 'conversation:update'");
    /* البثُّ خارج withTenant: لا نداءَ شبكةٍ داخل معاملة. */
    expect(body.indexOf('emitToTenant')).toBeGreaterThan(body.indexOf('return after!;'));
  });

  it('★ والبطاقةُ تُظهر الحالةَ نصّاً وتفرّق الحجبَ عن العدول', () => {
    expect(page).toContain('محجوبٌ من حسابكم');
    expect(page).toContain('عدل عن المراسلة');
    expect(page).toContain("setFlag(detail.contact.id, 'block')");
    expect(page).toContain("setFlag(detail.contact.id, 'optout')");
    /* والزرُّ مقيَّدٌ بصلاحيّة الكتابة ومحجوبٌ في الانتحال. */
    expect(page).toContain('perms.write && !perms.readOnly');
  });
});
