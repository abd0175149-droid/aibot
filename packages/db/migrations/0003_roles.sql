-- ════════════════════════════════════════════════════════════════
-- الأدوار والصلاحيّات — وإصلاحُ ثغرةٍ كشفها أوّل تشغيلٍ على الخادم.
--
-- 🔴 العلّة: كان التطبيق يتّصل بدور **مالك القاعدة**، وهو SUPERUSER في صورة
--    postgres الرسميّة. **والسوبريوزر يتجاوز RLS كليّاً — حتّى مع FORCE.**
--    أي أنّ البوّابة الثانية كانت موجودةً في المخطّط ومعدومةً في الإنتاج،
--    وكان خطأٌ برمجيٌّ واحد في `where` كافياً لتسريب بيانات عميلٍ إلى آخر.
--    ولم يكشف هذا أيُّ اختبارٍ بلا قاعدة: الاختبار كان يضبط الدور صراحةً.
--
-- ✅ الإصلاح: التطبيق يتّصل بـ`aibot_app` — دورٌ عاديّ تسري عليه السياسات.
--    و`aibot_platform` (BYPASSRLS) يبقى للوصول العابر عبر `withPlatform`،
--    ويُنتقل إليه بـ`SET LOCAL ROLE` داخل المعاملة وحدها.
-- ════════════════════════════════════════════════════════════════

-- ① دور التطبيق يستطيع الدخول. كلمة سرّه تُضبط من deploy.sh لا من هنا،
--    فلا يدخل سرٌّ إلى المستودع أبداً.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aibot_app') THEN
    CREATE ROLE aibot_app LOGIN;
  ELSE
    ALTER ROLE aibot_app LOGIN;
  END IF;
END $$;

-- ② عضويّة الدور المتجاوز — شرطُ عمل `SET LOCAL ROLE aibot_platform`.
--    الصلاحيّة لا تُكتسب إلّا داخل معاملةٍ صرّحت بها، وتُفقد بنهايتها.
GRANT aibot_platform TO aibot_app;

-- ③ الصلاحيّات على الجداول القائمة.
GRANT USAGE ON SCHEMA public TO aibot_app, aibot_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aibot_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aibot_app, aibot_platform;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO aibot_app, aibot_platform;

-- ④ وعلى ما يُنشأ لاحقاً — وإلّا فجدولٌ جديد يكسر الإنتاج بعد ترحيلٍ ناجح.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aibot_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO aibot_app, aibot_platform;

-- ⑤ الجداول العامّة: تُقرأ من دور التطبيق ولا تُكتب.
GRANT SELECT ON tenants, plans, prices TO aibot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO aibot_app;

-- ⑥ سجلّ التدقيق إضافةٌ فقط — يُعاد تأكيده هنا لأنّ ③ يمنح الكلّ لـplatform.
REVOKE UPDATE, DELETE ON audit_log FROM aibot_app;

-- ⑦ حارسٌ يمنع عودة العلّة: إن كان الدور الذي يُشغّل هذا الترحيل هو نفسه
--    الذي سيتّصل به التطبيق وكان سوبريوزر، فالأمر يُقال بصوتٍ عالٍ.
DO $$
DECLARE is_super boolean;
BEGIN
  SELECT rolsuper INTO is_super FROM pg_roles WHERE rolname = 'aibot_app';
  IF is_super THEN
    RAISE EXCEPTION 'aibot_app سوبريوزر — سيتجاوز RLS. أزِل الصفة قبل المتابعة.';
  END IF;
  RAISE NOTICE '✔ aibot_app دورٌ عاديّ — سياسات RLS تسري عليه';
END $$;
