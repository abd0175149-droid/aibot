import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ حرّاسُ باني الأدوات — **أداةٌ نصفُ مبنيّةٍ أمام زبونٍ حقيقيّ.**
 *
 * التجربةُ تحتاج صفّاً محفوظاً (السرُّ مشفَّرٌ في القاعدة)، فالباني يحفظ عند
 * أوّل ضغطةٍ على «جرّبها». وكان الصفُّ يُنشأ **مفعَّلاً**، وعاملُ الردّ يعرض
 * كلَّ أداةٍ مفعَّلةٍ على النموذج في كلّ رسالة — بلا علاقةٍ بالنسخة المنشورة.
 * فأداةٌ بمسارٍ خاطئ وبلا خريطةِ ردٍّ ولا تأكيد تصير في متناول البوت من لحظة
 * الضغط. ثمّ تُخفق حتّى يفتح قاطعُ الدائرة، فيقرأ المالك «أداةٌ عُطِّلت
 * آليّاً» قبل أن يفهم ما جرى.
 */

const API = join(__dirname, '..', 'src', 'routes', 'bot.ts');
const WEB = join(__dirname, '..', '..', 'web', 'src');
const read = (p: string) => readFileSync(p, 'utf8');
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*/gm, ' ');

const SRC = read(API);
const CODE = strip(SRC);

describe('الأداةُ تُنشأ معطَّلةً حتّى يُحفظ القرار', () => {
  it('★ الإنشاءُ لا يُفعّل إلّا بطلبٍ صريح', () => {
    const at = CODE.indexOf("app.post<{ Body: Record<string, any> }>('/bot/tools'");
    expect(at, 'مسارُ الإنشاء غيرُ موجود').toBeGreaterThan(0);
    const block = CODE.slice(at, at + 2000);
    expect(block, 'الصفُّ يُنشأ مفعَّلاً فيراه البوت الحيّ فوراً')
      .toContain('enabled: b.enabled === true');
  });

  it('والتجربةُ في الباني تحفظ معطَّلة، و«احفظ» يفعّل', () => {
    const b = strip(read(join(WEB, 'components', 'ToolBuilder.tsx')));
    expect(b, 'التجربةُ تحفظ بلا تحديدٍ فتُفعّل').toContain('save(false)');
    expect(b, '«احفظ الأداة» هو ما يفعّلها').toContain('save(true)');
    expect(b).toMatch(/async function save\(enabled: boolean\)/);
    expect(b, 'و`enabled` يُرسَل في كلّ حفظٍ صراحةً').toMatch(/toPayload\(\), enabled/);
  });

  it('★ وإغلاقُ الباني يعيد الجلب — أداةٌ حُفظت للتجربة ثمّ أُغلقت النافذة كانت تختفي', () => {
    const page = strip(read(join(WEB, 'app', 'app', 'bot', 'page.tsx')));
    const at = page.indexOf('<ToolBuilder');
    expect(at).toBeGreaterThan(0);
    const block = page.slice(at, at + 700);
    expect(block).toMatch(/onClose=\{\(\) => \{ setEditing\(null\); void tools\.reload\(\); \}\}/);
  });
});

describe('الإيقافُ المؤقّت له زرّ', () => {
  const page = read(join(WEB, 'app', 'app', 'bot', 'page.tsx'));

  it('★ وكان المخرجُ الوحيد الحذف — بسرّ الأداة ومسارها', () => {
    expect(page).toContain('أوقفها مؤقّتاً');
    expect(page).toContain('شغّلها');
    expect(strip(page)).toMatch(/async function setToolEnabled\(id: string, enabled: boolean\)/);
  });

  it('ووسمُ «مسوّدة» يفرّق ما لم يُحفظ عمّا عطّله قاطعُ الدائرة', () => {
    expect(page).toContain('مسوّدة — لا يراها بوتك');
    expect(strip(page), 'الوسمُ مشروطٌ بغياب سبب التعطيل الآليّ')
      .toMatch(/!t\.enabled && !t\.disabledReason/);
  });
});

describe('لا نداءَ شبكةٍ داخل معاملة', () => {
  it('★ تجربةُ الأداة تقرأ الصفَّ في معاملةٍ قصيرة ثمّ تنادي خارجها', () => {
    const at = CODE.indexOf("'/bot/tools/:id/test'");
    expect(at).toBeGreaterThan(0);
    const block = CODE.slice(at, at + 2200);
    /* خادمُ العميل البطيء كان يحتجز اتّصالَ قاعدةٍ ستَّ عشرةَ ثانية. وعشرُ
       تجاربَ متزامنة تستنفد البِركة (عشرةٌ فقط) فتتوقّف كلُّ مسارات الـAPI
       **لكلّ المستأجرين** — عطلٌ ذاتيٌّ عابرٌ للمستأجرين من فعلٍ بريء. */
    const tx = block.indexOf('withTenant(getDb()');
    const call = block.indexOf('await execHttpTool(');
    expect(tx).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(0);
    expect(call, 'النداءُ الخارجيُّ قبل إغلاق المعاملة').toBeGreaterThan(tx);
    /* والمعاملةُ تنتهي بسطرها الخاصّ قبل النداء: تعبيرٌ واحدٌ يُرجع الصفّ. */
    expect(block).toMatch(/const tool = await withTenant\(getDb\(\), tenantId, async \(tx\) =>/);
  });

  it('★ وحدٌّ على التجربة — خمسٌ في الدقيقة', () => {
    const at = CODE.indexOf("'/bot/tools/:id/test'");
    const block = CODE.slice(at, at + 2200);
    expect(block).toContain('enforceRate(');
    expect(block).toMatch(/rl:tooltest:\$\{tenantId\}/);
  });
});

describe('رسالةُ خارج الدوام تُقال مرّةً', () => {
  const w = strip(readFileSync(
    join(__dirname, '..', '..', 'worker', 'src', 'reply.ts'), 'utf8',
  ));

  it('★ لا تُكرَّر مع كلّ رسالةٍ واردة', () => {
    /* كانت تُرسَل لكلّ مهمّة ردّ: ثلاثُ رسائلَ ليلاً تعني ثلاثَ نسخٍ متطابقة.
       والأثقل أنّها تخرج عبر طبقة الإرسال فتختم نافذة الفوترة — فيدفع العميل
       نافذةً كاملةً ثمنَ ردٍّ آليٍّ يقول «نحن مغلقون». */
    expect(w).toMatch(/lastOutbound\?\.body\?\.trim\(\) === cfg\.outsideHoursMessage\.trim\(\)/);
  });

  it('والخروجُ المبكّر حين لا رسالة — لا إرسالَ فارغ', () => {
    expect(w).toMatch(/if \(!cfg\.outsideHoursMessage\) return null;/);
  });

  it('★ وتُقال من جديدٍ بعد أن يردّ البوتُ أو الموظّف — الشرطُ على آخر صادر', () => {
    const at = w.indexOf('const lastOutbound');
    expect(at).toBeGreaterThan(0);
    const block = w.slice(at, at + 700);
    expect(block).toMatch(/eq\(messages\.direction, 'out'\)/);
    expect(block).toMatch(/orderBy\(desc\(messages\.createdAt\)\)/);
  });
});
