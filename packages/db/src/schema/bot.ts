import {
  pgTable, uuid, text, boolean, integer, timestamp, jsonb, numeric, real,
  customType, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { uuid7, now, vector768 } from './_common';
import { tenants, users } from './platform';
import { conversations } from './channel';

/* ═══════════════ البوت ═══════════════ */

export const botConfigs = pgTable('bot_configs', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().unique().references(() => tenants.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  publishedVersionId: uuid('published_version_id'),
  draft: jsonb('draft'),
  pauseMinutes: integer('pause_minutes').notNull().default(30),
  maxToolLoops: integer('max_tool_loops').notNull().default(4),
  contextMessages: integer('context_messages').notNull().default(12),
  failMessage: text('fail_message'),
  failHandoff: boolean('fail_handoff').notNull().default(true),
  businessHours: jsonb('business_hours'),
  outsideHoursMessage: text('outside_hours_message'),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
});

/**
 * ★ النسخ المنشورة — ما ينقص النظام الحالي.
 * البوت الحيّ يقرأ النسخة المنشورة وحدها، فتعديل العميل لا يمسّ محادثةً جارية،
 * والتراجع = نشرُ نسخةٍ قديمة لا تعديلٌ في مكانه.
 */
export const botVersions = pgTable('bot_versions', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  persona: text('persona').notNull().default(''),
  /** نصّ المعرفة الكامل — يُستعمل في وضع `full` ويبقى مرجعاً في الوضعين الآخرين. */
  knowledgeBase: text('knowledge_base').notNull().default(''),
  toolsConfig: jsonb('tools_config').notNull().default(sql`'{}'::jsonb`),
  provider: text('provider').notNull().default('google'),
  model: text('model').notNull().default('gemini-2.5-flash'),
  params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
  /**
   * وضع المعرفة. العتبة 8,000 توكن لا 20,000 — راجع ٠٨.٦:
   * البادئة الثابتة تُخزَّن في الكاش بخصم، والمسترجَع يُفوتَر كاملاً،
   * فالتعادل بين 3,500 و7,700 حسب كثافة حركة العميل.
   */
  knowledgeMode: text('knowledge_mode', { enum: ['full', 'hybrid', 'rag'] }).notNull().default('full'),
  knowledgeBudget: jsonb('knowledge_budget').notNull().default(sql`'{}'::jsonb`),
  /** حالة التضمين — النشر لا يكتمل قبل جهوز الفكتورات، والنسخة القديمة تخدم حتّى ذلك. */
  embedStatus: text('embed_status', { enum: ['pending', 'ready', 'failed', 'skipped'] })
    .notNull().default('skipped'),
  publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
}, (t) => [uniqueIndex('bot_versions_uq').on(t.tenantId, t.version)]);

/** ★ الأدوات معرَّفة بالبيانات — لا دالّة TypeScript لكلّ أداة، ولا نشرٌ لكلّ عميل. */
export const botTools = pgTable('bot_tools', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  titleAr: text('title_ar').notNull(),
  /** أهمّ حقلٍ في الجدول: هو ما يقرأه النموذج ليقرّر متى يستعمل الأداة. */
  description: text('description').notNull(),
  kind: text('kind', { enum: ['builtin', 'http'] }).notNull().default('http'),
  enabled: boolean('enabled').notNull().default(true),
  adminOnly: boolean('admin_only').notNull().default(false),
  /**
   * القدرات التي تحتاجها هذه الأداة من القناة.
   * أداةٌ تحتاج `location` تُحذف من تعريفات إنستجرام — لا تُعطَّل بل **لا تُذكر**،
   * فلا يعرف النموذج بوجودها ولا يَعِد بما لا يملك.
   */
  requiresCapabilities: text('requires_capabilities').array().notNull().default(sql`'{}'::text[]`),
  paramsSchema: jsonb('params_schema').notNull().default(sql`'{"type":"object","properties":{}}'::jsonb`),
  http: jsonb('http'),
  /** JSONPath لكلّ حقل. إرجاع الاستجابة كاملةً يُغرق السياق ويضاعف الفاتورة. */
  responseMap: jsonb('response_map'),
  secretsEnc: text('secrets_enc'),
  keyVersion: integer('key_version').notNull().default(1),
  /** كلّ أداةٍ تكتب أو تدفع أو تلغي يجب أن تكون كذلك: تتحقّق وترسل أزراراً فقط. */
  confirmRequired: boolean('confirm_required').notNull().default(false),
  confirmTemplate: text('confirm_template'),
  rateLimitPerMin: integer('rate_limit_per_min').notNull().default(30),
  failureCount: integer('failure_count').notNull().default(0),
  disabledReason: text('disabled_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
}, (t) => [uniqueIndex('bot_tools_uq').on(t.tenantId, t.key)]);

export const knowledgeSources = pgTable('knowledge_sources', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['text', 'file', 'url'] }).notNull(),
  title: text('title').notNull(),
  originalName: text('original_name'),
  storagePath: text('storage_path'),
  extractedText: text('extracted_text'),
  charCount: integer('char_count').notNull().default(0),
  status: text('status', { enum: ['pending', 'ready', 'failed'] }).notNull().default('pending'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
}, (t) => [index('kb_sources_tenant_idx').on(t.tenantId, t.createdAt)]);

