import type { ChannelAdapter, ChannelKind, OutboundMessage, ChannelCapabilities } from './types.js';
import { WhatsAppAdapter, whatsappCapabilities } from './whatsapp.js';
import { InstagramAdapter, instagramCapabilities } from './instagram.js';

export * from './types.js';
export * from './phone.js';
export { WhatsAppAdapter, whatsappCapabilities };
export { InstagramAdapter, instagramCapabilities };

const REGISTRY = new Map<ChannelKind, ChannelAdapter>([
  ['whatsapp_cloud', new WhatsAppAdapter()],
  // إضافة القناة الثانية كانت سطراً واحداً هنا وملفّاً واحداً بجانبه.
  // لم تتغيّر النواة ولا الطوابير ولا الإنبوكس ولا عدّاد النوافذ ولا الحرّاس.
  ['instagram', new InstagramAdapter()],
]);

export function getAdapter(kind: ChannelKind): ChannelAdapter {
  const a = REGISTRY.get(kind);
  if (!a) throw new Error(`لا محوّل للقناة ${kind} — سجّله في packages/channels/src/index.ts`);
  return a;
}

export function isChannelSupported(kind: string): kind is ChannelKind {
  return REGISTRY.has(kind as ChannelKind);
}

export function capabilitiesFor(kind: ChannelKind): ChannelCapabilities {
  return getAdapter(kind).capabilities;
}

/**
 * هل تستطيع هذه القناة تنفيذ هذه النيّة؟
 * تُستعمل عند بناء تعريفات الأدوات: أداةٌ تحتاج قدرةً غائبة **تُحذف من التعريفات**
 * ولا تُعطَّل — فلا يعرف النموذج بوجودها ولا يَعِد بما لا يملك.
 */
export function canRender(caps: ChannelCapabilities, msg: OutboundMessage['kind']): boolean {
  switch (msg) {
    case 'text': return true;
    case 'choices': return caps.buttons > 0 || caps.quickReplies > 0;
    case 'location': return caps.location;
    case 'image': return caps.mediaKinds.includes('image');
  }
}

/**
 * مُصيِّرٌ احتياطيّ: قناةٌ لا تدعم الأزرار ولا الردود السريعة تتلقّى
 * نصّاً مرقَّماً بدل أن تفقد الخيارات كليّاً.
 */
export function degradeChoices(msg: OutboundMessage, caps: ChannelCapabilities): OutboundMessage {
  if (msg.kind !== 'choices') return msg;
  if (caps.buttons > 0 || caps.quickReplies > 0) return msg;
  const lines = msg.options.map((o, i) => `${i + 1}) ${o.title}`).join('\n');
  return { kind: 'text', body: `${msg.body}\n\n${lines}` };
}
