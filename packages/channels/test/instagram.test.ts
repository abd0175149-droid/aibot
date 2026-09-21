import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { InstagramAdapter } from '../src/instagram.js';
import { WhatsAppAdapter } from '../src/whatsapp.js';
import { getAdapter, canRender, degradeChoices } from '../src/index.js';

const ig = new InstagramAdapter();
const SECRET = 'platform-app-secret';

describe('حلّ المستأجر — الفرق الجوهريّ بين القناتين', () => {
  it('إنستجرام يُعرَف من معرّف الحساب في الحمولة لا من المسار', () => {
    const key = ig.resolveKey({
      headers: {}, rawBody: Buffer.alloc(0),
      body: { entry: [{ id: '17841400000000000', messaging: [] }] },
    });
    expect(key).toEqual({ by: 'account', externalId: '17841400000000000' });
  });

  it('حتّى لو جاء مسارٌ، إنستجرام يتجاهله — تطبيق المنصّة له ويبهوكٌ واحد', () => {
    const key = ig.resolveKey({
      pathPublicId: 'ABC', headers: {}, rawBody: Buffer.alloc(0),
      body: { entry: [{ id: '999' }] },
    });
    expect(key).toEqual({ by: 'account', externalId: '999' });
  });

  it('واتساب عكسه تماماً: من المسار لا من الحمولة', () => {
    const wa = new WhatsAppAdapter();
    expect(wa.resolveKey({ pathPublicId: 'XYZ', headers: {}, rawBody: Buffer.alloc(0), body: {} }))
      .toEqual({ by: 'path', publicId: 'XYZ' });
  });

  it('التوقيع إلزاميّ هنا أيضاً', () => {
    const raw = Buffer.from('{"entry":[]}');
    const sig = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
    expect(ig.verifySignature(raw, sig, SECRET)).toBe(true);
    expect(ig.verifySignature(raw, sig, 'other')).toBe(false);
    expect(ig.verifySignature(raw, undefined, SECRET)).toBe(false);
  });
});

describe('تحليل حمولة ماسنجر — بنيةٌ مختلفة كلّيّاً عن واتساب', () => {
  const IG_ACCOUNT = '17841400000000000';
  const payload = {
    entry: [{
      id: IG_ACCOUNT,
      messaging: [
        { sender: { id: 'IGSID_111' }, recipient: { id: IG_ACCOUNT }, timestamp: 1758450000000,
          message: { mid: 'mid.A', text: 'في اشي نباتي؟' } },
        { sender: { id: 'IGSID_111' }, recipient: { id: IG_ACCOUNT }, timestamp: 1758450060000,
          message: { mid: 'mid.B', text: 'شوف القائمة', quick_reply: { payload: 'menu' } } },
        // صدى رسالتنا نحن — يجب أن يُتجاهل وإلّا ردّ البوت على نفسه
        { sender: { id: IG_ACCOUNT }, recipient: { id: 'IGSID_111' }, timestamp: 1758450090000,
          message: { mid: 'mid.C', text: 'أهلاً', is_echo: true } },
        { sender: { id: 'IGSID_111' }, recipient: { id: IG_ACCOUNT }, timestamp: 1758450120000,
          read: { mid: 'mid.C' } },
      ],
    }],
  };

  it('يستخرج الرسائل ويستعمل IGSID هويّةً لا رقم هاتف', () => {
    const p = ig.parseWebhook(payload);
    expect(p.messages).toHaveLength(2);
    expect(p.messages[0]!.from).toBe('IGSID_111');
    expect(p.messages[0]!.text).toBe('في اشي نباتي؟');
  });

  it('الردّ السريع يصل كـbuttonPayload — كالزرّ في واتساب تماماً', () => {
    const p = ig.parseWebhook(payload);
    expect(p.messages[1]!.type).toBe('interactive');
    expect(p.messages[1]!.buttonPayload).toBe('menu');
  });

  it('صدى رسائلنا يُتجاهل — وإلّا ردّ البوت على نفسه بلا نهاية', () => {
    const p = ig.parseWebhook(payload);
    expect(p.messages.map((m) => m.externalId)).not.toContain('mid.C');
  });

  it('ردّ الستوري نوعٌ مستقلّ', () => {
    const p = ig.parseWebhook({ entry: [{ id: 'A', messaging: [{
      sender: { id: 'S' }, timestamp: 1, message: { mid: 'm', attachments: [{ type: 'story_mention', payload: { url: 'https://cdn/x.jpg' } }] },
    }] }] });
    expect(p.messages[0]!.type).toBe('story_reply');
  });

  it('التعليقات والإشارات أحداث حساب لا محادثات', () => {
    const p = ig.parseWebhook({ entry: [{ id: 'A', changes: [{ field: 'comments', value: { id: 'c1' } }] }] });
    expect(p.messages).toHaveLength(0);
    expect(p.accountEvents[0]!.kind).toBe('comments');
  });

  it('لا ينهار على حمولةٍ مشوّهة', () => {
    expect(() => ig.parseWebhook(null)).not.toThrow();
    expect(ig.parseWebhook({ entry: [{}] }).messages).toHaveLength(0);
  });
});

describe('القدرات — ما تفرضه القناة على الأدوات', () => {
  const caps = getAdapter('instagram').capabilities;

  it('لا أزرار، بل ردودٌ سريعة — والنيّة نفسها تُصيَّر إلى الاثنين', () => {
    expect(caps.buttons).toBe(0);
    expect(caps.quickReplies).toBe(13);
    expect(canRender(caps, 'choices')).toBe(true); // ما زال يستطيع عرض الخيارات
  });

  it('لا موقع — فأداة send_location تُحذف من التعريفات تلقائيّاً', () => {
    expect(caps.location).toBe(false);
    expect(canRender(caps, 'location')).toBe(false);
  });

  it('الهويّة معرّفٌ خاصّ لا هاتف — وهذا ما كسر (tenant, phone)', () => {
    expect(caps.identityKind).toBe('scoped_id');
    expect(getAdapter('whatsapp_cloud').capabilities.identityKind).toBe('phone');
  });

  it('النافذة 24 ساعة في القناتين — فحارس النافذة ينتقل بلا تعديل', () => {
    expect(caps.windowHours).toBe(24);
    expect(getAdapter('whatsapp_cloud').capabilities.windowHours).toBe(24);
  });

  it('لا قوالب — وهو سبب اختلاف نموذج الملكيّة', () => {
    expect(caps.templates).toBe(false);
    expect(getAdapter('whatsapp_cloud').capabilities.templates).toBe(true);
  });

  it('الخيارات تبقى خياراتٍ ولا تتحوّل نصّاً — لأنّ الردود السريعة كافية', () => {
    const msg = { kind: 'choices' as const, body: 'اختر', options: [{ id: 'a', title: 'القائمة' }] };
    expect(degradeChoices(msg, caps)).toBe(msg);
  });
});
