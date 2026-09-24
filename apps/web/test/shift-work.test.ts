import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ حرّاسُ الوردية على الهاتف — **إحباطٌ يوميٌّ صامت**.
 *
 * ما هنا لا يُشتكى منه لأنّه لا يُرى على أنّه عطل: الموظّف يتعلّم ألّا يكتب
 * طويلاً، ويتعلّم أن يضغط مرّتين، ويتعلّم أن يُحدّث الصفحة. ثمّ يُقال إنّ
 * النظام «غير عمليّ» بلا أن يستطيع أحدٌ تسمية السبب.
 */

const SRC = join(__dirname, '..', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*/gm, ' ');

describe('المسوّدةُ لا تضيع', () => {
  const p = code('app/app/inbox/page.tsx');

  it('★ مسوّدةٌ لكلّ محادثة — لا واحدةٌ للشاشة تُمسح مع كلّ تنقّل', () => {
    expect(p).toMatch(/const drafts = useRef<Record<string, string>>/);
    expect(p, 'تُستعاد عند العودة لا تُمسح').toMatch(/setDraft\(active \? \(drafts\.current\[active\] \?\? ''\) : ''\)/);
  });

  it('وتُحفظ مسوّدةُ السابقة قبل تبديل المفتوحة', () => {
    expect(p).toMatch(/if \(before && before !== active\) drafts\.current\[before\] = draftRef\.current/);
  });

  it('★ وتُمسح عند **نجاح** الإرسال وحده — وفشلُه يُبقي الكلمات', () => {
    const at = p.indexOf('delete drafts.current[active]');
    expect(at, 'لا مسحَ بعد النجاح — فتبقى المسوّدةُ بعد إرسالها').toBeGreaterThan(0);
    const send = p.indexOf('async function send');
    const fail = p.indexOf('catch (err)', send);
    expect(at, 'المسحُ في مسار الفشل').toBeLessThan(fail);
  });

  it('وsessionStorage في try/catch — وضعُ التصفّح الخاصّ يرمي', () => {
    const n = (p.match(/sessionStorage/g) ?? []).length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(p).toMatch(/try \{[\s\S]{0,400}sessionStorage/);
  });

  it('★ والصفُّ يقول إنّ فيه مسوّدة — وإلّا نُسيت في محادثةٍ لا تُفتح', () => {
    expect(read('app/app/inbox/page.tsx')).toContain('مسوّدة');
  });
});

describe('القائمةُ لا ترتجف', () => {
  const h = code('lib/useApi.tsx');

  it('★ `loading` أوّلُ تحميلٍ وحده، و`refreshing` لما عداه', () => {
    expect(h).toMatch(/loading: loading && data === null/);
    expect(h).toMatch(/refreshing: loading && data !== null/);
  });

  it('والشاشةُ ترسم خيطاً لا هيكلاً عند إعادة الجلب', () => {
    const p = code('app/app/inbox/page.tsx');
    expect(p).toMatch(/list\.refreshing && <div className="ibx-refresh"/);
  });

  it('★ والخيطُ يحترم تفضيلَ تقليل الحركة', () => {
    const css = readFileSync(join(SRC, 'app', 'inbox.css'), 'utf8');
    const at = css.indexOf('.ibx-refresh');
    expect(at).toBeGreaterThan(0);
    expect(css.slice(at), 'حركةٌ لا تتوقّف لمن طلب إيقافها').toMatch(/prefers-reduced-motion[\s\S]{0,300}animation: none/);
  });

  it('ولا إعادةَ جلبٍ للحوار بعد الإرسال — البثُّ يأتي بالفقاعة', () => {
    const p = code('app/app/inbox/page.tsx');
    const send = p.indexOf('async function send');
    const end = p.indexOf('finally', send);
    expect(p.slice(send, end), 'هيكلٌ فوق الحوار بعد كلّ إرسال').not.toContain('thread.reload()');
  });
});

describe('«رسائل أقدم» تنتهي ولا تُكرّر', () => {
  const p = code('app/app/inbox/page.tsx');

  it('★ ضغطتان لا تُلحقان الصفحة مرّتين', () => {
    expect(p).toMatch(/if \(!first \|\| !active \|\| olderBusy \|\| olderDone\) return/);
    expect(p, 'وحالةُ الانشغال تظهر في الزرّ').toMatch(/busy=\{olderBusy\}/);
  });

  it('والدمجُ بالمعرّف يُسقط المكرّر أيّاً كان مصدرُه', () => {
    expect(p).toMatch(/new Map<string, Msg>\(\)/);
  });

  it('★ وحين تنفد الرسائل يُقال ذلك ويختفي الزرّ', () => {
    expect(p).toMatch(/if \(more\.items\.length < 50\) setOlderDone\(true\)/);
    expect(read('app/app/inbox/page.tsx')).toContain('بدايةُ المحادثة');
  });

  it('★ والتمريرُ يبقى في موضعه عند الإلحاق — سفاري بلا overflow-anchor', () => {
    expect(p).toMatch(/pendingAnchor/);
    expect(p, 'التصحيحُ قبل الرسم وإلّا رُئي وميضُ القفزة').toMatch(/useLayoutEffect\(\(\) => \{/);
    expect(p).toMatch(/el\.scrollTop = el\.scrollHeight - pendingAnchor\.current/);
  });

  it('وظهورُ الزرّ مشروطٌ بامتلاء **الصفحة الأولى** لا بطول القائمة', () => {
    expect(p).toMatch(/\(fresh\?\.items\.length \?\? 0\) >= 50/);
  });
});

describe('لوحةُ المفاتيح لا تغطّي حقلَ الكتابة', () => {
  it('★ `visualViewport` هو المقياسُ الوحيد الذي يعرف اللوحة', () => {
    const v = code('lib/viewport.ts');
    expect(v).toMatch(/window\.visualViewport/);
    expect(v).toMatch(/--vvh/);
    expect(v, 'وسفاري يُزيح الإطارَ المرئيّ فالارتفاعُ وحده لا يكفي').toMatch(/offsetTop/);
    expect(v, 'والمستمعان يُفكّان — وإلّا تسرّبا عبر التنقّل').toMatch(/removeEventListener/);
  });

  it('والإطارُ يقرؤها مع احتياطٍ — متصفّحٌ بلا الخاصّيّة يعمل كما كان', () => {
    const css = readFileSync(join(SRC, 'app', 'shell.css'), 'utf8');
    expect(css).toMatch(/height: var\(--vvh, 100dvh\)/);
    expect(css, 'و`dvh` تبقى قبلها فلا شاشةَ بلا ارتفاع').toMatch(/height: 100dvh;[\s\S]{0,900}var\(--vvh/);
  });

  it('★ والإطارُ ينادي الخطّاف فعلاً — ملفٌّ غير مُنادًى شيفرةٌ ميّتة', () => {
    expect(code('components/Shell.tsx')).toMatch(/useVisualViewport\(\)/);
  });
});
