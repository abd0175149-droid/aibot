-- ════════════════════════════════════════════════════════════════
-- ★ العمود الذي يستعلم عنه الاسترجاع الهجين ولا وجود له.
--
-- `apps/worker/src/retrieval.ts` يقرأ `c.tsv` في فرعه المعجميّ منذ أن كُتب،
-- ولا عمود `tsv` في أيّ ترحيلٍ ولا في مخطّط Drizzle. فأوّلُ مستأجرٍ تتجاوز
-- معرفتُه ٨٠٠٠ توكن (وضع `hybrid`) يُصيب `column c.tsv does not exist` داخل
-- معاملة الردّ فتتراجع، والخطأُ ليس `AiError` فلا تُرفع حادثة، وBullMQ تُعيد
-- المحاولة ثمّ تموت المهمّة. **الميزة الأساسيّة للمنتج لم تعمل يوماً.**
--
-- ولم يظهر لأنّ المستأجر الحيّ الوحيد في وضع `full` و`kb_chunks` فارغ.
--
-- ★ والتطبيع في الطرفين أو لا يعمل أصلاً: الاستعلام يُطبَّع في JS
-- (`normalizeArabic`: تشكيلٌ وتطويلٌ وهمزاتٌ وألفٌ مقصورةٌ وتاءٌ مربوطة)،
-- والنصُّ مخزَّنٌ خامّاً. فحتّى بعد إضافة العمود تفشل المطابقة على كلّ كلمةٍ
-- فيها «ة» أو «أ». و`ar_norm` أدناه مرآةُ تلك الدالّة بلغة القاعدة —
-- و`packages/core/test/ar-norm.test.ts` يحرس تطابقهما.
--
-- ⚠️ `IMMUTABLE` شرطٌ لا زينة: عمودٌ مولَّدٌ مخزَّن يرفض أيّ دالّةٍ غير ذلك.
-- ⚠️ ومتماثِل: النشر يُطبّق كلّ الترحيلات في كلّ مرّة.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ar_norm(t text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT regexp_replace(
           translate(
             regexp_replace(t, '[ً-ْٰـ]', '', 'g'),  -- تشكيلٌ وتطويل
             'أإآٱىة', 'اااايه'
           ),
           '[؟?!.,،;:]+', ' ', 'g'
         )
$$;

-- عمودٌ مولَّدٌ مخزَّن: يُحسب عند الكتابة فلا كلفةَ على القراءة، ويبقى
-- متّسقاً مع `body` بلا مُشغِّلٍ يُنسى.
ALTER TABLE kb_chunks
  ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('arabic', ar_norm(coalesce(body, '')))) STORED;

CREATE INDEX IF NOT EXISTS kb_chunks_tsv_idx ON kb_chunks USING gin (tsv);

-- والمسارُ الثاني في نفس الاستعلام: `c.body % :q` بتشابه الثلاثيّات.
-- بلا فهرسٍ عليه يصير مسحاً كاملاً لكلّ سؤال.
CREATE INDEX IF NOT EXISTS kb_chunks_body_trgm_idx
  ON kb_chunks USING gin (ar_norm(body) gin_trgm_ops);
