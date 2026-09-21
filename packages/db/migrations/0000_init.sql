-- ════════════════════════════════════════════════════════════════
-- AiBot — الترحيل الأوّل
--
-- ما يجب أن يكون هنا ولا يُضاف لاحقاً أبداً:
--   ① ON DELETE CASCADE من tenants على كلّ جدولٍ مستأجَر.
--      (سابقةٌ موثَّقة: 25 جدولاً بلا CASCADE جعلت حذف مستأجرٍ عمليّةً يدويّة خطرة.)
--   ② RLS على كلّ جدولٍ مستأجَر — البوّابة الثانية بعد withTenant.
--   ③ القيد الفريد للهويّة على (tenant_id, channel_id, external_id) لا على الهاتف،
--      فإنستجرام لا يعطي هاتفاً بل IGSID.
--   ④ pgvector — تأجيله يعني ترحيلَ جدولٍ ضخمٍ لاحقاً.
--
-- يُنفَّذ بـ psql -v ON_ERROR_STOP=1 — وأيّ فشلٍ يوقف النشر ويتراجع.
-- ════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- ── uuid v7: مرتَّب زمنيّاً فتبقى الفهارس متراصّة ──────────────────
-- (بوستجرس 18 يوفّرها أصلاً؛ هذه للتوافق مع 16 و17.)
CREATE OR REPLACE FUNCTION gen_uuid_v7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  -- النسخة 7
  uuid_bytes := set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);
  -- المتغيّر RFC 4122
  uuid_bytes := set_byte(uuid_bytes, 8, (b'10'   || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END $$ LANGUAGE plpgsql VOLATILE;

-- ── الدوران: دورٌ للتطبيق (يخضع لـRLS) ودورٌ للمنصّة (يتجاوزها) ───
-- الدور المتجاوز يُستعمل في /console وفي العمّال فقط، وكلّ استعمالٍ له مسجَّل.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aibot_app') THEN
    CREATE ROLE aibot_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aibot_platform') THEN
    CREATE ROLE aibot_platform NOLOGIN BYPASSRLS;
  END IF;
END $$;
