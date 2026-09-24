import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ حرّاسُ الوردية — **قائمةٌ تصدُق، وحوارٌ لا يختلط، وبثٌّ لا يموت.**
 *
 * ثلاثةُ أعطالٍ في شاشةٍ واحدة، وكلُّها **صامتة**: لا خطأ ولا رسالة، والشاشةُ
 * تبدو سليمةً وهي تكذب. وهذا أخطر ما في شاشة عملٍ يوميّة — فالموظّف لا يشكّ
 * فيما يراه، والزبونُ هو من يدفع الثمن.
 */

const SRC = join(__dirname, '..', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
/** بلا تعليقات: كلُّ دعوى «لا يوجد» تكذب بشرحِ إصلاحها. */
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*/gm, ' ');

describe('بياناتُ مسارٍ لا تُعرض تحت عنوان مسارٍ آخر', () => {
  const h = code('lib/useApi.tsx');

  it('★ الجلبُ يمسح بياناتِ المسار السابق قبل أن يبدأ', () => {
    expect(h, 'كانت data تبقى حتّى يصل الجديد — وإن فشل الجلب فإلى الأبد')
      .toMatch(/if \(path !== shownFor\.current\)/);
    const at = h.indexOf('if (path !== shownFor.current)');
    expect(h.slice(at, at + 200)).toContain('setData(null)');
  });

  it('★ وحارسُ «الأحدث» رقمٌ متزايدٌ لا مرجعٌ مشترك', () => {
    /* `alive` كان مرجعاً واحداً: التنظيفُ يُطفئه ثمّ يُشعله الـeffect التالي
       فوراً، فتمرّ استجابةُ المحادثة السابقة وتكتب فوق الحاليّة **بعد** أن
       ظهرت. أي أنّ الحوار ينقلب إلى حوارٍ آخر أمام عينَي الموظّف. */
    expect(h, 'حارسُ alive يشهد زوراً').not.toMatch(/alive\.current/);
    expect(h).toMatch(/const mine = \+\+seq\.current/);
    expect(h).toMatch(/if \(seq\.current !== mine\) return/);
    expect(h, 'والتنظيفُ يُبطل الطائرَ بتقديم الرقم').toMatch(/return \(\) => \{ seq\.current\+\+; \};/);
  });

  it('ولا يُمسح عند تغيّر deps وحدها — إعادةُ جلبٍ للمورد نفسه ليست وميضاً', () => {
    expect(h).toMatch(/\}, \[load, path\]\);/);
  });
});

describe('الحوارُ يُرسَم لصاحبه وحده', () => {
  const p = code('app/app/inbox/page.tsx');

  it('★ الرسائلُ مشروطةٌ بمطابقة معرّف المحادثة', () => {
    expect(p).toMatch(/thread\.data\.conversationId === active/);
    expect(p, 'وmsgs من المطابِق لا من الخام').toMatch(/msgs = useMemo\(\(\) => \[\.\.\.older, \.\.\.\(fresh\?\.items/);
  });

  it('والنافذةُ كذلك — سقفُ الردّ الحرّ من محادثةٍ أخرى قرارٌ خاطئ', () => {
    expect(p).toMatch(/const win = fresh\?\.window;/);
  });

  it('★ والمُنشئ مغلقٌ حتّى يصل الحوار — لا ردَّ على ما لم يُقرأ', () => {
    expect(p).toMatch(/const threadReady = Boolean\(fresh\)/);
    expect(p).toMatch(/disabled=\{sending \|\| can\.readOnly \|\| !threadReady\}/);
    expect(p, 'والسببُ يُقال — زرٌّ معطَّلٌ بلا سببٍ يُقرأ عطلاً')
      .toContain('لم يصل الحوار بعد');
  });
});

describe('البثُّ لا يموت صامتاً', () => {
  const s = code('lib/socket.ts');

  it('★ التوكنُ دالّةٌ تُقرأ عند كلّ مصافحة لا كائنٌ يُلتقط مرّة', () => {
    /* عمرُ توكن الوصول ربعُ ساعة والاتّصالُ يعيش ساعات. فأوّلُ انقطاع —
       نشرةٌ أو نومُ جهاز — يعيد الوصلَ بتوكنٍ منتهٍ، فيرفضه `io.use`،
       و`socket.io-client` يتوقّف عن المحاولة **إلى الأبد**. */
    expect(s).toMatch(/auth: \(cb/);
    expect(s).toMatch(/cb\(\{ token: getToken\(\)/);
    expect(s, 'الكائنُ الثابت هو العطل نفسُه').not.toMatch(/auth: \{ token \}/);
  });

  it('★ ورفضُ المصافحة يُجدّد التوكن ثمّ يصل بيده — فالعميل قد توقّف', () => {
    expect(s).toMatch(/on\('connect_error'/);
    expect(s).toMatch(/unauthorized/i);
    expect(s).toMatch(/bootstrap\(\)/);
    expect(s).toMatch(/socket\?\.connect\(\)/);
  });

  it('ولا تجديدَين متزامنَين عند وابل الأخطاء', () => {
    expect(s).toMatch(/renewing \?\?=/);
  });

  it('وحالةُ الوصلة تُنشر للشاشة', () => {
    expect(s).toMatch(/export function useLink/);
    expect(s).toMatch(/useSyncExternalStore/);
  });

  it('★ والشاشةُ تقول إنّها منقطعة وتُعيد الجلب عند العودة', () => {
    const p = read('app/app/inbox/page.tsx');
    expect(p).toContain('الاتّصال اللحظيّ منقطع');
    expect(code('app/app/inbox/page.tsx')).toMatch(/useLink\(useCallback\(/);
    expect(code('app/app/inbox/page.tsx'), 'واستطلاعٌ احتياطيٌّ ما دامت منقطعة')
      .toMatch(/useFallbackPoll\(!linkUp, 60_000/);
  });
});

describe('«يحتاجك الآن» رقمٌ واحدٌ من القاعدة', () => {
  const p = code('app/app/inbox/page.tsx');

  it('★ الرقمُ البطوليّ من الخادم لا من الصفحة المحمَّلة', () => {
    expect(p).toMatch(/const attnTotal = list\.data\?\.attention\.count/);
    expect(p).toMatch(/<span className="num">\{attnTotal\}<\/span>/);
  });

  it('وما سقط خارج المعروض يُقال ويُفتح', () => {
    expect(p).toMatch(/const attnHidden = Math\.max\(0, attnTotal - attnRows\.length\)/);
    expect(read('app/app/inbox/page.tsx')).toContain('خارج المعروض — اعرِضهم');
  });
});

describe('التولّي له اسم', () => {
  const p = read('app/app/inbox/page.tsx');

  it('★ «تولّيتَها» للمتولّي وحده، ولغيره اسمُه', () => {
    expect(p).toContain('تولّاها ${c.assignedName');
    expect(code('app/app/inbox/page.tsx')).toMatch(/c\.assignedUserId === myId/);
  });

  it('★ وتحذيرُ التصادم يظهر حين يتولّاها غيرك', () => {
    expect(p).toContain('يتولّاها {conv.assignedName} الآن');
    expect(p, 'وحسمٌ لا إخفاء: زرٌّ يأخذها باسمك').toContain('أتابعها أنا');
  });

  it('و«حوّلها لزميل» تُعيّن اسماً لا وسماً', () => {
    const c = code('app/app/inbox/page.tsx');
    expect(c).toMatch(/roster\.data\?\.items/);
    expect(c).toMatch(/assignTo\(u\.id, u\.name\)/);
    expect(c).toMatch(/post\(`\/conversations\/\$\{active\}\/assign`/);
  });
});
