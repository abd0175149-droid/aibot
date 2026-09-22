'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * التحكّم بالنمط — فاتح · داكن · اتبع النظام.
 *
 * ★ لماذا وُجد: نظام التوكِنات يدعم ثلاث حالاتٍ منذ البداية
 *   (`:root` المجرّد، و`prefers-color-scheme` مضبوطةً بـ`:not([data-theme='light'])`،
 *   و`:root[data-theme='dark']`) — و**لا سطر واحد في التطبيق كان يكتب `data-theme`**.
 *   فالحالة الثالثة كانت ميّتة والمستخدم محكومٌ بإعداد نظام تشغيله بلا خيار.
 *   وكان `suppressHydrationWarning` موضوعاً على `<html>` أصلاً: بصمةُ الاستعداد
 *   لسكربتٍ لم يُكتب قطّ.
 *
 * ★ وثلاثة قرارات تحكم هذا الملفّ:
 *
 *  ① **«اتبع النظام» حالةٌ حقيقيّة لا افتراضٌ ضمنيّ.** حين يختارها المستخدم
 *    نُزيل `data-theme` تماماً فتحكم `prefers-color-scheme` — ونستمع لتغيّرها
 *    فتتبدّل الشاشة معه دون إعادة تحميل. ولو خزّنّا «فاتح» عند اختيار «النظام»
 *    لتجمّد على ما كان وقت الاختيار.
 *
 *  ② **لا وميض.** السكربت يعمل قبل أوّل رسم، متزامناً في `<head>`، فلا يرى
 *    المستخدم ومضةً فاتحةً قبل الداكن. ولذلك هو نصٌّ خام لا مكوّن React:
 *    React يعمل بعد الرسم الأوّل، فيكون الوميض قد وقع.
 *
 *  ③ **التخزين قد يرمي.** نافذةٌ خاصّة أو بيانات موقعٍ محظورة تجعل
 *    `localStorage` يرمي عند القراءة نفسها لا عند الكتابة فقط. كلّ وصولٍ
 *    ملفوفٌ بـtry/catch، والفشل يعني «اتبع النظام» لا شاشةً بيضاء.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'aibot.theme';

/**
 * السكربت الذي يسبق الرسم الأوّل. يُحقن نصّاً في `<head>`.
 * مكتوبٌ بـES5 وبلا اعتماديّات — يعمل قبل أيّ حزمة.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(KEY)});
if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}
else{document.documentElement.removeAttribute('data-theme');}
}catch(e){}})();`;

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice): void {
  const el = document.documentElement;
  if (choice === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', choice);
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* نافذةٌ خاصّة أو تخزينٌ محظور — الاختيار يعمل لهذه الجلسة ولا يُحفظ */
  }
}

interface ThemeCtx {
  choice: ThemeChoice;
  /** ما يُعرض فعلاً الآن — يلزم لأيقونةٍ تعكس الواقع لا النيّة. */
  resolved: 'light' | 'dark';
  set: (c: ThemeChoice) => void;
}

const Ctx = createContext<ThemeCtx>({ choice: 'system', resolved: 'light', set: () => undefined });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setChoice(read());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    // ★ الاستماع يجعل «اتبع النظام» حيّةً: تبدّل النظام يبدّل الشاشة فوراً
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  function set(c: ThemeChoice) {
    setChoice(c);
    apply(c);
  }

  const resolved: 'light' | 'dark' = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;

  return <Ctx.Provider value={{ choice, resolved, set }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}
