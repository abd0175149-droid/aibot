import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mediaPlaceholder, typeLabel } from '@aibot/shared';

/**
 * ★ **الوسيطةُ بلا تعليقٍ كانت تُسقط الردَّ وتُطلق إنذاراً في آنٍ واحد.**
 *
 *   رسالةٌ صوتيّةٌ أو صورةٌ بلا تعليق تُحفظ بـ`body` فارغ، والسياقُ كان
 *   يُرشَّح بـ`body`. فتختفي من الحوار عند النموذج ويصير «آخرُ ما قاله
 *   الزبون» **سؤالاً أقدم** — فيردّ البوت على ما مضى.
 *   وإن كانت أوّلَ رسالةٍ خرجت `contents` **فارغة**، فيرفضها Gemini بـ400،
 *   وتُرفَع حادثةُ `ai_error` حرجة تُنبّه المالكَ والمنصّة — والزبون يستلم
 *   صمتاً تامّاً. أي أنّ أشيع ما يرسله زبونٌ عربيٌّ على واتساب كان أسوأَ
 *   مسارٍ في النظام.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*/gm, ' ');

describe('الوصفُ نصٌّ واحدٌ لثلاثة قرّاء', () => {
  it('اسمُ النوع عربيٌّ — لا «[image]» في قائمةٍ عربيّة', () => {
    expect(typeLabel('image')).toBe('صورة');
    expect(typeLabel('audio')).toBe('تسجيل صوتيّ');
    expect(typeLabel('location')).toBe('موقع');
  });

  it('★ وللمجهول اسمٌ مفهومٌ لا مفتاحٌ خام', () => {
    expect(typeLabel('نوعٌ لم يوجد بعد')).toBe('مرفَق');
  });

  it('والوصفُ يقول إنّه وصفٌ لا محتوى — فلا يخمّن النموذج ما فيه', () => {
    expect(mediaPlaceholder('audio')).toBe('[أرسل الزبون تسجيل صوتيّ بلا نصّ]');
  });
});

describe('السياقُ يرى الوسيطة', () => {
  const r = code('apps/worker/src/reply.ts');

  it('★ الترشيحُ لم يعد على `body` — وسيطةٌ بلا تعليقٍ تدخل موصوفة', () => {
    expect(r, 'كان `.filter((m) => m.body)` يُسقطها من الحوار كلّه')
      .not.toMatch(/\.filter\(\(m\) => m\.body\)/);
    expect(r).toContain('mediaPlaceholder(m.type)');
  });

  it('والنوعُ مجلوبٌ من القاعدة — وإلّا فلا وصفَ يُبنى', () => {
    expect(r).toMatch(/body: messages\.body, type: messages\.type/);
  });

  it('★ والتفاعلُ لا يدخل السياق — سياقٌ مطابقٌ يُعيد الجوابَ نفسَه بكلفةٍ جديدة', () => {
    expect(r).toMatch(/m\.type !== 'reaction'/);
  });

  it('ولا سطرَ فارغٍ يتسرّب — دورٌ بلا نصٍّ يرفضه المزوّد', () => {
    expect(r).toMatch(/\.filter\(\(t\) => t\.text\)/);
  });

  it('★ والقواعدُ تقول للنموذج ما يفعل حين تصل وسيطة', () => {
    const c = read('packages/core/src/context.ts');
    expect(c, 'بلا قاعدةٍ صريحة يخمّن النموذج ما في التسجيل').toContain('وصفٌ');
    expect(c).toContain('حوّل لموظّف');
    expect(c, 'والموقعُ لا يُسأل عنه مرّتين').toContain('عنوانه');
  });
});

describe('التفاعلُ حدثٌ لا رسالة', () => {
  const i = code('apps/worker/src/inbound.ts');

  it('★ لا نافذةَ تُمدَّد ولا عدّادَ يرتفع ولا ردَّ يُجدوَل', () => {
    const at = i.indexOf("m.type === 'reaction'");
    expect(at, 'التفاعلُ يُعامَل رسالةً — فوترةٌ وإنذارٌ ونداءُ نموذجٍ على «شكراً»').toBeGreaterThan(0);
    const before = i.slice(0, at);
    /* الحارسُ **قبل** فتح النافذة وجدولة الردّ — وإلّا فهو حارسٌ متأخّر. */
    expect(before, 'الحارسُ بعد فتح النافذة لا يمنع الفوترة').not.toContain('openOrExtendWindow(tx');
    expect(before).not.toContain('enqueueReply(conv.id)');
  });

  it('ومع ذلك يُبثّ ويُحفظ — الموظّف يرى أنّ الزبون تفاعل', () => {
    const at = i.indexOf("m.type === 'reaction'");
    const block = i.slice(at, at + 900);
    expect(block).toContain("'message:new'");
    expect(block).toContain('continue;');
  });

  it('والمعاينةُ عربيّةٌ لا اسمُ نوعٍ تقنيّ', () => {
    expect(i, 'كان `[${m.type}]` — «[location]» في قائمةٍ عربيّة').toContain('typeLabel(m.type)');
  });

  it('والموقعُ يُحفظ في حمولة الرسالة ويُبثّ معها', () => {
    expect((i.match(/location: m\.location \?\? null/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });
});

describe('المرفَقُ يُفتح، وبقيوده', () => {
  const a = code('apps/api/src/routes/inbox.ts');

  it('★ مسارُ الجلب موجودٌ وينادي المحوّل', () => {
    expect(a, 'fetchMedia كانت مكتوبةً في المحوّل بلا مسارٍ ينادِيها')
      .toContain("'/conversations/:id/messages/:mid/media'");
    expect(a).toContain('adapter.fetchMedia(');
  });

  it('★ والقراءةُ داخل withTenant — فـRLS يمنع وسيطَ مستأجرٍ آخر ولو خُمّن معرّفُه', () => {
    const at = a.indexOf("'/conversations/:id/messages/:mid/media'");
    const block = a.slice(at, at + 2600);
    expect(block).toContain('withTenant(getDb()');
    expect(block, 'والرسالةُ مشروطةٌ بمحادثتها — لا معرّفٌ عائم')
      .toContain('eq(messages.conversationId, req.params.id)');
  });

  it('★ ولا كاشَ مشترك — الوسيطُ محتوى زبونٍ خاصّ', () => {
    const at = a.indexOf("'/conversations/:id/messages/:mid/media'");
    expect(a.slice(at, at + 2600)).toMatch(/no-store, private/);
  });

  it('وانتهاءُ مهلة الحفظ عند المزوّد 404 لا 500 — حالةٌ تُقال لا عطل', () => {
    const at = a.indexOf("'/conversations/:id/messages/:mid/media'");
    expect(a.slice(at, at + 2600)).toContain('404');
  });
});
