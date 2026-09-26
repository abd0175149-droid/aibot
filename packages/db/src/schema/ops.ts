import {
  pgTable, uuid, text, varchar, boolean, integer, timestamp, jsonb, numeric, index, uniqueIndex, primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { uuid7, now } from './_common';
import { tenants, users } from './platform';
import { tenantChannels } from './channel';

/* ═══════════════ التشغيل والمراقبة ═══════════════ */

/**
 * كلّ عطلٍ يستحقّ انتباهك.
 * البصمة تشمل القناة: `kind + tenant + channel + السبب` — فواتساب مقطوعةٌ
 * وإنستجرام تعمل حادثتان مختلفتان لا واحدة.
 */
export const incidents = pgTable('incidents', {
  id: uuid('id').primaryKey().default(uuid7),
  /** فارغ = عطل منصّة لا عطل عميل. */
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').references(() => tenantChannels.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  severity: text('severity', { enum: ['info', 'warn', 'critical'] }).notNull(),
  title: text('title').notNull(),
  detail: jsonb('detail'),
  status: text('status', { enum: ['open', 'ack', 'resolved'] }).notNull().default('open'),
  fingerprint: text('fingerprint').notNull(),
  count: integer('count').notNull().default(1),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().default(now),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().default(now),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
}, (t) => [
  index('incidents_tenant_idx').on(t.tenantId, t.status, t.lastSeenAt),
]);

export const healthChecks = pgTable('health_checks', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => tenantChannels.id, { onDelete: 'cascade' }),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().default(now),
  level: text('level', { enum: ['ok', 'degraded', 'blocked', 'unreachable'] }).notNull(),
  tokenValid: boolean('token_valid'),
  webhookSubscribed: boolean('webhook_subscribed'),
  detail: jsonb('detail'),
  issues: jsonb('issues'),
  latencyMs: integer('latency_ms'),
}, (t) => [index('health_channel_idx').on(t.tenantId, t.channelId, t.checkedAt)]);

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().default(uuid7),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
  failCount: integer('fail_count').notNull().default(0),
}, (t) => [index('push_user_idx').on(t.userId)]);

/**
 * ما أُرسل ولماذا.
 * فريدٌ جزئيّ على (user_id, tag) حيث read_at IS NULL — دورة حياةٍ واحدة لكلّ موضوع.
 * (الدرس المدفوع: صفُّ إشعارٍ لكلّ دفعة أغرق الصندوق.)
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().default(uuid7),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  data: jsonb('data'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
}, (t) => [index('notif_user_idx').on(t.userId, t.createdAt)]);

/**
 * عتباتُ السقف التي أُنذر بها العميل — صفٌّ لكلّ (مستأجر · دورة · عتبة).
 *
 * ★ لماذا جدولٌ لا عمود: **الفريدُ هو الضمانة.** `ON CONFLICT DO NOTHING …
 *   RETURNING` يُرجع صفّاً للفائز وحده، فتُطلَق العتبةُ مرّةً واحدةً ولو
 *   تسابق عاملان على نافذتين في نفس اللحظة. وقراءةٌ ثمّ كتابةٌ في عمودٍ
 *   jsonb تُنتج إنذارَين في هذا السباق بالضبط.
 *
 * ★ ولا تصفيرَ مجدولاً: **الدورة جزءٌ من المفتاح.** فشهرٌ جديد لا صفوفَ له،
 *   فيُنذر من جديد بلا مهمّةٍ تنظيفٍ تُنسى أو تفشل.
 *
 * والصفّ يحمل `windowsUsed`/`windowsLimit` وقتَ الإطلاق: بلا هذا لا تعرف
 * لاحقاً على أيّ سقفٍ أُنذر العميل — والسقف يتغيّر بترقيةٍ أو بتجاوزٍ خاصّ.
 */
export const quotaAlerts = pgTable('quota_alerts', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** نفسُ صيغة `conversation_windows.billing_period` — «YYYY-MM» بتوقيت المستأجر. */
  billingPeriod: varchar('billing_period', { length: 7 }).notNull(),
  /** 80 · 95 · 100 — نسبةٌ مئويّة صحيحة لا كسر. */
  threshold: integer('threshold').notNull(),
  windowsUsed: integer('windows_used').notNull(),
  windowsLimit: integer('windows_limit').notNull(),
  /** سياسةُ الباقة وقتَ الإنذار — لأنّ نصّ العاقبة مبنيٌّ عليها. */
  policy: text('policy').notNull(),
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull().default(now),
}, (t) => [uniqueIndex('quota_alerts_uq').on(t.tenantId, t.billingPeriod, t.threshold)]);
