import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  SUPPORT, supportMailto, planTalkLabel, planTalkSubject, planTalkBody,
} from '../src/lib/support';

/**
 * ★ **طريقٌ مسدودٌ عند السقف — وهو أسوأُ موضعٍ يقع فيه.**
 *
 *   العميل يبلغ سقف باقته، فيتوقّف بوته، فيصله إشعارٌ يفتح `/app/usage` —
 *   والفعلُ الأوّل (والوحيد) في رصيفها «نزِّل الجدول (CSV)». و«راسلنا» في ثلاث
 *   شاشاتٍ نصٌّ بلا رابط. **ورفعُ السقف قرارٌ بشريٌّ عندنا**: لا بوّابةَ دفعٍ ولا
 *   ترقيةً ذاتيّة، أي أنّ التواصل هو الفعل نفسُه لا زينةٌ تحته.
 *
 *   وثلاثةُ أبوابٍ مسدودةٍ أخرى في نفس السلسلة:
 *    · عدّادُ السقف في ذيل الشريط كان رابطاً إلى شاشةٍ تردّ ٤٠٣ لغير صاحب الفوترة،
 *    · و«أعِد المحاولة» في الإنبوكس على رسالةٍ رفضتها الحصّة لا تنجح أبداً،
 *    · و`overagePolicy` يصل من الخادم ولم يكن معلَناً، فلا تفرّق الشاشةُ «توقّف
 *      بوتك» من «الزائد يُفوتَر» — وهما فعلان مختلفان يُطلبان من العميل.
 */

const WEB = join(__dirname, '..', 'src');
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8');
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*/gm, ' ');
const jsx = (rel: string) => read(rel)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*/gm, ' ');

describe('الماسحُ يُعمي التعليقات — ومنها تعليقاتُ JSX', () => {
  it('★ وإلّا صدّق شرحاً مكتوباً بدل رابطٍ مكتوب', () => {
    const mark = ['dead', 'end', 'probe'].join('-');
    expect(read('app/app/page.tsx').length).toBeGreaterThan(0);
    /* dead-end-probe */
    expect(code('../test/support-dead-end.test.ts')).not.toContain(mark);
    expect(readFileSync(__filename, 'utf8')).toContain(mark);
  });
});

describe('قناةُ التواصل موضعٌ واحدٌ حقيقيّ', () => {
  it('★ البريدُ على النطاق نفسِه — والنمطُ قائمٌ في سياسة الخصوصيّة', () => {
    expect(SUPPORT.email).toMatch(/^[a-z]+@aibot\.masaros\.net$/);
    expect(read('app/(legal)/privacy/page.tsx'), 'النمطُ المرجع').toContain('@aibot.masaros.net');
  });

  it('★★ والرابطُ يحمل موضوعاً مُشفَّراً — وإلّا وصل بريدٌ بلا سياق', () => {
    const href = supportMailto('رفعُ سقف الباقة — 2026-09', 'المستهلَك 1500 من 1500 نافذة.');
    expect(href.startsWith(`mailto:${SUPPORT.email}?`)).toBe(true);
    expect(href, 'العربيّةُ والمسافاتُ تُشفَّر — وإلّا قُطع الموضوع عند أوّل فراغ')
      .not.toMatch(/[ ء-ي]/);
    expect(decodeURIComponent(href)).toContain('رفعُ سقف الباقة');
    expect(decodeURIComponent(href)).toContain('1500 من 1500');
  });

  it('★★ والنصُّ يتبدّل بسياسة التجاوز — «لرفع سقفك» لمن لا يقف بوتُه وعدٌ خاطئ', () => {
    expect(planTalkLabel('allow_bill')).toContain('يُفوتَر');
    expect(planTalkLabel('allow_bill')).not.toContain('لرفع سقف');
    for (const p of ['block', 'handoff_only', undefined]) {
      expect(planTalkLabel(p as string | undefined), String(p)).toContain('لرفع سقف');
    }
  });

  it('والدورةُ تدخل الموضوع متى عُرفت', () => {
    expect(planTalkSubject('2026-09')).toContain('2026-09');
    expect(planTalkSubject()).not.toContain('undefined');
    expect(planTalkBody(1490, 1500)).toContain('هذا الشهر');
    expect(planTalkBody(1490, 1500, '2026-09')).toContain('2026-09');
  });

  it('ورقمُ واتساب يبقى معدوماً حتّى يوجد رقمٌ حقيقيّ', () => {
    /* رابطٌ لرقمٍ مفترَض أسوأُ من غيابه: يَعِد بقناةٍ لا تردّ. */
    expect(SUPPORT.whatsapp).toBeNull();
  });
});

describe('لا «راسلنا» بلا رابطٍ في أيّ شاشة', () => {
  const tsx = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory()
      ? tsx(join(dir, e.name))
      : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []));

  const files = [...tsx(join(WEB, 'app')), ...tsx(join(WEB, 'components'))];

  it('الماسحُ يقرأ الشجرة', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('★★ وكلُّ ظهورٍ لـ«راسلنا» داخل `SupportLink`', () => {
    /* والنصوصُ المتبدّلةُ خرجت إلى `lib/support.ts` عمداً: لو بقيت في الشاشات
       لحملت كلمةَ «راسلنا» خارج أيّ عنصرٍ فسقط هذا الحارسُ على إصلاحه هو. */
    const bad = files.filter((f) => {
      const src = readFileSync(f, 'utf8')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/[^\n]*/gm, ' ')
        .replace(/<SupportLink[\s\S]*?<\/SupportLink>/g, ' ')
        /* ورابطُ بريدٍ صريحٌ مقبولٌ أيضاً: صفحةُ الخصوصيّة لها صندوقُها. */
        .replace(/<a href="mailto:[\s\S]*?<\/a>/g, ' ');
      return src.includes('راسلنا');
    }).map((f) => f.slice(WEB.length));
    expect(bad, '«راسلنا» بلا رابطٍ: نصيحةٌ لا تُنفَّذ').toEqual([]);
  });
});

