# ٦ — نموذج البيانات

اصطلاحات: المفاتيح `uuid v7` (مرتَّبة زمنيّاً فتُبقي الفهارس متراصّة)، التواريخ `timestamptz`
بالـUTC (العرض بتوقيت المستأجر)، وكلّ جدولٍ مستأجَر فيه `tenant_id uuid NOT NULL REFERENCES
tenants(id) ON DELETE CASCADE` وعليه RLS. كلّ فهرسٍ مركَّب يبدأ بـ`tenant_id`.

## ٦.١ المنصّة والمستأجرون

**`tenants`** — العميل.
`id` · `public_id varchar(26) UNIQUE` (في رابط الويبهوك) · `name` · `slug UNIQUE` ·
`status` (`active|suspended|trial|archived`) · `plan_id` · `timezone` (افتراضيّ `Asia/Amman`) ·
`locale` (`ar|en`) · `capabilities jsonb` (`{campaigns:false, customTools:true, …}`) ·
`trial_ends_at` · `created_at` · `archived_at`.

**`users`** — كلّ الأشخاص (مالك المنصّة والعملاء وموظّفوهم).
`id` · `tenant_id NULL` (فارغٌ لمالك المنصّة) · `email UNIQUE` · `password_hash` ·
`name` · `phone` · `role` (`platform_owner|tenant_owner|tenant_agent`) · `is_active` ·
`last_login_at` · `must_change_password`.

**`sessions`** — `id` · `user_id` · `refresh_hash` · `user_agent` · `ip` · `expires_at` ·
`revoked_at`.

**`plans`** — الباقات بلا نشرِ كود.
`id` · `name` · `price_monthly` · `currency` (`JOD`) · `limits jsonb`:
`{windows, aiTokens, kbChars, seats, customTools, retentionDays, dailySendCap, contacts}` ·
`overage_policy` (`block|allow_bill|handoff_only`) · `is_public` · `sort`.

**`subscriptions`** — `id` · `tenant_id` · `plan_id` · `status` · `period_start` ·
`period_end` · `limits_override jsonb` (سقفٌ خاصّ لعميلٍ بعينه بلا باقةٍ جديدة) · `notes`.

**`audit_log`** — `id` · `tenant_id NULL` · `actor_user_id` · `action` · `entity` ·
`entity_id` · `diff jsonb` · `ip` · `created_at`. إضافةٌ فقط، ولا واجهة تحذف منه.

## ٦.٢ القناة

**`tenant_channels`** — بيانات اعتماد واتساب لكلّ مستأجر (يحتمل أكثر من رقم لاحقاً).
`id` · `tenant_id` · `kind` (`whatsapp_cloud`) · `phone_number_id` · `waba_id` ·
`display_phone` · `token_enc` · `token_fingerprint` · `app_secret_enc` · `verify_token` ·
`key_version` · `status` (`pending|connected|error|disabled`) · `quality_rating` ·
`messaging_tier` · `verified_name` · `last_checked_at` · `last_error` · `connected_at`.
فهرس فريد: `(phone_number_id)` — رقمٌ واحد لا يخدم مستأجرَين.

**`contacts`** — زبائن العميل.
`id` · `tenant_id` · `phone` (مطبَّع: محلّيّ `07…` أو E.164) · `wa_phone` (صيغة الإرسال) ·
`display_name` · `attributes jsonb` (حقولٌ يعرّفها العميل: رقم عضويّة، مدينة…) ·
`tags text[]` · `opted_out_at` · `first_seen_at` · `last_seen_at` · `blocked_at`.
فريد: `(tenant_id, phone)`.

**`conversations`** — محادثةٌ لكلّ جهة اتّصال.
`id` · `tenant_id` · `contact_id` · `status` (`open|closed`) · `bot_enabled` ·
`bot_paused_until` · `assigned_user_id` · `needs_attention` · `unread_count` ·
`last_inbound_at` · `last_message_at` · `last_message_preview` · `tags text[]` ·
`window_id` (النافذة الحاليّة) · `created_at`.
فهارس: `(tenant_id, last_message_at DESC)` · `(tenant_id, needs_attention)` جزئيّ.

