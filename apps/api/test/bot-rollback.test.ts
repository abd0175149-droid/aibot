import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOT_SCREEN, BOT_SCREEN_ABS, readBotScreen } from '../../../test-support/bot-screen';

/**
 * ★ **مسارُ التراجع كان محصَّناً ومكتملاً — ولا زرَّ له في أيّ شاشة.**
 *
 *   `POST /bot/versions/:id/rollback` قائمٌ منذ المرحلة الثالثة، يرفض `pending`
 *   ويرفض `failed` برسالتَين مكتوبتَين. و`/bot/versions` يُجلَب في شاشة البوت —
 *   لكن لحالةِ التضمين وحدَها: الصفوفُ لا تُعرض، فلا نسخةَ غيرُ الحيّة تُسمّى
 *   ولا تُختار. وتعليقٌ في نفس الملفّ كان يقول للمالك إنّ الفقدَ «لا يستطيع
 *   التراجع عنه من هذه الشاشة» — وهو يستطيع، لو كان للمسار زرّ.
 *
 * ★ وفتحُ الزرّ يفتح سباقاً كان نائماً: `embed.ts` يكتب النسخةَ الحيّةَ بلا شرط
 *   عند الجهوز، فتراجعٌ خلال دقيقةِ التضمين يُمحى من تحت المالك بلا رسالة.
 *   فالمسارُ صار يرفض التراجعَ وفي الطابور نسخةٌ تُضمَّن.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*/gm, ' ');

const PAGE = BOT_SCREEN.map(code).join('\n');
const API = code('apps/api/src/routes/bot.ts');

describe('الماسحُ يُزيل التعليقات', () => {
  it('★ وبلا ذلك يمرّ الحارسُ على تعليقٍ يقول «لا يستطيع التراجع»', () => {
    /* وهو تعليقٌ حقيقيٌّ في الملفّ (سطرُ تحذير الحذف)، يحمل كلمة `rollback`
       الإنجليزيّة في شرحٍ آخر — فماسحٌ لا يُعمي التعليقات يُصدّق شرحاً. */
    expect(BOT_SCREEN.map(read).join('\n')).toContain('التراجع عنه من هذه الشاشة');
    expect(PAGE, 'التعليقاتُ ما زالت تُقرأ').not.toContain('التراجع عنه من هذه الشاشة');
  });
});

describe('الزرُّ موصولٌ بالمسار', () => {
  it('★ الشاشةُ تنادي `rollback` فعلاً', () => {
    expect(PAGE).toMatch(/post\(`\/bot\/versions\/\$\{id\}\/rollback`\)/);
  });

  it('★★ والسجلُّ المجلوب **يُعرض** — وجلبُه وحده كان يمرّ', () => {
    /* هذا جوهرُ الإخفاق: `useApi('/bot/versions')` كان موجوداً، فأيُّ حارسٍ
       يفحص «هل تُجلَب النسخ» ينجح — والصفوفُ لا تُرسم في أيّ مكان. */
    expect(PAGE).toContain("tab === 'versions'");
    expect(PAGE, 'التبويبُ يعرض الحالةَ المجلوبة نفسَها').toMatch(/state=\{vers\}/);
    expect(PAGE, 'وكلُّ صفٍّ يحمل فعلَه').toMatch(/setAsk\(\{ k: 'rollback', id: v\.id, version: v\.version \}\)/);
  });

  it('★ والتبويبُ في القائمة — وإلّا لم يُفتح إلّا برابط', () => {
    const decl = /const TABS = \[([\s\S]*?)\] as const;/.exec(PAGE)?.[1] ?? '';
    expect(decl).toContain("id: 'versions'");
  });

  it('★ وورقةُ تأكيدٍ قبل فعلٍ يمسّ كلَّ الزبائن', () => {
    expect(PAGE).toContain("open={ask?.k === 'rollback'}");
    expect(PAGE, 'والعاقبةُ تُقال برقمَي النسختَين').toMatch(/v\$\{ask\.version\}/);
    expect(PAGE).toMatch(/v\$\{pubVersion\}/);
  });

  it('★★ وعلَمُ انتظارٍ خاصٌّ به — لا علَمٌ عامّ', () => {
    /* علَمٌ واحدٌ يُظهر «…» على زرّ الحفظ والنشر معاً، فيُقرأ أنّ النظام
       يعمل على ثلاثة أفعالٍ وهو يعمل على واحد. */
    expect(PAGE).toMatch(/type Busy = [^;]*'rollback'/);
    expect(PAGE).toContain("busy={busy === 'rollback'}");
  });

  it('★ وسببُ المنع مكتوبٌ على الزرّ — لا زرٌّ ميّتٌ بلا تفسير', () => {
    expect(PAGE).toContain('const rollbackReason = lockReason');
    expect(PAGE, 'والنسخةُ التي تُجهَّز معرفتها تقول ذلك في صفّها').toContain('reason={why ?? undefined}');
  });

  it('والرصيفُ يقول ما يفعله التبويبُ المفتوح', () => {
    expect(PAGE).toContain("} else if (tab === 'versions') {");
  });
});

