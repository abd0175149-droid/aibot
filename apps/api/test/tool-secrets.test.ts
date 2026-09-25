import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactSecrets, MASKED } from '@aibot/core';
import {
  migrateLiteralSecrets, maskHttp, credentialValues, looksSecret, hasTemplate,
} from '../src/tool-secrets.js';

/**
 * ★ **سرُّ أداة العميل كان يخرج من ثلاثة أبواب.**
 *
 *  ① زرُّ «جرّبها» يُعيد `debug.url` — وهو العنوان **بعد** استبدال
 *    `{{secret.API_TOKEN}}`. والواجهةُ تطبعه في كتلةٍ قابلةٍ للنسخ.
 *  ② `GET /bot/tools` كان بـ`requireAuth()` بلا `settings`: كلُّ موظّفٍ في
 *    المستأجر يقرأ `http.headers.Authorization` كما كُتب.
 *  ③ والعمودُ `http` غيرُ مشفَّرٍ أصلاً — بخلاف `secrets_enc` — فمن لصق
 *    التوكن في حقل الترويسة خزّنه نصّاً صريحاً في القاعدة والنسخ الاحتياطيّة.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*/gm, ' ');

describe('الماسحُ يُزيل التعليقات فعلاً', () => {
  it('وإلّا لأثبت الحارسُ نفسَه من شرحه', () => {
    /* debug-url-raw-leak */
    /* والعلامةُ تُبنى من أجزاء: لو كُتبت حرفيّاً هنا لَظهرت في الكود أيضاً
       فنجح الفحصُ بلا أن يُثبت أنّ التعليقاتَ تُزال. */
    const mark = ['debug', 'url', 'raw', 'leak'].join('-');
    expect(read('apps/api/test/tool-secrets.test.ts'), 'العلامةُ ليست في التعليق').toContain(mark);
    expect(code('apps/api/test/tool-secrets.test.ts'), 'الماسحُ لا يُزيل التعليقات').not.toContain(mark);
  });
});

describe('الحجبُ يطابق ما يخرج فعلاً', () => {
  it('★ القيمةُ تُحجب بصيغتها الخام وبصيغتها المُشفَّرة للعنوان', () => {
    /* `renderUrl` يمرّ كلَّ قيمةٍ على `encodeURIComponent`، فسرٌّ فيه `/` أو
       `+` يظهر في العنوان بشكلٍ لا يطابق النصَّ الأصليّ — وحجبُ الخام وحده
       كان يترك السرَّ ظاهراً في العنوان بعينه. */
    const secret = 'sk-live/abc+123def';
    const url = `https://api.example.com/v1?key=${encodeURIComponent(secret)}`;
    expect(url).toContain('sk-live%2Fabc%2B123def');
    const out = redactSecrets(url, [secret]);
    expect(out).not.toContain('sk-live');
    expect(out).toContain(MASKED);
  });

  it('★ والسرُّ نصٌّ حرفيٌّ لا نمط — `RegExp` كان سيرمي على `(` و`+`', () => {
    const secret = 'a+b(c)d.e*f?g';
    expect(() => redactSecrets(`x ${secret} y`, [secret])).not.toThrow();
    expect(redactSecrets(`x ${secret} y`, [secret])).toBe(`x ${MASKED} y`);
  });

  it('★★ والقصيرُ لا يُحجب — حجبُه يُفسد التشخيصَ كلَّه', () => {
    /* قيمةٌ مثل «ar» أو «1» تُشطب من كلّ موضعٍ في الاستجابة، فيصير مخرَجُ
       التشخيص شبكةَ نقاطٍ لا يُقرأ منها شيء — وهو الغرضُ منه. */
    expect(redactSecrets('{"lang":"ar","n":1}', ['ar', '1'])).toBe('{"lang":"ar","n":1}');
  });

  it('والفارغُ والعدمُ يمرّان بلا رمي', () => {
    expect(redactSecrets('abc', [])).toBe('abc');
    expect(redactSecrets('abc', ['', '   '])).toBe('abc');
  });

  it('وكلُّ الظهورات لا الأوّلَ وحده', () => {
    const s = 'tok-abcdef12345';
    expect(redactSecrets(`${s} و${s}`, [s])).toBe(`${MASKED} و${MASKED}`);
  });
});

