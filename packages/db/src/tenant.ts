import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client.js';

/**
 * البوّابة الأولى من بوّابتَي العزل.
 *
 * كلّ وصولٍ إلى جدولٍ مستأجَر يمرّ من هنا، والدالّة تفتح معاملةً وتضبط
 * `app.tenant_id` فيها — فتُفعَّل سياسات RLS (البوّابة الثانية) على كلّ
 * استعلامٍ داخلها تلقائيّاً، حتّى لو نسي المطوّر `where`.
 *
 * النتيجة المقصودة: **لا يكفي خطأٌ برمجيٌّ واحد لتسريب بيانات عميلٍ إلى آخر** —
 * يلزم خطآن في طبقتين مختلفتين.
 *
 * ⚠️ `SET LOCAL` تعمل داخل المعاملة وحدها. استعمالها خارج معاملةٍ يضبط المتغيّر
 *    على اتّصالٍ مُعارٍ من المجمّع ثمّ يُعيده للمجمّع وهو ملوَّث — وهذا بالضبط
 *    شكل التسريب الذي تمنعه الدالّة. لذلك لا تُصدَّر طريقةٌ أخرى لضبطه.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
    throw new Error('tenantId غير صالح — يُشتقّ من التوكن لا من الطلب');
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * وصولٌ عابرٌ للمستأجرين — للمالك وللعمّال المجدولين فقط.
 * كلّ استدعاءٍ يجب أن يُتبَع بسطرٍ في `audit_log`؛ ولذلك يأخذ سبباً إلزاميّاً
 * لا يُستعمل في الاستعلام بل يُجبر المستدعي على التصريح بنيّته في الكود نفسه.
 */
export async function withPlatform<T>(
  db: Db,
  reason: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!reason || reason.length < 8) {
    throw new Error('withPlatform يحتاج سبباً مكتوباً — الوصول العابر لا يكون صامتاً');
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE aibot_platform`);
    return fn(tx);
  });
}
