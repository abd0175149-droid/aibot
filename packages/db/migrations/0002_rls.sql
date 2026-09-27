-- مولَّد من TENANT_SCOPED — لا تُحرّره يدويّاً، حرّر schema.ts

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'users'::regclass) THEN
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE users FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'subscriptions'::regclass) THEN
    ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON subscriptions;
CREATE POLICY tenant_isolation ON subscriptions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'audit_log'::regclass) THEN
    ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON audit_log;
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_log TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'tenant_channels'::regclass) THEN
    ALTER TABLE tenant_channels ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tenant_channels FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON tenant_channels;
CREATE POLICY tenant_isolation ON tenant_channels
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_channels TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'contacts'::regclass) THEN
    ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON contacts;
CREATE POLICY tenant_isolation ON contacts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'channel_identities'::regclass) THEN
    ALTER TABLE channel_identities ENABLE ROW LEVEL SECURITY;
    ALTER TABLE channel_identities FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON channel_identities;
CREATE POLICY tenant_isolation ON channel_identities
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON channel_identities TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'conversations'::regclass) THEN
    ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON conversations;
CREATE POLICY tenant_isolation ON conversations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON conversations TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'messages'::regclass) THEN
    ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE messages FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON messages;
CREATE POLICY tenant_isolation ON messages
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'conversation_windows'::regclass) THEN
    ALTER TABLE conversation_windows ENABLE ROW LEVEL SECURITY;
    ALTER TABLE conversation_windows FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON conversation_windows;
CREATE POLICY tenant_isolation ON conversation_windows
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_windows TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'optouts'::regclass) THEN
    ALTER TABLE optouts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE optouts FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON optouts;
CREATE POLICY tenant_isolation ON optouts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON optouts TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'bot_configs'::regclass) THEN
    ALTER TABLE bot_configs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE bot_configs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON bot_configs;
CREATE POLICY tenant_isolation ON bot_configs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_configs TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'bot_versions'::regclass) THEN
    ALTER TABLE bot_versions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE bot_versions FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON bot_versions;
CREATE POLICY tenant_isolation ON bot_versions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_versions TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'bot_tools'::regclass) THEN
    ALTER TABLE bot_tools ENABLE ROW LEVEL SECURITY;
    ALTER TABLE bot_tools FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON bot_tools;
CREATE POLICY tenant_isolation ON bot_tools
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_tools TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'knowledge_sources'::regclass) THEN
    ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
    ALTER TABLE knowledge_sources FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON knowledge_sources;
CREATE POLICY tenant_isolation ON knowledge_sources
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_sources TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'kb_chunks'::regclass) THEN
    ALTER TABLE kb_chunks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE kb_chunks FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON kb_chunks;
CREATE POLICY tenant_isolation ON kb_chunks
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_chunks TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'kb_retrievals'::regclass) THEN
    ALTER TABLE kb_retrievals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE kb_retrievals FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON kb_retrievals;
CREATE POLICY tenant_isolation ON kb_retrievals
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_retrievals TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'kb_evals'::regclass) THEN
    ALTER TABLE kb_evals ENABLE ROW LEVEL SECURITY;
    ALTER TABLE kb_evals FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON kb_evals;
CREATE POLICY tenant_isolation ON kb_evals
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_evals TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'ai_runs'::regclass) THEN
    ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ai_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON ai_runs;
CREATE POLICY tenant_isolation ON ai_runs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_runs TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'ai_keys'::regclass) THEN
    ALTER TABLE ai_keys ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ai_keys FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON ai_keys;
CREATE POLICY tenant_isolation ON ai_keys
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_keys TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'incidents'::regclass) THEN
    ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE incidents FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON incidents;
CREATE POLICY tenant_isolation ON incidents
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON incidents TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'health_checks'::regclass) THEN
    ALTER TABLE health_checks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE health_checks FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON health_checks;
CREATE POLICY tenant_isolation ON health_checks
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON health_checks TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'notifications'::regclass) THEN
    ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON notifications;
CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'push_subscriptions'::regclass) THEN
    ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON push_subscriptions;
CREATE POLICY tenant_isolation ON push_subscriptions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'quota_alerts'::regclass) THEN
    ALTER TABLE quota_alerts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE quota_alerts FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON quota_alerts;
CREATE POLICY tenant_isolation ON quota_alerts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON quota_alerts TO aibot_app;

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'deletion_requests'::regclass) THEN
    ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;
    ALTER TABLE deletion_requests FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS tenant_isolation ON deletion_requests;
CREATE POLICY tenant_isolation ON deletion_requests
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON deletion_requests TO aibot_app;

GRANT USAGE ON SCHEMA public TO aibot_app, aibot_platform;
GRANT SELECT ON tenants, plans TO aibot_app;
-- audit_log إضافةٌ فقط: لا واجهة تحذف منه ولا تعدّله
REVOKE UPDATE, DELETE ON audit_log FROM aibot_app;
