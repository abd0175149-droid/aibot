'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getToken } from './api';
import { useSession } from './session';

let socket: Socket | null = null;

/**
 * الاتّصال اللحظيّ.
 *
 * اتّصالٌ واحد للتطبيق كلّه — لا اتّصالٌ لكلّ شاشة. والأحداث تُحدِّث الكاش
 * مباشرةً بدل إعادة الجلب: إنبوكسٌ بعشر محادثاتٍ نشطة يُرهق الشبكة وإلّا.
 */
function ensure(): Socket | null {
  const token = getToken();
  if (!token) return null;
  if (socket?.connected) return socket;

  socket?.close();
  socket = io({
    path: '/api/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 800,
    reconnectionDelayMax: 8000,
  });
  return socket;
}

export function useSocket(handlers: Record<string, (payload: any) => void>): void {
  const { me } = useSession();
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!me) return;
    const s = ensure();
    if (!s) return;

    const names = Object.keys(ref.current);
    const bound = names.map((n) => {
      const fn = (p: unknown) => ref.current[n]?.(p);
      s.on(n, fn);
      return [n, fn] as const;
    });

    return () => { for (const [n, fn] of bound) s.off(n, fn); };
  }, [me]);
}

export function closeSocket(): void {
  socket?.close();
  socket = null;
}
