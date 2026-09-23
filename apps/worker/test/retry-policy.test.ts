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
export function attemptsWithoutBackoff(src: string, file: string): Offence[] {
  const lines = src.split(/\r?\n/);
  const out: Offence[] = [];
  lines.forEach((text, i) => {
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

  it('★ سياسةُ ردِّ البوت واحدةٌ في الموضعَين — مسارٌ واحدٌ بسلوكَين عطلٌ ينتظر ساعته', () => {
    const worker = read('apps/worker/src/enqueue.ts');
    const api = read('apps/api/src/queues.ts');
    for (const [name, src] of [['worker', worker], ['api', api]] as const) {
      expect(src, `${name}: تأخيرُ الدمج 2000ms`).toMatch(/delay:\s*(2000|delayMs)/);
      expect(src, `${name}: تراجعٌ أُسّيٌّ بخمس ثوانٍ`)
        .toMatch(/backoff:\s*\{\s*type:\s*'exponential',\s*delay:\s*5000\s*\}/);
      expect(src, `${name}: حدٌّ لمجموعة الفاشلة`).toMatch(/removeOnFail:\s*\d+/);
    }

    /* ★ العددُ يُقارَن بأخيه لا برقمٍ مثبَّتٍ هنا.
       كان الحارس يثبّت `attempts: 2` حرفيّاً، فلمّا رفعه تمرينُ الشبكة إلى
       أربعٍ **فشل الحارس على الإصلاح نفسه**. وغرضُه لم يكن العددَ قطّ بل
       **ألّا يتباعد الموضعان**: مسارٌ واحدٌ بسلوكَين هو العطل. فيبقى الغرض
       محروساً ويتحرّر الرقم — وحارسُ «كلّ attempts يجاوره backoff» أعلاه
       يمنع أن يعود العددُ بلا تراجع. */
    const n = (src: string) => /attempts:\s*(\d+)/.exec(src)?.[1];
    expect(n(worker), 'عددُ المحاولات معلَنٌ في العامل').toBeDefined();
    expect(n(api), 'عددُ المحاولات في الموضعَين واحد').toBe(n(worker));
    expect(Number(n(worker)), 'أكثرُ من محاولةٍ واحدة').toBeGreaterThan(1);
  });

  it('الماسح يمسك الشكل فعلاً — وإلّا فهو اختبارٌ يمرّ دائماً', () => {
    const bad = "await q.add('reply', d, {\n  jobId,\n  attempts: 2,\n  removeOnComplete: 500,\n});";
    expect(attemptsWithoutBackoff(bad, 'x.ts')).toHaveLength(1);

    const fixed = "await q.add('reply', d, {\n  jobId,\n  attempts: 2,\n"
      + "  backoff: { type: 'exponential', delay: 5000 },\n});";
    expect(attemptsWithoutBackoff(fixed, 'x.ts')).toEqual([]);

    // محاولةٌ واحدة لا تحتاج تراجعاً — ساحةُ الجرّب الجافّ مثلاً
    expect(attemptsWithoutBackoff('attempts: 1,', 'x.ts')).toEqual([]);
    // و`attemptsMade` قراءةٌ لا سياسة
    expect(attemptsWithoutBackoff('const n = job.attemptsMade;', 'x.ts')).toEqual([]);
  });
});
