import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * ★ حارسٌ ساكن على سياسة إعادة المحاولة — من عائلة `ops-scripts.test.ts`.
 *
 * العطل الذي وُلد منه، وكشفه تمرين المزوّد (`drill-provider.ts`):
 * `bot-reply` كان يُجدوَل بـ`attempts: 2` **وبلا `backoff`**. وBullMQ بلا
 * `backoff` يُعيد المحاولة **فوراً**: مزوّدٌ يعيد ٥٠٠ يُضرَب ضربتَين في أقلّ
 * من ثانية، فتُستهلك المحاولتان على نفس اللحظة الفاشلة وتموت المهمّة. أي أنّ
 * «إعادة المحاولة» كانت اسماً بلا مُسمّى: العطل العابر لم يُمنَح وقتاً ليمرّ.
 *
 * ولا يُمسَك هذا بمراجعةٍ: `attempts: 2` يبدو سليماً تماماً وحده. يُمسَك
 * بالشكل — كلّ `attempts` أكبر من واحدٍ يجب أن يجاوره `backoff`.
 *
 * وهنا يسكن لأنّ `vitest run` في هذه الحزمة هو ما يُشغّله `turbo run test`،
 * وحارسٌ في مجلّدٍ لا تمرّ عليه CI طمأنينةٌ كاذبة.
 */

const REPO = join(__dirname, '..', '..', '..');

/** ملفّات جدولة المهامّ — الموضعان اللذان يدفعان إلى الطوابير. */
const SOURCES = [
  'apps/worker/src/enqueue.ts',
  'apps/api/src/queues.ts',
];

