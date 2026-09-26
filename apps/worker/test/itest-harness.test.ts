import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★★★ **حارسٌ على حزام التكامل نفسِه.**
 *
 *   الحزامُ هو الجوابُ على البند ٨١: «١٣٨ اختباراً كانت خضراء بينما البوت لا
 *   يردّ». وقد أثبت نفسَه يومَ كُتب — أُعيد عطلُ اليوم (تاريخٌ خامٌّ في قالب
 *   `sql`) فسقط الدورُ الثاني بالخطأ نفسِه ورمزِ خروجٍ 1، بينما ١١١٤ اختباراً
 *   ساكناً بقيت خضراء.
 *
 *   لكنّ حزاماً يُعطَّل بسطرٍ واحد: لاحقةٌ تتبدّل فيجمعه النشرُ ويتعلّق، أو
 *   مجلَّدٌ مسمّىً يجعل الشوطَ يبدأ متّسخاً فيمرّ على بقايا سابقه، أو
 *   `down()` لا يُنادى فتتراكم الحاويات. وهذا يحرس تلك الأمور.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8');
const DIR = join(REPO, 'test-integration');

describe('حزامُ التكامل قائمٌ ومعزول', () => {
  it('★ المجلَّد موجودٌ وفيه اختبارٌ واحدٌ على الأقلّ', () => {
    expect(existsSync(DIR), 'لا حزامَ تكامل — والبند ٨١ مفتوح').toBe(true);
    const files = readdirSync(DIR);
    expect(files.filter((f) => f.endsWith('.itest.ts')).length).toBeGreaterThanOrEqual(1);
  });

  it('★★★ ولا ملفَّ بلاحقة `.test.ts` فيه — وإلّا جمعَه النشر', () => {
    /* 🔴 `npx vitest run` — وهو ما تُشغّله بوّابةُ النشر و CI — يجمع
       `**\/*.test.ts` بالافتراض (لا إعدادَ vitest في الجذر). فملفٌّ بهذه
       اللاحقة هنا يجعل البوّابةَ ترفع حاويات دوكر على خادمٍ حِملُه سبعة،
       فتتعلّق أو تفشل على شيءٍ لا علاقةَ له بالشيفرة المدفوعة. */
    const stray = readdirSync(DIR).filter((f) => f.endsWith('.test.ts'));
    expect(stray, 'ملفٌّ بلاحقةٍ عاديّةٍ في حزام التكامل').toEqual([]);
  });

  it('★ ولا `vitest.config.ts` في الجذر — فما تجمعه البوّابةُ لا يتبدّل', () => {
    /* إعدادٌ يُكتشَف تلقائيّاً يُغيّر ما يجمعه `npx vitest run` من حيث لا
       نقصد. والإعدادُ المنفصل يُمرَّر باسمه صراحةً. */
    expect(existsSync(join(REPO, 'vitest.config.ts'))).toBe(false);
    expect(existsSync(join(REPO, 'vitest.workspace.ts'))).toBe(false);
    expect(existsSync(join(REPO, 'vitest.itest.config.ts'))).toBe(true);
  });

  it('★ والإعدادُ يجمع `.itest.ts` وحدها، بلا توازٍ بين الملفّات', () => {
    const cfg = read('vitest.itest.config.ts');
    expect(cfg).toContain("include: ['test-integration/**/*.itest.ts']");
    /* الحزامُ يرفع حاوياتٍ بأسماءٍ ثابتة (`aibot-itest`)، فشوطان متوازيان
       يتنازعانها ويفشلان على تنازعٍ لا على عطل. */
    expect(cfg).toContain('fileParallelism: false');
  });
});

