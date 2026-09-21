import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ChannelAdapter, ChannelCapabilities, DecryptedCreds, HealthReport, OutboundMessage,
  ParsedWebhook, RawWebhook, ResolveKey, SendResult,
} from './types.js';
import { ChannelError } from './types.js';
import { normalizeAnyPhone } from './phone.js';

const GRAPH = process.env.GRAPH_BASE ?? 'https://graph.facebook.com/v21.0';

/**
 * أكوادٌ من ميتا مقبولةٌ ولا تُصنَّف عطلاً — نشاطٌ غير موثَّق، SIP غير مفعّل…
 * بلا هذه القائمة يمتلئ سجلّ الحوادث بضجيجٍ فتُطفَأ التنبيهات بعد أسبوع.
 */
const IGNORED_CODES = new Set(['2593109', '2593110', '131009']);

export const whatsappCapabilities: ChannelCapabilities = {
  buttons: 3,
  quickReplies: 0,
  lists: true,
  location: true,
  templates: true,
  windowHours: 24,
  maxTextLen: 4096,
  identityKind: 'phone',
  mediaKinds: ['image', 'audio', 'document', 'video'],
  choiceTitleLen: 20,
};

export class WhatsAppAdapter implements ChannelAdapter {
  readonly kind = 'whatsapp_cloud' as const;
  readonly capabilities = whatsappCapabilities;

  /** BYO: لكلّ عميلٍ رابطُه، فالمستأجر يُعرَف من المسار. */
  resolveKey(req: RawWebhook): ResolveKey | null {
    return req.pathPublicId ? { by: 'path', publicId: req.pathPublicId } : null;
  }