/** `attempts: 2` وما فوق. و`attemptsMade` لا يُمسَك: النقطتان شرطٌ في النمط. */
const ATTEMPTS = /attempts:\s*([2-9]|[1-9]\d)/;
const BACKOFF = /backoff:\s*\{/;

export interface Offence { file: string; line: number; text: string }

/**
 * كلّ `attempts` بلا `backoff` في نافذةٍ من عشرة أسطر حوله.
 * ★ ونافذةٌ لا كائنٌ محلَّل: خيارات BullMQ تُكتب مفكوكةً (`...OPTS`) ومجمَّعةً
 *   وسطريّةً، ومحلّلٌ يفترض شكلاً واحداً يصير حارساً يمرّ دائماً.
 */
/**
 * ★ سطرُ تعليقٍ يذكر السياسة ليس سياسة.
 *   أطلق الماسحُ إنذاراً على تعليقٍ يشرح **لماذا رُفع** العدد («وكانت
 *   `attempts: 3` بتراجعٍ من ثانية…») — وحارسٌ يمنع شرحَ إصلاحه حارسٌ
 *   يُدفَع صاحبُه إلى حذف الشرح، فيُفقد أثمنُ ما في الملفّ.
 */
function isComment(text: string): boolean {
  return /^\s*(\/\/|\*|\/\*)/.test(text);
}

export function attemptsWithoutBackoff(src: string, file: string): Offence[] {
  const lines = src.split(/\r?\n/);
  const out: Offence[] = [];
  lines.forEach((text, i) => {
    if (isComment(text)) return;
    if (!ATTEMPTS.test(text)) return;
    const window = lines.slice(Math.max(0, i - 10), i + 11).join('\n');
    if (BACKOFF.test(window)) return;
    out.push({ file, line: i + 1, text: text.trim() });
  });
  return out;
}

function read(rel: string): string {
  return readFileSync(join(REPO, rel), 'utf8');
}

describe('إعادة المحاولة بلا تراجعٍ ليست إعادة محاولة', () => {
  it('كلّ attempts أكبر من واحد يجاوره backoff', () => {
    const offences: string[] = [];
    for (const rel of SOURCES) {
      for (const o of attemptsWithoutBackoff(read(rel), rel)) {
        offences.push(`${o.file}:${o.line} → ${o.text}`);
      }
    }
    expect(
      offences,
      'BullMQ بلا `backoff` يُعيد المحاولة فوراً، فتُستهلك المحاولات على نفس '
      + 'اللحظة الفاشلة ويموت العطل العابر بلا أن يُمنَح وقتاً. أضِف '
      + '`backoff: { type: "exponential", delay: … }`.',
    ).toEqual([]);
  });

  /**
   * ★ ثمّ تغيّر الغرضُ لأنّ العطلَ نفسه زال.
   *
   *   كان هنا حارسُ **تطابق**: نسختان من `enqueueReply` — واحدةٌ في العامل
   *   وواحدةٌ في الـAPI — والحارسُ يمنع تباعدهما. وكان يشهد زوراً: النسختان
   *   تتطابقان في الأرقام (`delay` · `backoff` · `attempts`) وتختلفان في
   *   **القرار**، فنسخةُ الـAPI تحذف المهمّة في حالتَي `delayed`/`waiting`
   *   وحدهما فتبقى المكتملةُ حاجزةً للمعرّف — «ردٌّ واحدٌ لكلّ محادثةٍ في
   *   عمرها كلّه». أي أنّ الحارس كان يقارن ما لا يُصلح ويُغفل ما يكسر.
   *
   *   فحُذفت نسخةُ الـAPI (ولا مستدعيَ لها كان أصلاً)، وصار الحارسُ حارسَ
   *   **وحدانيّة**: منتِجُ ردِّ البوت واحدٌ في المستودع كلِّه، ومعه قراره.
   */
  it('★ منتِجُ ردِّ البوت واحدٌ — ونسختان لقرارٍ واحد عطلٌ ينتظر ساعته', () => {
    const worker = read('apps/worker/src/enqueue.ts');
    expect(worker, 'تأخيرُ الدمج 2000ms').toMatch(/delay:\s*(2000|delayMs)/);
    expect(worker, 'تراجعٌ أُسّيٌّ بخمس ثوانٍ')
      .toMatch(/backoff:\s*\{\s*type:\s*'exponential',\s*delay:\s*5000\s*\}/);
    expect(worker, 'حدٌّ لمجموعة الفاشلة').toMatch(/removeOnFail:\s*\d+/);

    const attempts = /attempts:\s*(\d+)/.exec(worker.slice(worker.search(/REPLY_OPTS\s*=/)))?.[1];
    expect(attempts, 'عددُ المحاولات معلَنٌ في كتلة العامل').toBeDefined();
    expect(Number(attempts), 'أكثرُ من محاولةٍ واحدة').toBeGreaterThan(1);

    /* ولا نسخةَ ثانية: القرارُ (`decideEnqueue`) يعيش في موضعٍ واحد. */
    for (const rel of SOURCES) {
      if (rel === 'apps/worker/src/enqueue.ts') continue;
      expect(read(rel), `${rel}: نسخةٌ ثانية من منتِج الردّ`)
        .not.toMatch(/export async function enqueueReply/);
    }
    expect(worker).toMatch(/decideEnqueue/);
  });

  it('الماسح يمسك الشكل فعلاً — وإلّا فهو اختبارٌ يمرّ دائماً', () => {
    const bad = "await q.add('reply', d, {\n  jobId,\n  attempts: 2,\n  removeOnComplete: 500,\n});";
    expect(attemptsWithoutBackoff(bad, 'x.ts')).toHaveLength(1);

    // وتعليقٌ يذكر عدداً قديماً لا يُعدّ مخالفة — وإلّا مُنع شرحُ الإصلاح
    expect(attemptsWithoutBackoff(' * وكانت `attempts: 3` بتراجعٍ من ثانية', 'x.ts')).toEqual([]);
    expect(attemptsWithoutBackoff('// attempts: 9 سابقاً', 'x.ts')).toEqual([]);

    const fixed = "await q.add('reply', d, {\n  jobId,\n  attempts: 2,\n"
      + "  backoff: { type: 'exponential', delay: 5000 },\n});";
    expect(attemptsWithoutBackoff(fixed, 'x.ts')).toEqual([]);

    // محاولةٌ واحدة لا تحتاج تراجعاً — ساحةُ الجرّب الجافّ مثلاً
    expect(attemptsWithoutBackoff('attempts: 1,', 'x.ts')).toEqual([]);
    // و`attemptsMade` قراءةٌ لا سياسة
    expect(attemptsWithoutBackoff('const n = job.attemptsMade;', 'x.ts')).toEqual([]);
  });
});
