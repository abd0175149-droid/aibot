import { TENANT_SCOPED } from './schema.js';

/**
 * يولّد ترحيل RLS من نفس القائمة التي يقرأها اختبار التسرّب.
 * فجدولٌ جديد يُنسى من `TENANT_SCOPED` يسقط في الاختبار لا في الإنتاج.
 *
 * ⚠️ `nullif(..., '')` ليس تجميلاً: `current_setting('app.tenant_id', true)`
 *    يُرجع NULL حين لا يُضبط قطّ (فلا تظهر صفوف — وهذا المطلوب)، لكنّه يُرجع
 *    **نصّاً فارغاً** إن ضُبط بفراغ، و`''::uuid` يرمي خطأً بدل أن يمنع بهدوء.
 *    كشفَ هذا تشغيلٌ على قاعدةٍ حقيقيّة، ولم يكشفه أيّ اختبارٍ بلا قاعدة.
 */
export function rlsMigrationSql(): string {
  const parts: string[] = [
    '-- مولَّد من TENANT_SCOPED — لا تُحرّره يدويّاً، حرّر schema.ts',
    '',
  ];
  for (const t of TENANT_SCOPED) {
    parts.push(
      /* ★ مشروطتان: `ALTER TABLE` يأخذ ACCESS EXCLUSIVE **قبل** أن يكتشف
         أنّ لا شيءَ ليُغيَّر، وطلبُه يصطفّ أمام القرّاء التاليين فيجمّد الجدول
         لا يزاحمه فقط. وبلا الشرط تُنفَّذ عبارتان لكلّ جدولٍ في كلّ نشرة
         (خمسون قفلاً حصريّاً) ولا واحدةٌ منها تُغيّر شيئاً. */
      `DO $$ BEGIN`,
      `  IF NOT (SELECT relrowsecurity AND relforcerowsecurity`,
      `            FROM pg_class WHERE oid = '${t}'::regclass) THEN`,
      `    ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
      `    ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
      `  END IF;`,
      `END $$;`,
      /* ⚠️ وأمّا السياسةُ نفسُها فتُحذف وتُعاد **بلا شرط** عن قصد: شرطٌ على
         وجود اسمٍ اسمُه `tenant_isolation` يعني أنّ تغييرَ **تعبير** السياسة لا
         يسري أبداً على قاعدةٍ قائمة — فتبقى القديمةُ تحرس بتعبيرٍ عتيق، وهو
         عطلُ عزلٍ صامتٌ أسوأُ من قفلٍ زائد. والنافذةُ بين الحذف والإنشاء
         (‏RLS مفعّلٌ بلا سياسة = صفرُ صفوفٍ بصمت) مغلقةٌ بـ`--single-transaction`
         في `deploy.sh`. */
      `DROP POLICY IF EXISTS tenant_isolation ON ${t};`,
      `CREATE POLICY tenant_isolation ON ${t}`,
      `  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)`,
      `  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO aibot_app;`,
      '',
    );
  }
  parts.push(
    "GRANT USAGE ON SCHEMA public TO aibot_app, aibot_platform;",
    "GRANT SELECT ON tenants, plans TO aibot_app;",
    "-- audit_log إضافةٌ فقط: لا واجهة تحذف منه ولا تعدّله",
    "REVOKE UPDATE, DELETE ON audit_log FROM aibot_app;",
  );
  return parts.join('\n');
}
