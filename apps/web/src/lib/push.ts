import { api, post, del } from './api';

/**
 * ★ تفعيل الإشعارات من المتصفّح — الطرف المفقود من سلسلة التنبيه.
 *
 *   `public/sw.js` مكتوبٌ منذ البداية ويعالج `push` و`notificationclick`،
 *   و`notify.ts` في العامل يقرأ الاشتراكات ويدفع إليها. وبينهما كان فراغٌ
 *   كامل: لا سطرَ يسجّل العامل، ولا يطلب إذناً، ولا يرسل الاشتراك إلى الخادم.
 *   فكان الجدولُ فارغاً أبداً وكلُّ تنبيهٍ حرجٍ يُكتب ولا يصل أحداً.
 *
 * ⚠️ ثلاثة قيودٍ لا تُتجاوَز، وكلُّها سببُ رسالةٍ مكتوبةٍ أدناه لا صمت:
 *   • المفتاح العامّ يأتي من الخادم لا من بيئة البناء — الواجهة تُبنى مرّةً
 *     وتُشغَّل في متصفّحٍ لا بيئةَ له، والمفتاح يتبدّل بتبدّل الخادم.
 *   • الإذن يُطلب **بعد إيماءةِ مستخدم** — المتصفّحات ترفض الطلب التلقائيّ،
 *     ورفضٌ دائمٌ لا يُستأنف من الصفحة إطلاقاً.
 *   • على iOS لا إشعارات إلّا إذا أُضيف التطبيق إلى الشاشة الرئيسيّة (16.4+)،
 *     ولا `PushManager` قبل ذلك — فالحالة تُقال لا تُخمَّن.
 */

export type PushState =
  /** المتصفّح لا يدعم الدفع أصلاً (أو iOS خارج الشاشة الرئيسيّة). */
  | 'unsupported'
  /** الإذن مرفوضٌ رفضاً دائماً — لا سبيل إلى الطلب ثانيةً من الصفحة. */
  | 'denied'
  /** مدعومٌ ولم يُشترَك بعد. */
  | 'off'
  /** مشتركٌ وفعّال. */
  | 'on';

/** هل يملك هذا المتصفّح ما يلزم؟ يُقرأ في المتصفّح وحده. */
export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/** الحالة الحاليّة بلا أيّ طلبِ إذنٍ ولا أثرٍ جانبيّ — تُنادى عند الرسم. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => null);
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  return sub ? 'on' : 'off';
}

/**
 * مفتاح VAPID يأتي base64url ويحتاجه المتصفّح بايتاتٍ خامّة.
 * والتحويل يدويّ لأنّ `atob` لا يعرف أبجديّة url.
 */
function urlB64ToBytes(b64: string): ArrayBuffer {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  /* ★ `ArrayBuffer` لا `Uint8Array`: نوعُ `applicationServerKey` يشترط عازلاً
     مدعوماً بـ`ArrayBuffer` بعينه، و`Uint8Array` العامّ قد يُدعَم بذاكرةٍ
     مشتركة فيرفضه المدقّق. والعازلُ يُنشأ أوّلاً ويُكتب من خلال منظارٍ عليه. */
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

/**
 * يُفعّل الإشعارات: يسجّل العامل، يطلب الإذن، يشترك، ويرسل الاشتراك للخادم.
 * يُنادى من معالج ضغطةٍ لا غير. ويرمي برسالةٍ عربيّةٍ تقول ما يُفعل.
 */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) {
    throw new Error(
      'متصفّحك لا يدعم الإشعارات. على الآيفون: أضِف التطبيق إلى الشاشة الرئيسيّة ثمّ افتحه من هناك.',
    );
  }
  if (Notification.permission === 'denied') {
    throw new Error('الإشعارات محظورةٌ لهذا الموقع في إعدادات متصفّحك — اسمح بها من هناك ثمّ أعِد المحاولة.');
  }

  const { key } = await api<{ key: string }>('/push/key');

  const reg = await navigator.serviceWorker.register('/sw.js');
  // انتظارُ الجاهزيّة شرط: `pushManager` على تسجيلٍ لم يُفعَّل بعد يرمي
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('لم تُمنح الإشعارات. اضغط ثانيةً واسمح بها لتصلك التنبيهات الحرجة.');
  }

  const sub = await reg.pushManager.subscribe({
    // شرطٌ في كروم: إشعارٌ مرئيٌّ لكلّ دفعة — ولا دفعَ صامتاً
    userVisibleOnly: true,
    applicationServerKey: urlB64ToBytes(key),
  });

  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  await post('/push/subscribe', { endpoint: j.endpoint, keys: j.keys });
}

/** يوقف الإشعارات على هذا الجهاز: يُلغي الاشتراك محلّيّاً ثمّ يحذفه من الخادم. */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => null);
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  const endpoint = sub.endpoint;
  // الترتيب مقصود: لو فشل الحذف من الخادم بقي الاشتراك ميّتاً عنده ويُنظَّف
  // عند أوّل دفعةٍ تعيد 410 — أهونُ من إلغاءٍ محلّيٍّ لم يقع وصفٍّ يظنّ نفسه حيّاً.
  await sub.unsubscribe().catch(() => undefined);
  await del('/push/subscribe', { endpoint }).catch(() => undefined);
}

/** تنبيهٌ تجريبيّ يسلك المسار الحقيقيّ كاملاً — فيكشف انقطاعه قبل الحادثة. */
export async function testPush(): Promise<void> {
  await post('/push/test', {});
}
