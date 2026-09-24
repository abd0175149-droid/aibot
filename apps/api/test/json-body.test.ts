import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@aibot/shared';
import { parseJsonBody, isWebhookPath, WEBHOOK_PREFIX } from '../src/json-body.js';

/**
 * ★ **التسامحُ كُتب للويبهوك ووُزّع على كلّ مسار.**
 *
 * محلّلُ JSON كان يُعيد `{}` عن كلّ جسمٍ مشوّه، بتعليقٍ صريح: «حمولةٌ مشوّهة:
 * 200 ثمّ تسجيل — لا 400 يعطّل الويبهوك». وهي قاعدةٌ صحيحةٌ **للويبهوك وحده**:
 * ميتا تُعيد المحاولة على 400 وقد توقف الاشتراك.
 *
 * لكنّها سَرَت على كلّ شيء. ومسارانِ يقرآن `Boolean(req.body?.x)`:
 * `POST /team/:id/active` و`POST /bot/toggle`. فجسمٌ مقطوعٌ في الشبكة
 * — `{"isActive": tru` — يصير `{}`، و`Boolean(undefined)` تصير `false`:
 * **يُعطَّل عضوٌ وتُبطَل جلساتُه**، أو يُطفأ بوتُ العميل عن كلّ زبائنه.
 * والطلبُ يعود 200، فلا شيءَ يقول إنّ ما وقع غيرُ ما قُصد.
 */

const bad = Buffer.from('{"isActive": tru');
const good = Buffer.from('{"isActive": true}');

describe('المسارُ هو ما يُفرّق لا نوعُ المحتوى', () => {
  it('الويبهوك يبتلع المشوّه — وهي قاعدةٌ مقصودة', () => {
    /* ميتا تُعيد المحاولة على ٤٠٠ وقد توقف الاشتراك: ابتلاعُ المشوّه هناك
       يحمي قناةَ العميل من أن تُغلق بسبب حمولةٍ واحدةٍ غريبة. */
    expect(parseJsonBody(`${WEBHOOK_PREFIX}whatsapp/abc`, bad)).toEqual({});
    expect(isWebhookPath(`${WEBHOOK_PREFIX}whatsapp/abc`)).toBe(true);
  });

  it('★ وما عداه يُرفَض — والقبولُ كان يُعطّل عضواً بجسمٍ مقطوع', () => {
    for (const url of ['/api/team/x/active', '/api/bot/toggle', '/api/conversations/x/bot']) {
      expect(() => parseJsonBody(url, bad), url).toThrow();
    }
  });

  it('★★ والخطأُ ٤٠٠ لا ٥٠٠ — فلا يُقرأ عطلاً عندنا وهو حمولةُ العميل', () => {
    /* خطأٌ بلا `statusCode` يمرّ بمعالج الأخطاء فيصير «خطأ داخليّ»، ويُغرق
       السجلَّ بما ليس عطلاً — فتختفي الأعطالُ الحقيقيّة بينه. */
    try {
      parseJsonBody('/api/bot/toggle', bad);
      expect.unreachable('لم يُرمَ شيء');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).status).toBe(400);
    }
  });

  it('والسليمُ يمرّ في الحالتين', () => {
    expect(parseJsonBody('/api/bot/toggle', good)).toEqual({ isActive: true });
    expect(parseJsonBody(`${WEBHOOK_PREFIX}x`, good)).toEqual({ isActive: true });
  });

  it('★ والفارغُ يبقى `{}` — لا مُنادِيَ يرسل نوعَ JSON بجسمٍ فارغ', () => {
    /* وتشديدُه يشتري لا شيء ويفتح مسارَ ٤٠٠ جديداً على طلباتٍ تعمل اليوم. */
    expect(parseJsonBody('/api/bot/toggle', Buffer.alloc(0))).toEqual({});
  });

  it('والبادئةُ لا تُخدَع بمسارٍ يتضمّنها في وسطه', () => {
    expect(isWebhookPath('/api/x/api/webhooks/y')).toBe(false);
    expect(isWebhookPath(undefined)).toBe(false);
    expect(isWebhookPath('/api/webhooksfake')).toBe(false);
  });
});

