import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★★★ حارسٌ ساكن على **تسلسل الردود** — وُلد من توازٍ قِيس لا استُنتج.
 *
 *   قفلُ BullMQ لكلّ **معرّفِ مهمّة** لا لكلّ محادثة، وتزامنُ `bot-reply`
 *   ثلاثة. وكان فرعُ «قيد التوليد» في `enqueueReply` يُضيف مهمّةً ثانيةً
 *   بمعرّفٍ مستقلّ (`conv-X-next`) تنطلق بعد ثانيتين، بينما نداءُ النموذج
 *   يستغرق من ثلاثٍ إلى عشرين. فمسبارٌ على طابورٍ مؤقّتٍ في حاوية العامل
 *   نفسِها أعطى:
 *
 *       start:conv-X       live=1
 *       start:conv-X-next  live=2      ← ردّان على المحادثة نفسها معاً
 *       MAX_CONCURRENT_ON_SAME_CONVERSATION=2
 *
 *   ونتيجتُه نداءان للنموذج يقرأ كلٌّ منهما تاريخاً لا يحوي ردَّ الآخر:
 *   ترحيبان متداخلان للزبون، وضِعفُ الكلفة للمالك، واحتمالُ `pendingAction`
 *   مختلفَين على الصفّ نفسه فينفّذ زرُّ «أكّد» غيرَ ما يظنّه الزبون.
 *
 * ⚠️ وحرّاسُ هذا الملفّ كلُّها **إيجابيّةُ الإثبات أوّلاً**: كلُّ فحصٍ سالبٍ
 *    يسبقه فحصٌ يُثبت أنّ المرساة موجودة. حارسٌ على سلسلةٍ اختفت يمرّ دائماً
 *    فيُطَمئن دائماً — وهي فئةُ العطل الأخطر في الحرّاس السكونيّة.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8').replace(/\r\n/g, '\n');
