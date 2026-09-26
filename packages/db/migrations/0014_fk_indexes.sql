-- ════════════════════════════════════════════════════════════════
-- ★★ **أربعةُ مفاتيحَ أجنبيّةٍ بلا فهرس — استعلاماتٌ مرتبطةٌ ومسحٌ كاملٌ عند الحذف.**
--
-- · `conversations.contact_id`: كلُّ ما يخصّ جهةً (ورقتُها، دمجُها، حجبُها،
--   بثُّ تحديثها) يبحث بها — وكان مسحاً كاملاً لمحادثات المستأجر.
-- · `conversation_windows.contact_id`: الدمجُ ينقل نوافذَ الجهة المُمتصّة.
-- · `kb_chunks.source_id`: حذفُ ملفِّ معرفةٍ يتعاقب (CASCADE) إلى مقاطعه —
--   وبلا فهرسٍ يمسح PostgreSQL جدولَ المقاطع كلَّه لكلّ حذف، وهو أكبرُ جدولٍ
--   عند عميلٍ يرفع ملفّات. (`kb_chunks_uq` يبدأ بـtenant_id ثمّ version_id
--   فلا يخدم هذا الشرط.)
-- · `kb_retrievals.conversation_id`: أثرُ الاسترجاع يُقرأ لكلّ محادثة.
--
-- ⚠️ بلا خيار البناء المتزامن عمداً: الترحيلاتُ تُطبَّق داخل معاملةٍ في النشر،
--    وذلك الخيارُ يرفض المعاملة. والجداولُ اليومَ صغيرةٌ فالقفلُ لحظيّ — ومن
--    يعيد هذا على قاعدةٍ كبيرةٍ يفعلها يدويّاً خارج النشر.
-- ════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS conv_contact_idx     ON conversations        (tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS windows_contact_idx  ON conversation_windows (tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS kb_chunks_source_idx ON kb_chunks            (source_id);
CREATE INDEX IF NOT EXISTS kb_retr_conv_idx     ON kb_retrievals        (conversation_id);
