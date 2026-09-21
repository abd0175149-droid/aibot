-- ════════════════════════════════════════════════════════════════
-- اختبار التسرّب بين المستأجرين — يُشغَّل على قاعدةٍ حقيقيّة.
--
-- هذا ما لا يستطيع vitest إثباته: أنّ **بوستجرس نفسه** يمنع التسرّب،
-- لا أنّ الكود يتذكّر أن يُضيف `where`.
--
-- يُشغَّل بـ psql -v ON_ERROR_STOP=1، فأيّ فشلٍ يوقف السكربت.
-- ════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
BEGIN;

-- مستأجران وبياناتٌ لكلٍّ منهما
INSERT INTO tenants (id, public_id, name, slug, status) VALUES
  ('11111111-1111-7111-8111-111111111111', 'TENANTAAAAAAAAAAAAAAAAAAAA', 'عميل أ', 'alpha', 'active'),
  ('22222222-2222-7222-8222-222222222222', 'TENANTBBBBBBBBBBBBBBBBBBBB', 'عميل ب', 'beta',  'active');

INSERT INTO tenant_channels (id, tenant_id, kind, external_account_id, display_name, status) VALUES
  ('aaaaaaaa-1111-7111-8111-aaaaaaaaaaaa', '11111111-1111-7111-8111-111111111111', 'whatsapp_cloud', 'PHONE_A', 'رقم أ', 'connected'),
  ('bbbbbbbb-2222-7222-8222-bbbbbbbbbbbb', '22222222-2222-7222-8222-222222222222', 'whatsapp_cloud', 'PHONE_B', 'رقم ب', 'connected');

INSERT INTO contacts (id, tenant_id, phone, display_name) VALUES
  ('a1a1a1a1-1111-7111-8111-a1a1a1a1a1a1', '11111111-1111-7111-8111-111111111111', '0791111111', 'زبون أ'),
  ('b1b1b1b1-2222-7222-8222-b1b1b1b1b1b1', '22222222-2222-7222-8222-222222222222', '0792222222', 'زبون ب');

COMMIT;

-- ─────────────────────────────────────────────────────────────────
-- الاختبار يجري بدور التطبيق، لا بمالك القاعدة.
-- ⚠️ مالك القاعدة في صورة postgres هو SUPERUSER، و**السوبريوزر يتجاوز RLS
--    حتّى مع FORCE**. فلو اتّصل التطبيق بهذا الدور لكانت كلّ السياسات زينة.
-- ─────────────────────────────────────────────────────────────────
SET ROLE aibot_app;

-- ① سياق المستأجر أ
SELECT set_config('app.tenant_id', '11111111-1111-7111-8111-111111111111', false);

\echo '① قراءة بسياق أ — يجب أن ترى صفّاً واحداً فقط:'
SELECT count(*) AS contacts_visible, coalesce(max(display_name),'—') AS who FROM contacts;

DO $$
DECLARE n int; nm text;
BEGIN
  SELECT count(*), coalesce(max(display_name),'') INTO n, nm FROM contacts;
  IF n <> 1 OR nm <> 'زبون أ' THEN
    RAISE EXCEPTION '✘ تسرّب: بسياق أ ظهر % صفّاً (%)', n, nm;
  END IF;
  RAISE NOTICE '✔ أ يرى صفّه وحده';
END $$;

-- ② سياق المستأجر ب
SELECT set_config('app.tenant_id', '22222222-2222-7222-8222-222222222222', false);

DO $$
DECLARE n int; nm text;
BEGIN
  SELECT count(*), coalesce(max(display_name),'') INTO n, nm FROM contacts;
  IF n <> 1 OR nm <> 'زبون ب' THEN
    RAISE EXCEPTION '✘ تسرّب: بسياق ب ظهر % صفّاً (%)', n, nm;
  END IF;
  RAISE NOTICE '✔ ب يرى صفّه وحده';
END $$;