describe('الخادمُ يحرس ما فتحه الزرّ', () => {
  const at = API.indexOf("'/bot/versions/:id/rollback'");
  const block = API.slice(at, at + 4000);

  it('المِرساةُ موجودة — فلا يمرّ الحارسُ على فراغ', () => {
    expect(at).toBeGreaterThan(0);
  });

  it('★★★ ولا تراجعَ وفي الطابور نسخةٌ تُضمَّن الآن', () => {
    /* `embed.ts` يكتب `publishedVersionId = job.versionId` **بلا شرط**، فتراجعٌ
       يقع قبله يُمحى بعد دقيقة: الشاشةُ قالت «عاد بوتك إلى v3» ثمّ صارت الحيّةُ
       v7 بلا فعلٍ ولا رسالة. والفحصانِ القائمان يحرسان النسخةَ المقصودة وحدها،
       وهذا يحرس الطابور. */
    expect(block).toMatch(/eq\(botVersions\.embedStatus, 'pending'\)/);
    expect(block, 'والرسالةُ تسمّي النسخةَ التي يُنتظر جهوزُها').toMatch(/busy\.v/);
    expect(block).toContain('409');
    expect(read('apps/worker/src/embed.ts'), 'لو صار التضمينُ مشروطاً فهذا الحارسُ زائدٌ — راجِعه')
      .toMatch(/publishedVersionId: job\.versionId/);
  });

  it('★ وصفُّ تدقيقٍ — فلا يكون الفعلَ الوحيدَ بلا فاعلٍ ولا وقت', () => {
    expect(block).toContain("action: 'bot.rollback'");
    expect(block).toMatch(/actorUserId: req\.auth!\.sub/);
  });

  it('★★ و`bot_configs.updatedAt` **لا تُلمَس**', () => {
    /* هي طابعُ المسوّدة الذي تُقارنه الشاشةُ في `PUT /bot/draft`، ولمسُها
       تُطلق «تغيّرت المسوّدة من مكانٍ آخر» على مالكٍ لم يكتب حرفاً. */
    const upd = /await tx\.update\(botConfigs\)\.set\(\{ publishedVersionId: ver\.id \}\)/.exec(block);
    expect(upd, 'شكلُ التحديث تغيّر — تحقّق أنّ updatedAt ما زالت بمنأى').not.toBeNull();
    expect(block).not.toMatch(/publishedVersionId: ver\.id, updatedAt/);
  });

  it('والفحصانِ القائمان باقيان — pending وfailed على النسخة المقصودة', () => {
    expect(block).toContain("ver.embedStatus === 'pending'");
    expect(block).toContain("ver.embedStatus === 'failed'");
  });

  it('★ والصلاحيّةُ إعداداتٌ لا قراءةٌ عامّة', () => {
    expect(API.slice(at, at + 90)).toContain('preHandler: auth');
  });
});
