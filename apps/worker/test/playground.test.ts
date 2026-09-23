import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_TOOLS } from '@aibot/core';
import { WRITES } from '../src/playground.js';

/**
 * ★ حرّاسُ الساحة — **ساكنةٌ عمداً**، على نمط `db-context.test.ts`.
 *
 * والقيدُ الحاكم للساحة ليس حالةً تُجرَّب بل **شكلٌ في الكود**: جرّبٌ جافٌّ لا
 * يُرسل شيئاً إلى قناةٍ ولا يُنشئ محادثةً ولا يُفوتِر نافذة. واختبارُ تكاملٍ
 * يمسك الحالةَ التي جرّبها وحدها؛ وهذا يمسك الشكلَ كلَّه — بما فيه السطرُ
 * الذي يُضاف بعد ستّة أشهر.
 *
 * وثلاثةُ أعطالٍ يمنعها هذا الملفّ، ولا يُرى أيٌّ منها بالعين:
 *  ① **إرسالٌ من زرّ تجربة**: سطرُ `sendOutbound` واحدٌ يجعل الجرّب يكتب
 *    لزبونٍ حقيقيٍّ على واتساب. ولا يظهر إلّا على زبون.
 *  ② **كتابةٌ في بيانات عميلٍ من جرّب**: أداةٌ كاتبةٌ تُضاف إلى المنفِّذ الحيّ
 *    ولا تُمثَّل هنا فتوسم محادثةً حقيقيّةً «تحتاج تدخّلك» في تجربةٍ جافّة.
 *  ③ **تباعدُ المنفِّذَين**: أداةٌ تعمل حيّاً وتفشل في الجرّب (أو العكس) —
 *    فتُعلّم الساحةُ العميلَ درساً كاذباً عن بوته، وذاك أسوأ من غياب الساحة.
 */

/**
 * ★ **التعليقُ ليس كوداً** — والماسحُ يُعميه قبل أن يقرأ.
 *
 *   وهذا درسٌ مدفوعٌ مرّتين في هذه المدوّنة: أوّلُ تشغيلٍ لحارس الأنماط
 *   المضمَّنة أبلغ عن ثلاث «مخالفات» كلُّها في شرحٍ **يذكر** النمطَ الممنوع
 *   ليشرحه. وماسحٌ يعدّ التعليقات يُنتج إنذاراً كاذباً، وذاك أسرعُ طريقٍ
 *   إلى إطفاء الاختبار. وملفُّ الجرّب يشرح **لماذا لا `sendOutbound` فيه** —
 *   فالشرحُ نفسُه كان يُسقط الحارس.
 */