**`messages`**
`id` · `tenant_id` · `conversation_id` · `wamid UNIQUE NULL` · `direction` (`in|out`) ·
`source` (`customer|bot|agent|system|template`) · `type` (`text|interactive|image|audio|
document|location|button`) · `body text` · `payload jsonb` · `status` (`sent|delivered|read|
failed`) · `error_code` · `error_message` · `user_id` (من الموظّفين ردّ) · `ai_run_id` ·
`created_at` · `deleted_at`.
فهارس: `(conversation_id, created_at DESC)` · `(tenant_id, created_at DESC)`.
**التقسيم (partition) بالشهر** حين يتجاوز الجدول ٢٠ مليون صفّ — لا قبل.

**`conversation_windows`** — ★ جدول العدّاد الذي يُفوتَر عليه.
`id` · `tenant_id` · `conversation_id` · `contact_id` · `opened_at` · `expires_at`
(`opened_at + 24h`، يُمدَّد مع كلّ وارد) · `billed_at NULL` · `billing_period` (`YYYY-MM`) ·
`first_outbound_message_id` · `messages_in` · `messages_out` · `bot_replies` ·
`ai_cost_usd numeric(12,6)` · `closed_at`.
فهارس: `(tenant_id, billing_period)` · `(conversation_id, expires_at DESC)` ·
فريدٌ جزئيّ: `(conversation_id)` حيث `closed_at IS NULL` — **نافذةٌ مفتوحةٌ واحدة لكلّ محادثة**.

## ٦.٣ البوت

**`bot_configs`** — الإعداد الحاليّ (مسوّدة) لكلّ مستأجر.
`id` · `tenant_id UNIQUE` · `enabled` · `published_version_id` · `draft jsonb` ·
`pause_minutes` · `max_tool_loops` · `context_messages` · `fail_message` · `fail_handoff` ·
`business_hours jsonb` · `outside_hours_message` · `updated_by` · `updated_at`.

**`bot_versions`** — ★ النسخ المنشورة (ما ينقص النظام الحالي).
`id` · `tenant_id` · `version int` · `persona text` · `knowledge_base text` ·
`tools_config jsonb` · `model` · `params jsonb` · `published_by` · `published_at` ·
`note`. فريد: `(tenant_id, version)`. التراجع = نشر نسخةٍ قديمة (لا تعديل في مكانه).

**`bot_tools`** — ★ الأدوات المعرَّفة بالبيانات.
`id` · `tenant_id` · `key` (slug فريد داخل المستأجر) · `title_ar` · `description`
(وصفٌ للنموذج — أهمّ حقلٍ في الجدول) · `kind` (`builtin|http`) · `enabled` ·
`admin_only` · `params_schema jsonb` (JSON Schema) · `http jsonb`
(`{method,url,headers,bodyTemplate,timeoutMs}`) · `response_map jsonb` ·
`secrets_enc` · `confirm_required bool` · `confirm_template text` ·
`rate_limit_per_min` · `failure_count` · `disabled_reason` · `created_at`.

**`knowledge_sources`** — مصادر المعرفة قبل التجميع.
`id` · `tenant_id` · `kind` (`text|file|url`) · `title` · `original_name` · `storage_path` ·
`extracted_text` · `char_count` · `status` (`pending|ready|failed`) · `error` · `created_at`.
(الإصدار الأوّل يجمع النصوص في `knowledge_base`؛ RAG في `07` حين يتجاوز الحجم الحدّ.)

**`ai_runs`** — صفٌّ لكلّ ردّ (وريث `wa_bot_usage` وأوسع منه).
`id` · `tenant_id` · `conversation_id NULL` · `source` (`live|playground`) · `provider` ·
`model` · `calls` · `prompt_tokens` · `output_tokens` · `thoughts_tokens` · `cached_tokens` ·
`total_tokens` · `cost_usd numeric(12,6)` · `key_owner` (`platform|tenant`) · `latency_ms` ·
`tools jsonb` · `flags jsonb` (`{handoff,unknown,leak,fail,audio,outOfScope}`) ·
`error` · `created_at`.
فهارس: `(tenant_id, created_at)` · `(conversation_id)`.

