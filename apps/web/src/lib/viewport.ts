'use client';

import { useEffect } from 'react';

/**
 * ★ **لوحةُ مفاتيح الهاتف كانت تغطّي حقلَ الكتابة وآخرَ الرسائل.**
 *
 *   الإطارُ مثبَّتٌ على `100dvh`، و`dvh` تحسب شريطَ عنوان المتصفّح الذي
 *   ينزلق — **ولا تحسب لوحةَ المفاتيح**. فعلى iOS تبقى الشاشةُ بطولها
 *   الكامل بينما نصفُها السفليُّ تحت اللوحة: يكتب الموظّف ولا يرى ما يكتب،
 *   ولا يرى الرسالةَ التي يردّ عليها، وزرُّ الإرسال خارج الشاشة.
 *   وهو عطلٌ يقع في **كلّ** ردٍّ يُكتب على هاتف — أي في أغلب العمل.
 *
 *   والحلُّ `visualViewport`: المقياسُ الوحيد الذي يعرف اللوحة. يُنشر
 *   ارتفاعُه في `--vvh` ويقرؤه الإطار، فينكمش فوقها بدل أن يختفي تحتها.
 *
 * ⚠️ ويبقى `100dvh` احتياطاً في CSS: متصفّحٌ بلا `visualViewport` (وهي
 *    مدعومةٌ في كلّ ما يهمّنا، لكنّ الاحتياط مجّانيّ) يعمل كما كان لا أسوأ.
 * ⚠️ و`offsetTop` يُطرح أيضاً: سفاري يُزيح الإطارَ المرئيَّ إلى الأعلى عند
 *    التركيز داخل حقلٍ قرب الأسفل، فالارتفاعُ وحده لا يكفي.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      root.style.setProperty('--vvtop', `${Math.round(vv.offsetTop)}px`);
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vvtop');
    };
  }, []);
}
