import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ حرّاسُ **ما بين الشاشات** — وهو المهمَل دائماً.
 *
 * لا أحدَ يصمّم صفحةَ الخطأ، ولا أحدَ يفتح خمسَ تبويبات وهو يبني الشاشة
 * الواحدة. لكنّ المستخدم يفعل الاثنين في أوّل يوم، وأوّلُ خطأٍ يقع هو أوّلُ
 * انطباعٍ عن اكتمال المنتج.
 */

const APP = join(__dirname, '..', 'src', 'app');
const read = (rel: string) => readFileSync(join(APP, rel), 'utf8');

describe('صفحتا الخطأ موجودتان وعربيّتان ولهما مخرج', () => {
  it('★ ٤٠٤ — وكانت صفحة Next الإنجليزيّة بلا رابطٍ يُخرج منها', () => {
    expect(existsSync(join(APP, 'not-found.tsx'))).toBe(true);
    const s = read('not-found.tsx');
    expect(s, 'بلا رابطِ عودةٍ يبقى المستخدم عالقاً في التطبيق المثبَّت')
      .toMatch(/href="\/app"/);
    expect(s).toMatch(/[؀-ۿ]/);
  });

  it('★ وصفحةُ العطل تُعيد المحاولة وتعطي رمزاً يُقال للدعم', () => {
    expect(existsSync(join(APP, 'error.tsx'))).toBe(true);
    const s = read('error.tsx');
    expect(s, 'بلا `reset` يبقى المستخدم أمام شاشةٍ ميّتة').toMatch(/onClick=\{reset\}/);
    expect(s, 'و`digest` هو ما يربط شكواه بسطرٍ في السجلّ').toContain('error.digest');
    expect(s, 'ومكوّنُ عميل — وإلّا لم يستقبل `reset`').toMatch(/^'use client';/);
  });

  it('ولهما أسلوبٌ في الثيم لا افتراضيُّ المتصفّح', () => {
    const css = readFileSync(join(APP, 'globals.css'), 'utf8');
    expect(css).toContain('.oops');
    expect(css, 'والخلفيّةُ من الرمز لا لونٌ ثابت').toMatch(/\.oops \{[^}]*background: var\(--bg\)/s);
  });
});