**`ai_keys`** — مفاتيح العملاء (قرار ق٢).
`id` · `tenant_id` · `provider` · `key_enc` · `key_fingerprint` · `key_version` ·
`is_active` · `last_ok_at` · `last_error`.

**`prices`** — أسعار النماذج ($ لكلّ مليون توكن).
`provider` · `model` · `input` · `output` · `cached_input` · `effective_from`.
التسعير **لحظة العرض** من هذا الجدول، فتصحيح سعرٍ يصحّح التاريخ كلّه (نمطٌ مجرَّب في المافيا).

## ٦.٤ التشغيل والمراقبة

**`incidents`** — كلّ عطلٍ يستحقّ انتباهك.
`id` · `tenant_id NULL` (فارغ = عطل منصّة) · `kind` (`channel_down|token_invalid|
quality_drop|webhook_silent|ai_error|tool_error|quota_exceeded|send_failed|worker_stalled`) ·
`severity` (`info|warn|critical`) · `title` · `detail jsonb` · `status` (`open|ack|resolved`) ·
`fingerprint` (للتجميع) · `count` · `first_seen_at` · `last_seen_at` · `resolved_at` ·
`resolved_by` · `notified_at`.
فريد: `(fingerprint)` حيث `status != 'resolved'` — **حادثةٌ واحدة لا مئة إشعار**.

**`health_checks`** — نتيجة كلّ فحصٍ دوريّ.
`id` · `tenant_id` · `checked_at` · `level` (`ok|degraded|blocked|unreachable`) ·
`phone jsonb` · `waba jsonb` · `token_valid` · `webhook_subscribed` · `issues jsonb` ·
`latency_ms`. احتفاظ ٣٠ يوماً ثمّ تجميع يوميّ.

**`push_subscriptions`** — أجهزة الإشعارات.
`id` · `user_id` · `tenant_id NULL` · `endpoint UNIQUE` · `p256dh` · `auth` ·
`user_agent` · `created_at` · `last_ok_at` · `fail_count`. (يُحذف الاشتراك بعد فشلٍ 410.)

**`notifications`** — ما أُرسل ولماذا.
`id` · `user_id` · `tenant_id NULL` · `tag` · `title` · `body` · `data jsonb` ·
`read_at` · `created_at`. فريدٌ جزئيّ على `(user_id, tag)` حيث `read_at IS NULL` —
**دورة حياةٍ واحدة لكلّ موضوع** (الدرس المدفوع في المافيا: صفٌّ لكلّ دفعة أغرق الصندوق).

**`usage_daily`** — تجميعٌ يوميّ لكلّ مستأجر (يجعل التقارير فوريّة).
`tenant_id` · `day` · `windows_opened` · `windows_billed` · `messages_in` · `messages_out` ·
`bot_replies` · `agent_replies` · `handoffs` · `unknown_answers` · `ai_tokens` ·
`ai_cost_usd` · `avg_latency_ms`. مفتاح: `(tenant_id, day)`.

## ٦.٥ قواعد المخطّط الملزِمة

1. **كلّ جدولٍ مستأجَر يُنشأ مع `ON DELETE CASCADE` من `tenants`** — من الترحيل الأوّل. إضافته
   لاحقاً على ٢٥ جدولاً عمليّةٌ يدويّة خطرة (سابقةٌ موثَّقة في المافيا).
2. **لا حذف صلب للرسائل** — `deleted_at` فقط؛ واتساب لا يدعم السحب، وسجلّك يجب أن يطابق الواقع.
3. **فهرسٌ مركَّب يبدأ بـ`tenant_id`** في كلّ استعلامٍ متكرّر، وإلّا فمسحٌ كامل يبطئ الجميع.
4. **`numeric` للنقود والكلفة** لا `float` — أبداً.
5. **الترحيلات في الكود** (drizzle-kit) ومتَماثِلة، فتُبنى القاعدة من الصفر على مضيفٍ جديد.
6. عمودٌ محسوب أو مشتقّ من حالةٍ متغيّرة لا يُخزَّن إلّا إن كان **مُفوتَراً عليه** — النوافذ
   والكلفة تُخزَّن لأنّها عقدٌ ماليّ، والباقي يُحسب.
