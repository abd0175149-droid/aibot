/*
 * Service Worker.
 *
 * ⚠️ مزالق iOS المدفوعة الثمن:
 *   • الإشعارات لا تعمل إلّا إذا أُضيف التطبيق إلى الشاشة الرئيسيّة (16.4+).
 *   • الإذن يُطلب **بعد إيماءة مستخدم** لا عند التحميل.
 *   • تحديث الـSW لا يُلتقط إلّا بإعادة تشغيل التطبيق — خطّط لذلك في كلّ إصدار.
 *
 * ⚠️ والصفحة التي يُثبَّت منها تحدّد التطبيق: من ثبّت من ‎/console حصل على لوحة
 *    المالك. ضع زرّ التثبيت في الشاشة الصحيحة لكلّ دور.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let p = {};
  try {
    p = event.data.json();
  } catch {
    p = { title: 'AiBot', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(p.title || 'AiBot', {
      // لا محتوى رسالةٍ كاملاً: إشعارٌ على شاشة قفلِ موظّفٍ تسريبٌ محتمل
      body: p.body || '',
      // tag + renotify: إشعارٌ حيٌّ واحد لكلّ موضوع يُحدَّث ولا يتكرّر
      tag: p.tag || 'aibot',
      renotify: Boolean(p.renotify),
      icon: '/icon.svg',
      badge: '/icon.svg',
      dir: 'rtl',
      lang: 'ar',
      data: p.data || {},
      actions: [{ action: 'open', title: 'افتح' }],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app';

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // إن كان التطبيق مفتوحاً: ركّزه وانتقل — لا تفتح تبويباً ثانياً
      for (const c of all) {
        if ('focus' in c) {
          await c.focus();
          if ('navigate' in c) await c.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
