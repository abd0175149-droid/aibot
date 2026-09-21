import {
  pgTable, uuid, text, boolean, integer, timestamp, jsonb, numeric, date,
  index, uniqueIndex, primaryKey,
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

/** تجميعٌ يوميّ لكلّ مستأجر وقناة — يجعل التقارير فوريّة. */
export const usageDaily = pgTable('usage_daily', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => tenantChannels.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
  windowsOpened: integer('windows_opened').notNull().default(0),
  windowsBilled: integer('windows_billed').notNull().default(0),
  messagesIn: integer('messages_in').notNull().default(0),
  messagesOut: integer('messages_out').notNull().default(0),
  botReplies: integer('bot_replies').notNull().default(0),
  agentReplies: integer('agent_replies').notNull().default(0),
  handoffs: integer('handoffs').notNull().default(0),
  unknownAnswers: integer('unknown_answers').notNull().default(0),
  aiTokens: integer('ai_tokens').notNull().default(0),
  aiCostUsd: numeric('ai_cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  avgLatencyMs: integer('avg_latency_ms'),
}, (t) => [primaryKey({ columns: [t.tenantId, t.channelId, t.day] })]);