describe('السقفُ يعطي مخرجاً لا ملفّاً', () => {
  const usage = jsx('app/app/usage/page.tsx');
  const home = jsx('app/app/page.tsx');

  it('★★ التواصلُ قبل التنزيل في الرصيف — والموضعُ هو الأولويّة', () => {
    const link = usage.indexOf('btn primary lg wide sc-link');
    const csv = usage.indexOf('نزِّل الجدول (CSV)');
    expect(link).toBeGreaterThan(0);
    expect(csv).toBeGreaterThan(0);
    expect(link, 'التنزيلُ ما زال الفعلَ الأوّل عند السقف').toBeLessThan(csv);
  });

  it('★ والتنزيلُ يتنازل عن ثقل «الأساس» عند السقف', () => {
    expect(usage).toMatch(/variant=\{planTalk \? 'quiet' : 'primary'\}/);
  });

  it('★★★ والشريطُ يحمل نفسَ الفعل — لا رصيفٌ يقول «راسلنا» وشريطٌ يسكت', () => {
    /* عند ٩٥٪ كان الرصيفُ يقول «راسلنا لرفع سقفك» والشريطُ فوقه يقول
       «استهلكتَ ٩٥٪» بلا أيّ فعل — وهو بعينه الانقلابُ الذي تعالجه النتيجة. */
    expect((usage.match(/<SupportLink/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(usage).toContain('const planTalk = atCap || pct >= 0.95');
    expect(home).toContain('const planTalk = atCap || pct >= 0.95');
  });

  it('★ والرئيسيّةُ تُقدّم الدواءَ على الإيصال', () => {
    const cure = home.indexOf('<SupportLink subject={planSubject}');
    const receipt = home.indexOf('شاهد الاستهلاك');
    expect(cure).toBeGreaterThan(0);
    expect(cure).toBeLessThan(receipt);
  });

  it('★ و`overagePolicy` صار معلَناً — يرسله الخادمُ منذ كُتب', () => {
    expect(code('app/app/usage/page.tsx')).toContain('overagePolicy: string;');
    expect(readFileSync(join(WEB, '..', '..', 'api', 'src', 'routes', 'reports.ts'), 'utf8'))
      .toContain('overagePolicy: policy');
  });
});

describe('البابان الآخران في نفس السلسلة', () => {
  it('★★ عدّادُ السقف لا يقود إلى ٤٠٣', () => {
    /* `/app/usage` محجوبةٌ بـ`needs: billing` و`GET /usage` يردّ ٤٠٣ لغيره،
       والعدّادُ في ذيل الشريط لم يكن محجوباً بشيء. */
    const layout = code('app/app/layout.tsx');
    expect(layout).toContain("import { useSession, useCan } from '@/lib/session';");
    expect(layout).toMatch(/capFooter = can\.billing/);
    expect(layout, 'والسهمُ يَعِد بوِجهةٍ — فيسقط معها').toContain('{can.billing && <span aria-hidden="true" className="cap-go">');
    expect(layout, 'والعدّادُ نفسُه يبقى مرئيّاً: هو ما يفسّر صمتَ البوت')
      .toMatch(/<div className="cap">\{capBody\}<\/div>/);
  });

  it('★★★ و«أعِد المحاولة» لا تُعرض على ما رفضته الحصّة', () => {
    /* الإرسالُ مرفوضٌ في طبقة الحصّة قبل أن يلمس ميتا، فكلُّ إعادةٍ تفشل بنفس
       السبب — والموظّف يعيد ويظنّ العطلَ في الشبكة. */
    const inbox = jsx('app/app/inbox/page.tsx');
    expect(inbox).toContain('QUOTA_BLOCKED_MSG');
    expect(inbox).toMatch(/!m\.errorMessage\?\.includes\(QUOTA_BLOCKED_MSG\)[\s\S]{0,600}أعِد المحاولة/);
    expect(inbox, 'ومن لا يملك الفوترة يُقال له من يرفعه').toContain('السقف يرفعه صاحبُ الفوترة');
  });

  it('★★ والنصُّ الذي تُفحَص عليه الرسالةُ مشتركٌ لا منسوخ', () => {
    const REPO = join(WEB, '..', '..', '..');
    const shared = readFileSync(join(REPO, 'packages', 'shared', 'src', 'quota.ts'), 'utf8');
    expect(shared).toContain('export const QUOTA_BLOCKED_MSG');
    for (const f of ['apps/worker/src/outbound.ts', 'apps/worker/src/reply.ts']) {
      const src = readFileSync(join(REPO, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
      expect(src, `${f}: نسخةٌ مكتوبةٌ بيدٍ من النصّ المشترك`)
        .not.toMatch(/['"]بلغ الحساب سقف نوافذ الباقة['"]/);
      expect(src).toContain('QUOTA_BLOCKED_MSG');
    }
  });
});
