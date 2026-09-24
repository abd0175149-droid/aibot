import {
  pgTable, uuid, text, varchar, boolean, integer, timestamp, jsonb, numeric, index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { uuid7, now } from './_common';

/* ═══════════════ المنصّة ═══════════════ */

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().default(uuid7),
  publicId: varchar('public_id', { length: 26 }).notNull().unique(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status', { enum: ['trial', 'active', 'suspended', 'archived'] }).notNull().default('trial'),
  planId: uuid('plan_id'),
  timezone: text('timezone').notNull().default('Asia/Amman'),
  locale: text('locale', { enum: ['ar', 'en'] }).notNull().default('ar'),
  /** {campaigns:false, customTools:true, instagram:false, vision:false} — الحملات مقفلة افتراضيّاً. */
  capabilities: jsonb('capabilities').notNull().default(sql`'{"campaigns":false,"customTools":true}'::jsonb`),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(uuid7),
  /** فارغٌ لمالك المنصّة — وهو المستخدم الوحيد بلا مستأجر. */
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  role: text('role', { enum: ['platform_owner', 'tenant_owner', 'tenant_agent'] }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
}, (t) => [index('users_tenant_idx').on(t.tenantId)]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().default(uuid7),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshHash: text('refresh_hash').notNull(),
  /** ★ تجزئةُ التوكن السابق بعد التدوير — نافذةُ سماحٍ لمتسابقٍ من تبويبٍ آخر.
      وبلاها كان تبويبان يُجدّدان معاً يُسقطان المستخدم من الحساب: الخاسرُ
      يُردّ ٤٠١ ومعه مسحُ الكوكي، والكوكي مشتركٌ فيسقط الفائزُ أيضاً. */
  prevRefreshHash: text('prev_refresh_hash'),
  /** لحظةُ آخر تدوير — حدُّ نافذة السماح، فلا يبقى السابقُ صالحاً للأبد. */
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  userAgent: text('user_agent'),
  ip: text('ip'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().default(uuid7),
  name: text('name').notNull(),
  priceMonthly: numeric('price_monthly', { precision: 10, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('JOD'),
  /** {windows,aiTokens,kbChars,seats,customTools,retentionDays,dailySendCap,contacts} */
  limits: jsonb('limits').notNull(),
  overagePolicy: text('overage_policy', { enum: ['block', 'allow_bill', 'handoff_only'] })
    .notNull().default('handoff_only'),
  isPublic: boolean('is_public').notNull().default(true),
  sort: integer('sort').notNull().default(0),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').notNull().references(() => plans.id),
  status: text('status', { enum: ['active', 'past_due', 'suspended', 'cancelled'] }).notNull().default('active'),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  /** سقفٌ خاصّ لعميلٍ بعينه بلا إنشاء باقةٍ جديدة له. */
  limitsOverride: jsonb('limits_override'),
  notes: text('notes'),
}, (t) => [index('subs_tenant_idx').on(t.tenantId, t.periodEnd)]);

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: text('entity_id'),
  diff: jsonb('diff'),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
}, (t) => [index('audit_tenant_idx').on(t.tenantId, t.createdAt)]);
