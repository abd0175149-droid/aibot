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
