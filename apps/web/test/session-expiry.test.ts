import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginHref, safeNext } from '../src/lib/nav';

/**
 * ★★★ **انتهاءُ الجلسة كان يمحو ما كُتب ولم يُحفَظ.**
 *
 *   `apps/web/src/lib/api.ts` كان يكتب `location.href` من داخل مساعد الجلب
 *   نفسِه عند فشل التجديد — تحميلٌ كاملٌ للصفحة يمحو شجرةَ React كلَّها:
 *   نصُّ الشخصيّة في شاشة البوت، وحقولُ الدعوة في الفريق، و**الكلمةُ المؤقّتة
 *   المعروضة مرّةً واحدة** — والخادم لا يخزّنها نصّاً فلا سبيل إليها بعدها.
 *
 *   والأسوأ أنّه يقع من **استقصاءٍ في الخلفيّة**: إنبوكسٌ مفتوحٌ يسأل كلّ
 *   دقيقة، فتُمحى شاشةُ من لم يلمس شيئاً منذ ساعة وهو يكتب في تبويبٍ آخر.
 */

const SRC = join(__dirname, '..', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const code = (rel: string) => read(rel)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*/gm, ' ');

afterEach(() => { vi.unstubAllGlobals(); });

describe('الماسحُ يُعمي التعليقات', () => {
  it('★ والملفّاتُ مليئةٌ بشروحٍ تذكر `location.href`', () => {
    expect(read('lib/api.ts')).toContain('location.href');
    expect(code('lib/api.ts'), 'التعليقاتُ ما زالت تُقرأ').not.toContain('location.href');
  });
});

describe('وِجهةُ من لا جلسةَ له تُبنى مرّةً واحدة', () => {
  it('★ والاستعلامُ يبقى — ومن كان يقرأ محادثةً بعينها يعود إليها', () => {
    expect(loginHref('/app/inbox', '?c=abc')).toBe(`/login?next=${encodeURIComponent('/app/inbox?c=abc')}`);
  });

  it('★★ وما ترفضه `safeNext` يهبط إلى `/login` مجرّداً — لا يُبنى بأيدينا ما لا يُقبَل', () => {
    /* ما لا يجوز قبولُه من عنوانٍ خارجيّ لا يجوز أن نصنعه نحن: النقطتان
       تمنعان `javascript:` بأيّ التفاف، فقيمةٌ تحملهما تُسقط `next` كلَّه. */
    expect(safeNext('/app/x?u=http://evil')).toBeNull();
    expect(loginHref('/app/x', '?u=http://evil')).toBe('/login');
    expect(loginHref('//evil.example', '')).toBe('/login');
  });

  it('وبلا وسيطٍ يقرأ الموضعَ الحاليّ', () => {
    vi.stubGlobal('location', { pathname: '/app/bot', search: '?tab=kb' });
    expect(loginHref()).toBe(`/login?next=${encodeURIComponent('/app/bot?tab=kb')}`);
  });
});

