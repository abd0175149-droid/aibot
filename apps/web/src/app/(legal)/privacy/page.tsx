import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Note } from '@/components/ui';

export const metadata: Metadata = {
  title: 'سياسة الخصوصيّة — AiBot',
  description: 'ما نعالجه من بيانات زبائن عملائنا، ولمن نرسله، ومتى نحذفه.',
};

/**
 * تُنشر **قبل أوّل عميل**. ليست تزمّتاً: قانون حماية البيانات الشخصيّة
 * الأردنيّ 24/2023 يجعلها التزاماً، ولوحة ميتا تطلب رابطها عند مراجعة التطبيق.
 *
 * ★ وهذه الصفحة تعيش **خارج القشرة** — لا شريط جانبيّ ولا ترويسة تطبيق. فمن
 *   يفتحها من رابطٍ في لوحة ميتا أو من تذييل عرضٍ لا يجد طريقاً إلى المنصّة
 *   ولا إلى الوثيقة الأخرى، فيعود بزرّ المتصفّح أو لا يعود. ولذلك شريطٌ
 *   رقيقٌ فوقها وذيلٌ يحيل إلى البنود.
 *
 * ★ والقرار الذي أُعيدت البنية من أجله: **طول السطر**. كان النصّ على 72ch —
 *   وفي العربيّة يُقرأ ذلك نحو تسعين محرفاً، فتفقد العين بداية السطر التالي
 *   في كلّ قفزة. وهذا أثقل ما يُتعب في وثيقةٍ طويلة، وأوّل سببٍ لألّا تُقرأ.
 *   فصار 60ch، ومعه فهرسٌ لاصقٌ لأنّ أحداً لا يقرأ هذه الوثائق من أوّلها:
 *   يُفتح الرابط بحثاً عن بندٍ واحد.
 *
 * ⚠️ ولا يُحذف بندٌ ولا يُغيَّر معناه. كلّ ما تغيّر هنا شكلٌ وبنيةٌ وترقيمٌ
 *   للبنود — والنصّ القانونيّ منقولٌ كما هو.
 */

/**
 * ★ البنود والفهرس من **مصدرٍ واحد**. لو كُتب العنوان في مكانٍ والفهرس في
 *   آخر لتباعدا عند أوّل تعديلٍ قانونيّ — فيصير رابطٌ في الفهرس يحمل اسماً
 *   لبندٍ آخر، وذاك عطلٌ خبيثٌ في وثيقةٍ تُحتجّ بها.
 */
const SECTIONS = [
  { n: 1, id: 'role', title: 'من نحن وما دورنا' },
  { n: 2, id: 'collected', title: 'ما نعالجه' },
  { n: 3, id: 'never', title: 'ما لا نفعله' },
  { n: 4, id: 'subprocessors', title: 'المعالجات من الباطن' },
  { n: 5, id: 'retention', title: 'الاحتفاظ والحذف' },
  { n: 6, id: 'security', title: 'الأمن' },
  { n: 7, id: 'rights', title: 'حقوقك كزبونٍ لأحد عملائنا' },
  { n: 8, id: 'contact', title: 'التواصل' },
] as const;

type Sect = (typeof SECTIONS)[number];

/** يضمن أنّ كلّ عنوانٍ مرسومٍ له مدخلٌ في الفهرس — والعكس. */
function sec(id: Sect['id']): Sect {
  const s = SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`بندٌ بلا مدخلٍ في الفهرس: ${id}`);
  return s;
}

/** آخر تحديثٍ فعليٍّ للنصّ القانونيّ — ISO ليُقرأ آليّاً أيضاً. */
const UPDATED = '2026-09-21';

function Sec({ of, children }: { of: Sect; children: ReactNode }) {
  return (
    <section className="legal-s" id={of.id} aria-labelledby={`${of.id}-h`}>
      <h2 className="legal-s-h" id={`${of.id}-h`}>
        <span className="legal-s-n num">{of.n}</span>
        {of.title}
      </h2>
      {children}
    </section>
  );
}

