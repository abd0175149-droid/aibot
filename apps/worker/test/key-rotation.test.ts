import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★★★ **تدويرُ المفتاح — وعدٌ في تعليقٍ بلا أداة، ثمّ أداةٌ بقائمةٍ ناقصة.**
 *
 *   `packages/crypto/src/index.ts` يَعِد منذ اليوم الأوّل بأنّ «تدوير المفتاح
 *   مهمّةُ خلفيّةٍ تعيد التشفير صفّاً صفّاً» — ولم توجد تلك المهمّة قطّ.
 *
 *   وأخطرُ من غيابها أن تُكتب **بقائمةِ أعمدةٍ ناقصة**: تُعلن «تمّ التدوير»
 *   بينما جدولٌ كاملٌ ما زال بالمفتاح القديم، فيُحذف القديمُ ويضيع ما فيه —
 *   ولا يظهر ذلك إلّا يومَ يُقرأ ذلك الصفّ، وقد لا يُقرأ لشهور.
 *
 *   ولهذا الحارسُ يقارن قائمةَ الأداة بـ**المخطَّط نفسِه**: كلُّ عمودٍ ينتهي
 *   بـ`_enc` يجب أن يكون فيها، وكلُّ زوجٍ فيها يجب أن يوجد في المخطَّط.
 *
 * ⚠️ وما يجعل هذا الصنفَ خطِراً بلا حدّ: الفكُّ الفاشل **لا يُرى**. في
 *    الويبهوك يُرسَل الردُّ 200 قبل الفكّ (وهو الصواب مع ميتا)، فيُبتلع
 *    الرميُ في سطرِ سجلٍّ وميتا لا تُعيد الإرسال — كلُّ رسالةٍ تضيع بلا أثر.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8');

describe('أداةُ التدوير موجودةٌ وتغطّي المخطَّط', () => {
  const TOOL = 'ops/rotate-master-key.ts';

  it('★ الأداةُ موجودةٌ أصلاً — والوعدُ كان في تعليقٍ وحده', () => {
    expect(existsSync(join(REPO, TOOL)), 'لا أداةَ تدوير — والتعليقُ يَعِد بها').toBe(true);
  });

  const tool = existsSync(join(REPO, TOOL)) ? read(TOOL) : '';

  /** كلُّ عمودٍ مشفَّرٍ في المخطَّط: `xEnc: text('x_enc')`. */
  function schemaEncColumns(): string[] {
    const dir = join(REPO, 'packages', 'db', 'src', 'schema');
    const out: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      const marks: Array<{ name: string; at: number }> = [];
      for (const m of src.matchAll(/pgTable\(\s*'([a-z0-9_]+)'/g)) {
        marks.push({ name: m[1]!, at: m.index! });
      }
      marks.forEach((mk, i) => {
        const end = i + 1 < marks.length ? marks[i + 1]!.at : src.length;
        for (const c of src.slice(mk.at, end).matchAll(/text\('([a-z0-9_]*_enc)'\)/g)) {
          out.push(`${mk.name}.${c[1]!}`);
        }
      });
    }
    return [...new Set(out)];
  }

  /** الأزواجُ كما كتبتها الأداة. */
  function toolPairs(): string[] {
    const at = tool.indexOf('const PAIRS');
    if (at < 0) return [];
    const block = tool.slice(at, tool.indexOf('];', at));
    return [...block.matchAll(/table:\s*'([a-z0-9_]+)',\s*col:\s*'([a-z0-9_]+)'/g)]
      .map((m) => `${m[1]!}.${m[2]!}`);
  }

  const inSchema = schemaEncColumns();
  const inTool = toolPairs();

  it('الماسحان يجدان شيئاً فعلاً (فحصٌ ذاتيّ)', () => {
    /* ماسحٌ يُرجع صفراً يجعل المقارنةَ تمرّ على فراغٍ فتُطَمئن دائماً. */
    expect(inSchema.length).toBeGreaterThanOrEqual(4);
    expect(inTool.length).toBeGreaterThanOrEqual(4);
    expect(inSchema).toContain('tenant_channels.token_enc');
  });

  it('★★★ كلُّ عمودٍ مشفَّرٍ في المخطَّط تغطّيه الأداة', () => {
    const missed = inSchema.filter((c) => !inTool.includes(c));
    expect(
      missed,
      'عمودٌ مشفَّرٌ خارج قائمة التدوير: ستُعلن الأداةُ «تمّ» ويبقى بالمفتاح '
      + 'القديم، فيُحذف القديمُ ويضيع ما فيه. أضِفه إلى PAIRS.',
    ).toEqual([]);
  });

  it('★ ولا عمودَ في الأداة لا وجودَ له في المخطَّط', () => {
    /* زوجٌ ميّتٌ يُنتج خطأَ SQL في منتصف تدويرٍ نصفُه تمّ — وهي أسوأُ لحظةٍ
       لاكتشاف خطأٍ مطبعيّ. (ونفسُ صنف عطل `channel_payload` في الاحتفاظ.) */
    const ghost = inTool.filter((c) => !inSchema.includes(c));
    expect(ghost, 'زوجٌ في الأداة بلا مثيلٍ في المخطَّط').toEqual([]);
  });
});

