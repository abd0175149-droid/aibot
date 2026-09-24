'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getToken, bootstrap } from './api';
import { useSession } from './session';
import type { EventMap } from '@aibot/shared';

let socket: Socket | null = null;

/* ── حالةُ الاتّصال، مُشتركةٌ لأنّ السوكِت واحدٌ للتطبيق كلّه ── */
export type LinkState = 'up' | 'down';
let link: LinkState = 'down';
const watchers = new Set<() => void>();
function setLink(next: LinkState): void {
  if (link === next) return;
  link = next;
  for (const w of watchers) w();
}

/** لا تجديدَين متزامنَين للتوكن عند وابل `connect_error`. */
let renewing: Promise<boolean> | null = null;

/**
 * الاتّصال اللحظيّ.
 *
 * اتّصالٌ واحد للتطبيق كلّه — لا اتّصالٌ لكلّ شاشة. والأحداث تُحدِّث الكاش
 * مباشرةً بدل إعادة الجلب: إنبوكسٌ بعشر محادثاتٍ نشطة يُرهق الشبكة وإلّا.
 *
 * ★ **العطل الذي أُعيدت كتابةُ هذا الملفّ من أجله: الإنبوكس الحيّ كان يموت
 *   صامتاً بعد كلّ نشر.**
 *
 *   كان التوكن يُمرَّر **كائناً ثابتاً** (`auth: { token }`) يُلتقط مرّةً عند
 *   الإنشاء. وعمرُ توكن الوصول ربعُ ساعة، والاتّصالُ يعيش ساعات. فعند أوّل
 *   انقطاع — نشرةٌ تُعيد تشغيل الـAPI، أو نومُ الجهاز، أو تذبذبُ شبكة —
 *   يُعيد العميل الاتّصال **بنفس التوكن المنتهي**، فيرفضه `io.use` في
 *   المصافحة. ورفضُ الوسيط ليس كخطأ النقل: `socket.io-client` يضع
 *   `active = false` ويتوقّف عن المحاولة **إلى الأبد**.
 *
 *   والنتيجةُ أنّ الشاشة تبقى كما هي، ساكنةً، بلا أيّ علامة: رسائل الزبائن
 *   تصل القاعدة ولا تظهر للموظّف حتّى يُحدّث الصفحة بالصدفة. وهو بعينه
 *   العطلُ الذي كُتب جسرُ البثّ لإزالته.
 *
 *   ثلاثةٌ تُصلحه معاً — وأيُّ واحدٍ وحده لا يكفي:
 *     ① التوكن **دالّةٌ** تُقرأ عند كلّ مصافحة، لا كائنٌ يُلتقط مرّة.
 *     ② رفضُ المصافحة يُجدّد التوكن ثمّ يُعيد الوصل بيده — فالعميل توقّف.
 *     ③ الحالةُ تُنشر للشاشة، فالانقطاعُ يُرى ويُعاد الجلبُ عند العودة.
 */