  /**
   * التوقيع **إلزاميّ**. غياب App Secret يعني القناة معطَّلة، لا «تعمل بلا تحقّق».
   * (كان اختياريّاً في النظام القديم — أي أنّ أيّ أحدٍ يستطيع حقن رسائل.)
   */
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
      for (const change of entry?.changes ?? []) {
        const field = change?.field;
        const value = change?.value ?? {};

        if (field !== 'messages') {
          out.accountEvents.push({ kind: field ?? 'unknown', detail: value });
          continue;
        }

        for (const m of value.messages ?? []) {
          out.messages.push({
            externalId: String(m.id),
            from: normalizeAnyPhone(String(m.from)),
            fromHandle: value.contacts?.[0]?.profile?.name ?? null,
            at: new Date(Number(m.timestamp) * 1000),
            ...mapInboundType(m),
            raw: m,
          });
        }

        for (const s of value.statuses ?? []) {
          const err = s.errors?.[0];
          out.statuses.push({
            externalId: String(s.id),
            status: s.status,
            errorCode: err ? String(err.code) : null,
            errorMessage: err ? String(err.title ?? err.message ?? '') : null,
            at: new Date(Number(s.timestamp) * 1000),
          });
        }
      }
    }
    return out;
  }

  async send(creds: DecryptedCreds, to: string, msg: OutboundMessage): Promise<SendResult> {
    const payload = renderOutbound(to, msg);
    const res = await graph(
      `${GRAPH}/${creds.externalAccountId}/messages`,
      creds.token,
      { method: 'POST', body: JSON.stringify(payload) },
    );
    const id = res?.messages?.[0]?.id;
    if (!id) throw new ChannelError('NO_MESSAGE_ID', 'ميتا لم تُرجع معرّف رسالة', true, 200, res);
    return { externalId: String(id) };
  }

  async markRead(creds: DecryptedCreds, externalId: string): Promise<void> {
    await graph(`${GRAPH}/${creds.externalAccountId}/messages`, creds.token, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: externalId }),
    }).catch(() => undefined); // إشعار القراءة ليس حرجاً — لا يُفشل شيئاً
  }

  /**
   * ستّة فحوص. أهمّها الأخير: **اشتراك الويبهوك** — السبب الأوّل لـ«البوت لا يردّ»
   * بينما كلّ شيءٍ آخر يبدو سليماً.
   */
  async healthCheck(creds: DecryptedCreds): Promise<HealthReport> {
    const issues: string[] = [];
    const detail: Record<string, unknown> = {};
    let tokenValid = false;
    let webhookSubscribed: boolean | null = null;
    let quality: string | null = null;
    let tier: string | null = null;
    let level: HealthReport['level'] = 'ok';

    try {
      const phone = await graph(
        `${GRAPH}/${creds.externalAccountId}?fields=verified_name,quality_rating,` +
        `throughput,code_verification_status,platform_type,status`,
        creds.token,
      );
      tokenValid = true;
      detail.phone = phone;
      quality = phone?.quality_rating ?? null;
      tier = phone?.throughput?.level ?? null;

      if (phone?.status && phone.status !== 'CONNECTED') {
        issues.push(`حالة الرقم ${phone.status}`);
        level = 'blocked';
      }
      if (quality === 'YELLOW') {
        issues.push('تقييم الرقم أصفر — أوقف أيّ إرسالٍ جماعيّ فوراً وراجع الردود');
        if (level === 'ok') level = 'degraded';
      }
      if (quality === 'RED') {
        issues.push('تقييم الرقم أحمر — الإرسال الجماعيّ مقفلٌ آليّاً حتّى تفكّه يدويّاً');
        level = 'blocked';
      }
    } catch (e) {
      const err = e as ChannelError;
      if (!IGNORED_CODES.has(err.code)) {
        issues.push(`التوكن أو الرقم غير قابلٍ للقراءة: ${err.message}`);
        level = 'unreachable';
      }
    }

    const wabaId = creds.config.wabaId as string | undefined;
    if (wabaId && tokenValid) {
      try {
        const subs = await graph(`${GRAPH}/${wabaId}/subscribed_apps`, creds.token);
        webhookSubscribed = Array.isArray(subs?.data) && subs.data.length > 0;
        detail.subscribedApps = subs?.data ?? [];
        if (!webhookSubscribed) {
          issues.push('التطبيق غير مشترك في حقول الويبهوك — لن تصل رسالةٌ واحدة');
          level = 'blocked';
        }
      } catch {
        webhookSubscribed = null;
      }
    }

    return { level, tokenValid, webhookSubscribed, qualityRating: quality, messagingTier: tier, issues, detail };
  }

  async fetchMedia(creds: DecryptedCreds, mediaId: string) {
    try {
      const meta = await graph(`${GRAPH}/${mediaId}`, creds.token);
      if (!meta?.url) return null;
      const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${creds.token}` } });
      if (!res.ok) return null;
      return { data: Buffer.from(await res.arrayBuffer()), mime: String(meta.mime_type ?? 'application/octet-stream') };
    } catch {
      return null;
    }
  }
}

/* ───────────────────────── مساعدات ───────────────────────── */

function mapInboundType(m: any): Pick<import('./types.js').NormalizedInbound, 'type' | 'text' | 'buttonPayload' | 'mediaId'> {
  switch (m.type) {
    case 'text':
      return { type: 'text', text: m.text?.body ?? '', buttonPayload: null, mediaId: null };
    case 'button':
      return { type: 'button', text: m.button?.text ?? null, buttonPayload: m.button?.payload ?? m.button?.text ?? null, mediaId: null };
    case 'interactive': {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
      return { type: 'interactive', text: r?.title ?? null, buttonPayload: r?.id ?? null, mediaId: null };
    }
    case 'image': case 'audio': case 'video': case 'document':
      return { type: m.type, text: m[m.type]?.caption ?? null, buttonPayload: null, mediaId: m[m.type]?.id ?? null };
    case 'location':
      return { type: 'location', text: null, buttonPayload: null, mediaId: null };
    default:
      return { type: 'unsupported', text: null, buttonPayload: null, mediaId: null };
  }
}

/**
 * تصيير النيّة إلى شكل واتساب.
 * الأدوات تُنتج «اعرض خيارات» — لا «أرسل أزراراً». وهنا تُترجَم،
 * فقناةٌ ثالثة تحتاج محوّلاً لا تعديلاً في الأدوات.
 */
function renderOutbound(to: string, msg: OutboundMessage): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  switch (msg.kind) {
    case 'text':
      return { ...base, type: 'text', text: { body: msg.body.slice(0, 4096), preview_url: false } };
    case 'choices':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: msg.body.slice(0, 1024) },
          action: {
            buttons: msg.options.slice(0, 3).map((o) => ({
              type: 'reply',
              // ميتا ترفض الرسالة كاملةً إن تجاوز العنوان 20 حرفاً — القصّ هنا لا في الأداة
              reply: { id: o.id.slice(0, 256), title: o.title.slice(0, 20) },
            })),
          },
        },
      };
    case 'location':
      return {
        ...base, type: 'location',
        location: { latitude: msg.lat, longitude: msg.lng, name: msg.name, address: msg.address },
      };
    case 'image':
      return { ...base, type: 'image', image: { link: msg.url, caption: msg.caption } };
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
  const json = text ? safeJson(text) : null;

  if (!res.ok) {
    const err = json?.error ?? {};
    const code = String(err.code ?? res.status);
    // 429 و5xx قابلة للإصلاح بإعادة المحاولة؛ 4xx الأخرى فشلٌ دائم يُنتج حادثة
    const retryable = res.status === 429 || res.status >= 500;
    throw new ChannelError(code, err.message ?? `Graph ${res.status}`, retryable, res.status, json);
  }
  return json;
}

function safeJson(t: string): any {
  try { return JSON.parse(t); } catch { return { raw: t }; }
}
