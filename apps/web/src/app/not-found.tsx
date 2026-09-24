import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'الصفحة غير موجودة' };

/**
 * ★ **٤٠٤ عربيّةٌ لها طريقُ عودة.**
 *
 *   كان رابطٌ خاطئٌ أو صفٌّ محذوفٌ يعرض صفحة Next الافتراضيّة:
 *   «404 | This page could not be found.» بالإنجليزيّة، بخطٍّ غير خطّ
 *   المنتج، من اليسار إلى اليمين، وبلا رابطٍ واحدٍ يُخرج منها.
 *   وهي أوّلُ ما يراه المستخدم حين يُخطئ — فيقرأ أنّ ما بين يديه غيرُ مكتمل،
 *   ويبقى عالقاً: لا زرَّ رجوعٍ في التطبيق المثبَّت، ولا شريطَ عنوانٍ يكتب فيه.
 */
export default function NotFound() {
  return (
    <main className="oops">
      <p className="oops-k" aria-hidden="true">٤٠٤</p>
      <h1>ما لقينا هالصفحة</h1>
      <p className="oops-b">
        الرابط غلط، أو الشيء اللي كان هنا انحذف. وإذا وصلك الرابط من زميل،
        يمكن يكون مقصوصاً — الروابط الطويلة بتنقصّ لمّا تُنسخ من واتساب.
      </p>
      <div className="oops-a">
        <Link className="btn primary" href="/app">ارجع للوحة</Link>
        <Link className="btn quiet" href="/app/inbox">افتح الإنبوكس</Link>
      </div>
    </main>
  );
}