describe('التنقّلُ خرج من مساعد الجلب', () => {
  const API = code('lib/api.ts');

  it('★★★ لا `location` في `api.ts` إطلاقاً — التنقّلُ قرارُ الشاشة لا الشبكة', () => {
    expect(API, 'ما زال يتنقّل من داخل الجلب').not.toMatch(/location\.(href|replace|assign)/);
  });

  it('★★ والخبرُ يُبلَّغ لمن يرسم — لا لمن يجلب', () => {
    expect(API).toMatch(/export function watchExpired/);
    expect(API).toMatch(/export function watchResumed/);
    expect(API).toContain('notifyExpired()');
  });

  it('★★★ وعلَمُ الموت قاطعُ دائرة — وكان التنقّلُ يفعلها بلا قصد', () => {
    /* التحميلُ الكامل كان يُنهي كلَّ مُستقصٍ في الصفحة. وبلاه يبقى إنبوكسٌ
       واقفٌ على البوّابة يطلب `/auth/refresh` كلَّ دقيقةٍ إلى الأبد — كلُّ
       مرّةٍ استعلامُ قاعدةٍ وكوكي محوٍ جديد. */
    expect(API).toMatch(/let dead = false;/);
    expect(API, 'التجديدُ يُرفَض بلا شبكةٍ ما دام العلَمُ مرفوعاً')
      .toMatch(/if \(dead\) return false;/);
    const iDead = API.indexOf('if (dead) return false;');
    const iFetch = API.indexOf("fetch('/api/auth/refresh'");
    expect(iDead, 'الفحصُ بعد النداء لا يمنع شيئاً').toBeLessThan(iFetch);
  });

  it('★★ والعلَمُ يسقط عند الاستئناف — من تبويبٍ آخر أيضاً', () => {
    /* الكوكي مشتركٌ بين التبويبات: تبويبٌ يُعيد الدخول يُحيي الجلسةَ لكلّها،
       فبلا هذا يبقى لوحٌ ميّتٌ فوق جلسةٍ حيّة. */
    expect(API).toMatch(/notifyResumed\(\);\n      return true;/);
    expect(API).toMatch(/export function setToken[\s\S]{0,140}notifyResumed\(\)/);
  });

  it('★★ و`/auth/logout` مستثنًى مع `/auth/login`', () => {
    /* الخروجُ بتوكنٍ ميّتٍ كان سيرسم البوّابةَ إطاراً واحداً قبل أن يصل
       التحويل — ومَن ضغط «خروج» لا يُسأل كلمتَه. */
    expect(API).toMatch(/\/\^\\\/auth\\\/\(login\|logout\)\//);
  });
});

describe('البوّابةُ تُرسم فوق ما هو مرسوم', () => {
  const SESSION = code('lib/session.tsx');
  const GATE = code('components/SessionGate.tsx');

  it('★ القشرةُ تسمع الخبرَين معاً', () => {
    expect(SESSION).toMatch(/watchExpired\(\(\) => setExpired\(true\)\)/);
    expect(SESSION, 'بلا الثاني يبقى لوحٌ ميّتٌ فوق جلسةٍ حيّة')
      .toMatch(/watchResumed\(\(\) => setExpired\(false\)\)/);
  });

  it('★★ واللوحُ **بعد** الأبناء في الشجرة — وهم باقون مرسومون', () => {
    const iKids = SESSION.indexOf('{children}');
    const iGate = SESSION.indexOf('<SessionGate');
    expect(iKids).toBeGreaterThan(0);
    expect(iGate, 'اللوحُ قبل الأبناء يستبدلهم بدل أن يعلوَهم').toBeGreaterThan(iKids);
  });

  it('★★★ ومخرجٌ نهائيٌّ بعد ثلاث محاولات — الجهازُ المشترك', () => {
    /* موظّفٌ عُطِّل حسابُه: `/auth/login` يردّ ٤٠١ دائماً على المعطَّل، فبلا
       مخرجٍ تبقى محادثاتُ زبائنه مرسومةً خلف نموذجٍ لا ينجح أبداً على جهاز
       المتجر. والتنقّلُ القديم كان يمحوها بلا قصد. */
    expect(GATE).toMatch(/const MAX_TRIES = 3;/);
    expect(GATE).toMatch(/if \(n >= MAX_TRIES\) \{ hardExit\(\); return; \}/);
    expect(GATE, 'والخروجُ يمحو التوكنَ ويُحمّل من جديد')
      .toMatch(/setToken\(null\);\s*location\.replace\(loginHref\(\)\)/);
    expect(GATE, 'ومخرجٌ صريحٌ دائماً لمن لا يريد الاستئناف').toContain('اخرج وسجّل الدخول من جديد');
  });

  it('★★ والبريدُ يمرّ بالعازل — لا يُدسّ في جملةٍ عربيّة', () => {
    /* بلا عزلٍ ينقلب `a@b.com` في فقرةٍ أساسُها RTL. و`Field.label` نصٌّ لا
       عقدةُ عرض، فدسُّ البريد في وسمٍ عربيٍّ يفرض المخالفة. */
    expect(GATE).toMatch(/<Iso text=\{email\} \/>/);
    expect(GATE, 'البريدُ في وسمِ حقل').not.toMatch(/label=\{`[^`]*\$\{email\}/);
  });

  it('★ ولا تُرسم قبل أن نعرف من هو', () => {
    expect(SESSION).toMatch(/\{expired && me && \(/);
  });
});

describe('تغييرُ الهويّة يبقى تحميلاً صلباً', () => {
  const SHELL = code('components/Shell.tsx');

  it('★★★ الخروجُ وإنهاءُ الانتحال كلاهما — لا أحدهما', () => {
    /* `router.replace` يُبقي شجرةَ React وفيها بياناتُ المستأجر، ويُبقي
       المقبضَ منضمّاً إلى غرفته (`t:<id>`) ولا تُشتقّ الغرفُ من جديد.
       وإنهاءُ الانتحال تغييرُ مستأجرٍ في نفس التبويب — أي نفسُ التسريب. */
    for (const fn of ['async function logout()', 'async function leaveImpersonation()']) {
      const at = SHELL.indexOf(fn);
      expect(at, fn).toBeGreaterThan(0);
      const body = SHELL.slice(at, SHELL.indexOf('\n  }', at));
      expect(body, `${fn}: تنقّلٌ داخل التطبيق على تغيير هويّة`).not.toContain('router.replace');
      expect(body, `${fn}: بلا تحميلٍ صلب`).toContain('location.replace');
    }
  });
});
