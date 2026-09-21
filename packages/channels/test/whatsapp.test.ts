import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { WhatsAppAdapter } from '../src/whatsapp.js';
import { normalizeAnyPhone, toWaPhone } from '../src/phone.js';
import { canRender, degradeChoices, capabilitiesFor } from '../src/index.js';
import type { ChannelCapabilities } from '../src/types.js';

const wa = new WhatsAppAdapter();
const SECRET = 'app-secret-under-test';

function signed(body: unknown) {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
  return { raw, sig };
}

describe('توقيع الويبهوك — إلزاميّ بلا استثناء', () => {
  it('يقبل التوقيع الصحيح', () => {
    const { raw, sig } = signed({ hello: 'world' });
    expect(wa.verifySignature(raw, sig, SECRET)).toBe(true);
  });

  it('يرفض جسماً عُدِّل بعد التوقيع', () => {
    const { sig } = signed({ hello: 'world' });
    expect(wa.verifySignature(Buffer.from('{"hello":"evil"}'), sig, SECRET)).toBe(false);
  });

  it('يرفض غياب الترويسة — لا «يعمل بلا تحقّق»', () => {
    const { raw } = signed({ a: 1 });
    expect(wa.verifySignature(raw, undefined, SECRET)).toBe(false);
  });

  it('يرفض غياب App Secret — القناة تُعطَّل ولا تُفتح', () => {
    const { raw, sig } = signed({ a: 1 });
    expect(wa.verifySignature(raw, sig, '')).toBe(false);
  });
});

describe('حلّ المستأجر', () => {
  it('واتساب BYO يُعرَف من المسار', () => {
    const k = wa.resolveKey({ pathPublicId: 'ABC123', headers: {}, rawBody: Buffer.alloc(0), body: {} });
    expect(k).toEqual({ by: 'path', publicId: 'ABC123' });
  });

  it('بلا مسارٍ لا يُخمَّن مستأجر', () => {
    expect(wa.resolveKey({ headers: {}, rawBody: Buffer.alloc(0), body: {} })).toBeNull();
  });
});

describe('تحليل الحمولة', () => {
  const payload = {
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          contacts: [{ profile: { name: 'أم خالد' } }],
          messages: [
            { id: 'wamid.A', from: '962791234567', timestamp: '1758450000', type: 'text', text: { body: 'فيكم توصيل؟' } },
            { id: 'wamid.B', from: '962791234567', timestamp: '1758450060', type: 'interactive',
              interactive: { button_reply: { id: 'confirm_2291', title: 'أكّد الحجز' } } },
          ],
          statuses: [
            { id: 'wamid.C', status: 'failed', timestamp: '1758450100',
              errors: [{ code: 131047, title: 'Re-engagement message' }] },
          ],
        },
      }],
    }],
  };

  it('يستخرج الرسائل ويطبّع الرقم الأردنيّ إلى المحلّيّ', () => {
    const p = wa.parseWebhook(payload);
    expect(p.messages).toHaveLength(2);
    expect(p.messages[0]!.from).toBe('0791234567');
    expect(p.messages[0]!.text).toBe('فيكم توصيل؟');
    expect(p.messages[0]!.fromHandle).toBe('أم خالد');
  });

  it('ضغطة الزرّ تصل كـbuttonPayload لا كنصٍّ حرّ — فالتنفيذ حتميّ', () => {
    const p = wa.parseWebhook(payload);
    expect(p.messages[1]!.buttonPayload).toBe('confirm_2291');
  });

  it('يستخرج حالات التسليم مع كود الخطأ', () => {
    const p = wa.parseWebhook(payload);
    expect(p.statuses[0]).toMatchObject({ status: 'failed', errorCode: '131047' });
  });

  it('الحقول غير messages تصير أحداث حساب لا رسائل', () => {
    const p = wa.parseWebhook({ entry: [{ changes: [{ field: 'phone_number_quality_update', value: { q: 'YELLOW' } }] }] });
    expect(p.messages).toHaveLength(0);
    expect(p.accountEvents[0]!.kind).toBe('phone_number_quality_update');
  });

  it('لا ينهار على حمولةٍ فارغة أو مشوّهة', () => {
    expect(() => wa.parseWebhook(null)).not.toThrow();
    expect(wa.parseWebhook({ entry: 'nope' }).messages).toHaveLength(0);
  });
});

describe('توحيد الأرقام', () => {
  it('الأردنيّ الدوليّ يصير محلّيّاً', () => expect(normalizeAnyPhone('962791234567')).toBe('0791234567'));
  it('غير الأردنيّ يبقى E.164 — ولا يُسقَط بصمت', () => expect(normalizeAnyPhone('971501234567')).toBe('+971501234567'));
  it('لا تصادم: المحلّيّ يبدأ بصفرٍ والدوليّ لا', () => {
    expect(normalizeAnyPhone('0791234567')).toBe('0791234567');
    expect(normalizeAnyPhone('00962791234567')).toBe('0791234567');
  });
  it('الإرسال يعيده إلى صيغة ميتا', () => {
    expect(toWaPhone('0791234567')).toBe('962791234567');
    expect(toWaPhone('+971501234567')).toBe('971501234567');
  });
});

describe('القدرات — لا شرطَ قناةٍ في الكود', () => {
  const caps = capabilitiesFor('whatsapp_cloud');

  it('واتساب تدعم الأزرار والموقع', () => {
    expect(canRender(caps, 'choices')).toBe(true);
    expect(canRender(caps, 'location')).toBe(true);
  });

  it('قناةٌ بلا أزرارٍ ولا ردودٍ سريعة تُصيَّر إلى نصٍّ مرقَّم لا تفقد الخيارات', () => {
    const poor: ChannelCapabilities = { ...caps, buttons: 0, quickReplies: 0, location: false };
    expect(canRender(poor, 'choices')).toBe(false);
    const out = degradeChoices(
      { kind: 'choices', body: 'اختر موعداً', options: [{ id: 'a', title: '7:00' }, { id: 'b', title: '8:30' }] },
      poor,
    );
    expect(out).toEqual({ kind: 'text', body: 'اختر موعداً\n\n1) 7:00\n2) 8:30' });
  });

  it('قناةٌ بردودٍ سريعة تستطيع عرض الخيارات وإن لم تدعم الأزرار — حالة إنستجرام', () => {
    const ig: ChannelCapabilities = { ...caps, buttons: 0, quickReplies: 13, location: false };
    expect(canRender(ig, 'choices')).toBe(true);
    expect(canRender(ig, 'location')).toBe(false);
  });
});