export default function Privacy() {
  return (
    <main className="legal">
      <div className="legal-bar">
        <b>AiBot</b>
        <nav aria-label="وثائق ومسارات">
          <Link href="/privacy" aria-current="page">سياسة الخصوصيّة</Link>
          <Link href="/terms">بنود الخدمة</Link>
          <Link href="/app">المنصّة</Link>
        </nav>
      </div>

      <header className="legal-h">
        <p className="legal-k">وثيقةٌ قانونيّة</p>
        <h1>سياسة الخصوصيّة</h1>
        <p className="legal-lead">
          مكتوبةٌ بعربيّةٍ واضحة لا بمصطلحاتٍ تُخفي: ما نعالجه، ولمن نرسله، ومتى نحذفه.
        </p>
        <p className="legal-upd">
          آخر تحديث
          <time className="num" dateTime={UPDATED}>{UPDATED}</time>
        </p>
      </header>

      <div className="legal-body">
        {/* ★ الفهرس أوّلاً في DOM — تنقّلٌ داخل الصفحة يسبق نصّها لمن يقرأ
            بالصوت أو يتنقّل بالمفتاح. والشبكة تنقله بصريّاً إلى اليسار على
            الحاسوب، فلا يتعارض الترتيبان. */}
        <nav className="legal-toc" aria-labelledby="toc-h">
          <h2 id="toc-h">في هذه الصفحة</h2>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>
                  <span className="legal-toc-n num">{s.n}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="legal-doc">
          <Sec of={sec('role')}>
            <p>
              AiBot منصّةٌ تُشغّل بوتات محادثةٍ على واتساب وإنستجرام نيابةً عن أصحاب الأنشطة
              التجاريّة. وفق قانون حماية البيانات الشخصيّة الأردنيّ رقم <span className="num">24</span>{' '}
              لسنة <span className="num">2023</span>، نحن
              <strong> معالِجٌ للبيانات</strong>، وعميلنا — صاحب النشاط — هو <strong>المتحكّم</strong>.
              أي أنّ بيانات زبائنه تخصّه هو، ونحن نعالجها بأمره وحده.
            </p>
          </Sec>

          <Sec of={sec('collected')}>
            <ul>
              <li>رقم هاتف الزبون أو معرّف حسابه على إنستجرام، واسمه الظاهر إن أرسلته المنصّة.</li>
              <li>نصّ الرسائل المتبادلة، وحالة تسليمها.</li>
              <li>الوسوم والملاحظات التي يكتبها صاحب النشاط أو موظّفوه.</li>
              <li>بياناتٌ تشغيليّة: زمن الردّ، عدد التوكنز، أعلام الجودة.</li>
            </ul>
          </Sec>

          <Sec of={sec('never')}>
            <ul>
              <li><strong>لا نبيع البيانات</strong> ولا نشاركها مع معلنين.</li>
              <li><strong>لا ندرّب نماذج</strong> على محادثات عملائنا.</li>
              <li>
                لا نصل إلى حساب عميلٍ إلّا بـ<strong>انتحال قراءةٍ فقط</strong> عند الدعم،
                وهو مسجَّلٌ <strong>ويظهر للعميل في سجلّه</strong>.
              </li>
            </ul>
          </Sec>

          <Sec of={sec('subprocessors')}>
            <p>
              نستعين بمزوّدي نماذج لغويّة (Google) لتوليد الردود، وبواجهات ميتا لإرسال الرسائل
              واستقبالها. يُرسَل إلى مزوّد النموذج نصُّ المحادثة ومعرفة النشاط — ولا تُرسَل
              قائمة جهات الاتّصال ولا بيانات الفوترة.
            </p>
          </Sec>

          <Sec of={sec('retention')}>
            <p>
              مدّة الاحتفاظ بالمحادثات بندٌ في باقة كلّ عميل (<span className="num">60</span> إلى{' '}
              <span className="num">365</span> يوماً)، وتُحذف آليّاً
              بعدها. ويستطيع صاحب النشاط حذف أيّ جهة اتّصال وكلّ بياناتها بزرٍّ واحد.
              وعند انتهاء العلاقة: <strong>تصديرٌ كامل يُرسل إليه، ثمّ حذفٌ بعد{' '}
                <span className="num">60</span> يوماً</strong>.
            </p>
          </Sec>

          <Sec of={sec('security')}>
            <p>
              توكنات القنوات ومفاتيح الذكاء مشفَّرةٌ بمعيار <span className="mono">AES-256-GCM</span>{' '}
              بمفتاحٍ رئيس خارج القاعدة.
              ولا يُعرض أيّ سرٍّ في أيّ واجهة — بصمةٌ وتاريخٌ فقط. وبيانات كلّ عميلٍ معزولةٌ
              بطبقتين مستقلّتين، فخطأٌ برمجيٌّ واحد لا يكفي لتسريبها.
            </p>
          </Sec>

          <Sec of={sec('rights')}>
            <p>
              للاطّلاع على بياناتك أو تصحيحها أو حذفها، راسل النشاط التجاريّ الذي تحادثه مباشرةً —
              فهو المتحكّم بها. وإن لم تصل إلى نتيجة،{' '}
              <a href="mailto:privacy@aibot.masaros.net">راسلنا</a> وسنساعده على تنفيذ طلبك.
            </p>
            {/* أهمّ سطرٍ في الوثيقة لزبونٍ يقرأها: ما يفعله **الآن** ليتوقّف
                الإرسال. فيُرفع من وسط فقرةٍ إلى ملاحظةٍ لا تُفوَّت. */}
            <Note>
              <b>ولإيقاف الرسائل نهائيّاً:</b> أرسل كلمة <strong>«إلغاء»</strong> في المحادثة،
              ويُسجَّل طلبك فوراً ويُحترم في كلّ إرسالٍ لاحق.
            </Note>
          </Sec>

          <Sec of={sec('contact')}>
            <p>
              للاستفسارات المتعلّقة بالخصوصيّة:{' '}
              <a href="mailto:privacy@aibot.masaros.net" dir="ltr">privacy@aibot.masaros.net</a>
            </p>
          </Sec>
        </article>
      </div>

      <footer className="legal-f">
        <Link className="legal-next" href="/terms">
          <span>الوثيقة التالية</span>
          <b>بنود الخدمة ←</b>
        </Link>
      </footer>
    </main>
  );
}
