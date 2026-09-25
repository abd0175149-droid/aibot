import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import config, { csp, securityHeaders } from '../next.config.mjs';

/**
 * ★ **رؤوسُ الأمن على الواجهة** — وُلد هذا الملفّ من قياسٍ لا من قائمةِ مراجعة:
 *   `curl -D - https://aibot.masaros.net/login` في ٢٣ أيلول ٢٠٢٦ عاد **بلا رأسِ
 *   أمنٍ واحد** — لا `Strict-Transport-Security` ولا `Content-Security-Policy`
 *   ولا `X-Content-Type-Options` ولا `Referrer-Policy` ولا منعَ تأطير، ومع
 *   `x-powered-by: Next.js` في المقابل.
 *
 * ★ **ولماذا تُختبر الرؤوسُ ولا يُكتفى بوضعها.** النفقُ مُدارٌ من لوحة
 *   Cloudflare (‏`ops/DOMAIN.md`)، فرأسٌ يُضاف هناك لا يُراجَع في المستودع ولا
 *   يُنشر مع الكود ويضيع مع أوّل إعادةِ إنشاءٍ للنفق. والرأسُ الذي يُحذف بالسهو
 *   لا يُشتكى منه أحدٌ ولا يسقط بناءٌ — يعيش الموقعُ بلا حمايةٍ بصمت. فالحارسُ
 *   هنا هو ما يجعل حذفَه مسموعاً.
 */

