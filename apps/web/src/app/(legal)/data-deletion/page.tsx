import Link from 'next/link';
import type { Metadata } from 'next';
import { Note } from '@/components/ui';

export const metadata: Metadata = {
  title: 'حذف البيانات',
  description: 'كيف تطلب حذف بياناتك من AiBot، وحالة طلبٍ أرسلته من فيسبوك.',
};

/**
 * ★★ صفحةُ حذف البيانات **للمنصّة** — رابطُ «User data deletion» في تطبيق AiBot عند ميتا.
 *
 *   إنستجرام يربط على تطبيق المنصّة، فمن يسحب إذنه أو يطلب حذف بياناته من إعدادات
 *   فيسبوك يصل نداءٌ إلى `/api/meta/data-deletion`، والردُّ يحمل رابطاً إلى هنا برمز
 *   تأكيد (‏`?code=`). والصفحةُ تقول حالته بلغةٍ يفهمها الإنسان — شرطُ ميتا في الردّ.
 *
 *   وأمّا زبائنُ أيّ عميل فصفحتُهم عند العميل نفسِه (‏`/b/<slug>/data-deletion`):
 *   العميلُ هو المتحكّم في بياناتهم، ونحن معالجٌ بأمره.
 */
export const dynamic = 'force-dynamic';

const API = () => process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4100';

async function statusOf(code: string | undefined): Promise<{ found: boolean; at?: string } | null> {
  if (!code || !/^[A-Z0-9]{16}$/.test(code)) return null;
  try {
    const r = await fetch(`${API()}/api/public/meta-deletion/${code}`, { cache: 'no-store' });
    if (r.status === 404) return { found: false };
    return r.ok ? (await r.json() as { found: boolean; at?: string }) : null;
  } catch { return null; }
}

export default async function DataDeletion({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const st = await statusOf(code);
  return (
    <main className="legal">
      <div className="legal-bar">
        <b>AiBot</b>
        <nav aria-label="وثائق ومسارات">
          <Link href="/privacy">سياسة الخصوصيّة</Link>
          <Link href="/terms">بنود الخدمة</Link>
          <Link href="/data-deletion" aria-current="page">حذف البيانات</Link>
        </nav>
      </div>
      <header className="legal-h">
        <h1>حذف البيانات</h1>
        <p className="legal-lead">Data deletion instructions — AiBot</p>
      </header>
      <article className="legal-doc biz-doc">
        {code && (
          st?.found
            ? <Note tone="brand"><b>طلبك نفّذ.</b> رمز التأكيد <span className="num" dir="ltr">{code}</span>: فصل حساب إنستجرام وحذف توكنه في <time className="num" dateTime={st.at}>{st.at?.slice(0, 10)}</time>. Your request was completed.</Note>
            : <Note tone="warn">لا طلب بهذا الرمز. تأكّد من الرمز، أو اكتب إلى <span dir="ltr">privacy@aibot.masaros.net</span>. No request found for this code.</Note>
        )}
        <h2>إن ربطت إنستجرام بـ AiBot</h2>
        <p>
          من فيسبوك: الإعدادات ← الأمان وتسجيل الدخول ← تطبيقات ومواقع الأعمال ← AiBot ← إزالة، واختر
          حذف بياناتك. نفصل حسابك ونحذف توكنه فورا، وتصلك هنا حالة الطلب.
        </p>
        <p dir="ltr" lang="en">
          From Facebook: Settings → Business integrations → AiBot → Remove, and request data deletion.
          We disconnect your account and delete its token immediately; this page shows the status.
        </p>
        <h2>إن كنت زبونا لأحد عملائنا</h2>
        <p>
          بياناتك يملكها النشاط الذي راسلته، ونحن نعالجها بأمره. أرسل «احذف بياناتي» في نفس المحادثة،
          أو راجع صفحة حذف البيانات لديه. If you messaged one of our clients, send «delete my data»
          in the same chat.
        </p>
        <h2>التواصل</h2>
        <p><span dir="ltr">privacy@aibot.masaros.net</span></p>
      </article>
    </main>
  );
}