const MAIN = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8');
const BARE = MAIN.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*/gm, ' ');

describe('التوصيلُ في main.ts', () => {
  it('★ لا تسامحَ عامٌّ باقٍ', () => {
    expect(BARE, 'ما زال يُعيد {} عن كلّ مشوّه').not.toMatch(/done\(null, \{\}\)/);
    expect(BARE).toContain('parseJsonBody(req.url, raw)');
  });

  it('★★ والبايتاتُ تُحفظ قبل أيّ قرار — توقيعُ الويبهوك يُحسب عليها', () => {
    const at = BARE.indexOf('rawBody');
    const dec = BARE.indexOf('parseJsonBody(');
    expect(at).toBeGreaterThan(0);
    expect(at, 'القرارُ قبل حفظ البايتات — فيضيع ما يُثبت أنّ الطلب من ميتا')
      .toBeLessThan(dec);
  });

  it('★ ومعالجُ الأخطاء مسجَّلٌ قبل المسارات', () => {
    /* خطأُ محلّل المحتوى يقع **خارج** أيّ مسار، فمعالجٌ مسجَّلٌ بعده لا
       يلتقطه — وتخرج ٥٠٠ إنجليزيّةٌ بدل ٤٠٠ عربيّةٍ مفهومة. */
    const h = BARE.indexOf('app.setErrorHandler');
    const r = BARE.indexOf('await app.register(');
    expect(h).toBeGreaterThan(0);
    expect(r).toBeGreaterThan(0);
    expect(h).toBeLessThan(r);
  });
});

const BOT = readFileSync(join(__dirname, '..', 'src', 'routes', 'bot.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

describe('الملفُّ لا يُقرأ قبل التوكن', () => {
  it('★ الفحصُ في `onRequest` لا `preHandler`', () => {
    /* `preHandler` يعمل **بعد** التحليل: اثنا عشر ميجابايت في ذاكرة الخادم
       قبل أن يُرمى ٤٠١، وعشرةُ طلباتٍ متزامنةٍ مئةً وعشرين، بلا حدِّ معدّل. */
    const at = BOT.indexOf("'/bot/knowledge/files'");
    expect(at).toBeGreaterThan(0);
    const opts = BOT.slice(at, at + 220);
    expect(opts).toContain('onRequest: authBeforeBody');
    expect(opts, 'الاثنان معاً يُبقيان التحليلَ قبل الفحص').not.toContain('preHandler');
  });

  it('★★ والسقفُ يسكن المسارَ لا المحلّل — وإلّا سرى على كلّ `/api`', () => {
    /* `addContentTypeParser` يكتب على نسخة `/api` نفسِها، فـ`bodyLimit` فيه
       كان يرفع السقفَ إلى اثني عشر ميجابايت على `POST /auth/login` لمجهول. */
    expect(BOT, 'السقفُ ما زال في المحلّل').not.toMatch(/parseAs: 'buffer', bodyLimit: KB_MAX/);
    const at = BOT.indexOf("'/bot/knowledge/files'");
    expect(BOT.slice(at, at + 220)).toContain('bodyLimit: KB_MAX');
  });
});

describe('السجلُّ لا يحفظ ما بحث عنه الموظّف', () => {
  it('★ قيمُ الاستعلام تُحجب ومفاتيحُه تبقى', () => {
    /* ثلاثُ شاشاتٍ تضع كلامَ الزبون في `?q=`. فموظّفٌ يبحث عن «0791234567»
       ليفتح محادثةَ من اتّصل به كان يكتب الرقمَ في سجلٍّ يُحتفظ به ويُشحن.
       و«أنّ بحثاً جرى» ليس سرّاً — وهو ما يُقرأ في التشخيص. */
    expect(BARE).toContain('serializers');
    expect(BARE).toMatch(/kv\.split\('='\)\[0\]/);
    expect(BARE, 'والمسارُ يبقى كاملاً — هو ما يُشخَّص به').toMatch(/const \[path, query\] = req\.url\.split/);
  });
});
