import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ChannelAdapter, ChannelCapabilities, DecryptedCreds, HealthReport, NormalizedInbound,
  OutboundMessage, ParsedWebhook, RawWebhook, ResolveKey, SendResult,
} from './types.js';
import { ChannelError } from './types.js';

const GRAPH = process.env.GRAPH_BASE ?? 'https://graph.facebook.com/v21.0';

/**
 * محوّل إنستجرام.
 *
 * هذا الملفّ هو كلّ ما لزم لإضافة قناةٍ ثانية: لا تعديل في النواة، ولا في
 * الطوابير، ولا في الإنبوكس، ولا في عدّاد النوافذ، ولا في الحرّاس.
 * وهو الدليل العمليّ على أنّ حدّ `packages/channels` صحيح.
 *
 * الفروق الجوهريّة عن واتساب — وكلّها محصورةٌ هنا:
 *  ① الملكيّة: تطبيق **المنصّة** لا تطبيق العميل، والعميل يمنح بـOAuth.
 *     ولذلك المستأجر يُعرَف من `entry[].id` لا من مسار الويبهوك.
 *  ② الحمولة بنمط ماسنجر: `entry[].messaging[]` لا `entry[].changes[].value`.
 *  ③ لا أزرار — ردودٌ سريعة (13) بدلاً منها.
 *  ④ لا إرسال موقع، فأداة `send_location` تُحذف من التعريفات تلقائيّاً.
 *  ⑤ الهويّة `IGSID` لا رقم هاتف.
 *  ⑥ تصل ردود الستوري والإشارات كأنواع أحداثٍ إضافيّة.
 *
 * وما لا يختلف: نافذة الـ24 ساعة، وتوقيع `X-Hub-Signature-256` — ولذلك
 * ينتقل حارس النافذة وعدّاد الفوترة بلا تعديلٍ واحد.
 */

export const instagramCapabilities: ChannelCapabilities = {
  buttons: 0,
  quickReplies: 13,
  lists: false,
  location: false,
  templates: false,
  windowHours: 24,
  maxTextLen: 1000,
  identityKind: 'scoped_id',
  mediaKinds: ['image', 'audio', 'video', 'story_reply'],
  choiceTitleLen: 20,
};

export class InstagramAdapter implements ChannelAdapter {
  readonly kind = 'instagram' as const;
  readonly capabilities = instagramCapabilities;

  /** تطبيق المنصّة له ويبهوكٌ واحد — فالمستأجر من معرّف الحساب في الحمولة. */
  resolveKey(req: RawWebhook): ResolveKey | null {
    const entry = (req.body as any)?.entry?.[0];
    const id = entry?.id;
    return id ? { by: 'account', externalId: String(id) } : null;
  }

