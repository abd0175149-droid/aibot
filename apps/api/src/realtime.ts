import type { FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import IORedis from 'ioredis';
import { EVENT_CHANNEL, decodeEvent } from '@aibot/shared';
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

    // الانضمام التلقائيّ لغرفة المستأجر — لا ينضمّ العميل بنفسه لأيّ غرفة
    if (claims.tid) socket.join(`t:${claims.tid}`);
    if (claims.role === 'platform_owner') socket.join('platform');

    socket.on('join', (room: unknown, ack?: (ok: boolean) => void) => {
      const target = String(room ?? '');
      // إعادة التحقّق عند كلّ انضمام — لا عند الاتّصال وحده
      const allowed =
        (claims.tid && target === `t:${claims.tid}`) ||
        (claims.role === 'platform_owner' && (target === 'platform' || target.startsWith('t:')));
      if (!allowed) return ack?.(false);
      socket.join(target);
      ack?.(true);
    });
  });
}

/**
 * الحمولة تحمل **الصفّ الجديد كاملاً** لا معرّفه.
 * يوفّر جولة ذهابٍ وإياب، ويُبقي الواجهة متّسقة عند تعدّد التبويبات.
 */
export function emitToTenant(tenantId: string, event: string, payload: unknown): void {
  io?.to(`t:${tenantId}`).emit(event, payload);
}

export function emitToPlatform(event: string, payload: unknown): void {
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
