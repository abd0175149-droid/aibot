import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * ★★★ **إعدادٌ يُقرأ ولا يُمرَّر أسوأ من إعدادٍ غائب.**
 *
 *   المبدأُ مكتوبٌ في `apps/web/test/security-headers.test.ts` منذ دفعةٍ
 *   سابقة، ومُطبَّقٌ هناك على `TRUST_PROXY` وحده. وهذا الملفّ يُعمّمه — لأنّ
 *   بندَين اثنَين أفلتا منه، وأحدُهما كان يُفسد بياناتِ العملاء:
 *
 *   ① **`CHAT_MODEL`**: يُقرأ في `packages/ai/src/index.ts`، ومكتوبٌ في
 *      `.env.example`، **وغائبٌ عن `docker-compose.yml`** — بينما أخوه
 *      `EMBED_MODEL` يُمرَّر. فمن يبدّل النموذجَ في `.env` يحصل على النموذج
 *      المخبوز في الشيفرة بصمت، ويظنّ أنّه بدّله.
 *
 *   ② **`MASTER_KEY_V<n>`**: يمسحها `packages/crypto` لفكِّ ما شُفّر بمفتاحٍ
 *      سابقٍ أثناء التدوير، ولم تكن تُمرَّر. فمن يتّبع الإجراءَ الموثَّق يجد
 *      كلَّ سرٍّ قديمٍ يرمي عند الفكّ **و`.env` عنده صحيحٌ تماماً** — أي إجراءُ
 *      تدويرٍ يُفسد كلَّ توكنِ قناةٍ وكلَّ سرِّ أداةٍ في المنصّة.
 *
 * ⚠️ والسببُ البنيويّ واحد: **لا `env_file:` في `docker-compose.yml`
 *    إطلاقاً.** فما لا يُذكر صراحةً في `environment:` لا يصل الحاويةَ مهما
 *    كان في `.env`. وهذا اختيارٌ سليم (لا يُسرّب الملفَّ كلَّه إلى كلّ خدمة)
 *    لكنّه يجعل كلَّ متغيّرٍ جديدٍ دَيناً يجب تسديدُه في موضعَين.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8');
const COMPOSE = read('docker-compose.yml');
const ENV_EXAMPLE = read('.env.example');

describe('لا `env_file` — فكلُّ متغيّرٍ يُذكر صراحةً', () => {
  it('★ الافتراضُ الذي يقوم عليه هذا الملفّ كلُّه', () => {
    /* لو أُضيف `env_file:` يوماً لبطل نصفُ هذه الحرّاس — ولوجب حذفُها لا
       إبقاؤها خضراءَ على افتراضٍ لم يعد صحيحاً. */
    expect(COMPOSE, 'أُضيف env_file — راجع هذا الملفّ كلَّه').not.toMatch(/^\s*env_file:/m);
  });
});

/** كلُّ `process.env.X` في الشيفرة المصدريّة (لا السكربتات ولا الاختبارات). */
function readVars(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const roots = ['apps/api/src', 'apps/worker/src', 'packages'];
  const walk = (dir: string): string[] => {
    const acc: string[] = [];
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) {
        if (e === 'node_modules' || e === 'test' || e === 'scripts' || e === 'dist') continue;
        acc.push(...walk(full));
      } else if (e.endsWith('.ts') && !e.endsWith('.test.ts')) acc.push(full);
    }
    return acc;
  };
  for (const r of roots) {
    for (const f of walk(join(REPO, r))) {
      const rel = relative(REPO, f).replace(/\\/g, '/');
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        const k = m[1]!;
        if (!out.has(k)) out.set(k, []);
        if (!out.get(k)!.includes(rel)) out.get(k)!.push(rel);
      }
    }
  }
  return out;
}

/**
 * ما لا يُمرَّر عمداً ولا يُلام على غيابه — **وكلُّ سطرٍ هنا سببٌ مكتوب.**
 * والقائمةُ لا تُوسَّع لتمرير الحارس: توسيعُها هو الطريقةُ التي تموت بها.
 */
const NOT_IN_COMPOSE: Record<string, string> = {
  NODE_ENV: 'تضبطه صورةُ التشغيل نفسُها (Dockerfile) لا التشغيل',
  GIT_REV: 'وسيطُ **بناء** يُخبز في الصورة — وتمريرُه وقتَ التشغيل يجعل /api/health تكذب بعد التراجع',
  PORT: 'ثابتٌ داخل الشبكة؛ النشرُ يعرض API_PORT على المضيف وحده',
  API_PORT: 'يُستعمل في كتلة ports لا في environment',
  LOG_LEVEL: 'زينةُ تشخيصٍ لا تُغيّر سلوكاً — وغيابُها لا يُنتج عطلاً صامتاً',
  LOG_COMPLETED: 'مفتاحُ ضجيجٍ تشخيصيّ يُشغَّل يدويّاً عند الحاجة',
  AI_FAULT_STATUS: 'حقنُ أعطالٍ للتمارين وحدها — لا يُمرَّر إلى الإنتاج عمداً',
  GOOGLE_AI_BASE: 'نقطةُ المزوّد الافتراضيّة صحيحة؛ يُبدَّل في التمارين وحدها',
  GRAPH_BASE: 'نقطةُ ميتا الافتراضيّة صحيحة؛ يُبدَّل في التمارين وحدها',
  COMPOSE_DIR: 'للسكربتات على المضيف لا داخل الحاوية',
  HEALTH_URL: 'للسكربتات على المضيف لا داخل الحاوية',
  TENANT_SLUG: 'وسيطُ تمرينٍ يُمرَّر في سطر الأمر',
  MEDIA_ROOT: 'مسارٌ مربوطٌ بنقطة التجميع في compose (media_data:/app/media)؛ '
    + 'تغييرُه بلا تغيير المجلَّد المُجمَّع يُنتج مجلَّداً فارغاً — فليس مقبضَ بيئة',
};

