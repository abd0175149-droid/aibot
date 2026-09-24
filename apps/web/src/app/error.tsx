'use client';

import { useEffect } from 'react';

/**
 * ★ **صفحةُ العطل — بالعربيّة وبمخرجٍ ومعرّفٍ يُقال للدعم.**
 *
 *   كان خطأُ رسمٍ يعرض شاشة Next الرماديّة: نصٌّ إنجليزيٌّ وأثرُ مكدّسٍ في
 *   التطوير، ولا شيءَ في الإنتاج. والمستخدم لا يعرف إن كان العطل عنده أم
 *   عندنا، ولا يملك ما يقوله إن اتّصل.
 *
 *   و`digest` هو الرابط: Next يُولّده للخطأ ويسجّله على الخادم، فذكرُه هنا
 *   يجعل شكوى المستخدم قابلةً للبحث في السجلّ بدل «صار خطأ عندي أمس».
 */
export default function AppError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // يُقرأ في وحدة التحكّم عند التشخيص المباشر — والسجلّ عند الخادم أصلاً
    console.error(error);
  }, [error]);

  return (
    <main className="oops">
      <p className="oops-k" aria-hidden="true">✕</p>
      <h1>صار خطأ عندنا</h1>
      <p className="oops-b">
        مش غلطتك. جرّب تعيد المحاولة — وإذا تكرّر، احكِ للدعم وأعطِه الرمز
        اللي تحت، فيه بنلاقي السطر بالضبط.
      </p>
      {error.digest && (
        <p className="oops-d">
          <span>رمز العطل</span> <code className="mono">{error.digest}</code>
        </p>
      )}
      <div className="oops-a">
        <button type="button" className="btn primary" onClick={reset}>أعِد المحاولة</button>
        <a className="btn quiet" href="/app">ارجع للوحة</a>
      </div>
    </main>
  );
}
