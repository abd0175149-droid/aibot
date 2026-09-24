import { describe, it, expect } from 'vitest';
import { WhatsAppAdapter } from '../src/whatsapp.js';
import { NormalizedInbound } from '@aibot/shared';

/**
 * ★ **ثلاثُ حالاتٍ شائعةٌ جدّاً عند زبائن العرب على واتساب — وكلُّها مكسورة.**
 *
 *   ① **الموقع.** محتوى الطلب في مطعمٍ يوصّل. كان يُحوَّل إلى نوعٍ بلا نصٍّ
 *     ولا إحداثيّة (تبقى في الحمولة الخام وحدها)، فلا يراه الموظّف ولا
 *     البوت — فيُسأل الزبون عن عنوانه بعد أن أرسله.
 *   ② **التفاعل 👍.** أشيعُ ما يفعله الزبون حين يرضى ويكتفي. كان يقع في
 *     `unsupported` فيُعامَل رسالةً تستحقّ ردّاً: نافذةٌ تُمدَّد، وعدّادٌ
 *     يرتفع، ومهمّةُ ردٍّ سياقُها مطابقٌ للشوط السابق — فيُنادى النموذج
 *     بكلفةٍ جديدة ليُعيد الجواب نفسَه.
 *   ③ **الملصق.** نفسُ المصير، ومعرّفُ وسيطه يُهدَر فلا يُفتح.
 */

const ad = new WhatsAppAdapter();

/** ويبهوك واتساب كما يصل فعلاً — لا شكلٌ مبسَّط. */
function hook(message: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: '111' },
          contacts: [{ wa_id: '962790000000', profile: { name: 'أبو محمّد' } }],
          messages: [{ from: '962790000000', id: 'wamid.X', timestamp: '1758700000', ...message }],
        },
      }],
    }],
  };
}

const one = (message: Record<string, unknown>) => ad.parseWebhook(hook(message)).messages[0]!;

describe('الموقعُ يصل موقعاً', () => {
  const m = one({
    type: 'location',
    location: { latitude: 31.963158, longitude: 35.930359, name: 'بيت الشام', address: 'عمّان · الدوّار السابع' },
  });

  it('★ النصُّ يحمل الاسمَ والعنوانَ والإحداثيّة — فيدخل السياقَ والقائمةَ معاً', () => {
    expect(m.type).toBe('location');
    expect(m.text).toContain('بيت الشام');
    expect(m.text).toContain('الدوّار السابع');
    expect(m.text, 'الإحداثيّةُ لازمة: لا اسمَ لكلّ موقع').toContain('31.963158');
  });

  it('والإحداثيّاتُ محفوظةٌ عدداً لا منطوقةً في نصّ', () => {
    expect(m.location).toEqual({
      lat: 31.963158, lng: 35.930359,
      name: 'بيت الشام', address: 'عمّان · الدوّار السابع',
    });
  });

  it('وموقعٌ بلا اسمٍ ولا عنوان يبقى مفيداً', () => {
    const bare = one({ type: 'location', location: { latitude: 31.5, longitude: 35.9 } });
    expect(bare.text).toContain('31.500000');
    expect(bare.location?.lat).toBe(31.5);
  });

  it('★ وإحداثيّةٌ مشوّهةٌ لا تُنتج NaN في القاعدة ولا رابطَ خريطةٍ مكسوراً', () => {
    const bad = one({ type: 'location', location: { latitude: 'nope', longitude: null } });
    expect(bad.location).toBeNull();
    expect(bad.text).toContain('بلا إحداثيّات');
    expect(NormalizedInbound.safeParse({ ...bad, at: bad.at }).success).toBe(true);
  });
});

describe('التفاعلُ والملصقُ صنفان قائمان', () => {
  it('★ التفاعلُ نوعُه reaction ونصُّه الإيموجي — لا unsupported', () => {
    const m = one({ type: 'reaction', reaction: { message_id: 'wamid.prev', emoji: '👍' } });
    expect(m.type).toBe('reaction');
    expect(m.text).toBe('👍');
  });

  it('والملصقُ يحتفظ بمعرّف وسيطه فيُفتح', () => {
    const m = one({ type: 'sticker', sticker: { id: 'MEDIA-9', mime_type: 'image/webp' } });
    expect(m.type).toBe('sticker');
    expect(m.mediaId).toBe('MEDIA-9');
  });

  it('وما لا يُعرف يبقى unsupported — لا نوعَ يُخترع', () => {
    expect(one({ type: 'order', order: {} }).type).toBe('unsupported');
  });
});

describe('ما كان يعمل يبقى يعمل', () => {
  it('النصُّ والزرُّ والوسائطُ بتعليق', () => {
    expect(one({ type: 'text', text: { body: 'مرحبا' } }).text).toBe('مرحبا');
    const b = one({ type: 'button', button: { text: 'أكّد', payload: 'confirm:1' } });
    expect(b.buttonPayload).toBe('confirm:1');
    const img = one({ type: 'image', image: { id: 'M1', caption: 'هاي الوصفة' } });
    expect([img.type, img.text, img.mediaId]).toEqual(['image', 'هاي الوصفة', 'M1']);
  });

  it('وصورةٌ بلا تعليقٍ تبقى بلا نصّ — والوصفُ يُضاف في السياق لا في المحوّل', () => {
    const img = one({ type: 'image', image: { id: 'M2' } });
    expect(img.text).toBeNull();
    expect(img.mediaId).toBe('M2');
  });
});
