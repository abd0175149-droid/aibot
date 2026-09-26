CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"diff" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"name" text NOT NULL,
	"price_monthly" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'JOD' NOT NULL,
	"limits" jsonb NOT NULL,
	"overage_policy" text DEFAULT 'handoff_only' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"limits_override" jsonb,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"public_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"plan_id" uuid,
	"timezone" text DEFAULT 'Asia/Amman' NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"capabilities" jsonb DEFAULT '{"campaigns":false,"customTools":true}'::jsonb NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "tenants_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"display_handle" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone" text,
	"display_name" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"opted_out_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"billed_at" timestamp with time zone,
	"billing_period" varchar(7),
	"first_outbound_message_id" uuid,
	"messages_in" integer DEFAULT 0 NOT NULL,
	"messages_out" integer DEFAULT 0 NOT NULL,
	"bot_replies" integer DEFAULT 0 NOT NULL,
	"ai_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"bot_enabled" boolean DEFAULT true NOT NULL,
	"bot_paused_until" timestamp with time zone,
	"assigned_user_id" uuid,
	"needs_attention" boolean DEFAULT false NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"window_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"external_id" text,
	"direction" text NOT NULL,
	"source" text NOT NULL,
	"type" text DEFAULT 'text' NOT NULL,
	"body" text,
	"payload" jsonb,
	"channel_payload" jsonb,
	"status" text,
	"error_code" text,
	"error_message" text,
	"user_id" uuid,
	"ai_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "optouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_account_id" text,
	"display_name" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_enc" text,
	"token_fingerprint" text,
	"app_secret_enc" text,
	"verify_token" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"quality_rating" text,
	"messaging_tier" text,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"key_enc" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid,
	"source" text DEFAULT 'live' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"calls" integer DEFAULT 1 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"thoughts_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"key_owner" text DEFAULT 'platform' NOT NULL,
	"latency_ms" integer,
	"tools" jsonb,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context_meta" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bot_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"published_version_id" uuid,
	"draft" jsonb,
	"pause_minutes" integer DEFAULT 30 NOT NULL,
	"max_tool_loops" integer DEFAULT 4 NOT NULL,
	"context_messages" integer DEFAULT 12 NOT NULL,
	"fail_message" text,
	"fail_handoff" boolean DEFAULT true NOT NULL,
	"business_hours" jsonb,
	"outside_hours_message" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_configs_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bot_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title_ar" text NOT NULL,
	"description" text NOT NULL,
	"kind" text DEFAULT 'http' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"admin_only" boolean DEFAULT false NOT NULL,
	"requires_capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"params_schema" jsonb DEFAULT '{"type":"object","properties":{}}'::jsonb NOT NULL,
	"http" jsonb,
	"response_map" jsonb,
	"secrets_enc" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"confirm_required" boolean DEFAULT false NOT NULL,
	"confirm_template" text,
	"rate_limit_per_min" integer DEFAULT 30 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bot_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"persona" text DEFAULT '' NOT NULL,
	"knowledge_base" text DEFAULT '' NOT NULL,
	"tools_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"model" text DEFAULT 'gemini-2.5-flash' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"knowledge_mode" text DEFAULT 'full' NOT NULL,
	"knowledge_budget" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embed_status" text DEFAULT 'skipped' NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"source_id" uuid,
	"ord" integer NOT NULL,
	"heading_path" text,
	"body" text NOT NULL,
	"kind" text DEFAULT 'chunk' NOT NULL,
	"parent_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"token_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"embed_model" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_evals" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"question" text NOT NULL,
	"expected" text,
	"must_hit_chunk_ids" uuid[],
	"last_recall" real,
	"last_ok" boolean,
	"last_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_retrievals" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid,
	"ai_run_id" uuid,
	"mode" text NOT NULL,
	"query_text" text,
	"chunk_ids" uuid[],
	"scores" real[],
	"retrieved_tokens" integer DEFAULT 0 NOT NULL,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"tool_fallback_used" boolean DEFAULT false NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"original_name" text,
	"storage_path" text,
	"extracted_text" text,
	"char_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prices" (
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input" numeric(12, 6) NOT NULL,
	"output" numeric(12, 6) NOT NULL,
	"cached_input" numeric(12, 6),
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"token_valid" boolean,
	"webhook_subscribed" boolean,
	"detail" jsonb,
	"issues" jsonb,
	"latency_ms" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid,
	"channel_id" uuid,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"fingerprint" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid,
	"tag" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	"fail_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_channel_id_tenant_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."tenant_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversation_windows" ADD CONSTRAINT "conversation_windows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversation_windows" ADD CONSTRAINT "conversation_windows_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversation_windows" ADD CONSTRAINT "conversation_windows_channel_id_tenant_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."tenant_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversation_windows" ADD CONSTRAINT "conversation_windows_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_id_tenant_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."tenant_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_identity_id_channel_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_tenant_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."tenant_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "optouts" ADD CONSTRAINT "optouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "optouts" ADD CONSTRAINT "optouts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tenant_channels" ADD CONSTRAINT "tenant_channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_keys" ADD CONSTRAINT "ai_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bot_configs" ADD CONSTRAINT "bot_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bot_configs" ADD CONSTRAINT "bot_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bot_tools" ADD CONSTRAINT "bot_tools_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bot_versions" ADD CONSTRAINT "bot_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bot_versions" ADD CONSTRAINT "bot_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_version_id_bot_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."bot_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "kb_evals" ADD CONSTRAINT "kb_evals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "kb_retrievals" ADD CONSTRAINT "kb_retrievals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "kb_retrievals" ADD CONSTRAINT "kb_retrievals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "health_checks" ADD CONSTRAINT "health_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "health_checks" ADD CONSTRAINT "health_checks_channel_id_tenant_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."tenant_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "incidents" ADD CONSTRAINT "incidents_channel_id_tenant_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."tenant_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_tenant_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subs_tenant_idx" ON "subscriptions" USING btree ("tenant_id","period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_tenant_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "identities_uq" ON "channel_identities" USING btree ("tenant_id","channel_id","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identities_contact_idx" ON "channel_identities" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_tenant_phone_idx" ON "contacts" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_tenant_seen_idx" ON "contacts" USING btree ("tenant_id","last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "windows_period_idx" ON "conversation_windows" USING btree ("tenant_id","billing_period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "windows_expiry_idx" ON "conversation_windows" USING btree ("conversation_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conv_identity_uq" ON "conversations" USING btree ("tenant_id","identity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_recent_idx" ON "conversations" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_attn_idx" ON "conversations" USING btree ("tenant_id","needs_attention");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_external_uq" ON "messages" USING btree ("channel_id","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_conv_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_tenant_idx" ON "messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "optouts_uq" ON "optouts" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channels_account_uq" ON "tenant_channels" USING btree ("kind","external_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channels_tenant_idx" ON "tenant_channels" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_keys_uq" ON "ai_keys" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_runs_tenant_idx" ON "ai_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_runs_conv_idx" ON "ai_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bot_tools_uq" ON "bot_tools" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bot_versions_uq" ON "bot_versions" USING btree ("tenant_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kb_chunks_uq" ON "kb_chunks" USING btree ("tenant_id","version_id","source_id","ord","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_chunks_version_idx" ON "kb_chunks" USING btree ("tenant_id","version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_evals_tenant_idx" ON "kb_evals" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_retr_tenant_idx" ON "kb_retrievals" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_sources_tenant_idx" ON "knowledge_sources" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prices_uq" ON "prices" USING btree ("provider","model","effective_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_channel_idx" ON "health_checks" USING btree ("tenant_id","channel_id","checked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_tenant_idx" ON "incidents" USING btree ("tenant_id","status","last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notif_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
-- ════════════════════════════════════════════════════════════════
-- إنذارُ السقف — مكتوبٌ بيدٍ لا مولَّد، وموضعُه هنا **قصد**.
--
-- `0002_rls.sql` مولَّدٌ من `TENANT_SCOPED` ويطبّق السياسة على كلّ جدولٍ فيها.
-- فجدولٌ يُنشأ في ترحيلٍ **بعده** يمرّ بلا RLS: صفوفُ عميلٍ تُقرأ من سياق
-- عميلٍ آخر بلا خطأ. ولذلك يُنشأ الجدول في ترحيل الجداول نفسِه — قبل RLS.
--
-- ⚠️ متماثِل: النشر يُطبّق كلّ الترحيلات في كلّ مرّة.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "quota_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"billing_period" varchar(7) NOT NULL,
	"threshold" integer NOT NULL,
	"windows_used" integer NOT NULL,
	"windows_limit" integer NOT NULL,
	"policy" text NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "quota_alerts" ADD CONSTRAINT "quota_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
-- ★ الفريدُ هو ما يجعل الإنذار مرّةً واحدةً لكلّ عتبةٍ لكلّ دورة: الإدراج
--    بـON CONFLICT DO NOTHING … RETURNING يُرجع صفّاً للفائز وحده، فلا
--    إنذارَ مكرّرٌ ولو تسابق عاملان. والدورةُ في المفتاح ⟵ شهرٌ جديد يُنذر.
CREATE UNIQUE INDEX IF NOT EXISTS "quota_alerts_uq" ON "quota_alerts" USING btree ("tenant_id","billing_period","threshold");
