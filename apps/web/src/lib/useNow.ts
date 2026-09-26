'use client';

import { useEffect, useState } from 'react';

/**
 * ساعةٌ تدقّ كلَّ `everyMs` — للعدّادات التنازليّة في القشرة.
 *
 * ⚠️ تدقّ حين `active` وحده: قشرةٌ بلا انتحالٍ لا تُعيد رسمَ نفسها كلَّ
 *    ربع دقيقةٍ بلا سبب.
 */
export function useNow(active: boolean, everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs]);
  return now;
}
