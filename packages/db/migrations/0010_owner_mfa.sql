-- ★ العاملُ الثاني لحساب مالك المنصّة.
--
-- ⚠️ `IF NOT EXISTS` ليست تجميلاً: `deploy.sh` يُطبّق **كلّ** ملفّ .sql في
--    كلّ نشرة، و`idempotent.ts` يُعيد كتابة `CREATE TABLE`/`CREATE INDEX` وحدها
--    ولا يمسّ `ALTER TABLE ADD COLUMN`. فبلاها تفشل النشرةُ الثانية عند عمودٍ
--    قائم، ولا تنجح نشرةٌ بعدها أبداً.
--
-- ⚠️ ولا قيمةَ افتراضيّة ولا `NOT NULL`: عمودٌ فارغٌ يعني «لم يُسجَّل بعد»،
--    وهو ما يُبقي بابَ التسجيل مفتوحاً للمالك القائم بدل أن يُقفل عليه.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_enc text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_key_version integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enrolled_at timestamp with time zone;
