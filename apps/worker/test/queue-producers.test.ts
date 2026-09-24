import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ حارسٌ ساكن: **كلّ طابورٍ يُستهلَك يجب أن يُنتَج**.
 *
 * العطل الذي وُلد منه: طابور `notify-push` كان مسجَّلاً عاملاً في
 * `worker/main.ts` — يقرأ ويرسل ويحذف — **ولا سطرَ واحد في المستودع يدفع إليه
 * مهمّة**. وحوادثُ الحرج كانت تُنبَّه بنداءٍ مباشر يلتفّ عليه، فبقي الطابور
 * ميّتاً وبقي كلُّ ما ليس حادثةً حرجة (تحويلٌ لموظّف · عتبةُ سقف · تجربة)
 * بلا طريقٍ إلى الإشعار إطلاقاً. عاملٌ يستهلك طابوراً لا ينتجه أحد هو ميزةٌ
 * مبنيّةٌ وميّتة — ولا شيء في الشيفرة يقول ذلك.
 *
 * ولا يُمسَك هذا بمراجعةٍ: كلّ ملفٍّ سليمٌ وحده. يُمسَك بالربط بين ملفَّين.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

/** الملفّات التي تدفع إلى الطوابير — يُضاف إليها أيُّ منتِجٍ جديد. */
const PRODUCERS = [
  'apps/api/src/queues.ts',
  'apps/worker/src/enqueue.ts',
  'apps/worker/src/main.ts',
];

/** أسماءُ الطوابير المستهلَكة: `new Worker('name'`. */
export function consumedQueues(src: string): string[] {
  return [...src.matchAll(/new Worker\(\s*'([^']+)'/g)].map((m) => m[1]!);
}

/**
 * أسماءُ الطوابير المنتَجة. مصدران:
 *  • نصٌّ حرفيّ: `q('bot-reply')` أو `new Queue('health-poll'`.
 *  • عبر الثابت: `q(QUEUE.reply)` — فيُحلّ من خريطة `QUEUE` نفسها.
 * ولا يُشترط وجود `.add` في نفس السطر: `const queue = q(...)` ثمّ `queue.add`
 * شكلٌ قائمٌ في الشيفرة، ومحلّلٌ يشترط السطر الواحد يصير حارساً يمرّ دائماً.
 */
export function producedQueues(sources: string[], queueMap: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/(?:\bq|new Queue)\(\s*'([^']+)'/g)) out.add(m[1]!);
    for (const m of src.matchAll(/\bq\(\s*QUEUE\.(\w+)\s*\)/g)) {
      const name = queueMap[m[1]!];
      if (name) out.add(name);
    }
  }
  return out;
}

/** خريطة `QUEUE` كما هي مكتوبةٌ في `apps/api/src/queues.ts`. */
export function queueMap(src: string): Record<string, string> {
  const block = /export const QUEUE = \{([\s\S]*?)\} as const;/.exec(src)?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map((m) => [m[1]!, m[2]!]));
}

describe('كلّ طابورٍ يُستهلَك يجب أن يُنتَج', () => {
  const queuesSrc = read('apps/api/src/queues.ts');
  const map = queueMap(queuesSrc);
  const consumed = consumedQueues(read('apps/worker/src/main.ts'));
  const produced = producedQueues(PRODUCERS.map(read), map);

  it('خريطة QUEUE تُقرأ فعلاً — وإلّا فالحارس يقارن فراغاً بفراغ', () => {
    expect(Object.keys(map).length).toBeGreaterThan(5);
    expect(Object.values(map)).toContain('notify-push');
  });

  it('العمّال المسجَّلون يُقرأون فعلاً', () => {
    expect(consumed.length).toBeGreaterThan(5);
    expect(consumed).toContain('notify-push');
  });

  it('★ لا عاملَ بلا منتِج — طابورٌ يُستهلَك ولا يُدفَع إليه ميزةٌ ميّتة', () => {
    const orphans = consumed.filter((name) => !produced.has(name));
    expect(
      orphans,
      'هذه الطوابير لها عاملٌ يستهلكها ولا سطرَ في المستودع يدفع إليها مهمّة. '
      + 'إمّا أن يُكتب المنتِج، أو يُحذف العامل — وبقاؤهما هكذا ميزةٌ مبنيّةٌ وميّتة.',
    ).toEqual([]);
  });

  it('الماسح يمسك الشكل فعلاً — وإلّا فهو اختبارٌ يمرّ دائماً', () => {
    expect(consumedQueues("new Worker('x', f); new Worker( 'y' , g)")).toEqual(['x', 'y']);
    const m = { reply: 'bot-reply' };
    expect([...producedQueues(["q(QUEUE.reply)"], m)]).toEqual(['bot-reply']);
    expect([...producedQueues(["const t = q('bot-dry');"], m)]).toEqual(['bot-dry']);
    // طابورٌ مستهلَكٌ بلا منتِج يُرصَد
    expect(producedQueues(['لا شيء'], m).has('notify-push')).toBe(false);
  });
});

/**
 * ★ وحارسٌ ثانٍ من نفس العائلة: **جدولٌ يُقرأ يجب أن يُكتَب**.
 *
 * `push_subscriptions` كان يُقرأ ويُحدَّث ويُحذف منه في العامل، ولا مسارَ واحد
 * يُدرج فيه — فالجدولُ فارغٌ أبداً والقراءةُ تنجح دائماً بصفر صفوف. وهذا هو
 * الشكل الأخطر في هذا المشروع: **النجاح الفارغ**.
 */
describe('جدولٌ يُقرأ يجب أن يُكتَب', () => {
  it('push_subscriptions له مسارٌ يُدرج فيه', () => {
    const src = read('apps/api/src/routes/push.ts');
    expect(src).toMatch(/insert\(pushSubscriptions\)/);
    expect(src, 'وإلغاءُ الاشتراك مشروطٌ بالمستخدم لا بالعنوان وحده')
      .toMatch(/eq\(pushSubscriptions\.userId/);
  });

  it('المسار مركَّبٌ في الموجّه — ملفٌّ غير مركَّبٍ مسارٌ لا يُجيب', () => {
    expect(read('apps/api/src/main.ts')).toMatch(/registerPush\(api\)/);
  });

  it('الواجهة تسجّل العامل وتطلب الإذن وترسل الاشتراك', () => {
    const src = read('apps/web/src/lib/push.ts');
    expect(src).toMatch(/serviceWorker\.register\('\/sw\.js'\)/);
    expect(src).toMatch(/Notification\.requestPermission\(\)/);
    expect(src).toMatch(/pushManager\.subscribe/);
    expect(src).toMatch(/post\('\/push\/subscribe'/);
  });
});