  /** نفس الترويسة ونفس الخوارزميّة — لكنّ السرّ سرُّ **تطبيق المنصّة**. */
  verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
    if (!header || !appSecret) return false;
    const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const a = Buffer.from(header, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(body: unknown): ParsedWebhook {
    const out: ParsedWebhook = { messages: [], statuses: [], accountEvents: [] };
    const entries = (body as any)?.entry;
    if (!Array.isArray(entries)) return out;

    for (const entry of entries) {
      const igAccountId = String(entry?.id ?? '');

      for (const ev of entry?.messaging ?? []) {
        const senderId = String(ev?.sender?.id ?? '');
        // صدى رسائلنا نحن يعود في نفس الويبهوك — يُتجاهل وإلّا ردّ البوت على نفسه
        if (!senderId || senderId === igAccountId || ev?.message?.is_echo) continue;

        const at = new Date(Number(ev.timestamp ?? Date.now()));

        if (ev.message) {
          out.messages.push({
            externalId: String(ev.message.mid),
            from: senderId,
            fromHandle: null, // إنستجرام لا يرسل الاسم مع الرسالة — يُجلب عند الحاجة
            at,
            ...mapMessage(ev.message),
            raw: ev,
          });
          continue;
        }

        if (ev.postback) {
          out.messages.push({
            externalId: String(ev.postback.mid ?? `pb:${ev.timestamp}`),
            from: senderId, fromHandle: null, at,
            type: 'button',
            text: ev.postback.title ?? null,
            buttonPayload: ev.postback.payload ?? null,
            mediaId: null,
            raw: ev,
          });
          continue;
        }

        if (ev.read || ev.delivery) {
          const ids: string[] = ev.delivery?.mids ?? [];
          for (const mid of ids) {
            out.statuses.push({
              externalId: String(mid),
              status: ev.read ? 'read' : 'delivered',
              errorCode: null, errorMessage: null, at,
            });
          }
          continue;
        }

        out.accountEvents.push({ kind: 'unknown_messaging', detail: ev });
      }

      // تعليقات وإشارات — ليست محادثاتٍ مباشرة
      for (const change of entry?.changes ?? []) {
        out.accountEvents.push({ kind: String(change?.field ?? 'change'), detail: change?.value });
      }
    }
    return out;
  }

  async send(creds: DecryptedCreds, to: string, msg: OutboundMessage): Promise<SendResult> {
    const payload = renderOutbound(to, msg);
    const json = await graph(`${GRAPH}/${creds.externalAccountId}/messages`, creds.token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const id = json?.message_id ?? json?.mid;
    if (!id) throw new ChannelError('NO_MESSAGE_ID', 'إنستجرام لم يُرجع معرّف رسالة', true, 200, json);
    return { externalId: String(id) };
  }

  async markRead(creds: DecryptedCreds, externalId: string): Promise<void> {
    await graph(`${GRAPH}/${creds.externalAccountId}/messages`, creds.token, {
      method: 'POST',
      body: JSON.stringify({ recipient: { id: externalId }, sender_action: 'mark_seen' }),
    }).catch(() => undefined);
  }

  /**
   * فحصٌ أبسط من واتساب: لا تقييم جودةٍ ولا مستوى إرسال ولا مراجعة WABA —
   * لأنّ الرسائل المباشرة بلا قوالب ولا حملات، فسطح المخالفة أضيق أصلاً.
   */
  async healthCheck(creds: DecryptedCreds): Promise<HealthReport> {
    const issues: string[] = [];
    try {
      const me = await graph(
        `${GRAPH}/${creds.externalAccountId}?fields=id,username,name,profile_picture_url`,
        creds.token,
      );
      return {
        level: 'ok', tokenValid: true, webhookSubscribed: null,
        qualityRating: null, messagingTier: null, issues, detail: { account: me },
      };
    } catch (e) {
      const err = e as ChannelError;
      issues.push(`تعذّر قراءة الحساب: ${err.message}`);
      return {
        // 190 = توكن منتهٍ أو مسحوب ⟵ العميل يحتاج إعادة منح، لا عطل شبكة
        level: err.code === '190' ? 'blocked' : 'unreachable',
        tokenValid: false, webhookSubscribed: null,
        qualityRating: null, messagingTier: null, issues, detail: {},
      };
    }
  }

  async fetchMedia(_creds: DecryptedCreds, mediaUrl: string) {
    // إنستجرام يرسل رابطاً موقَّتاً مباشرةً لا معرّفاً يُستبدل
    try {
      const res = await fetch(mediaUrl, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      return {
        data: Buffer.from(await res.arrayBuffer()),
        mime: res.headers.get('content-type') ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }
}

/* ───────────────────────── مساعدات ───────────────────────── */

function mapMessage(m: any): Pick<NormalizedInbound, 'type' | 'text' | 'buttonPayload' | 'mediaId'> {
  if (m.quick_reply) {
    return { type: 'interactive', text: m.text ?? null, buttonPayload: m.quick_reply.payload ?? null, mediaId: null };
  }
  const att = m.attachments?.[0];
  if (att) {
    const url = att.payload?.url ?? null;
    if (att.type === 'story_mention' || m.reply_to?.story) {
      return { type: 'story_reply', text: m.text ?? null, buttonPayload: null, mediaId: url };
    }
    const t = ['image', 'audio', 'video'].includes(att.type) ? att.type : 'unsupported';
    return { type: t as 'image', text: m.text ?? null, buttonPayload: null, mediaId: url };
  }
  if (typeof m.text === 'string') return { type: 'text', text: m.text, buttonPayload: null, mediaId: null };
  return { type: 'unsupported', text: null, buttonPayload: null, mediaId: null };
}

/** نفس النيّة، شكلٌ آخر: «اعرض خيارات» تصير ردوداً سريعة لا أزراراً. */
function renderOutbound(to: string, msg: OutboundMessage): Record<string, unknown> {
  const recipient = { id: to };
  switch (msg.kind) {
    case 'text':
      return { recipient, message: { text: msg.body.slice(0, 1000) } };
    case 'choices':
      return {
        recipient,
        message: {
          text: msg.body.slice(0, 1000),
          quick_replies: msg.options.slice(0, 13).map((o) => ({
            content_type: 'text',
            title: o.title.slice(0, 20),
            payload: o.id.slice(0, 1000),
          })),
        },
      };
    case 'image':
      return {
        recipient,
        message: { attachment: { type: 'image', payload: { url: msg.url, is_reusable: true } } },
      };
    case 'location':
      // لا تصل هنا: `canRender` يمنعها، والأداة محذوفةٌ من التعريفات أصلاً.
      throw new ChannelError('UNSUPPORTED', 'إنستجرام لا يدعم إرسال الموقع', false);
  }
}

async function graph(url: string, token: string, init?: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new ChannelError('NETWORK', `تعذّر الوصول إلى Graph: ${(e as Error).message}`, true);
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ChannelError(
      String(err.code ?? res.status),
      err.message ?? `Graph ${res.status}`,
      res.status === 429 || res.status >= 500,
      res.status, json,
    );
  }
  return json;
}