function code(src: string): string {
  const NL = String.fromCharCode(10);
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.split(NL).map((l) => ' '.repeat(l.length)).join(NL))
    // `://` في عنوانٍ ليس تعليقاً — والنقطتان قبله هي ما يفرّقه
    .replace(/(^|[^:])\/\/[^\r\n]*/g, (m: string, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

const DIR = join(__dirname, '..', 'src');
const PG = code(readFileSync(join(DIR, 'playground.ts'), 'utf8'));
const LIVE = code(readFileSync(join(DIR, 'tools.ts'), 'utf8'));
const MAIN = code(readFileSync(join(DIR, 'main.ts'), 'utf8'));

/** أسماءُ الأدوات التي يعالجها منفِّذٌ بـ`case '…'`. */
function cases(src: string): string[] {
  return [...src.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]!);
}

/** هل في هذه الكتلة كتابةٌ في القاعدة؟ */
const WRITE_CALL = /\b(?:tx|ctx\.tx)\.(?:update|insert|delete)\s*\(/;

/** يفصل جسمَ كلّ `case` في منفِّذٍ ويُرجع من يكتب منها. */
function writingCases(src: string): string[] {
  const parts = src.split(/case '/).slice(1);
  const out: string[] = [];
  for (const p of parts) {
    const name = p.slice(0, p.indexOf("'"));
    if (WRITE_CALL.test(p)) out.push(name);
  }
  return out;
}

describe('الساحة لا تُرسل شيئاً — والشكلُ هو الحدّ', () => {
  it('الماسحُ يُعمي التعليقَ ويقرأ الكود — وإلّا فهو حارسٌ يكذب', () => {
    expect(code('/* لا sendOutbound هنا */ const a = 1;')).not.toContain('sendOutbound');
    expect(code('// شرحٌ يذكر conversationWindows')).not.toContain('conversationWindows');
    expect(code("const x = 'https://a.dev'; // تعليق")).toContain('https://a.dev');
    expect(code("await sendOutbound(x); // إرسال")).toContain('sendOutbound');
  });

  it('★ لا إرسالَ ولا طابورَ صادرٍ ولا نافذةَ فوترةٍ في ملفّ الجرّب', () => {
    /* الفصلُ الذي يجعل الجرّب ممكناً قائمٌ في `reply.ts`: المعاملةُ تُخطّط
       والإرسالُ بعد الإيداع. فالساحةُ **تتوقّف عند الخطّة** — ولا تملك حتّى
       استيرادَ ما يُرسل. */
    const forbidden = [
      'sendOutbound', 'safeSend', 'enqueueOutbound', 'outbound.js',
      'conversationWindows', 'conversations', 'messages', 'contacts',
    ];
    const hits = forbidden.filter((f) => PG.includes(f));
    expect(
      hits,
      'الساحة جرّبٌ جافّ: لا إرسالَ إلى قناة، ولا محادثةً تُخلَق، ولا نافذةً تُفوتَر. '
      + 'وما لا يُستورَد لا يُنادى سهواً بعد ستّة أشهر.',
    ).toEqual([]);
  });

  it('★ صفُّ القياس موسومٌ بأنّه جرّب وبلا محادثة', () => {
    /* `source='playground'` هو ما يمنع خلطَ كلفة التجربة بكلفة ردٍّ حقيقيٍّ في
       كلّ تقرير. و`conversationId: null` هو ما يُثبت أنّه لا محادثةَ خُلقت. */
    expect(PG).toContain("source: 'playground'");
    expect(PG).toContain('conversationId: null');
  });

  it('سياقُ المستأجر مضبوطٌ ولا دورَ متجاوزاً — الجرّب ليس فعلاً عابراً', () => {
    expect(PG).toContain('withTenant(');
    expect(PG).not.toContain('withPlatform');
  });

  it('العاملُ مسجَّلٌ فعلاً — وإلّا فالمسار يُنتظر جوابٌ لا يأتي', () => {
    /* ميزةٌ مبنيّةٌ وميّتة: منتِجٌ بلا عامل يعني طلباً يُعلَّق حتّى المهلة.
       (وقع هذا في `kb-ingest`: عاملٌ مسجَّلٌ بلا منتِج — والعكسُ أسوأ.) */
    expect(MAIN).toContain("new Worker('bot-dry'");
    expect(MAIN).toContain('runPlayground');
  });

  it('محاولةٌ واحدةٌ لا إعادة — النداء يُحاسَب', () => {
    const api = code(readFileSync(join(DIR, '..', '..', 'api', 'src', 'queues.ts'), 'utf8'));
    expect(api).toContain("dry: 'bot-dry'");
    expect(api).toMatch(/attempts:\s*1/);
    // ولا نقطتين في اسم الطابور — BullMQ 5 يرفضه
    expect(api).not.toMatch(/'bot:dry'/);
  });
});

describe('الأدواتُ الكاتبة تُمثَّل ولا تُنفَّذ', () => {
  it('★ كلُّ أداةٍ تكتب في المنفِّذ الحيّ مذكورةٌ في WRITES', () => {
    const writes = writingCases(LIVE);
    expect(writes.length, 'الماسح لم يجد أداةً كاتبةً — فهو يمرّ على الفراغ').toBeGreaterThan(3);
    const missing = writes.filter((w) => !(w in WRITES));
    expect(
      missing,
      'أداةٌ تكتب في محادثةٍ أو بطاقةِ زبونٍ ولا تُمثَّل في الجرّب — '
      + 'فزرُّ تجربةٍ يُعدّل بياناتِ عميلٍ حقيقيّ. أضِفها إلى WRITES بنصّ أثرها.',
    ).toEqual([]);
  });

  it('ولا في WRITES اسمٌ بائتٌ لا يكتب — فالإفصاحُ الكاذب كالصمت', () => {
    const writes = new Set(writingCases(LIVE));
    const live = new Set(cases(LIVE));
    const stale = Object.keys(WRITES).filter((k) => live.has(k) && !writes.has(k));
    expect(stale, 'أداةٌ في WRITES صارت لا تكتب — أزِلها فتُنفَّذ في الجرّب كما في الحيّ.').toEqual([]);
  });

  it('كلُّ نصٍّ في WRITES يقول أثرَ الحيّ لا اسمَ حالة', () => {
    for (const [k, v] of Object.entries(WRITES)) {
      expect(v.length, `${k}: نصٌّ فارغ`).toBeGreaterThan(20);
      expect(v, `${k}: يجب أن يقول ما يحدث في الحيّ`).toContain('في الحيّ');
    }
  });
});

describe('المنفِّذان لا يتباعدان — الساحةُ تشهد على ما يعمل', () => {
  /** ما يعالجه منفِّذُ الجرّب: مُمثَّلاً (WRITES) أو بفرعٍ صريح. */
  const dryHandled = new Set([
    ...Object.keys(WRITES),
    ...[...PG.matchAll(/name === '([a-z_]+)'/g)].map((m) => m[1]!),
  ]);

  it('★ كلُّ أداةٍ يعالجها الحيُّ يعالجها الجرّب', () => {
    const missing = cases(LIVE).filter((c) => !dryHandled.has(c));
    expect(
      missing,
      'أداةٌ تعمل في الحيّ وتسقط في الجرّب إلى مسار أدوات العميل، فتعيد «أداةٌ غير معروفة» — '
      + 'والعميل يقرأ عطلاً ليس في بوته. أضِف فرعَها في apps/worker/src/playground.ts.',
    ).toEqual([]);
  });

  it('ولا فرعٌ في الجرّب لأداةٍ لا يعرفها الحيّ', () => {
    const live = new Set(cases(LIVE));
    const extra = [...dryHandled].filter((d) => !live.has(d));
    expect(extra, 'فرعٌ في الجرّب لأداةٍ لا وجودَ لها في المنفِّذ الحيّ — نتيجةٌ لا تقع أبداً.').toEqual([]);
  });

  it('★ فجوةٌ قائمةٌ تُسجَّل لا تُنسى: أداةٌ معلَنةٌ بلا تنفيذٍ في الاثنين', () => {
    /* `send_location` مُعلَنةٌ في `BUILTIN_TOOLS` وتُعرَض على النموذج حيث
       تدعم القناةُ الموقع — و**لا فرعَ لها في أيّ منفِّذ**، فتسقط إلى مسار
       أدوات العميل وتُعيد «أداةٌ غير معروفة». كشفَتها هذه المقارنة.
       والفجوةُ مسجَّلةٌ هنا كي لا تُنسى: من ينفّذها حيّاً يُسقط هذا السطر
       فيُنبّهه الاختبارُ إلى مرآتها في الجرّب. */
    const declared = BUILTIN_TOOLS.map((t) => t.key);
    const orphans = declared.filter((k) => !cases(LIVE).includes(k));
    expect(orphans).toEqual(['send_location']);
  });
});