/**
 * ★ مقاطع المعرفة المُضمَّنة.
 * `kind='question'` يحمل مفاتيح استرجاعٍ مولَّدة بالعاميّة تشير إلى المقطع الأمّ —
 * وهي أعلى رافعةٍ لاستدعاء العربيّة: المعرفة بالفصحى والسؤال بالعاميّة.
 */
export const kbChunks = pgTable('kb_chunks', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => botVersions.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').references(() => knowledgeSources.id, { onDelete: 'cascade' }),
  ord: integer('ord').notNull(),
  /** يُحقن مع المقطع — مقطعٌ بلا عنوانٍ يفقد سياقه («150 ديناراً» لأيّ خدمة؟). */
  headingPath: text('heading_path'),
  body: text('body').notNull(),
  kind: text('kind', { enum: ['chunk', 'question'] }).notNull().default('chunk'),
  parentId: uuid('parent_id'),
  /** الأساسيات: تُحقن دائماً ولا تنافس على مقاعد الاسترجاع. */
  pinned: boolean('pinned').notNull().default(false),
  tokenCount: integer('token_count').notNull(),
  /** لا يُعاد تضمين ما لم يتغيّر — عميلٌ يصحّح سعراً لا يعيد تضمين 400 مقطع. */
  contentHash: text('content_hash').notNull(),
  /** ⚠️ خلط نموذجَي تضمينٍ في فهرسٍ واحد لا يُنتج خطأً — يُنتج ترتيباً فاسداً بصمت. */
  embedModel: text('embed_model').notNull(),
  embedding: vector768('embedding').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
}, (t) => [
  uniqueIndex('kb_chunks_uq').on(t.tenantId, t.versionId, t.sourceId, t.ord, t.kind),
  index('kb_chunks_version_idx').on(t.tenantId, t.versionId),
]);

/* ★ `kb_chunks.tsv` عمودٌ **مولَّدٌ مخزَّن** يُنشأ في `0007_kb_chunks_tsv.sql`
   ولا يُعلَن هنا: drizzle لا يعرف الأعمدة المولَّدة، وإعلانُه حقلاً عاديّاً
   يجعل أيّ `insert` يحاول الكتابة فيه فترفض القاعدة. والاستعلام الوحيد الذي
   يقرؤه نصٌّ خامٌّ في `apps/worker/src/retrieval.ts`. */

/** قياس الاسترجاع. احتفاظ 30 يوماً ثمّ تجميع. */
export const kbRetrievals = pgTable('kb_retrievals', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  aiRunId: uuid('ai_run_id'),
  mode: text('mode').notNull(),
  queryText: text('query_text'),
  chunkIds: uuid('chunk_ids').array(),
  scores: real('scores').array(),
  retrievedTokens: integer('retrieved_tokens').notNull().default(0),
  cacheHit: boolean('cache_hit').notNull().default(false),
  skipped: boolean('skipped').notNull().default(false),
  /** ارتفاعه إشارةٌ قياسيّة على أنّ التقطيع أو مفاتيح العاميّة تحتاج مراجعة. */
  toolFallbackUsed: boolean('tool_fallback_used').notNull().default(false),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
}, (t) => [index('kb_retr_tenant_idx').on(t.tenantId, t.createdAt)]);

/** بوّابة التبديل: لا يُحوَّل مستأجرٌ إلى hybrid إلّا بـrecall@6 ≥ 0.95 على مجموعته. */
export const kbEvals = pgTable('kb_evals', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  expected: text('expected'),
  mustHitChunkIds: uuid('must_hit_chunk_ids').array(),
  lastRecall: real('last_recall'),
  lastOk: boolean('last_ok'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
}, (t) => [index('kb_evals_tenant_idx').on(t.tenantId)]);

/** صفٌّ لكلّ ردّ. */
export const aiRuns = pgTable('ai_runs', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  source: text('source', { enum: ['live', 'playground'] }).notNull().default('live'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  calls: integer('calls').notNull().default(1),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  thoughtsTokens: integer('thoughts_tokens').notNull().default(0),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  keyOwner: text('key_owner', { enum: ['platform', 'tenant'] }).notNull().default('platform'),
  latencyMs: integer('latency_ms'),
  tools: jsonb('tools'),
  /** {handoff,unknown,leak,fail,audio,outOfScope} */
  flags: jsonb('flags').notNull().default(sql`'{}'::jsonb`),
  /** ما دخل كلّ طبقة وما حُذف عند تجاوز الميزانيّة. */
  contextMeta: jsonb('context_meta'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
}, (t) => [
  index('ai_runs_tenant_idx').on(t.tenantId, t.createdAt),
  index('ai_runs_conv_idx').on(t.conversationId),
]);

export const aiKeys = pgTable('ai_keys', {
  id: uuid('id').primaryKey().default(uuid7),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  keyEnc: text('key_enc').notNull(),
  keyFingerprint: text('key_fingerprint').notNull(),
  keyVersion: integer('key_version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
  lastError: text('last_error'),
}, (t) => [uniqueIndex('ai_keys_uq').on(t.tenantId, t.provider)]);

/** التسعير لحظة العرض — فتصحيح سعرٍ يصحّح التاريخ كلّه. */
export const prices = pgTable('prices', {
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  input: numeric('input', { precision: 12, scale: 6 }).notNull(),
  output: numeric('output', { precision: 12, scale: 6 }).notNull(),
  cachedInput: numeric('cached_input', { precision: 12, scale: 6 }),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().default(now),
}, (t) => [uniqueIndex('prices_uq').on(t.provider, t.model, t.effectiveFrom)]);
