import type { FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import IORedis from 'ioredis';
import {
  EVENT_CHANNEL, decodeEvent, type EventMap, type PlatformEventMap,
} from '@aibot/shared';
import { verifyAccess } from './auth.js';

/**
 * البثّ اللحظيّ.
 *
 * غرفةٌ لكلّ مستأجر `t:{id}` وغرفةٌ للمالك `platform` — والعزل ببساطة.
 *
 * ⚠️ درسٌ من تشديدٍ أمنيّ سابق: **لا يكفي التحقّق عند الاتّصال**.
 *    كلّ انضمامٍ لغرفةٍ يُعاد التحقّق منه، لأنّ الاتّصال يعيش ساعاتٍ بينما
 *    عمر التوكن 15 دقيقة، ولأنّ العميل يستطيع طلب أيّ غرفةٍ شاء.
 */
let io: SocketServer | null = null;
let sub: IORedis | null = null;

export function attachRealtime(app: FastifyInstance): void {
  io = new SocketServer(app.server, {
    path: '/api/socket.io',
    cors: { origin: process.env.PUBLIC_URL ?? true, credentials: true },
    serveClient: false,
  });

  io.use((socket, next) => {
    const token = String(socket.handshake.auth?.token ?? '');
    const claims = verifyAccess(token);
    if (!claims) return next(new Error('UNAUTHORIZED'));
    socket.data.claims = claims;
    next();
  });

  /**
   * ★ جسرُ العامل — الجزء الذي كان مفقوداً كلّيّاً.
   *
   * العامل هو من يكتب الرسائل الواردة والصادرة، والـAPI هو من يملك خادم
   * السوكِت. وهما عمليّتان منفصلتان: `apps/worker` لا يستورد هذا الملفّ ولا
   * يستطيع. فكانت الشاشة تستمع لـ`message:new` و**لا يبثّه أحد** — رسالة
   * الزبون لا تظهر حتّى يُحدّث الموظّف الصفحة يدويّاً. إنبوكسٌ «حيّ» لم يكن
   * حيّاً ولا مرّة، وهو أصل شكوى «غير عمليّ».
   *
   * ★ والوارد من القناة **بيانٌ لا أمر**: نُعيد بثّه في غرفة مستأجره ولا
   *   ننفّذ منه شيئاً. و`decodeEvent` يرفض كلّ شكلٍ غير مطابق فلا تُسقط
   *   حمولةٌ مشوّهة المشتركَ كلّه.
   */
  const url = process.env.REDIS_URL;
  if (url) {
    sub = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
    sub.on('error', (e) => app.log.warn({ err: e }, 'مشترك الأحداث اللحظيّة'));
    void sub.subscribe(EVENT_CHANNEL).catch((e) => {
      app.log.error({ err: e }, 'تعذّر الاشتراك بقناة الأحداث — الإنبوكس لن يكون حيّاً');
    });
    sub.on('message', (_ch, raw) => {
      const ev = decodeEvent(raw);
      if (!ev) return;
      io?.to(`t:${ev.tenantId}`).emit(ev.event, ev.payload);
    });
  } else {
    app.log.error('REDIS_URL غير مضبوط — لا بثّ لحظيّ من العامل');
  }

  io.on('connection', (socket) => {
    const claims = socket.data.claims as ReturnType<typeof verifyAccess>;
    if (!claims) return socket.disconnect(true);

    /* ★ المقبضُ يُنسب إلى صاحبه ليُخرَج باسمه عند التعطيل — انظر
       `disconnectUser` أدناه. و`socket.data` موضعُه الطبيعيّ: يعيش مع
       الاتّصال ويموت معه. */
    socket.data.userId = claims.sub;

    // الانضمام التلقائيّ لغرفة المستأجر — لا ينضمّ العميل بنفسه لأيّ غرفة
    if (claims.tid) socket.join(`t:${claims.tid}`);
    /* ★ وانضمامٌ تلقائيٌّ بكلمة سرٍّ وحدها كان يُبقي سيلَ أحداث المنصّة
       مفتوحاً بينما اللوحةُ ترفض — فيُقرأ الأمرُ عطلاً في اللوحة لا حجباً. */
    if (claims.role === 'platform_owner' && claims.mfa === 'ok') socket.join('platform');

    socket.on('join', (room: unknown, ack?: (ok: boolean) => void) => {
      const target = String(room ?? '');
      // إعادة التحقّق عند كلّ انضمام — لا عند الاتّصال وحده
      const allowed =
        (claims.tid && target === `t:${claims.tid}`) ||
        /* ★★★ وهذه أوسعُ قراءةٍ عابرةٍ للمستأجرين في المنصّة كلِّها: بادئةُ
           `t:` تعني غرفةَ **أيّ** مستأجر، وحمولةُ `message:new` تحمل نصَّ
           الرسالة كاملاً. فحجبُ اللوحة وحدها مع تركِ هذه مفتوحةً إصلاحٌ على
           الورق: نفسُ البيانات تصل من الباب الثاني حيّةً. */
        (claims.role === 'platform_owner' && claims.mfa === 'ok'
          && (target === 'platform' || target.startsWith('t:')));
      if (!allowed) return ack?.(false);
      socket.join(target);
      ack?.(true);
    });
  });
}

/**
 * ★ **إخراجُ مقابض عضوٍ فوراً — والمقبضُ كان يعيش أطولَ من التوكن الذي فتحه.**
 *
 *   `io.use` يتحقّق عند **المصافحة وحدها**، والمصافحةُ تقع مرّةً ثمّ يعيش
 *   الاتّصال ساعات. فموظّفٌ عُطِّل حسابُه يبقى في غرفة مستأجره يرى نصَّ كلّ
 *   رسالةٍ يكتبها زبونٌ — وحمولةُ `message:new` تحمل النصّ كاملاً. طلباتُه
 *   على HTTP تسقط بـ401، والسوكِتُ لا يسأل أحداً.
 *   وإبطالُ الجلسات في شاشة الفريق يمنع **التجديد** ولا يُغلق قناةً مفتوحة.
 *
 * ⚠️ ويُنادى **بعد** إيداع المعاملة لا داخلها، لسببَين: قاعدةُ المستودع
 *    تمنع نداءً خارجيّاً داخل `withTenant` (المسبح عشرُ وصلات)، ومعاملةٌ
 *    تُلغى بعد إخراج صاحبها تطرد عضواً ما زال نشطاً في الجدول.
 *
 * ⚠️ ولا مَسحٌ دوريٌّ على انتهاء التوكن — وهو ما بدا الحلَّ الأوضح وهو فخّ:
 *    `socket.disconnect(true)` من الخادم **لا يُنتج `connect_error`** عند
 *    العميل ولا يُعيد الوصلَ تلقائيّاً. فمسحٌ كلَّ ربع ساعةٍ على انتهاء
 *    التوكن كان سيقتل إنبوكسَ كلّ موظّفٍ شرعيٍّ بصمت — وهو بعينه العطلُ
 *    الذي أُصلح في دفعةٍ سابقة. والعميلُ يُعيد الوصلَ الآن عند قطعٍ من
 *    الخادم (‏`lib/socket.ts`)، فالإخراجُ المقصود يتعافى منه الشرعيُّ
 *    ويبقى المعطَّلُ خارجاً — يرفضه `io.use` عند المصافحة التالية.
 */
export function disconnectUser(userId: string): void {
  if (!io) return;
  for (const s of io.of('/').sockets.values()) {
    if (s.data.userId === userId) s.disconnect(true);
  }
}

/**
 * الحمولة تحمل **الصفّ الجديد كاملاً** لا معرّفه.
 * يوفّر جولة ذهابٍ وإياب، ويُبقي الواجهة متّسقة عند تعدّد التبويبات.
 */
export function emitToTenant<K extends keyof EventMap>(
  tenantId: string, event: K, payload: EventMap[K],
): void {
  io?.to(`t:${tenantId}`).emit(event, payload);
}

export function emitToPlatform<K extends keyof PlatformEventMap>(
  event: K, payload: PlatformEventMap[K],
): void {
  io?.to('platform').emit(event, payload);
}

export async function closeRealtime(): Promise<void> {
  if (sub) {
    await sub.quit().catch(() => undefined);
    sub = null;
  }
  await new Promise<void>((resolve) => (io ? io.close(() => resolve()) : resolve()));
  io = null;
}