-- ③ الكتابة عبر الحدود مرفوضة (WITH CHECK)
DO $$
BEGIN
  BEGIN
    INSERT INTO contacts (tenant_id, phone, display_name)
    VALUES ('11111111-1111-7111-8111-111111111111', '0799999999', 'مدسوس');
    RAISE EXCEPTION '✘ خطر: ب كتب صفّاً باسم أ';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '✔ الكتابة باسم مستأجرٍ آخر مرفوضة';
  END;
END $$;

-- ④ التعديل عبر الحدود لا يمسّ شيئاً
DO $$
DECLARE n int;
BEGIN
  UPDATE contacts SET display_name = 'مُخترَق'
   WHERE tenant_id = '11111111-1111-7111-8111-111111111111';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION '✘ خطر: ب عدّل % صفّاً لأ', n; END IF;
  RAISE NOTICE '✔ التعديل عبر الحدود لا يمسّ صفّاً';
END $$;

-- ⑤ الحذف عبر الحدود لا يمسّ شيئاً
DO $$
DECLARE n int;
BEGIN
  DELETE FROM contacts WHERE tenant_id = '11111111-1111-7111-8111-111111111111';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION '✘ خطر: ب حذف % صفّاً لأ', n; END IF;
  RAISE NOTICE '✔ الحذف عبر الحدود لا يمسّ صفّاً';
END $$;

-- ⑥ بلا سياق: لا شيء يُرى إطلاقاً — والافتراضيّ آمن.
--    حالتان مختلفتان، والثانية هي التي كشفت العلّة على قاعدةٍ حقيقيّة:
--    سياقٌ **فارغ** كان يرمي خطأً بدل أن يمنع بهدوء، لأنّ ''::uuid لا يُحوَّل.
SELECT set_config('app.tenant_id', '', false);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM contacts;
  IF n <> 0 THEN RAISE EXCEPTION '✘ خطر: بسياقٍ فارغ ظهر % صفّاً', n; END IF;
  RAISE NOTICE '✔ سياقٌ فارغ: لا شيء يُرى ولا خطأ يُرمى';
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION '✘ سياقٌ فارغ يرمي خطأً بدل أن يمنع — راجع nullif في السياسة';
END $$;

RESET app.tenant_id;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM contacts;
  IF n <> 0 THEN RAISE EXCEPTION '✘ خطر: بلا ضبطٍ قطّ ظهر % صفّاً', n; END IF;
  RAISE NOTICE '✔ بلا ضبطٍ قطّ: لا شيء يُرى';
END $$;

-- ⑦ audit_log إضافةٌ فقط — لا تعديل ولا حذف من دور التطبيق
SELECT set_config('app.tenant_id', '11111111-1111-7111-8111-111111111111', false);
INSERT INTO audit_log (tenant_id, action) VALUES ('11111111-1111-7111-8111-111111111111', 'test');
DO $$
BEGIN
  BEGIN
    UPDATE audit_log SET action = 'مُزوَّر';
    RAISE EXCEPTION '✘ خطر: سجلّ التدقيق قابلٌ للتعديل';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '✔ سجلّ التدقيق إضافةٌ فقط';
  END;
END $$;

RESET ROLE;

-- ⑧ CASCADE: حذف مستأجرٍ يحذف كلّ ما يخصّه — بلا عمليّةٍ يدويّة
DELETE FROM tenants WHERE id = '11111111-1111-7111-8111-111111111111';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM contacts WHERE tenant_id = '11111111-1111-7111-8111-111111111111';
  IF n <> 0 THEN RAISE EXCEPTION '✘ CASCADE ناقص: بقي % صفّاً يتيماً', n; END IF;
  SELECT count(*) INTO n FROM tenant_channels WHERE tenant_id = '11111111-1111-7111-8111-111111111111';
  IF n <> 0 THEN RAISE EXCEPTION '✘ CASCADE ناقص في القنوات'; END IF;
  RAISE NOTICE '✔ CASCADE يحذف كلّ ما يخصّ المستأجر';
END $$;

-- تنظيف
DELETE FROM tenants WHERE slug IN ('alpha','beta');

\echo ''
\echo '════════ كلّ اختبارات العزل نجحت ════════'
