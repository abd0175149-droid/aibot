import { describe, it, expect } from 'vitest';
import { linkHostsFrom, stripDisallowedLinks } from '../src/guards.js';

/**
 * ★ العطل الذي وُلد منه هذا الملفّ: الحارس كان يعمل بلا خطأ والقائمة فارغة،
 *   فيحذف **كلّ** رابطٍ من كلّ ردّ عند كلّ مستأجر. ولا اختبارَ يكشف ذلك لأنّ
 *   `stripDisallowedLinks` سليمةٌ وحدها تماماً: العطل في أنّ أحداً لم يملأ
 *   مُدخلَها. فالاختبار هنا يربط الطرفين — يستخرج ثمّ يُصفّي — لأنّ الوصل
 *   هو ما انكسر لا الطرفان.
 */
describe('مضيفو الروابط يُستخرجون من المعرفة ثمّ يمرّون من الحارس', () => {
  const KB = [
    'موقعنا على الخريطة: https://maps.app.goo.gl/xyz',
    'احجز من https://www.nuskjo.grade.sbs/booking?ref=1 أو من https://nuskjo.grade.sbs/',
    'صفحةٌ بلا رابط.',
  ].join('\n');

  it('يستخرج المضيفين ويُسقط www ويُرتّب ولا يُكرّر', () => {
    expect(linkHostsFrom(KB)).toEqual(['maps.app.goo.gl', 'nuskjo.grade.sbs']);
  });

  it('يقرأ الشخصيّة والمعرفة معاً', () => {
    expect(linkHostsFrom('زُرنا: https://a.example', 'واحجز: https://b.example'))
      .toEqual(['a.example', 'b.example']);
  });

  it('لا يسقط على رابطٍ مشوّه ولا على فراغ', () => {
    expect(linkHostsFrom(null, undefined, '', 'http://')).toEqual([]);
  });

  it('★ الوصل: ما استُخرج من المعرفة يمرّ، وما لم يُكتب فيها يُحذف', () => {
    const hosts = linkHostsFrom(KB);
    const good = stripDisallowedLinks('احجز من https://nuskjo.grade.sbs/booking', hosts);
    expect(good.stripped).toBe(false);
    expect(good.text).toContain('https://nuskjo.grade.sbs/booking');

    // النطاقُ الفرعيّ يمرّ — قاعدةُ `endsWith` في الحارس مقصودة
    expect(stripDisallowedLinks('https://pay.nuskjo.grade.sbs/x', hosts).stripped).toBe(false);

    // ما اخترعه النموذج ولم يكتبه المالك يُحذف — والقاعدة لم تتغيّر
    const bad = stripDisallowedLinks('جرّب https://evil.example/pay', hosts);
    expect(bad.stripped).toBe(true);
    expect(bad.text).not.toContain('evil.example');
  });

  it('★ وقائمةٌ فارغة تحذف كلّ شيء — وهذا ما كان يقع لكلّ بوتٍ على المنصّة', () => {
    const r = stripDisallowedLinks('موقعنا: https://nuskjo.grade.sbs/', []);
    expect(r.stripped).toBe(true);
    expect(r.text).toBe('موقعنا:');
  });
});
