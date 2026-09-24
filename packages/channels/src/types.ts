import type {
  ChannelCapabilities, ChannelKind, NormalizedInbound, InboundStatus, OutboundMessage,
} from '@aibot/shared';

export type { ChannelCapabilities, ChannelKind, NormalizedInbound, InboundStatus, OutboundMessage };

/** بيانات الاعتماد بعد فكّ التشفير — تعيش في الذاكرة وقت الاستعمال فقط. */
export interface DecryptedCreds {
  channelId: string;
  tenantId: string;
  kind: ChannelKind;
  token: string;
  externalAccountId: string;
  config: Record<string, unknown>;
}

export interface RawWebhook {
  /** المعرّف العامّ من مسار الطلب — موجودٌ لواتساب فقط. */
  pathPublicId?: string;
  headers: Record<string, string | undefined>;
  rawBody: Buffer;
  body: unknown;
}

/**
 * كيف يُعرَف المستأجر من هذا الويبهوك.
 *
 * هذا هو الفرق الجوهريّ بين القناتين، وهو السبب في أنّ `resolveTenantChannel`
 * تحتمل المسارَين من اليوم الأوّل:
 *  • `path`    — واتساب BYO: تطبيق العميل يرسل إلى رابطٍ خاصّ به.
 *  • `account` — إنستجرام: تطبيق المنصّة له ويبهوكٌ واحد للجميع،
 *                فالمستأجر يُعرَف من معرّف الحساب داخل الحمولة.
 */
export type ResolveKey =
  | { by: 'path'; publicId: string }
  | { by: 'account'; externalId: string };

export interface ParsedWebhook {
  messages: NormalizedInbound[];
  statuses: InboundStatus[];
  /** أحداثٌ لا تخصّ محادثةً بعينها: جودة الرقم، مراجعة الحساب، حالة قالب. */
  accountEvents: Array<{ kind: string; detail: unknown }>;
}

export interface SendResult {
  externalId: string;
}

export interface HealthReport {
  level: 'ok' | 'degraded' | 'blocked' | 'unreachable';
  tokenValid: boolean;
  webhookSubscribed: boolean | null;
  qualityRating: string | null;
  messagingTier: string | null;
  issues: string[];
  detail: Record<string, unknown>;
}

/**
 * محوّل القناة.
 *
 * كلّ اختلافٍ بين واتساب وإنستجرام يسكن هنا. القاعدة الملزِمة:
 * **لا شرطَ قناةٍ خارج هذه الحزمة.** إن احتجتَ `if (kind === 'instagram')`
 * في النواة أو في مسارٍ أو في مكوّن واجهة، فالقدرة التي تفحصها ناقصةٌ من
 * `capabilities` — أضِفها هناك بدل الشرط.
 */
export interface ChannelAdapter {
  /**
   * ★ تجزئةُ حمولةٍ تحمل أكثر من حسابٍ إلى حمولاتٍ لكلّ حساب.
   *
   *   تطبيق المنصّة على إنستجرام له ويبهوكٌ **واحدٌ لكلّ الحسابات**، وميتا
   *   توثّق أنّ `entry` مصفوفةٌ قد تحمل أكثر من حساب في POST واحد. وكان
   *   `resolveKey` يقرأ `entry[0]` وحده بينما `parseWebhook` يجمع رسائل
   *   **كلّ** الحسابات في حمولةٍ واحدة تُدفع تحت المستأجر الأوّل: رسائلُ
   *   زبائن مستأجرٍ تُكتب في إنبوكس آخر، وبوتُه يحاول الردّ عليها بتوكنه.
   *   تسريبٌ بين مستأجرين بلا أثرٍ في السجلّ.
   *
   *   والمحوّلُ وحده يعرف شكل حمولته، فالتجزئة عنده لا في طبقة الويبهوك.
   *   وغيابُها يعني «حمولةٌ واحدةٌ لحسابٍ واحد» — وهو حال واتساب.
   */
  splitByAccount?(body: unknown): unknown[];

  readonly kind: ChannelKind;
  readonly capabilities: ChannelCapabilities;

  resolveKey(req: RawWebhook): ResolveKey | null;
  verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean;
  parseWebhook(body: unknown): ParsedWebhook;
  send(creds: DecryptedCreds, to: string, msg: OutboundMessage): Promise<SendResult>;
  markRead(creds: DecryptedCreds, externalId: string): Promise<void>;
  healthCheck(creds: DecryptedCreds): Promise<HealthReport>;
  /** تنزيل وسائط — يُرجع البايتات ونوع المحتوى، أو null إن تعذّر. */
  fetchMedia(creds: DecryptedCreds, mediaId: string): Promise<{ data: Buffer; mime: string } | null>;
}

/** خطأٌ من القناة مصنَّفٌ بقابليّة الإصلاح — يقرّر إعادة المحاولة من فشلٍ دائم. */
export class ChannelError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus?: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ChannelError';
  }
}