describe('الترحيلُ إلى الخزنة المشفَّرة عند الكتابة', () => {
  it('★ ترويسةُ مصادقةٍ بتوكنٍ حرفيّ تُنقل ويُستبدل مكانُها بمرجع', () => {
    const r = migrateLiteralSecrets({
      method: 'GET', url: 'https://x.example.com/a',
      headers: { Accept: 'application/json', Authorization: 'Bearer sk-live-abc123' },
    });
    expect(r).not.toBeNull();
    expect(r!.secrets).toEqual({ h_authorization: 'Bearer sk-live-abc123' });
    const h = (r!.http as { headers: Record<string, string> }).headers;
    expect(h.Authorization).toBe('{{secret.h_authorization}}');
    expect(h.Accept, 'ترويسةٌ عاديّةٌ لا تُلمس').toBe('application/json');
  });

  it('★★★ وقيمةٌ فيها قالبٌ لا تُلمس إطلاقاً — وهذا الفخّ', () => {
    /* `Bearer {{token}}` حيث `token` **مُعامِلٌ** لا سرّ: لو نُقلت القيمةُ
       كلُّها إلى الخزنة صارت الترويسةُ `{{secret.h_authorization}}`،
       ويستبدلها `renderTemplate` مرّةً واحدةً فيبقى `{{token}}` نصّاً حرفيّاً
       في الترويسة — أداةٌ كانت تعمل تُرسل الآن قالباً غيرَ مُستبدَل. */
    for (const v of ['Bearer {{secret.API_TOKEN}}', 'Bearer {{token}}', '{{secret.K}}']) {
      expect(hasTemplate(v)).toBe(true);
      expect(migrateLiteralSecrets({ headers: { Authorization: v } }), v).toBeNull();
    }
  });

  it('★ والاسمُ المُشتقُّ مقبولٌ عند `renderTemplate` — `[\\w.]+` وحدها', () => {
    const r = migrateLiteralSecrets({ headers: { 'X-Api-Key': 'abc123def456' } })!;
    expect(Object.keys(r.secrets)).toEqual(['h_x_api_key']);
    expect(/^[\w.]+$/.test('h_x_api_key')).toBe(true);
  });

  it('وترويسةٌ ليست اعتماداً تبقى كما هي — و`Idempotency-Key` منها', () => {
    for (const k of ['Accept', 'Content-Type', 'X-Request-Id', 'Idempotency-Key', 'Accept-Language']) {
      expect(migrateLiteralSecrets({ headers: { [k]: 'anything-at-all' } }), k).toBeNull();
    }
  });

  it('و`null` ولا ترويسات يُعيدان `null` — فلا يُعاد حفظُ عمودٍ بلا داعٍ', () => {
    expect(migrateLiteralSecrets(null)).toBeNull();
    expect(migrateLiteralSecrets(undefined)).toBeNull();
    expect(migrateLiteralSecrets({ url: 'https://x.example.com' })).toBeNull();
    expect(migrateLiteralSecrets({ headers: { Authorization: '  ' } })).toBeNull();
  });
});