describe('★★ كلُّ متغيّرٍ يُقرأ في الشيفرة يصل الحاويةَ فعلاً', () => {
  const vars = readVars();

  it('الماسحُ يجد متغيّراتٍ فعلاً (فحصٌ ذاتيّ)', () => {
    /* ماسحٌ يُرجع صفراً يجعل كلَّ ما بعده يمرّ على لا شيء — وهي فئةُ العطل
       الأخطر في الحرّاس السكونيّة: تمرّ دائماً فتُطَمئن دائماً. */
    expect(vars.size).toBeGreaterThan(12);
    expect([...vars.keys()]).toContain('MASTER_KEY');
    expect([...vars.keys()]).toContain('CHAT_MODEL');
  });

  it('★ لا متغيّرَ يُقرأ ولا يُمرَّر — إلّا بسببٍ مكتوب', () => {
    const missing: string[] = [];
    for (const [name, files] of vars) {
      if (name in NOT_IN_COMPOSE) continue;
      // يكفي ذكرُه في مفتاحٍ أو في قيمةِ بديلٍ `${NAME...}`
      if (new RegExp(`(^|\\s)${name}:|\\$\\{${name}[:}]`, 'm').test(COMPOSE)) continue;
      missing.push(`${name}  (${files.join(', ')})`);
    }
    expect(
      missing,
      'متغيّرٌ يُقرأ في الشيفرة ولا يصل الحاوية: يبدو مضبوطاً في .env ولا يفعل شيئاً. '
      + 'مرّره في docker-compose.yml، أو أضِفه إلى NOT_IN_COMPOSE بسببٍ مكتوب.',
    ).toEqual([]);
  });

  it('★ وكلُّ مفتاحٍ يُمرَّر بلا قيمةٍ افتراضيّةٍ مشروحٌ في القالب', () => {
    /* `${VAR:?}` يمنع الإقلاع عند الغياب — وهو الصواب. لكنّ مفتاحاً غائباً
       عن `.env.example` لا يملؤه أحد، فيُكتشف بانهيارِ إقلاعٍ لا بقراءة. */
    const required = [...COMPOSE.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)].map((m) => m[1]!);
    expect(required.length).toBeGreaterThan(4);
    const undocumented = [...new Set(required)]
      .filter((v) => !new RegExp(`^#?\\s*${v}=`, 'm').test(ENV_EXAMPLE));
    expect(undocumented, 'مفتاحٌ إلزاميٌّ غائبٌ عن .env.example').toEqual([]);
  });
});

describe('★★★ مفاتيحُ التدوير — الإجراءُ الموثَّق كان يُفسد كلَّ سرّ', () => {
  it('MASTER_KEY_V1..3 تُمرَّر إلى الخدمتَين اللتين تفكّان', () => {
    /* `packages/crypto` يمسح البيئةَ بحثاً عنها؛ وبلا تمريرٍ يجد كلَّ صفٍّ
       قديمٍ يرمي عند الفكّ و`.env` عند المشغّل صحيحٌ تماماً. */
    for (const v of ['MASTER_KEY_V1', 'MASTER_KEY_V2', 'MASTER_KEY_V3']) {
      expect((COMPOSE.match(new RegExp(`${v}:`, 'g')) ?? []).length,
        `${v} لا يصل api والعامل معاً`).toBeGreaterThanOrEqual(2);
    }
  });

  it('★ والقالبُ يشرح الإجراء لا يذكر المفتاحَ وحده', () => {
    expect(ENV_EXAMPLE).toMatch(/^MASTER_KEY_V1=/m);
    expect(ENV_EXAMPLE, 'خطوةُ «ثمّ احذف القديم» هي التي تُنسى').toContain('احذف المفتاحَ القديم');
    expect(ENV_EXAMPLE, 'وتحذيرُ الطمس — وهو الصامتُ القاتل').toContain('يطمس الرئيس');
  });

  it('★★ ومفتاحٌ سابقٌ بنفس رقم الإصدار الحاليّ **يُرفض** لا يُقبل', () => {
    /* 🔴 كان `keys.set` يكتب فوق الرئيس: من أتمّ التدوير ونسي حذف القديم
       يجعل المفتاحَ القديم مفتاحَ الإصدار الحاليّ، فيُشفَّر كلُّ سرٍّ **جديد**
       بمفتاحٍ يُفترض أنّه زال — ويُفكّ بنجاحٍ فلا يُرى شيء. ولا يظهر العطلُ
       إلّا يومَ يُحذف القديم فعلاً، وقد صارت كلُّ الأسرار الجديدة رهينتَه. */
    const crypto = read('packages/crypto/src/index.ts');
    expect(crypto).toContain('ver === current');
    expect(crypto).toContain('يحمل رقمَ الإصدار الحاليّ');
  });
});