function ensure(): Socket | null {
  if (socket) return socket;
  if (!getToken()) return null;

  socket = io({
    path: '/api/socket.io',
    /* ★ دالّةٌ لا كائن: socket.io ينادي هذه عند **كلّ** مصافحة، فيذهب
       التوكن الحيُّ لا الذي كان حيّاً ساعةَ فُتحت الصفحة. */
    auth: (cb: (d: Record<string, unknown>) => void) => cb({ token: getToken() ?? '' }),
    transports: ['websocket', 'polling'],
    reconnectionDelay: 800,
    reconnectionDelayMax: 8000,
  });

  socket.on('connect', () => setLink('up'));

  /**
   * ★ **قطعٌ من الخادم لا يُعيد الوصلَ من نفسه.**
   *
   *   `socket.disconnect(true)` في الخادم يصل العميلَ بسبب
   *   `io server disconnect`، و`socket.io-client` **لا يُعيد المحاولة** عليه
   *   قصداً: فُرض أنّ الخادم قصد الطرد. وهو يقصده فعلاً حين يُعطَّل حساب —
   *   لكنّه يقصده أيضاً حين تُعاد تهيئةُ الخادم.
   *   فيُعاد الوصلُ بتوكنٍ حيّ: من عُطِّل حسابُه يرفضه `io.use` عند المصافحة
   *   فيبقى خارجاً، ومن كان شرعيّاً يعود خلال ثانية. وبلا هذا كان كلُّ إخراجٍ
   *   مقصودٍ يُسكت إنبوكسَ صاحبه **حتّى لو أُعيد تفعيلُه**.
   */
  socket.on('disconnect', (reason: string) => {
    setLink('down');
    if (reason !== 'io server disconnect') return;
    renewing ??= bootstrap().finally(() => { renewing = null; });
    void renewing.then((ok) => { if (ok) socket?.connect(); });
  });

  socket.on('connect_error', (err: Error) => {
    setLink('down');
    /* الرفضُ من الوسيط (توكن منتهٍ) يُوقف المحاولاتِ نهائيّاً، فالتعافي
       يدويٌّ: جدّد التوكن ثمّ صِل. وما عداه خطأُ نقلٍ يتكفّل به العميل. */
    if (!/unauthorized/i.test(err.message)) return;
    renewing ??= bootstrap().finally(() => { renewing = null; });
    void renewing.then((ok) => { if (ok) socket?.connect(); });
  });

  return socket;
}

/**
 * ★ المعالِجاتُ مقيَّدةٌ بـ`EventMap`: اسمٌ خارج العقد لا يُترجَم، وحمولةٌ
 *   بحقلٍ غير موجودٍ لا تُترجَم. وكان النوعُ `Record<string, (p: any)=>void>` —
 *   أي أنّ حرفاً واحداً في الاسم يُسكت التحديثَ اللحظيَّ بصمت.
 */
export type SocketHandlers = { [K in keyof EventMap]?: (payload: EventMap[K]) => void };

export function useSocket(handlers: SocketHandlers): void {
  const { me } = useSession();
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!me) return;
    const s = ensure();
    if (!s) return;

    const names = Object.keys(ref.current) as Array<keyof EventMap>;
    const bound = names.map((n) => {
      const fn = (p: unknown) => (ref.current[n] as ((x: unknown) => void) | undefined)?.(p);
      s.on(n, fn);
      return [n, fn] as const;
    });

    return () => { for (const [n, fn] of bound) s.off(n, fn); };
  }, [me]);
}

const subscribeLink = (cb: () => void) => {
  watchers.add(cb);
  return () => { watchers.delete(cb); };
};

/**
 * حالةُ الوصلة للشاشة — و`onBack` يُنادى عند **عودة** الوصل لا عند أوّل وصل.
 * فالشاشةُ التي فاتها بثٌّ تُعيد الجلب، والتي لم يفتها شيءٌ لا تُرهق الشبكة.
 */
export function useLink(onBack?: () => void): LinkState {
  const state = useSyncExternalStore(subscribeLink, () => link, () => 'down' as LinkState);
  const wasDown = useRef(false);
  const cb = useRef(onBack);
  cb.current = onBack;

  useEffect(() => {
    if (state === 'down') { wasDown.current = true; return; }
    if (wasDown.current) { wasDown.current = false; cb.current?.(); }
  }, [state]);

  return state;
}

/**
 * استطلاعٌ احتياطيٌّ **ما دامت الوصلة منقطعة** — وهو الشبكةُ الأخيرة.
 * فحتّى لو عجز التجديدُ عن إعادة الوصل، لا يجلس الموظّف أمام شاشةٍ ميّتة.
 */
export function useFallbackPoll(down: boolean, everyMs: number, fn: () => void): void {
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    if (!down) return;
    const t = setInterval(() => cb.current(), everyMs);
    return () => clearInterval(t);
  }, [down, everyMs]);
}

export function closeSocket(): void {
  socket?.close();
  socket = null;
  setLink('down');
}
