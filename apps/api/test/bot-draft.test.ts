import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BotBehaviorPatch, BusinessHours, DAY_KEYS } from '@aibot/shared';

/**
 * ★ **تراجعٌ صامتٌ في أوّل تعديلٍ روتينيّ — وهو أخطر ما في شاشة البوت.**
 *
 *   الشاشةُ ترسل حقلَين، والمسارُ كان يكتبهما **مكان المسوّدة كلّها**. والنشرُ
 *   يقرأ من المسوّدة `toolsConfig` و`params` (وفيها `linkHosts`) و`model`.
 *   فضغطةُ «حفظ» على تعديل جملةٍ في الشخصيّة كانت تُخرج، عند أوّل نشرٍ بعدها:
 *   بوتاً بلا أدواتٍ مدمجة (بما فيها التحويل لموظّف)، وردوداً محذوفةَ الروابط
 *   (فالحارسُ يمحو ما ليس في قائمةٍ فارغة)، ونموذجاً غيرَ الذي كان يعمل
 *   فتتغيّر الفاتورة — بلا خطأٍ ولا رسالةٍ ولا أثر.
 */

const SRC = readFileSync(join(__dirname, '..', 'src', 'routes', 'bot.ts'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*/gm, ' ');

describe('حفظُ المسوّدة دمجٌ لا استبدال', () => {
  it('★ الجسمُ يُدمَج فوق المحفوظ — لا يحلّ محلّه', () => {
    expect(CODE, 'كان `draft: req.body` يكتب المسوّدة كلّها')
      .not.toMatch(/draft: req\.body/);
    expect(CODE).toMatch(/const draft = \{ \.\.\.seed, \.\.\.patch \}/);
  });

  it('★ والبذرةُ عند غياب المسوّدة هي النسخة المنشورة لا الفراغ', () => {
    expect(CODE).toMatch(/async function seedFromPublished/);
    for (const f of ['toolsConfig', 'params', 'provider', 'model', 'knowledgeBudget']) {
      expect(CODE, `${f} غائبٌ عن البذرة — والنشرُ يقرؤه من المسوّدة`)
        .toMatch(new RegExp(`${f}: ver\\.${f}`));
    }
  });

  it('والنشرُ نفسُه يبذر من المنشورة — فيُصلح مسوّداتٍ ناقصةً محفوظةً قبل اليوم', () => {
    expect(CODE).toMatch(/const draft = \{ \.\.\.\(await seedFromPublished\(tx, tenantId\)\), \.\.\.saved \}/);
  });

  it('★ ولا اسمَ نموذجٍ مكتوبٍ نصّاً في الاحتياط', () => {
    expect(CODE, 'ثابتُ الحزمة يتغيّر في موضعٍ واحد').toContain('DEFAULT_CHAT_MODEL');
    expect(CODE).not.toMatch(/draft\.model \?\? 'gemini/);
  });
});

describe('التزامنُ التفاؤليّ على المسوّدة', () => {
  it('★ الطابعُ يُفحص، والتعارضُ ٤٠٩ لا 200 صامتة', () => {
    expect(CODE).toMatch(/expectedUpdatedAt/);
    expect(CODE).toMatch(/ErrorCode\.CONFLICT/);
    expect(CODE).toMatch(/409/);
  });

  it('وردُّ التعارض يحمل المسوّدةَ الحاليّة — فتُعرض بلا جولةِ جلبٍ ثانية', () => {
    const at = CODE.indexOf('ErrorCode.CONFLICT');
    expect(CODE.slice(at, at + 400)).toMatch(/draft: cfg\.draft/);
  });

  it('★ و`null` تعني «لا تفحص» — وهي مخرجُ من يقرّر الكتابةَ فوق ما كُتب', () => {
    expect(CODE).toMatch(/expectedUpdatedAt !== undefined && expectedUpdatedAt !== null/);
  });

  it('والشاشةُ تحمل الطابعَ وتوقف الحفظ التلقائيّ عند التعارض', () => {
    const web = readFileSync(
      join(__dirname, '..', '..', 'web', 'src', 'app', 'app', 'bot', 'page.tsx'), 'utf8',
    );
    expect(web).toMatch(/draftUpdatedAt/);
    expect(web).toMatch(/e\.status === 409/);
    expect(web, 'بلا هذا يمحو أوّلُ blur عملَ غيرك بعد ثوانٍ')
      .toMatch(/!busy && !conflict/);
  });
});

describe('عقدُ سلوك البوت', () => {
  it('المدّةُ محدودةٌ بيوم', () => {
    expect(BotBehaviorPatch.safeParse({ pauseMinutes: 30 }).success).toBe(true);
    expect(BotBehaviorPatch.safeParse({ pauseMinutes: 0 }).success).toBe(false);
    expect(BotBehaviorPatch.safeParse({ pauseMinutes: 1441 }).success).toBe(false);
    expect(BotBehaviorPatch.safeParse({ pauseMinutes: 1.5 }).success).toBe(false);
  });

  it('والرسالتان محدودتا الطول وتقبلان الإفراغ', () => {
    expect(BotBehaviorPatch.safeParse({ failMessage: null }).success).toBe(true);
    expect(BotBehaviorPatch.safeParse({ failMessage: 'x'.repeat(301) }).success).toBe(false);
  });

  it('★ ومفاتيحُ الأيّام ثلاثيّةٌ بالضبط — و`Intl` يشتقّها هكذا', () => {
    /* `withinBusinessHours` يأخذ `weekday: 'short'` ثمّ `toLowerCase()`. فأيُّ
       اسمٍ آخر لا يطابق شيئاً، وساعاتُ الدوام تصير «مغلقٌ دائماً» بصمت. */
    const ok = BusinessHours.safeParse({ tz: 'Asia/Amman', days: { sat: [['09:00', '22:00']] } });
    expect(ok.success).toBe(true);
    expect(BusinessHours.safeParse({ days: { saturday: [['09:00', '22:00']] } }).success).toBe(false);
    expect(DAY_KEYS).toContain('sat');
    expect(DAY_KEYS).toHaveLength(7);
  });

  it('والوقتُ بصيغة HH:MM بأربعٍ وعشرين ساعة', () => {
    expect(BusinessHours.safeParse({ days: { sat: [['9:00', '22:00']] } }).success).toBe(false);
    expect(BusinessHours.safeParse({ days: { sat: [['24:00', '22:00']] } }).success).toBe(false);
    expect(BusinessHours.safeParse({ days: { sat: [['00:00', '23:59']] } }).success).toBe(true);
  });

  it('ولا تصحّ حمولةٌ فارغة — «لا شيءَ لتغييره» ليست نجاحاً', () => {
    expect(BotBehaviorPatch.safeParse({}).success).toBe(false);
  });

  it('★ والمسارُ يرفض فترةً تبدأ وتنتهي في اللحظة نفسها', () => {
    /* العاملُ يعامل `to <= from` نطاقاً عابراً لمنتصف الليل، فخطأٌ مطبعيٌّ
       («17:00–09:00» بدل العكس) يفتح الدوامَ ستَّ عشرةَ ساعةً بدل ثمانٍ. */
    expect(CODE).toMatch(/if \(to === from\)/);
  });

  it('والمسارُ يكتب الأعمدة الأربعة ويسجّل في التدقيق', () => {
    const at = CODE.indexOf("'/bot/config'");
    expect(at).toBeGreaterThan(0);
    const block = CODE.slice(at, at + 2400);
    for (const f of ['pauseMinutes', 'failMessage', 'outsideHoursMessage', 'businessHours']) {
      expect(block, `${f} لا يُكتب`).toContain(`set.${f}`);
    }
    expect(block).toContain('auditLog');
    expect(block, 'وهو خلف صلاحيّة الإعدادات').toMatch(/preHandler: auth/);
  });

  it('★ والشاشةُ صارت نموذجاً لا ثلاثَ بطاقاتِ قراءة', () => {
    const web = readFileSync(
      join(__dirname, '..', '..', 'web', 'src', 'components', 'BotBehavior.tsx'), 'utf8',
    );
    expect(web).toMatch(/patch\('\/bot\/config'/);
    expect(web, 'وفترةٌ معطوبةٌ تُمسك قبل الإرسال أيضاً').toMatch(/const badRange/);
    const page = readFileSync(
      join(__dirname, '..', '..', 'web', 'src', 'app', 'app', 'bot', 'page.tsx'), 'utf8',
    );
    expect(page).toMatch(/<BotBehavior/);
    /* والأربعةُ لم تعد بطاقاتِ قراءة. («لا تُعدَّل من هنا» تبقى — وهي عن
       الثلاثة الأخرى التي تضبطها المنصّة: النموذج ودوراتُ الأدوات وعددُ
       الرسائل، وتسكن `<details>` مطويّة.) */
    const behave = page.slice(page.indexOf("{tab === 'behave' && ("), page.indexOf('<details className="bot-more">'));
    expect(behave, 'ما زالت بطاقةَ قراءةٍ لمدّة السكوت').not.toContain('rm-k');
  });
});