describe('لكلّ شاشةٍ عنوانُها', () => {
  const root = read('layout.tsx');

  it('★ القالبُ يُلحق العلامة، والشاشةُ تُعطي اسمَها', () => {
    expect(root, 'كانت التبويباتُ كلُّها بعنوانٍ واحد').toMatch(/template: '%s · AiBot'/);
    expect(root).toMatch(/default: '/);
  });

  it('★ وكلُّ شاشةٍ تحت /app تحمل عنواناً — والصفحاتُ مكوّناتُ عميلٍ لا تحمله', () => {
    const dirs = readdirSync(join(APP, 'app'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(dirs.length).toBeGreaterThan(6);
    const naked = dirs.filter((d) => {
      const lay = join(APP, 'app', d, 'layout.tsx');
      return !existsSync(lay) || !readFileSync(lay, 'utf8').includes('title:');
    });
    expect(
      naked,
      'شاشةٌ بلا عنوان: من يفتح خمسَ تبويباتٍ لا يميّزها، ولا يجدها في سجلّ متصفّحه.',
    ).toEqual([]);
  });
});

describe('بيانُ التطبيق يطابق اللوحة الحاليّة', () => {
  const m = JSON.parse(readFileSync(join(APP, '..', '..', 'public', 'manifest.json'), 'utf8')) as
    Record<string, string>;
  const css = readFileSync(join(APP, 'globals.css'), 'utf8');

  /** قيمةُ متغيّرٍ من `:root` الأساسيّة — لا من كتلة النمط الداكن. */
  function token(name: string): string {
    const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    return new RegExp(`--${name}:\\s*(#[0-9a-f]{3,8})`, 'i').exec(root)?.[1]?.toLowerCase() ?? '';
  }

  it('★ لونُ الخلفيّة والعلامة من الرموز — وكانا من لوحةٍ رُفعت من التصميم كلّه', () => {
    /* `#00998a` تركوازيٌّ لا وجودَ له في المنتج، وكان يُفتح به شاشةُ بدء
       التطبيق المثبَّت — أوّلُ ما يراه من ثبّته. */
    expect(m.background_color?.toLowerCase()).toBe(token('bg'));
    expect(m.theme_color?.toLowerCase()).toBe(token('brand'));
  });

  it('والاتّجاهُ واللغةُ مضبوطان', () => {
    expect(m.lang).toBe('ar');
    expect(m.dir).toBe('rtl');
  });
});

describe('الرصيفُ يعرض وجهاته على الحاسوب', () => {
  const shell = readFileSync(join(__dirname, '..', 'src', 'components', 'Shell.tsx'), 'utf8');
  const css = read('shell.css');

  it('★ الفائضُ مرسومٌ في الشجرة لا مقصوصٌ منها', () => {
    expect(shell, 'كان `primary.map` يقصّ خمساً من تسع على كلّ عرض')
      .toMatch(/\{visible\.map\(\(n, i\) => \(/);
    expect(shell).toMatch(/navi-x/);
  });

  it('ولا تفريعَ على العرض في JS — شجرتان تتباعدان وتكسران التصيير على الخادم', () => {
    /* على الشيفرة بلا تعليقاتها: الشرحُ يذكر النمطَ الممنوع، وحارسٌ يعدّ
       التعليقات يُدفَع صاحبُه إلى حذف الشرح ليمرّ. */
    const code = shell.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*/gm, ' ');
    expect(code).not.toMatch(/matchMedia|innerWidth/);
  });

  it('★ وقاعدةُ الإخفاء تغلب قاعدةَ الأساس فعلاً — الوزنُ والترتيب معاً', () => {
    const hide = css.indexOf('.side .navi-x { display: none; }');
    const base = css.indexOf('.side .navi {');
    expect(hide, 'لا قاعدةَ إخفاء').toBeGreaterThan(0);
    expect(base).toBeGreaterThan(0);
    /* نفسُ الوزن (0,2,0)، فالترتيبُ هو الحاسم. وقاعدةٌ بوزن (0,1,0) أو موضعٌ
       قبل الأساس لا يُخفيان شيئاً — رُئي في التصيير: الوجهاتُ التسعُ كلُّها
       في شريط الهاتف بعناوينَ مقصوصة. */
    expect(hide, 'قاعدةُ الإخفاء قبل الأساس — فالأساسُ يغلبها').toBeGreaterThan(base);
    expect(css, 'وفوق ١١٠٠ تظهر بنفس الوزن').toContain('.side .navi-x { display: flex; }');
  });

  it('ونسخةُ الورقة تختفي فوق ١١٠٠ — وإلّا سُمعت الوجهاتُ مرّتين', () => {
    expect(shell).toMatch(/className="opts opts-x"/);
    expect(css).toContain('.opts-x { display: none; }');
  });
});

describe('الحوارُ يُدير التركيز — مرّةً واحدةً في المكوّن', () => {
  const ui = readFileSync(join(__dirname, '..', 'src', 'components', 'ui', 'index.tsx'), 'utf8');

  it('★ نقلٌ وحبسٌ وإرجاعٌ ومخرجٌ بمفتاح', () => {
    expect(ui).toMatch(/function useDialogFocus/);
    expect(ui, 'النقل: قارئُ الشاشة كان يقف في فراغٍ خارج الورقة').toMatch(/head\?\.focus\(\)/);
    expect(ui, 'الحبس: `Tab` كان يخرج إلى ما أخفاه `aria-modal` أصلاً').toMatch(/e\.preventDefault\(\); first\.focus\(\)/);
    expect(ui, 'الإرجاع: كان المستخدم يبدأ من رأس الصفحة بعد كلّ تأكيدٍ خطِر').toMatch(/back\.focus\(\)/);
    expect(ui).toMatch(/e\.key === 'Escape'/);
  });

  it('وتستعمله الورقةُ والحوارُ معاً', () => {
    expect((ui.match(/useDialogFocus\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('★ ولا نسخةَ ثانيةٌ من Escape في أيّ شاشة — قاعدةٌ نسختها شاشتان ونسيتها ثلاث', () => {
    const files = [
      join(__dirname, '..', 'src', 'components', 'Shell.tsx'),
      join(APP, 'console', 'page.tsx'),
      join(APP, 'app', 'bot', 'page.tsx'),
      join(APP, 'app', 'inbox', 'page.tsx'),
    ];
    for (const f of files) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
      expect(src, `${f} يكتب معالجَ Escape بنفسه`).not.toMatch(/=== 'Escape'/);
    }
  });

  it('وزرُّ الستارة خارج دورة Tab — وإلّا أخرج التركيزَ عند أوّل ضغطة', () => {
    expect(ui).toMatch(/className="sheet-scrim" tabIndex=\{-1\}/);
  });
});


describe('الحزمةُ المشتركة تُحلّ في بناء الواجهة', () => {
  const cfg = readFileSync(join(APP, '..', '..', 'next.config.mjs'), 'utf8');

  /**
   * ★ **بناءُ الواجهة فشل ثلاثَ نشراتٍ متتالية ولم يُلاحَظ.**
   *
   *   `@aibot/shared` حزمةٌ مصدرُها TypeScript بلا `dist`، وملفّاتُها تستورد
   *   بعضَها بلاحقة `.js` كما يوجب ESM. فأوّلُ استيرادِ **قيمةٍ** منها —
   *   لا نوعٍ — جعل webpack يحاول حلَّ `./errors.js` فلا يجده، فيسقط البناء.
   *   ولم يظهر قبلاً لأنّ كلّ استيرادٍ سابقٍ كان `import type`: الأنواع تُمحى
   *   عند الترجمة فلا يُحلّ الملفّ أصلاً.
   */
  it('★ الحزمةُ في `transpilePackages` — وإلّا لم تُترجَم أصلاً', () => {
    expect(cfg).toMatch(/transpilePackages: \['@aibot\/shared'\]/);
  });

  it('★ و`.js` في مصدرٍ TypeScript تُحلّ إلى `.ts`', () => {
    expect(cfg, 'بلا هذا يسقط البناء على أوّل استيرادِ قيمة').toMatch(/extensionAlias/);
    expect(cfg).toMatch(/'\.js': \['\.ts', '\.tsx', '\.js'\]/);
  });

  it('★ وبوّابةُ النشر تطابق **نسخةَ الواجهة** لا «تردّ 200» وحدها', () => {
    const dep = readFileSync(join(APP, '..', '..', '..', '..', 'deploy.sh'), 'utf8');
    expect(dep, 'بلا هذا يمرّ نشرٌ نصفُه جديدٌ ونصفُه قديم').toContain('/rev');
    expect(dep).toMatch(/الواجهة ليست على/);
    /* والمسارُ خارج `/api`: كلُّ ما تحته مُعادُ توجيهه إلى الـAPI. */
    expect(existsSync(join(APP, 'rev', 'route.ts'))).toBe(true);
    expect(readFileSync(join(APP, 'rev', 'route.ts'), 'utf8')).toContain('process.env.GIT_REV');
  });
});

/**
 * ★ **رابطٌ يحمل مرشّحاً لا تقرؤه شاشتُه الوجهة — عطلٌ لا يصرخ.**
 *
 *   ستّةُ روابطَ من الرئيسيّة والساحة تؤدّي إلى `/app/bot?tab=kb|tools`، وشاشةُ
 *   البوت لم تكن تقرأ `tab` إطلاقاً: تُفتح على «الشخصيّة» دائماً، ولا خطأَ في
 *   سجلٍّ ولا في بناء. ومن ضغط «افتح المعرفة» وهو يقرأ سؤالاً عجز عنه بوتُه
 *   يجد نفسَه في حقلٍ آخر — وتلك حلقةُ المنتج: «أخطأ ← أضِف ← جرّب ← انشر».
 *
 *   وعطلُ الطرفَين لا يُلتقط إلّا بحارسٍ يقرأ الطرفَين معاً.
 */
describe('كلُّ مرشّحٍ في رابطٍ داخليٍّ تقرؤه شاشتُه الوجهة', () => {
  const tsxFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory()
      ? tsxFiles(join(dir, e.name))
      : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []));

  /* التعليقاتُ تُنزع قبل المسح: رابطٌ مذكورٌ في شرحٍ ليس رابطاً في الشجرة،
     وماسحٌ لا يُعمي التعليقات يبلّغ عن شرحه هو. */
  const strip = (t: string) => t
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const links = tsxFiles(APP).flatMap((f) => [
    ...strip(readFileSync(f, 'utf8'))
      .matchAll(/href=[{]?["'`](\/[a-z0-9/_-]+)\?([a-zA-Z_]+)=([^"'`&]*)/g),
  ].map((m) => ({ file: f.slice(APP.length), route: m[1]!, param: m[2]!, value: m[3]! })));

  it('الماسحُ يجد الروابطَ فعلاً — فلا يمرّ الحارسُ بالفراغ', () => {
    expect(links.length, 'صفرُ روابطَ يعني ماسحاً معطوباً لا شجرةً نظيفة').toBeGreaterThanOrEqual(4);
    expect(links.some((l) => l.route === '/app/bot' && l.param === 'tab')).toBe(true);
  });

  it('★ والشاشةُ الوجهة تقرأ المرشّح باسمه', () => {
    const deaf = [...new Set(links.filter((l) => {
      const page = join(APP, l.route, 'page.tsx');
      if (!existsSync(page)) return true;
      return !readFileSync(page, 'utf8').includes(`get('${l.param}')`);
    }).map((l) => `${l.route}?${l.param}= (من ${l.file})`))];
    expect(deaf, 'رابطٌ يحمل مرشّحاً تُهمله شاشتُه: يُقرأ عطلاً ولا يظهر في سجلّ').toEqual([]);
  });

  it('★ وقيمةُ `?tab=` من تبويبات شاشة البوت نفسها — لا معرّفٌ مختلَق', () => {
    const bot = readFileSync(join(APP, 'app', 'bot', 'page.tsx'), 'utf8');
    const decl = /const TABS = \[([\s\S]*?)\] as const;/.exec(bot)?.[1] ?? '';
    const ids = [...decl.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]!);
    expect(ids, 'تغيّر شكلُ TABS — حدِّث هذا الحارس').toContain('persona');
    for (const l of links.filter((x) => x.param === 'tab')) {
      expect(ids, `«${l.value}» في ${l.file} ليس تبويباً في شاشة البوت`).toContain(l.value);
    }
  });
});

/**
 * ★★★ **خُطّافٌ بعد ارتدادٍ مبكّرٍ يُسقط الشاشة كلَّها — وقد وقع فعلاً.**
 *
 *   `apps/web/src/app/app/bot/page.tsx` عرّف `useState` بعد
 *   `if (bot.loading && !bot.data) return <Skeleton/>`: فالرسمُ الأوّل يرتدّ
 *   بعددٍ من الخُطّافات، والرسمُ التالي — لحظةَ وصول `/bot` — يمرّ فيستدعي
 *   خُطّافاً إضافيّاً، وReact ترفض ذلك رفضاً قاطعاً. فكانت شاشةُ البوت تسقط إلى
 *   حدّ الخطأ **لحظةَ وصول بياناتها**، أي دائماً — ولا `tsc` ولا البناءُ ولا
 *   أيُّ حارسٍ قائمٍ يقول ذلك.
 *
 * ⚠️ والمسحُ **مُقيَّدٌ بكلّ دالّةٍ على حدة**: `readUnits` في نفس الملفّ تبدأ
 *    بـ`if (!s) return 0;`، وماسحٌ يقرأ الملفَّ كتلةً واحدةً يعدّها ارتداداً
 *    مبكّراً فيبلّغ عن كلّ خُطّافٍ بعدها — ثمانيةُ إنذاراتٍ كاذبةٍ تُخرس الحارس.
 */
describe('لا خُطّافَ بعد ارتدادٍ مبكّرٍ في أيّ شاشة', () => {
  const HOOK = /^ {2}(?:const|let) .*=\s*use[A-Z]\w*\(/;
  const EFFECT = /^ {2}use(?:Effect|LayoutEffect|Memo|Callback|ImperativeHandle)\(/;
  /* ارتدادٌ على مستوى الدالّة: مسافتان بالضبط. أعمقُ من ذلك جسمُ حَلقةٍ أو
     دالّةٍ داخليّةٍ، ولا شأنَ لترتيب الخُطّافات به. */
  const EARLY = /^ {2}if \(.*\)\s*return\b/;
  const START = /^(?:export\s+)?(?:default\s+)?function\s+\w+|^(?:export\s+)?const\s+\w+\s*=\s*(?:function\b|\()/;

  /** يُعيد مواضعَ كلّ خُطّافٍ يتلو ارتداداً مبكّراً **في الدالّة نفسِها**. */
  const hooksAfterEarlyReturn = (src: string): number[] => {
    const lines = src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      .split(/\r?\n/);
    const starts = lines.flatMap((t, i) => (START.test(t) ? [i] : []));
    starts.push(lines.length);
    const out: number[] = [];
    for (let k = 0; k + 1 < starts.length; k += 1) {
      const seg = lines.slice(starts[k]!, starts[k + 1]!);
      const early = seg.findIndex((t) => EARLY.test(t));
      if (early < 0) continue;
      const hook = seg.slice(early + 1).findIndex((t) => HOOK.test(t) || EFFECT.test(t));
      if (hook >= 0) out.push(starts[k]! + early + hook + 2);
    }
    return out;
  };

  it('الماسحُ يجد العطلَ فعلاً — وهذه هي صورتُه التي وقعت', () => {
    const sample = [
      'export default function P() {',
      "  const a = useApi('/x');",
      '  if (a.loading && !a.data) return null;',
      '  const [b, setB] = useState(false);',
      '  return <div>{b}</div>;',
      '}',
    ].join('\n');
    expect(hooksAfterEarlyReturn(sample)).toEqual([4]);
  });

  it('ولا يُنذر كاذباً على ارتدادٍ في دالّةٍ **أخرى**', () => {
    const sample = [
      'function readUnits(s: string) {',
      '  if (!s) return 0;',
      '  return s.length;',
      '}',
      'export default function P() {',
      '  const [b, setB] = useState(false);',
      '  return <div>{b}</div>;',
      '}',
    ].join('\n');
    expect(hooksAfterEarlyReturn(sample)).toEqual([]);
  });

  const tsx = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory()
      ? tsx(join(dir, e.name))
      : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []));

  const files = [...tsx(APP), ...tsx(join(APP, '..', 'components'))];

  it('والماسحُ يقرأ الشجرةَ فعلاً', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('★ وكلُّ خُطّافٍ يسبق كلَّ ارتدادٍ مبكّرٍ في دالّته', () => {
    const bad = files.flatMap((f) => hooksAfterEarlyReturn(readFileSync(f, 'utf8'))
      .map((n) => `${f.slice(APP.length)}:${n}`));
    expect(bad, 'خُطّافٌ بعد ارتدادٍ مبكّر: React تُسقط الشاشة لحظةَ وصول بياناتها').toEqual([]);
  });
});
