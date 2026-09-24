import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeEvent, encodeEvent, EVENT_NAMES, PLATFORM_EVENT_NAMES } from '@aibot/shared';

/**
 * ★ **حارسان من عائلةٍ واحدة: لا ٥٠٠ على مدخلٍ مشوّه، ولا حدثٌ بلا عقد.**
 *
 *   وكلاهما يحمي من **الضجيج** لا من الانهيار: سجلٌّ يمتلئ بأخطاء ٥٠٠ ليست
 *   أعطالاً يُخفي الأعطالَ الحقيقيّة، وحدثٌ باسمٍ مطبوعٍ خطأً يُسكت التحديثَ
 *   اللحظيَّ بصمتٍ تامّ. والصمتُ في هذا النظام أخطر من الصراخ.
 */

const SRC = readFileSync(join(__dirname, '..', 'src', 'routes', 'inbox.ts'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*/gm, ' ');

/** مساراتُ الملفّ — تُولَّد من النصّ لا من قائمةٍ تُحدَّث باليد. */
function routes(src: string): Array<{ method: string; path: string; body: string }> {
  const re = /\bapp\.(get|post|patch|put|delete)\s*(?:<[^<>]*>)?\s*\(\s*'([^']+)'/g;
  const hits = [...src.matchAll(re)];
  return hits.map((m, i) => ({
    method: m[1]!, path: m[2]!,
    body: src.slice(m.index!, hits[i + 1]?.index ?? src.length),
  }));
}

const ROUTES = routes(SRC);

describe('كلُّ مسارٍ بمعرّفٍ يفحصه قبل القاعدة', () => {
  it('الماسحُ يجد المسارات فعلاً — وإلّا فالحارس يمرّ على الفراغ', () => {
    expect(ROUTES.length).toBeGreaterThan(8);
    expect(ROUTES.map((r) => r.path)).toContain('/conversations/:id/messages');
  });

  it('★ لا مسارَ بـ`:id` بلا فحصِ UUID — ورابطٌ مقصوصٌ يعطي ٤٠٤ لا ٥٠٠', () => {
    const withId = ROUTES.filter((r) => r.path.includes(':id'));
    expect(withId.length).toBeGreaterThan(5);
    const naked = withId.filter((r) => !r.body.includes('reqUuid('));
    expect(
      naked.map((r) => `${r.method} ${r.path}`),
      'معرّفٌ مشوّهٌ يمرّ إلى `::uuid` فيرمي بوستجرس — ٥٠٠ على رابطٍ يتبادله '
      + 'الموظّفون على واتساب، وسجلٌّ يمتلئ بأخطاءٍ ليست أعطالاً فتُخفي الحقيقيّة.',
    ).toEqual([]);
  });

  it('والمعرّفاتُ الثانويّة كذلك — الرسالةُ في الإعادة وفي المرفَق', () => {
    expect(CODE).toMatch(/reqUuid\(req\.params\.messageId/);
    expect(CODE, 'ومسارُ المرفَق يفحص الاثنين معاً').toMatch(/reqUuid\(req\.params\.mid/);
  });
});

describe('القيمُ المعدودة والحدود', () => {
  it('★ حالةٌ أو قناةٌ خارج المعروف ٤٠٠ لا ٥٠٠', () => {
    expect(CODE).toContain('CONV_STATUS.has(status)');
    expect(CODE).toContain('CHANNEL_KINDS.has(channel)');
  });

  it('ونصُّ البحث محدودُ الطول — وإلّا مسحَ الجدولَ بلا فائدةٍ لأحد', () => {
    expect(CODE).toMatch(/q\.length > 80/);
  });

  it('★ و`pauseMinutes` محدودةٌ بيوم — رقمٌ ضخمٌ يُنتج طابعاً خارج المدى فيرمي', () => {
    expect(CODE).toMatch(/pm < -1 \|\| pm > 1440/);
    expect(CODE, 'و`-1` مقصودةٌ: إعادةُ البوت تُنهي التوقّف يقيناً').toContain('-1');
  });

  it('والوسومُ محدودةُ العدد والطول — عمودٌ بميغابايتٍ يُقرأ في كلّ صفحة', () => {
    expect(CODE).toMatch(/v\.length > 20/);
    expect(CODE).toMatch(/t\.length > 40/);
  });

  it('★ وطابعٌ مشوّهٌ لا يُمرَّر `Invalid Date` إلى الاستعلام', () => {
    expect(CODE).toMatch(/Number\.isNaN\(t\)/);
  });
});

describe('الأحداثُ لها عقدٌ في وقت التشغيل أيضاً', () => {
  it('الأسماءُ المعروفة تمرّ', () => {
    for (const name of [...EVENT_NAMES, ...PLATFORM_EVENT_NAMES]) {
      const raw = encodeEvent({ tenantId: 't1', event: name, payload: { id: 'x' } });
      expect(decodeEvent(raw)?.event, `${name} يجب أن يمرّ`).toBe(name);
    }
  });

  it('★ واسمٌ خارج العقد يسقط عند الحدّ — لا يتسرّب إلى الشاشة بصمت', () => {
    const raw = encodeEvent({ tenantId: 't1', event: 'message:nwe', payload: {} });
    expect(decodeEvent(raw), 'خطأٌ إملائيٌّ واحدٌ كان يُسكت التحديثَ اللحظيّ')
      .toBeNull();
  });

  it('وحمولةٌ مشوّهةٌ لا تُسقط المشترك', () => {
    expect(decodeEvent('ليس JSON')).toBeNull();
    expect(decodeEvent('{}')).toBeNull();
    expect(decodeEvent(JSON.stringify({ tenantId: '', event: 'message:new' }))).toBeNull();
  });

  it('★ ولا اسمَ حرفيٍّ يتسلّل: كلُّ اسمٍ في الباثّين موجودٌ في العقد', () => {
    const emitted = new Set<string>();
    for (const rel of [
      ['..', 'src', 'routes', 'inbox.ts'],
      ['..', '..', 'worker', 'src', 'inbound.ts'],
      ['..', '..', 'worker', 'src', 'outbound.ts'],
    ]) {
      const src = readFileSync(join(__dirname, ...rel), 'utf8');
      for (const m of src.matchAll(/emitTo(?:Tenant|Platform)\([^,]*,\s*'([^']+)'/g)) emitted.add(m[1]!);
    }
    expect(emitted.size, 'الماسحُ لم يجد أيّ بثّ — فهو يمرّ على الفراغ').toBeGreaterThan(2);
    const known = new Set<string>([...EVENT_NAMES, ...PLATFORM_EVENT_NAMES]);
    expect([...emitted].filter((e) => !known.has(e))).toEqual([]);
  });
});