describe('الحجبُ في مخرَج القراءة', () => {
  it('★ ترويسةُ الاعتماد الحرفيّةُ تصير نقاطاً — والقالبُ يبقى مقروءاً', () => {
    const m = maskHttp({
      url: 'https://x.example.com/a',
      headers: { Authorization: 'Bearer sk-abc123', 'X-Ref': 'branch-1', Accept: 'application/json' },
    }) as { headers: Record<string, string> };
    expect(m.headers.Authorization).toBe(MASKED);
    expect(m.headers['X-Ref']).toBe('branch-1');
    expect(m.headers.Accept).toBe('application/json');
    const t = maskHttp({ headers: { Authorization: '{{secret.K}}' } }) as { headers: Record<string, string> };
    expect(t.headers.Authorization, 'المرجعُ ليس سرّاً — وحجبُه يُخفي عن المالك أنّه مربوط')
      .toBe('{{secret.K}}');
  });

  it('★★ ومفتاحٌ في مُعامِل عنوانٍ يُحجب — والكلمةُ العاديّةُ لا', () => {
    const masked = maskHttp({
      url: 'https://x.example.com/v1?api_key=sk_live_9aZ8bY7c&sort_key=name&q={{term}}',
    }) as { url: string };
    expect(masked.url).not.toContain('sk_live_9aZ8bY7c');
    expect(masked.url).toContain(`api_key=${MASKED}`);
    expect(masked.url, 'قيمةٌ عاديّةٌ في مُعامِلٍ اسمُه يحمل key').toContain('sort_key=name');
    expect(masked.url, 'والقوالبُ تبقى').toContain('q={{term}}');
  });

  it('★★★ ولا `new URL` في الحجب — العنوانُ قالبٌ لا رابط', () => {
    /* `new URL('https://x/v1/{{id}}')` يُعيد `.../%7B%7Bid%7D%7D`، و
       `searchParams.set` يُعيد تشفير كلّ قالبٍ في الاستعلام. فأداةٌ فيها
       `{{id}}` في المسار تنكسر بمجرّد أن يمرّ عنوانُها على URL ويُكتب. */
    const url = 'https://x.example.com/v1/{{id}}/x?api_key=sk_live_9aZ8bY7c&q={{term}}';
    const m = maskHttp({ url }) as { url: string };
    expect(m.url).toContain('/v1/{{id}}/x');
    expect(m.url).not.toContain('%7B');
    expect(code('apps/api/src/tool-secrets.ts'), 'أيّ استعمالٍ لـURL يُعيد تشفير القوالب')
      .not.toMatch(/new URL\(|searchParams/);
  });

  it('وما ليس كائناً يمرّ كما هو', () => {
    expect(maskHttp(null)).toBeNull();
    expect(maskHttp('x')).toBe('x');
  });
});

describe('مجموعةُ الحجب تشمل ما كُتب حرفيّاً', () => {
  it('★ التوكنُ وحدَه بعد `Bearer` يُحجب — وهو ما يعيده المصدرُ في جوابه', () => {
    const v = credentialValues({ headers: { Authorization: 'Bearer sk-live-abc12345' } });
    expect(v).toContain('Bearer sk-live-abc12345');
    expect(v, 'المصدرُ قد يُعيد التوكنَ وحدَه في جسم الجواب').toContain('sk-live-abc12345');
  });

  it('★ ومفتاحُ العنوان بصيغتيه — المُشفَّرة هي ما يظهر في `debug.url`', () => {
    const v = credentialValues({ url: 'https://x.example.com/a?api_key=sk%2Flive%2Fabc123' });
    expect(v).toContain('sk/live/abc123');
    expect(v).toContain('sk%2Flive%2Fabc123');
  });

  it('★★ ولا تدخلُ كلمةٌ عاديّة — حجبُها يشطبها من كلّ الاستجابة', () => {
    expect(credentialValues({ url: 'https://x.example.com/a?sort_key=name&key=ar' })).toEqual([]);
    expect(looksSecret('name')).toBe(false);
    expect(looksSecret('main-branch')).toBe(false);
    expect(looksSecret('sk_live_9aZ8bY7c')).toBe(true);
  });

  it('والقالبُ لا يدخل — لا قيمةَ له قبل الاستبدال', () => {
    expect(credentialValues({ url: 'https://x.example.com/a?api_key={{secret.K}}' })).toEqual([]);
  });
});

/* ───────────────── التوصيلُ في المسارات ───────────────── */

const BOT = code('apps/api/src/routes/bot.ts');
const HTTP = code('packages/core/src/tools/http.ts');

describe('كلُّ بابٍ أُغلق فعلاً', () => {
  it('★ `GET /bot/tools` خلف صلاحيّة الإعدادات', () => {
    /* والشاشةُ الوحيدةُ التي تناديه محجوبةٌ في التنقّل بـ`needs: settings`
       أصلاً، فالفتحُ لم يشترِ شيئاً وكشف الترويسات لكلّ موظّف. */
    const at = BOT.indexOf("app.get('/bot/tools'");
    expect(at).toBeGreaterThan(0);
    const opts = BOT.slice(at, at + 90);
    expect(opts).toContain('preHandler: auth');
    expect(opts, 'ما زال مفتوحاً لكلّ من يملك توكناً').not.toContain('requireAuth()');
    expect(code('apps/web/src/app/app/layout.tsx')).toContain("href: '/app/bot', label: 'البوت', icon: '✦', needs: 'settings'");
  });

  it('★ والقائمةُ تُحجب — صفوفٌ قديمةٌ لم تُحفظ بعد الترحيل', () => {
    const at = BOT.indexOf("app.get('/bot/tools'");
    expect(BOT.slice(at, at + 700)).toContain('http: maskHttp(rest.http)');
  });

  it('★★ والحجبُ **لا** يسبق التنفيذ — وإلّا أرسلت الأداةُ نقاطاً مصادقةً', () => {
    /* عاملُ الردّ و`playground` يقرآن العمودَ الخام من القاعدة مباشرةً. لو
       حُجب قبل `execHttpTool` لفشلت كلُّ أداةٍ عند كلّ زبون. */
    for (const f of ['apps/worker/src/tools.ts', 'apps/worker/src/playground.ts']) {
      expect(code(f), f).not.toContain('maskHttp');
    }
    const test = BOT.slice(BOT.indexOf("'/bot/tools/:id/test'"), BOT.indexOf("'/bot/tools/:id'"));
    expect(test, 'الحجبُ في التجربة يمرّ بـmask لا بتعديل الصفّ').not.toContain('maskHttp');
    expect(test).toContain('mask: credentialValues(tool.http)');
  });

  it('★★ والكتابةُ تُرحّل ولا ترفض — الرفضُ يحبس المالك', () => {
    /* أداةٌ معطوبةٌ لا تُصحَّح إلّا بحفظ، ورفضُ الحفظ على توكنٍ حرفيّ كان
       يمنع الخروجَ من العطل نفسِه. */
    expect(BOT).toContain('const mig = migrateLiteralSecrets(b.http ?? null)');
    expect(BOT).toContain('http: mig?.http ?? b.http ?? null');
    expect(BOT).toContain('if (b.http !== undefined) patch.http = mig?.http ?? b.http');
    expect(BOT, 'ولا رفضَ على وجود توكنٍ حرفيّ').not.toMatch(/TOOL_BLOCKED[^)]*سرّ/);
  });

  it('★★★ والتعديلُ يدمج الخزنة ولا يستبدلها', () => {
    /* الباني يرسل `secrets: { API_TOKEN }` وحدَه. فاستبدالُ الخزنة كلِّها
       يمحو `h_authorization` المُرحَّل، وتصير الترويسةُ مرجعاً إلى سرٍّ غيرِ
       موجود يستبدله `renderTemplate` بنصٍّ فارغ: مصادقةٌ خاويةٌ تُخفق عند كلّ
       زبون ولا شيءَ في الشاشة يقول لماذا. */
    expect(BOT).toContain('if (b.secrets !== undefined || mig) {');
    expect(BOT).toMatch(/const merged = \{ \.\.\.base, \.\.\.\(mig\?\.secrets \?\? \{\}\) \}/);
    expect(BOT, 'القديمُ يُفتح ليُدمج فيه')
      .toMatch(/cur\.secretsEnc \? JSON\.parse\(open\(cur\.secretsEnc, cur\.keyVersion\)\) : \{\}/);
  });

  it('★ والتشخيصُ يمرّ كلُّه على الحجب — لا حقلٌ خام', () => {
    const at = HTTP.indexOf('opts.debug');
    expect(at).toBeGreaterThan(0);
    const blk = HTTP.slice(at, at + 400);
    for (const f of ['url: red(', 'requestBody: body === undefined ? undefined : red(', 'responseSnippet: red(']) {
      expect(blk, f).toContain(f);
    }
    expect(HTTP, 'ورسائلُ الخطأ أيضاً — `fetch` يضع العنوانَ في بعضها')
      .toContain('error: red((e as Error).message)');
    expect(HTTP).toContain('const masks = [...Object.values(secrets), ...(opts.mask ?? [])]');
  });

  it('★★ والشاشةُ تقرأ أسماءَ الحقول التي يُعيدها الخادم', () => {
    /* كانت تقرأ `snippet` و`body` والخادم يُعيد `responseSnippet`
       و`requestBody`، فكتلةُ «أوّل ما ردّه» كانت `undefined` دائماً — وهي
       أوّلُ ما يحتاجه من يبني أداةً لا تعمل. */
    const tb = code('apps/web/src/components/ToolBuilder.tsx');
    expect(tb).toContain('test.debug.responseSnippet');
    expect(tb).toContain('test.debug.requestBody');
    expect(tb, 'الأسماءُ القديمةُ ما زالت').not.toMatch(/debug\?\.(snippet|body)\b/);
  });
});