describe('★★ البنيةُ تُرمى — لا تتراكم ولا تُورَّث', () => {
  const compose = read('docker-compose.itest.yml');
  const harness = read('test-integration/harness.ts');

  it('★★★ `tmpfs` لا مجلَّدٌ مسمّى — وإلّا بدأ الشوطُ متّسخاً', () => {
    /* 🔴 مجلَّدٌ يبقى يجعل الشوطَ التالي يجد صفوفَ سابقه، فيمرّ اختبارٌ
       لأنّ غيرَه ترك أثراً — وهو أسوأُ من فشلٍ صريح. */
    expect(compose).toContain('tmpfs:');
    expect(compose, 'مجلَّدٌ مسمّىً يبقى بين الأشواط').not.toMatch(/^volumes:/m);
  });

  it('★ ومنفذٌ عشوائيٌّ على 127.0.0.1 لا ثابت', () => {
    /* منفذٌ ثابتٌ يصطدم بالقاعدة الحيّة على نفس الخادم، ويربط الاختبارَ
       بها بلا أن يقصد أحد. */
    expect(compose).toContain('127.0.0.1:0:5432');
    expect(compose).toContain('127.0.0.1:0:6379');
    expect(harness, 'المنفذُ يُفترض لا يُقرأ').toContain("dc(['port'");
  });

  it('★★ وريدِسُ مستقلٌّ لا قاعدةٌ منطقيّةٌ في الحيّ', () => {
    /* مهامُّ الاختبار تدخل طوابيرَ بنفس الأسماء (`bot-reply`…)، فلو لامست
       ريدِس الحيّ لالتقطها عاملُ الإنتاج وردّ على «زبونٍ» لا وجودَ له. */
    expect(compose).toContain('redis:7-alpine');
    expect(harness).toContain('redisUrl');
  });

  it('★★★ و`down()` يُنادى من `finally` — وإلّا تراكمت الحاويات', () => {
    const t = read('test-integration/critical-path.itest.ts');
    expect(t).toContain('afterAll(');
    const at = t.indexOf('afterAll(');
    expect(t.slice(at, at + 160)).toContain('down(env)');
    /* والهدمُ قبل الرفع أيضاً: شوطٌ مات في منتصفه يترك حاوياتٍ تعمل. */
    expect(harness).toMatch(/dc\(\['down'[\s\S]{0,200}dc\(\['up'/);
  });

  it('★ ولا شبكةَ جديدة — مجمَّعُ عناوين الخادم نفد فعلاً', () => {
    /* «all predefined address pools have been fully subnetted» على خادمٍ
       مشتركٍ عليه ٣٣ شبكة. وتقليمُ شبكات مشاريعَ أخرى ليس قرارَنا. */
    expect(compose).toContain('network_mode: bridge');
  });
});

describe('★★ ومصادرُ الحقيقة هي الحقيقيّة', () => {
  const harness = read('test-integration/harness.ts');
  const fakes = read('test-integration/fakes.ts');

  it('★ الترحيلاتُ تُطبَّق من مجلَّد الترحيلات نفسِه وبالترتيب', () => {
    /* حزامٌ يُرحّل بترتيبٍ آخر — أو بمخطَّطٍ مكتوبٍ فيه — يشهد على قاعدةٍ
       غيرِ التي تعمل. */
    expect(harness).toContain("'packages', 'db', 'migrations'");
    expect(harness).toContain('.sort()');
  });

  it('★★ وكلمةُ دور التطبيق تُضبط — كما يفعل النشر خارج الترحيلات', () => {
    /* `deploy.sh` يضبطها بعد الترحيل؛ وحزامٌ يتخطّاها يحصل على قاعدةٍ لا
       يستطيع التطبيقُ الدخولَ إليها، فيفشل على تهيئةٍ لا على عطل. */
    expect(harness).toContain('ALTER ROLE aibot_app LOGIN PASSWORD');
  });

  it('★★★ والمزيَّفان يُبدَّلان بمتغيّرَين قائمَين في الشيفرة', () => {
    /* لا حقنَ جديدٌ في الإنتاج من أجل اختبار: `GRAPH_BASE` و
       `GOOGLE_AI_BASE` موجودان أصلاً في `whatsapp.ts` و`google.ts`. */
    expect(harness).toContain('process.env.GRAPH_BASE');
    expect(harness).toContain('process.env.GOOGLE_AI_BASE');
  });

  it('★★ وشكلُ المزيَّف يُطابق ما يقرؤه المُحلِّل', () => {
    /* مزيَّفٌ بشكلٍ مخترعٍ يشهد على مسارٍ غير الذي يعمل:
       · `messages[0].id` وإلّا رمى `NO_MESSAGE_ID`
       · و`usageMetadata` بعدَّادَين غيرِ صفريَّين وإلّا مرّ على كلفةٍ كاذبة */
    expect(fakes).toContain('messages: [{ id:');
    expect(fakes).toContain('promptTokenCount');
    expect(fakes).toMatch(/promptTokenCount:\s*[1-9]/);
    expect(fakes).toContain('candidates: [{');
  });
});