describe('★★ الأداةُ لا تُفسد ما تُدوّره', () => {
  const tool = read('ops/rotate-master-key.ts');

  it('★ جرّبٌ جافٌّ افتراضاً — والكتابةُ بطلبٍ صريح', () => {
    /* أداةٌ تكتب بمجرّد تشغيلها تُفسد قاعدةً بخطأِ طرفيّةٍ واحد. */
    expect(tool).toMatch(/APPLY\s*=\s*process\.env\.APPLY === '1'/);
    expect(tool).toContain('جرّبٌ جافّ');
  });

  it('★★★ والكتابةُ مشروطةٌ بالإصدار القديم لا بالمعرّف وحده', () => {
    /* 🔴 صفٌّ كُتب من الواجهة بين القراءة والكتابة يحمل الإصدارَ الهدف
       سلفاً. فكتابةٌ شرطُها `id` وحده تدوس قيمةً جديدةً بأخرى بُنيت من
       نسخةٍ بائتة — أي تُفسد سرّاً صحيحاً أثناء «إصلاحه». */
    const at = tool.indexOf('UPDATE ${sql.identifier(p.table)}');
    expect(at).toBeGreaterThan(0);
    const stmt = tool.slice(at, at + 400);
    expect(stmt).toContain('WHERE id = ${r.id}');
    expect(stmt, 'شرطُ الإصدار القديم غائب — سباقُ كتابةٍ يُفسد صفّاً').
      toContain('IS DISTINCT FROM ${target}');
  });

  it('★★ ولا تلمس صفّاً لا تملك مفتاحَه — تُعلنه وتقف', () => {
    /* محاولةُ فكِّ ما لا مفتاحَ له ترمي صفّاً صفّاً وتُخرج ضجيجاً، والخبرُ
       الحقيقيّ أنّ إصداراً كاملاً محجوب. */
    expect(tool).toContain('uncovered');
    expect(tool).toMatch(/exitCode = 1/);
  });

  it('★ ولا قيمةَ سرٍّ تُطبع — والاسمُ في الإرشاد مقصود', () => {
    /* المخرَجُ أعدادُ صفوفٍ وأرقامُ إصداراتٍ لا غير. و**ذكرُ الاسم** في رسالة
       الإرشاد («اضبط MASTER_KEY_V<n> أوّلاً») هو المطلوب: رسالةٌ تقول ما
       يُفعل. المحرَّمُ هو القيمة. */
    const bare = tool.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    /* لا طباعةَ لمتغيّرٍ يحمل سرّاً ولا لقراءةٍ من البيئة. */
    expect(bare).not.toMatch(/console\.(log|error)\([^)]*process\.env/);
    expect(bare).not.toMatch(/console\.(log|error)\([^)]*\b(r\.enc|plain|decrypt\()/);
    /* والسرُّ لا يمرّ في وسائط أمرٍ ولا يُكتب في ملفّ. */
    expect(bare).not.toMatch(/writeFileSync|execSync|spawn\(/);
  });

  it('★ والفكُّ وإعادةُ الختم خارج المعاملة — لا حسابَ داخل قفل', () => {
    /* معاملةٌ مفتوحةٌ أثناء حسابٍ محضٍ تحتجز اتّصالاً من بِركةٍ عشريّة بلا
       سبب — نفسُ قاعدة «لا نداءَ شبكةٍ داخل معاملة». */
    const readAt = tool.indexOf('قراءةُ دفعةٍ');
    const sealAt = tool.indexOf('seal(decrypt(');
    const writeAt = tool.indexOf('كتابةُ دفعةٍ');
    expect(sealAt).toBeGreaterThan(readAt);
    expect(sealAt, 'الختمُ داخل معاملة الكتابة').toBeLessThan(writeAt);
  });
});

describe('★★★ وتغطيةُ الإصدارات تُفحص دوريّاً — الصمتُ يصير خبراً', () => {
  const notify = read('apps/worker/src/notify.ts');
  const main = read('apps/worker/src/main.ts');
  const api = read('apps/api/src/main.ts');
  const health = read('apps/worker/src/health.ts');

  it('★ الفحصُ موجودٌ ويقرأ الإصدارات من القاعدة', () => {
    expect(notify).toContain('export async function checkKeyCoverage');
    expect(notify).toContain('configuredKeyVersions()');
  });

  it('★ ومجدوَلٌ ومنفَّذٌ فعلاً', () => {
    expect(main).toContain("name: 'keycover'");
    expect(main).toContain("job.name === 'keycover'");
    expect(main).toContain('await checkKeyCoverage()');
  });

  it('★★ وفحصُ الصحّة لم يعد يبتلع بلا سطر', () => {
    /* 🔴 `pollChannel(ch).catch(() => undefined)` — وأوّلُ ما يمرّ من هناك
       فكُّ `token_enc`. فمفتاحٌ خاطئٌ كان يُسقط كلَّ فحصٍ لكلّ قناةٍ بلا أثرٍ
       واحد، والشاشةُ تُظهر «موصولة» لأنّ الحالة لا تتبدّل. */
    expect(health).not.toMatch(/pollChannel\(ch\)\.catch\(\(\)\s*=>\s*undefined\)/);
    const at = health.indexOf('pollChannel(ch).catch(');
    expect(at).toBeGreaterThan(0);
    expect(health.slice(at, at + 400)).toContain('فشل فحصُ صحّة قناة');
  });

  it('★ والتغطيةُ ظاهرةٌ في الصحّة العميقة', () => {
    expect(api).toContain('keys: keyCoverage()');
    /* ولا قيمةَ سرّيّةٌ فيها: أرقامُ إصداراتٍ لا مفاتيح. */
    const at = api.indexOf('function keyCoverage');
    expect(api.slice(at, at + 260)).not.toMatch(/MASTER_KEY|process\.env/);
  });
});
