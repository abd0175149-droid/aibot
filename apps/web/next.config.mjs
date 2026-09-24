/**
 * ★ **رؤوس الأمن — ولماذا أُضيفت هنا لا في النفق.**
 *
 *   قياسٌ على الخادم الحيّ (٢٣ أيلول ٢٠٢٦): `curl -D - https://aibot.masaros.net/login`
 *   يعود **بلا رأسِ أمنٍ واحد** — لا HSTS ولا CSP ولا `nosniff` ولا
 *   `Referrer-Policy` ولا منعَ تأطير. ونفقُ Cloudflare مُدارٌ من اللوحة
 *   (‏`ops/DOMAIN.md`)، فرأسٌ يُضاف هناك يعيش في إعدادٍ لا يُراجَع في المستودع
 *   ولا يُنشر مع الكود ويضيع مع أوّل إعادة إنشاءٍ للنفق. فالرؤوسُ تُولَد من
 *   المصدر، وتُختبَر، وتُنشَر معه.
 *
 * ★ **وما لم يُضَف عن قصد: `script-src` بلا `'unsafe-inline'`.**
 *   موجّهُ تطبيقات Next.js يبثّ نصوصاً سطريّةً لكلّ صفحة (بيانات الترطيب
 *   والتدفّق)، وسدُّها يحتاج `nonce` يمرّ عبر middleware — إعادةُ بناءٍ في
 *   طبقة العرض لا رأسٌ ناقص. فالمكتوب هنا هو ما لا يكسر شيئاً **ويمنع فعلاً**:
 *   `frame-ancestors 'none'` (منعُ النقر المخطوف) · `object-src 'none'` ·
 *   `base-uri 'self'` (منعُ حقنِ `<base>` الذي يحوّل كلّ رابطٍ نسبيّ) ·
 *   `form-action 'self'` (منعُ نموذجٍ مزروعٍ يرسل الكلمة إلى الخارج).
 *   و`script-src` مكتوبٌ صريحاً بمصادره كي يمنع نصّاً من **نطاقٍ آخر** —
 *   وهو ما يكفي لأكثر ما يُحقن فعلاً.
 *
 * ★ **و`connect-src` يُشتقّ من `NEXT_PUBLIC_API_URL`** لا يُكتب نطاقاً حرفيّاً:
 *   السوكِت على نفس الأصل بمخطّط `ws`، وكتابةُ `wss:` مجرّدةً تفتح كلّ مضيف.
 */

/** أصلُ الـAPI ونظيرُه بمخطّط السوكِت — وفراغٌ آمنٌ إن لم تُضبط البيئة. */
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? '').origin;
  } catch {
    return '';
  }
})();
const wsOrigin = apiOrigin.replace(/^http/, 'ws');

const csp = [
  "default-src 'self'",
  // لا nonce بعد ⟶ `'unsafe-inline'` باقٍ للنصوص السطريّة، والمصادرُ محدودةٌ بالأصل
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src ${["'self'", apiOrigin, wsOrigin].filter(Boolean).join(' ')}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // سنةٌ كاملةٌ وكلُّ النطاقات الفرعيّة — النطاق كلّه على HTTPS عبر النفق
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // `frame-ancestors` يكفي للمتصفّحات الحديثة، وهذا للقديمة التي لا تقرأه
  { key: 'X-Frame-Options', value: 'DENY' },
  // المسارات تحمل معرّفاتٍ (‏/conversations/<uuid>) — لا تُسرَّب في Referer خارجيّ
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/** @type {import('next').NextConfig} */
export default {
  output: 'standalone',
  reactStrictMode: true,

  /**
   * ★ **`@aibot/shared` حزمةٌ مصدرُها TypeScript — لا `dist` لها.**
   *
   *   و`main` يشير إلى `src/index.ts`، وملفّاتُه تستورد بعضَها بلاحقة `.js`
   *   (كما يوجب ESM). فحين تستورد الواجهةُ منها **قيمةً** — لا نوعاً — يحاول
   *   webpack حلَّ `./errors.js` فلا يجده، ويسقط البناء كلُّه.
   *
   *   ولم يظهر هذا قبلاً لأنّ كلّ استيرادٍ سابقٍ كان `import type`: الأنواع
   *   تُمحى عند الترجمة فلا يُحلّ الملفّ أصلاً. فأوّلُ ثابتٍ مشتركٍ حقيقيّ
   *   (`MESSAGE_TYPE_AR`) كسر البناء — وهو بالضبط ما يجعل العطلَ خبيثاً:
   *   الحزمةُ «تعمل» في الواجهة منذ أشهر، والكسرُ ينتظر أوّلَ استعمالٍ جادّ.
   */
  transpilePackages: ['@aibot/shared'],
  webpack(config) {
    /* لاحقةُ `.js` في مصدرٍ TypeScript تعني `.ts` — وهذا هو الحلُّ المعياريّ
       لها. ولا يُغني عنه `transpilePackages`: ذاك يقرّر **من يُترجَم**،
       وهذا يقرّر **كيف يُحلّ المسار**. */
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  // نسخةُ الإطار ليست معلومةً يحتاجها زائر — وهي أوّل ما يقرأه ماسحٌ آليّ
  poweredByHeader: false,
  // الواجهة تنادي الـAPI عبر نفس النطاق (/api) — فلا CORS ولا عنوانٌ مختلف
  async rewrites() {
    return [{
      source: '/api/:path*',
      destination: `${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4100'}/api/:path*`,
    }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export { csp, securityHeaders };