/** بلا تعليقات: هذا الملفّ والملفّاتُ التي يحرسها تشرح العطلَ بألفاظه. */
const bare = (p: string): string => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('قفلُ المحادثة — ردٌّ واحدٌ في وقتٍ واحد', () => {
  const enq = bare('apps/worker/src/enqueue.ts');
  const rep = bare('apps/worker/src/reply.ts');

  it('★ «قيد التوليد» يكتب علامةً ولا يُضيف مهمّة', () => {
    const at = enq.indexOf("action === 'mark-dirty'");
    expect(at, 'فرعُ العلامة غائب — حدّث هذا الحارس').toBeGreaterThan(0);
    const branch = enq.slice(at, enq.indexOf('return;', at));
    expect(branch, 'العلامةُ لا تُكتب').toContain('dirtyKey(conversationId)');
    /* 🔴 مهمّةٌ ثانيةٌ هنا = التوازي الذي قِيس. */
    expect(branch, 'مهمّةٌ ثانيةٌ تُضاف — عاد التوازي').not.toContain('queue.add');
  });

  it('★ لا معرّفَ مهمّةٍ مبنيٌّ على الزمن في أيّ موضع', () => {
    /* أوّلُ شكلٍ للعطل كان `${jobId}-next-${Date.now()}`: معرّفٌ فريدٌ لكلّ
       رسالة، فثلاثُ رسائلَ سريعةٍ تُنتج ثلاثَ مهامّ لا يجمعها شيء. */
    expect(enq).not.toMatch(/jobId[^\n]*Date\.now\(\)/);
    expect(enq).not.toMatch(/-next-\$\{/);
  });

  it('★ القفلُ يُؤخَذ قبل أيّ عمل، والإفراجُ في finally', () => {
    const at = rep.indexOf('export async function handleReply');
    expect(at).toBeGreaterThan(0);
    const body = rep.slice(at, rep.indexOf('async function replyLocked', at));
    expect(body, 'لا قفلَ يُؤخَذ').toContain('acquireConvLock(job.conversationId)');
    /* المحجوبُ يخرج فوراً: بلا هذا يعمل ردّان معاً. */
    expect(body).toMatch(/if \(!token\)[\s\S]{0,400}return;/);
    /* والإفراجُ في `finally`: مهمّةٌ تفشل وتُعاد لا بدّ أن تجد القفلَ حرّاً. */
    expect(body).toMatch(/finally \{[\s\S]*?releaseConvLock/);
    expect(body, 'العلامةُ لا تُجدوَل عند التحرّر').toContain('scheduleFollowUp');
    /* العملُ كلُّه داخل القفل لا بعده. */
    expect(body).toMatch(/try \{[\s\S]{0,200}replyLocked\(job\)/);
  });

  it('★ والذرّيّةُ في سكربتٍ واحد — لا «افحص ثمّ اكتب»', () => {
    /* عبارتان منفصلتان تسمحان بأن يُفرَج عن القفل بينهما، فلا يقرأ العلامةَ
       أحدٌ أبداً: رسالةُ زبونٍ تُهجَر بلا ردٍّ ولا أثر. */
    for (const name of ['ACQUIRE_OR_MARK', 'RELEASE_AND_TAKE']) {
      const m = enq.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\``));
      expect(m, `سكربت ${name} غائب`).toBeTruthy();
      const lua = m![1]!;
      // كلُّ سكربتٍ يمسّ **المفتاحَين** — وإلّا فليس ذرّيّاً على الاثنين
      expect(lua).toContain('KEYS[1]');
      expect(lua).toContain('KEYS[2]');
    }
    /* والمفاتيحُ تُمرَّر عدّاً صريحاً (2) لا استنتاجاً. */
    expect(enq).toMatch(/ACQUIRE_OR_MARK, 2,/);
    expect(enq).toMatch(/RELEASE_AND_TAKE, 2,/);
  });

  it('★ ولا يُفرَج إلّا عن قفلِنا — الرمزُ يُطابَق داخل السكربت', () => {
    const lua = enq.match(/const RELEASE_AND_TAKE = `([\s\S]*?)`/)![1]!;
    /* 🔴 `DEL` أعمى يُفرِج عن قفلِ غيرِنا إن انتهت مهلتُنا وأخذه سواه —
       فيعود التوازي من حيث أُغلق، وبلا أثرٍ يدلّ عليه. */
    expect(lua).toContain("GET', KEYS[1]) == ARGV[1]");
  });
});

describe('بوّابةُ «لا ردَّ بلا جديد»', () => {
  const rep = read('apps/worker/src/reply.ts');

  it('★ تُقارن بأحدثِ واردٍ رآه المخطِّط لا بآخرِ صادر', () => {
    expect(rep, 'العلامةُ لا تُقرأ').toContain('conv.botAnsweredAt');
    expect(rep).toMatch(/newestIn <= conv\.botAnsweredAt/);
    /* ⚠️ الفخُّ المعاكس: صفُّ الردّ يُحجَز **بعد** التوليد فتاريخُه أحدثُ من
       رسالةٍ وصلت في أثنائه. فبوّابةٌ تقارن بآخر صادرٍ تُسقط تلك الرسالةَ
       صامتةً ولا يُجاب عليها أبداً — أسوأُ من ردٍّ مكرّر. */
    const at = rep.indexOf('botAnsweredAt: newestIn');
    expect(at, 'العلامةُ لا تُقدَّم').toBeGreaterThan(0);
  });

  it('★ والعلامةُ تُقدَّم في معاملة التخطيط نفسِها', () => {
    /* تراجعُ المعاملة يُرجعها فتُعاد المحاولة؛ وكتابتُها في معاملةٍ مستقلّةٍ
       تُقدّمها على ردٍّ لم يُخطَّط بعد فتُهجَر الرسالة. */
    const plan = rep.slice(rep.indexOf('const plan = await withTenant'));
    const gate = plan.indexOf('botAnsweredAt: newestIn');
    const close = plan.indexOf('  });', gate);
    expect(gate).toBeGreaterThan(0);
    expect(close, 'الكتابةُ خارج معاملة التخطيط').toBeGreaterThan(gate);
  });

  it('★ والبوّابةُ قبل نداء النموذج لا بعده', () => {
    const gate = rep.indexOf('if (!newestIn) return null;');
    const model = rep.indexOf('await runAgent(');
    expect(gate).toBeGreaterThan(0);
    expect(model).toBeGreaterThan(0);
    /* نداءٌ يُحاسَب ثمّ بوّابةٌ تمنع الإرسال = دفعنا ولم نُرسل. */
    expect(gate, 'البوّابةُ بعد نداء النموذج — الكلفةُ دُفعت').toBeLessThan(model);
  });
});

describe('جدولةُ الردّ خارج معاملة المستأجر', () => {
  const inb = read('apps/worker/src/inbound.ts');

  it('★ لا نداءَ ريدِس داخل withTenant', () => {
    const open = inb.indexOf('await withTenant(db, job.tenantId');
    expect(open).toBeGreaterThan(0);
    const call = inb.indexOf('await enqueueReply(');
    expect(call, 'الجدولةُ اختفت — حدّث هذا الحارس').toBeGreaterThan(0);
    /* 🔴 نداءُ ريدِس داخل معاملةٍ يحتجز اتّصالاً من بِركةٍ عشريّة وتزامنُ
       `ch-inbound` عشرة: يسقط ريدِس فتتجمّد القاعدةُ في
       `idle in transaction` — وهو ما يقيسه `drill-redis.ts`.
       ⚠️ وأخطرُ منه: معاملةٌ تتراجع تترك مهمّةَ ردٍّ على رسالةٍ لا وجودَ لها. */
    expect(call, 'الجدولةُ قبل نهاية المعاملة').toBeGreaterThan(inb.indexOf('  });', open));
  });

  it('★ والمعرّفاتُ تُجمع داخلها ثمّ تُجدوَل مرّةً واحدةً لكلّ محادثة', () => {
    expect(inb).toContain('const toReply = new Set<string>();');
    expect(inb).toContain('toReply.add(conv.id)');
  });
});

describe('شبكةُ الأمان — محادثةٌ موسومةٌ بلا حارس', () => {
  const enq = bare('apps/worker/src/enqueue.ts');
  const main = read('apps/worker/src/main.ts');

  it('★ المسحُ مجدوَلٌ فعلاً ومنفَّذٌ فعلاً', () => {
    /* آليّةُ إنقاذٍ غيرُ مجدوَلةٍ ليست آليّةً: العلامةُ يقرؤها حاملُ القفل عند
       تحرّره، فإن مات بينهما — وكلُّ نشرةٍ تقتل العامل في منتصف مهمّة —
       بقيت رسالةُ الزبون بلا ردٍّ إلى الأبد بلا خطأٍ ولا سجلّ. */
    expect(main).toContain("name: 'stranded'");
    expect(main).toContain("job.name === 'stranded'");
    expect(main).toContain('sweepStrandedConversations()');
  });

  it('★ ولا يوقظ محادثةً لها حارس', () => {
    const at = enq.indexOf('export async function sweepStrandedConversations');
    expect(at).toBeGreaterThan(0);
    const body = enq.slice(at);
    expect(body, 'قفلٌ قائمٌ يعني ردّاً يعمل الآن — هو يقرأ العلامة').toContain('exists(lockKey(id))');
    expect(body, 'مهمّةٌ مؤجَّلةٌ تعني ردّاً سيعمل').toContain("st === 'delayed'");
    /* الجدولةُ قبل الحذف: الترتيبُ المعاكس يفقد الرسالةَ عند سقوطٍ بينهما. */
    const sched = body.indexOf('scheduleFollowUp(id, 0)');
    const del = body.indexOf('del(dirtyKey(id))');
    expect(sched).toBeGreaterThan(0);
    expect(del, 'الحذفُ قبل الجدولة — سقوطٌ بينهما يفقد الرسالة').toBeGreaterThan(sched);
  });
});