describe('رؤوسُ الأمن — موجودةٌ وبقيمٍ صحيحة', () => {
  const byKey = new Map(securityHeaders.map((h: { key: string; value: string }) => [h.key, h.value]));

  it('★ مُركَّبةٌ على كلّ مسارٍ لا على صفحةٍ واحدة', async () => {
    expect(config.headers).toBeTypeOf('function');
    const rules = await config.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe('/:path*');
    expect(rules[0]!.headers).toBe(securityHeaders);
  });

  it('HSTS سنةٌ كاملةٌ وكلُّ النطاقات الفرعيّة', () => {
    const v = byKey.get('Strict-Transport-Security')!;
    expect(v).toMatch(/max-age=31536000/);
    expect(v).toMatch(/includeSubDomains/);
  });

  it('`nosniff` — فملفٌّ يُرفع لا يُنفَّذ بنوعٍ مخمَّن', () => {
    expect(byKey.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('★ منعُ التأطير بطبقتين — `frame-ancestors` للحديث و`X-Frame-Options` للقديم', () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(byKey.get('X-Frame-Options')).toBe('DENY');
  });

  it('★ `Referrer-Policy` — المسارات تحمل معرّفاتٍ لا تُسرَّب في Referer', () => {
    expect(byKey.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('صلاحيّاتُ الجهاز مقفولةٌ افتراضاً', () => {
    const v = byKey.get('Permissions-Policy')!;
    for (const f of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()']) {
      expect(v).toContain(f);
    }
  });

  it('`x-powered-by` مُطفأ — نسخةُ الإطار ليست معلومةً يحتاجها زائر', () => {
    expect(config.poweredByHeader).toBe(false);
  });
});

describe('CSP — ما تمنعه فعلاً', () => {
  const directives = new Map(
    csp.split('; ').map((d: string) => {
      const [name, ...rest] = d.split(' ');
      return [name!, rest.join(' ')];
    }),
  );

  it('`default-src` مقصورٌ على الأصل', () => {
    expect(directives.get('default-src')).toBe("'self'");
  });

  it('★ `object-src none` و`base-uri self` و`form-action self` — الثلاثةُ تمنع بلا كسر', () => {
    expect(directives.get('object-src')).toBe("'none'");
    expect(directives.get('base-uri')).toBe("'self'");
    expect(directives.get('form-action')).toBe("'self'");
  });

  it('خطوطُ جوجل مسموحةٌ صراحةً — وإلّا سقط الخطُّ العربيّ كلُّه', () => {
    expect(directives.get('style-src')).toContain('https://fonts.googleapis.com');
    expect(directives.get('font-src')).toContain('https://fonts.gstatic.com');
  });

  it('★ `connect-src` يُشتقّ من البيئة ويحوي أصلَ السوكِت — لا `wss:` مجرّدةً', () => {
    const v = directives.get('connect-src')!;
    expect(v).toContain("'self'");
    // `wss:` أو `ws:` مجرّدةً تفتح كلّ مضيف — وهي ما لا يجوز أن يظهر
    expect(v).not.toMatch(/(^|\s)wss?:(\s|$)/);
  });

  it('`worker-src self` — عاملُ الخدمة يعمل والخارجُ ممنوع', () => {
    expect(directives.get('worker-src')).toBe("'self'");
  });

  it('★ لا `unsafe-eval` — والمسموحُ الوحيدُ هو `unsafe-inline` للنصوص السطريّة', () => {
    expect(csp).not.toContain('unsafe-eval');
    // نقصٌ معروفٌ ومقصود: سدُّه يحتاج nonce عبر middleware لا رأساً إضافيّاً.
    // فإن أُضيف الـnonce يوماً فليسقط هذا السطر ويُحدَّث — لا أن يبقى صامتاً.
    expect(directives.get('script-src')).toBe("'self' 'unsafe-inline'");
  });
});

/**
 * ★ **المفتاحُ الذي لا يصل** — وهذا صنفُ عطلٍ ضُبط مرّتين في مراجعةٍ واحدة:
 *   `TRUST_PROXY` يُقرأ في `main.ts` ولا يُمرَّر في `docker-compose.yml` إطلاقاً،
 *   و`NEXT_PUBLIC_API_URL` يُمرَّر في `environment` وحدَه — و`NEXT_PUBLIC_*`
 *   تُحقن وقت **البناء**، ورؤوسُ `headers()` تُخبز في `routes-manifest.json`
 *   وقتَه أيضاً. فقيمةُ التشغيل لا تصل أيّاً منهما، و`connect-src` كان يُشتقّ
 *   من فراغٍ بلا أن يشكو أحد. إعدادٌ يُقرأ ولا يُمرَّر أسوأ من إعدادٍ غائب:
 *   يبدو مضبوطاً في `.env` ولا يفعل شيئاً.
 */
describe('★ الإعدادُ يصل فعلاً — لا مفتاحاً يُقرأ ولا يُمرَّر', () => {
  const root = join(__dirname, '..', '..', '..');
  const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
  const dockerfile = readFileSync(join(root, 'apps', 'web', 'Dockerfile'), 'utf8');

  it('`PUBLIC_URL` وسيطُ بناءٍ في الملفَّين — لا متغيّرَ تشغيلٍ وحده', () => {
    expect(dockerfile).toMatch(/ARG\s+PUBLIC_URL/);
    expect(dockerfile).toMatch(/NEXT_PUBLIC_API_URL=\$\{PUBLIC_URL\}/);
    // في كتلة `build.args` للواجهة لا في `environment`
    const webBuild = compose.slice(compose.indexOf('apps/web/Dockerfile'));
    expect(webBuild.slice(0, webBuild.indexOf('environment'))).toMatch(/PUBLIC_URL:/);
  });

  it('★★ و`TRUST_PROXY` مشروحٌ في القالب — مفتاحٌ غائبٌ عن القالب لا يضبطه أحد', () => {
    /* المفتاحُ يصل الحاويةَ منذ دفعةٍ سابقة، لكنّ قيمتَه الافتراضيّة
       (`127.0.0.1`) لا تُطابق قرينَ الاتّصال — بوّابةَ جسر دوكر — فتُهمَل
       `X-Forwarded-For` ويعود `req.ip` بوّابةَ الجسر لكلّ زائر. والمدى
       **خاصٌّ بالخادم** ويُعيد دوكر تعيينَه إن حُذفت الشبكة، فتثبيتُه في
       المستودع يجعل قيمةً تتغيّر تُحرَس باختبارٍ أخضر. فموضعُه `.env`،
       وواجبُ المستودع أن يشرحه ويُعطي أمرَ قراءته. */
    const env = readFileSync(join(root, '.env.example'), 'utf8');
    expect(env, 'مفتاحٌ غائبٌ عن القالب لا يملؤه أحد').toMatch(/^TRUST_PROXY=/m);
    expect(env, 'وأمرُ قراءة المدى على الخادم — لا قيمةٌ تُنسَخ').toContain('docker network inspect');
    expect(env, 'وطريقةُ التحقّق من أنّه سرى').toContain('docker compose logs api');
  });

  it('`TRUST_PROXY` مُمرَّرٌ إلى الـAPI — وإلّا فالحدُّ على IP زينة', () => {
    expect(compose).toMatch(/TRUST_PROXY:\s*\$\{TRUST_PROXY/);
  });

  it('★ وكلُّ `NEXT_PUBLIC_*` يقرؤه الإعداد مضبوطٌ في مسار البناء', () => {
    /* `NEXT_PUBLIC_*` وحدَها هي التي **يجب** أن تكون وقت بناء: هي تُحقن في
       الحزمة. وما عداها (‏`API_INTERNAL_URL`) متغيّرُ تشغيلٍ بقصد صاحبه. */
    const read = [...readFileSync(join(__dirname, '..', 'next.config.mjs'), 'utf8')
      .matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]*)/g)].map((m) => m[1]!);
    expect(read.length).toBeGreaterThan(0);
    for (const name of read) {
      expect(dockerfile, `${name} يُقرأ في next.config.mjs`).toContain(`${name}=`);
    }
  });
});
