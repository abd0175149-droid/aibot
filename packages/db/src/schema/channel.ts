import {
  pgTable, uuid, text, varchar, boolean, integer, timestamp, jsonb, numeric,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { uuid7, now } from './_common';
import { tenants, users } from './platform';

/* ═══════════════ القنوات والهويّة ═══════════════ */

/**
 * قناةٌ لكلّ مستأجر. النموذجان مختلفان عن قصد (٠٣.٢):
 *  • whatsapp_cloud — BYO: توكن العميل وApp Secret الخاصّ به،
 *                     والمستأجر يُعرَف من مسار الويبهوك `/webhooks/wa/:publicId`.
 *  • instagram      — تطبيق المنصّة: لا توكن يُلصق،
 *                     والمستأجر يُعرَف من `external_account_id` داخل الحمولة.
 * ولذلك `resolveTenantChannel` تحتمل المسارَين من اليوم الأوّل.
 */
export const tenantChannels = pgTable('tenant_channels', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['whatsapp_cloud', 'instagram'] }).notNull(),
  /** phone_number_id لواتساب · ig_user_id لإنستجرام. مفتاح الحلّ في ويبهوك المنصّة. */
  externalAccountId: text('external_account_id'),
  displayName: text('display_name'),
  /** ما يخصّ كلّ قناة وحدها: {wabaId} أو {pageId, igUsername} — لا أعمدة فارغة لكلّ نوع. */
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  /** ما تستطيعه هذه القناة. يُقرأ منه — ولا شرطَ قناةٍ في الكود. */
  capabilities: jsonb('capabilities').notNull().default(sql`'{}'::jsonb`),
  tokenEnc: text('token_enc'),
  tokenFingerprint: text('token_fingerprint'),
  appSecretEnc: text('app_secret_enc'),
  verifyToken: text('verify_token'),
  keyVersion: integer('key_version').notNull().default(1),
  status: text('status', { enum: ['pending', 'connected', 'error', 'disabled'] })
    .notNull().default('pending'),
  qualityRating: text('quality_rating'),
  messagingTier: text('messaging_tier'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastError: text('last_error'),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
}, (t) => [
  /** رقمٌ (أو حساب إنستجرام) واحد لا يخدم مستأجرَين — وهو أيضاً مفتاح الحلّ من الحمولة. */
  uniqueIndex('channels_account_uq').on(t.kind, t.externalAccountId),
  index('channels_tenant_idx').on(t.tenantId, t.kind),
]);

/** الإنسان. مجرَّدٌ عن القناة عمداً — ولذلك `phone` هنا nullable. */
export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  phone: text('phone'),
  displayName: text('display_name'),
  attributes: jsonb('attributes').notNull().default(sql`'{}'::jsonb`),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
  blockedAt: timestamp('blocked_at', { withTimezone: true }),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().default(now),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().default(now),
}, (t) => [
  index('contacts_tenant_phone_idx').on(t.tenantId, t.phone),
  index('contacts_tenant_seen_idx').on(t.tenantId, t.lastSeenAt),
]);

/**
 * ★ معرّفات الإنسان الواحد عبر القنوات.
 *
 * هذا الجدول هو ما يجعل إنستجرام ممكناً بلا ترحيلٍ لاحق: القيد الفريد انتقل من
 * `(tenant_id, phone)` إلى `(tenant_id, channel_id, external_id)`، فصار IGSID
 * مواطناً من الدرجة الأولى، وصار دمج هويّتين زرّاً في الواجهة لا ترحيلاً.
 *
 * ولماذا جدولٌ ثالث لا عمودان في `contacts`: لو وُضعا هناك لصار الإنسان الواحد
 * صفَّين لا يُدمجان، وتجزّأت بطاقته وتوزّعت ملاحظاته ووسومه.
 */
export const channelIdentities = pgTable('channel_identities', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => tenantChannels.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  /** E.164 · 07… · IGSID */
  externalId: text('external_id').notNull(),
  displayHandle: text('display_handle'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex('identities_uq').on(t.tenantId, t.channelId, t.externalId),
  index('identities_contact_idx').on(t.tenantId, t.contactId),
]);

/** محادثةٌ مستقلّة لكلّ قناة — والنافذة تتبعها، فالفوترة لكلّ قناة لا لكلّ إنسان. */
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => tenantChannels.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  identityId: uuid('identity_id').notNull().references(() => channelIdentities.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
  botEnabled: boolean('bot_enabled').notNull().default(true),
  botPausedUntil: timestamp('bot_paused_until', { withTimezone: true }),
  assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
  needsAttention: boolean('needs_attention').notNull().default(false),
  unreadCount: integer('unread_count').notNull().default(0),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  lastMessagePreview: text('last_message_preview'),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  windowId: uuid('window_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
}, (t) => [
  /** هويّةٌ واحدة = محادثةٌ واحدة. هذا ما يمنع ازدواج المحادثات عند تدفّقٍ متزامن. */
  uniqueIndex('conv_identity_uq').on(t.tenantId, t.identityId),
  index('conv_recent_idx').on(t.tenantId, t.lastMessageAt),
  index('conv_attn_idx').on(t.tenantId, t.needsAttention),
]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => tenantChannels.id, { onDelete: 'cascade' }),
  /** wamid لواتساب · mid لإنستجرام. فريدٌ داخل القناة — حمايةٌ من تكرار الويبهوك. */
  externalId: text('external_id'),
  direction: text('direction', { enum: ['in', 'out'] }).notNull(),
  source: text('source', { enum: ['customer', 'bot', 'agent', 'system', 'template'] }).notNull(),
  type: text('type').notNull().default('text'),
  body: text('body'),
  payload: jsonb('payload'),
  /** الحمولة الخام كما وصلت — للتشخيص ولإعادة التحليل بعد إصلاح محلّل. */
  channelPayload: jsonb('channel_payload'),
  status: text('status', { enum: ['queued', 'sent', 'delivered', 'read', 'failed'] }),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  aiRunId: uuid('ai_run_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  /** لا حذف صلب — واتساب لا يدعم السحب، وسجلّك يجب أن يطابق الواقع. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('messages_external_uq').on(t.channelId, t.externalId),
  index('messages_conv_idx').on(t.conversationId, t.createdAt),
  index('messages_tenant_idx').on(t.tenantId, t.createdAt),
]);

/**
 * ★ الجدول الذي يُفوتَر عليه.
 * تُفتح عند أوّل واردٍ بلا نافذة، وتُمدَّد مع كلّ وارد، و**تُختم عند أوّل صادرٍ داخلها**.
 * فرسالةٌ لا يردّ عليها أحدٌ لا تُفوتَر — وهذا ما يجعل العدّاد قابلاً للدفاع عنه أمام العميل.
 */
export const conversationWindows = pgTable('conversation_windows', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => tenantChannels.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().default(now),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  billedAt: timestamp('billed_at', { withTimezone: true }),
  billingPeriod: varchar('billing_period', { length: 7 }),
  firstOutboundMessageId: uuid('first_outbound_message_id'),
  messagesIn: integer('messages_in').notNull().default(0),
  messagesOut: integer('messages_out').notNull().default(0),
  botReplies: integer('bot_replies').notNull().default(0),
  aiCostUsd: numeric('ai_cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (t) => [
  index('windows_period_idx').on(t.tenantId, t.billingPeriod),
  index('windows_expiry_idx').on(t.conversationId, t.expiresAt),
]);

export const optouts = pgTable('optouts', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
}, (t) => [uniqueIndex('optouts_uq').on(t.tenantId, t.contactId)]);
