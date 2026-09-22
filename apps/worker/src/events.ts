import IORedis from 'ioredis';
import { EVENT_CHANNEL, encodeEvent } from '@aibot/shared';

/**
 * ناشر الأحداث اللحظيّة.
 *
 * ★ الإنبوكس كان يستمع لـ`message:new` و**لا يبثّه أحد**: العامل يكتب
 *   الرسائل والـAPI يملك خادم السوكِت، وهما عمليّتان لا تتكلّمان. فرسالة
 *   الزبون لم تكن تظهر حتّى يُحدّث الموظّف الصفحة — إنبوكسٌ «حيّ» لم يكن
 *   حيّاً ولا مرّة.
 *
 * ★ **البثّ لا يُسقط عملاً أبداً.** كلّ نداءٍ هنا مبتلَع الخطأ عمداً:
 *   ريدِس مقطوعٌ يعني شاشةً تتأخّر حتّى التحديث التالي، وهو أهون بكثيرٍ من
 *   رسالةٍ لا تُحفظ أو ردٍّ لا يُرسل. الأحداث زينةٌ فوق الحقيقة لا الحقيقة.
 */

let pub: IORedis | null = null;

function conn(): IORedis | null {
  if (pub) return pub;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  pub = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false, lazyConnect: false });
  // اتّصالٌ ناشرٌ منفصل: لا نخلطه باتّصال الطوابير فلا يعطّل أحدهما الآخر
  pub.on('error', () => undefined);
  return pub;
}

export function emitToTenant(tenantId: string, event: string, payload: unknown): void {
  const c = conn();
  if (!c) return;
  void c.publish(EVENT_CHANNEL, encodeEvent({ tenantId, event, payload })).catch(() => undefined);
}

export async function closeEvents(): Promise<void> {
  if (!pub) return;
  await pub.quit().catch(() => undefined);
  pub = null;
}
