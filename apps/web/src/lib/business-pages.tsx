import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import type { PublicBusinessDTO } from '@aibot/shared';

/**
 * ★★ صفحاتُ العميل العامّة — `/b/<slug>` وأخواتُها الثلاث.
 *
 *   تطبيقُ ميتا لواتساب ملكُ العميل، وتفعيلُه يطلب روابطَ خصوصيّةٍ وشروطٍ
 *   وتعليماتِ حذف بيانات **باسمه**. فالنصوصُ هنا قوالبُ تُملأ من ملفّ نشاطه:
 *   هو المتحكّمُ في البيانات، وAiBot معالجٌ نيابةً عنه — كما في صفحة المنصّة.
 *
 * ⚠️ بالعربيّة والإنجليزيّة (‏`?lang=en`): مراجعُ ميتا يقرأ الإنجليزيّة غالباً.
 * ⚠️ والقوالبُ ليست استشارةً قانونيّة — مراجعتُها مرّةً عند محامٍ مستحسنة.
 */

export type Lang = 'ar' | 'en';
export const UPDATED = '2026-09-27';

const API = () => process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4100';

export async function loadBusiness(slug: string): Promise<PublicBusinessDTO> {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(slug)) notFound();
  let res: Response;
  try {
    res = await fetch(`${API()}/api/public/b/${slug}`, { next: { revalidate: 60 } });
  } catch {
    throw new Error('تعذّر الوصول إلى الخادم');
  }
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`تعذّرت قراءة ملفّ النشاط (${res.status})`);
  return res.json() as Promise<PublicBusinessDTO>;
}

export function langOf(sp: { lang?: string } | undefined): Lang {
  return sp?.lang === 'en' ? 'en' : 'ar';
}

export const brand = (b: PublicBusinessDTO, l: Lang) =>
  l === 'en' ? (b.profile.tradeEn || b.profile.tradeAr) : (b.profile.tradeAr || b.profile.tradeEn);
const legal = (b: PublicBusinessDTO, l: Lang) =>
  l === 'en' ? (b.profile.legalEn || b.profile.legalAr) : b.profile.legalAr;
const addr = (b: PublicBusinessDTO, l: Lang) =>
  l === 'en' ? b.profile.addressEn : `${b.profile.address}، ${b.profile.city}، ${b.profile.country}`;
const countryEn = (c: string) => ({
  'الأردن': 'Jordan', 'السعودية': 'Saudi Arabia', 'الإمارات': 'the United Arab Emirates', 'فلسطين': 'Palestine',
  'مصر': 'Egypt', 'العراق': 'Iraq', 'الكويت': 'Kuwait', 'قطر': 'Qatar', 'البحرين': 'Bahrain', 'عُمان': 'Oman',
  'لبنان': 'Lebanon', 'سوريا': 'Syria',
} as Record<string, string>)[c] ?? c;

type PageKey = 'profile' | 'privacy' | 'terms' | 'deletion';
const PATH: Record<PageKey, string> = { profile: '', privacy: '/privacy', terms: '/terms', deletion: '/data-deletion' };
const TITLE: Record<Lang, Record<PageKey, string>> = {
  ar: { profile: 'التعريف', privacy: 'سياسة الخصوصيّة', terms: 'الشروط والأحكام', deletion: 'حذف البيانات' },
  en: { profile: 'About', privacy: 'Privacy policy', terms: 'Terms of service', deletion: 'Data deletion' },
};

export function pageTitle(b: PublicBusinessDTO, l: Lang, k: PageKey) {
  return k === 'profile' ? brand(b, l) : `${TITLE[l][k]} — ${brand(b, l)}`;
}

const Ltr = ({ children }: { children: ReactNode }) => <span dir="ltr" className="num">{children}</span>;

/** الإطار: شريطٌ بالاسم والصفحات الأربع ومبدّل اللغة، ثمّ الوثيقة، ثمّ ذيلٌ يسمّي المعالج. */
export function BusinessDoc({ b, l, page, children }: { b: PublicBusinessDTO; l: Lang; page: PageKey; children: ReactNode }) {
  const base = `/b/${b.slug}`;
  const q = l === 'en' ? '?lang=en' : '';
  return (
    <main className="legal biz" dir={l === 'en' ? 'ltr' : 'rtl'} lang={l}>
      <div className="legal-bar">
        <span className="biz-brand">
          {b.profile.logo
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <img src={b.profile.logo} alt="" width={32} height={32} />
            : <span className="biz-mark" aria-hidden="true">{brand(b, l).replace(/^ال/, '').charAt(0)}</span>}
          <b>{brand(b, l)}</b>
        </span>
        <nav aria-label={l === 'en' ? 'Pages' : 'الصفحات'}>
          {(Object.keys(PATH) as PageKey[]).map((k) => (
            <Link key={k} href={`${base}${PATH[k]}${q}`} aria-current={k === page ? 'page' : undefined}>{TITLE[l][k]}</Link>
          ))}
          <Link href={`${base}${PATH[page]}${l === 'en' ? '' : '?lang=en'}`} hrefLang={l === 'en' ? 'ar' : 'en'}>
            {l === 'en' ? 'العربيّة' : 'English'}
          </Link>
        </nav>
      </div>
      <header className="legal-h">
        <h1>{page === 'profile' ? brand(b, l) : TITLE[l][page]}</h1>
        <p className="legal-upd">
          {l === 'en' ? 'Last updated' : 'آخر تحديث'} <time className="num" dateTime={UPDATED}>{UPDATED}</time>
        </p>
      </header>
      <article className="legal-doc biz-doc">{children}</article>
      <footer className="legal-f biz-f">
        <p>
          {legal(b, l)} · <Ltr>{b.profile.email}</Ltr> · <Ltr>{b.profile.phone}</Ltr>
        </p>
        <p>
          {l === 'en'
            ? <>Customer messaging for {brand(b, l)} is operated by AiBot, acting as a data processor on its behalf.</>
            : <>خدمة المحادثة لدى {brand(b, l)} يشغّلها AiBot بصفته معالجا للبيانات نيابة عنه.</>}
        </p>
      </footer>
    </main>
  );
}

/* ───────────────────────── النصوص ───────────────────────── */

export function ProfileBody({ b, l }: { b: PublicBusinessDTO; l: Lang }) {
  const p = b.profile;
  const base = `/b/${b.slug}`;
  const q = l === 'en' ? '?lang=en' : '';
  return l === 'en' ? (
    <>
      {p.description && <p>{p.description}</p>}
      <h2>Contact</h2>
      <ul>
        <li>Phone{b.channels.whatsapp ? ' and WhatsApp' : ''}: <Ltr>{p.phone}</Ltr></li>
        <li>Email: <Ltr>{p.email}</Ltr></li>
        <li>Address: {p.addressEn}</li>
        {p.site && <li>Website: <a href={p.site} rel="noopener noreferrer">{p.site}</a></li>}
      </ul>
      <h2>Legal</h2>
      <p>{legal(b, l)}{p.cr && <> · Commercial registration <Ltr>{p.cr}</Ltr></>}</p>
      <p>
        <Link href={`${base}/privacy${q}`}>Privacy policy</Link> · <Link href={`${base}/terms${q}`}>Terms of service</Link> ·{' '}
        <Link href={`${base}/data-deletion${q}`}>Data deletion</Link>
      </p>
    </>
  ) : (
    <>
      {p.description && <p>{p.description}</p>}
      <h2>التواصل</h2>
      <ul>
        <li>الهاتف{b.channels.whatsapp ? ' وواتساب' : ''}: <Ltr>{p.phone}</Ltr></li>
        <li>البريد: <Ltr>{p.email}</Ltr></li>
        <li>العنوان: {addr(b, l)}</li>
        {p.site && <li>الموقع: <a href={p.site} rel="noopener noreferrer" dir="ltr">{p.site}</a></li>}
      </ul>
      <h2>البيانات القانونيّة</h2>
      <p>{p.legalAr}{p.cr && <> · سجلّ تجاريّ رقم <Ltr>{p.cr}</Ltr></>}</p>
      <p>
        <Link href={`${base}/privacy`}>سياسة الخصوصيّة</Link> · <Link href={`${base}/terms`}>الشروط والأحكام</Link> ·{' '}
        <Link href={`${base}/data-deletion`}>حذف البيانات</Link>
      </p>
    </>
  );
}

function channelsText(b: PublicBusinessDTO, l: Lang) {
  const c = [b.channels.whatsapp && (l === 'en' ? 'WhatsApp' : 'واتساب'), b.channels.instagram && (l === 'en' ? 'Instagram' : 'إنستجرام')]
    .filter(Boolean) as string[];
  if (!c.length) return l === 'en' ? 'WhatsApp or Instagram' : 'واتساب أو إنستجرام';
  return c.join(l === 'en' ? ' and ' : ' و');
}

export function PrivacyBody({ b, l }: { b: PublicBusinessDTO; l: Lang }) {
  const ch = channelsText(b, l);
  const isJo = b.profile.country === 'الأردن';
  return l === 'en' ? (
    <>
      <h2>Who we are</h2>
      <p>{legal(b, l)}, {addr(b, l)}. We are the controller of your personal data when you message us on {ch}.</p>
      <h2>What we collect</h2>
      <ul>
        <li>Your {b.channels.instagram && !b.channels.whatsapp ? 'Instagram-scoped ID' : 'phone number'} and profile name.</li>
        <li>The messages you send us, the media you share, and when they were sent.</li>
        <li>Our replies, including those written by an automated assistant.</li>
      </ul>
      <h2>Why we use it</h2>
      <p>To answer your questions and serve your requests. We do not sell your data or use it for advertising.</p>
      <h2>Who processes it for us</h2>
      <ul>
        <li>AiBot operates our messaging assistant as a processor, only on our instructions.</li>
        <li>An AI model provider generates suggested replies from the conversation.</li>
        <li>Meta Platforms delivers the messages under the WhatsApp Business and Instagram terms.</li>
      </ul>
      <h2>How long we keep it</h2>
      <p>We keep conversations for <Ltr>{b.retentionDays}</Ltr> days after the last message, then delete them.</p>
      <h2>Your rights</h2>
      <p>
        You can ask to access, correct or delete your data, or object to its processing
        {isJo ? <>, under Jordan&apos;s Personal Data Protection Law No. 24 of 2023</> : null}.
        Reply «إلغاء» or «stop» at any time and we will stop messaging you.
        To delete your data, see <Link href={`/b/${b.slug}/data-deletion?lang=en`}>Data deletion</Link>.
      </p>
      <h2>Contact</h2>
      <p><Ltr>{b.profile.email}</Ltr> · <Ltr>{b.profile.phone}</Ltr></p>
    </>
  ) : (
    <>
      <h2>من نحن</h2>
      <p>{legal(b, l)}، {addr(b, l)}. نحن المسؤولون عن بياناتك الشخصيّة حين تراسلنا على {ch}.</p>
      <h2>ما نجمعه</h2>
      <ul>
        <li>{b.channels.instagram && !b.channels.whatsapp ? 'معرّف حسابك على إنستجرام' : 'رقم هاتفك'} واسم ملفّك.</li>
        <li>الرسائل التي ترسلها والوسائط التي تشاركها، ووقت إرسالها.</li>
        <li>ردودنا عليك، ومنها ما يكتبه مساعد آليّ.</li>
      </ul>
      <h2>لماذا نستعمله</h2>
      <p>للردّ على أسئلتك وخدمة طلباتك. لا نبيع بياناتك ولا نستعملها للإعلان.</p>
      <h2>من يعالجها لصالحنا</h2>
      <ul>
        <li>AiBot يشغّل مساعدنا للمحادثة بصفته معالجا، وبأمرنا وحده.</li>
        <li>مزوّد نموذج ذكاء اصطناعيّ يولّد الردود المقترحة من المحادثة.</li>
        <li>ميتا توصل الرسائل وفق شروط واتساب للأعمال وإنستجرام.</li>
      </ul>
      <h2>مدّة الاحتفاظ</h2>
      <p>نحتفظ بالمحادثات <Ltr>{b.retentionDays}</Ltr> يوما بعد آخر رسالة، ثمّ نحذفها.</p>
      <h2>حقوقك</h2>
      <p>
        لك أن تطلب الاطّلاع على بياناتك أو تصحيحها أو حذفها، أو أن تعترض على معالجتها
        {isJo ? <>، وفق قانون حماية البيانات الشخصيّة الأردنيّ رقم <Ltr>24</Ltr> لسنة <Ltr>2023</Ltr></> : null}.
        وأرسل «إلغاء» في أيّ وقت فتتوقّف رسائلنا إليك. ولحذف بياناتك راجع{' '}
        <Link href={`/b/${b.slug}/data-deletion`}>صفحة حذف البيانات</Link>.
      </p>
      <h2>التواصل</h2>
      <p><Ltr>{b.profile.email}</Ltr> · <Ltr>{b.profile.phone}</Ltr></p>
    </>
  );
}

export function TermsBody({ b, l }: { b: PublicBusinessDTO; l: Lang }) {
  const ch = channelsText(b, l);
  return l === 'en' ? (
    <>
      <h2>The service</h2>
      <p>{brand(b, l)} answers customer questions on {ch} with an automated assistant. A member of our staff can take over any conversation.</p>
      <h2>Automated answers</h2>
      <p>Answers are generated automatically and may contain mistakes. Prices, dates and bookings are confirmed only by our staff.</p>
      <h2>Acceptable use</h2>
      <p>Do not send unlawful, abusive or harmful content. We may stop replying to accounts that do.</p>
      <h2>Messages from us</h2>
      <p>We message you only about requests you started, or after your consent. Reply «إلغاء» or «stop» to stop.</p>
      <h2>Your data</h2>
      <p>How we handle your data is described in our <Link href={`/b/${b.slug}/privacy?lang=en`}>Privacy policy</Link>.</p>
      <h2>Governing law</h2>
      <p>These terms are governed by the laws of {countryEn(b.profile.country)}.</p>
      <h2>Contact</h2>
      <p><Ltr>{b.profile.email}</Ltr></p>
    </>
  ) : (
    <>
      <h2>الخدمة</h2>
      <p>{brand(b, l)} يجيب عن أسئلة الزبائن على {ch} بمساعد آليّ، ويستطيع موظّف منّا تولّي أيّ محادثة.</p>
      <h2>الردود الآليّة</h2>
      <p>الردود تولّد آليّا وقد تخطئ. الأسعار والمواعيد والحجوزات لا تثبت إلّا بتأكيد موظّفينا.</p>
      <h2>الاستعمال المقبول</h2>
      <p>لا ترسل محتوى مخالفا للقانون أو مسيئا أو ضارّا. قد نتوقّف عن الردّ على من يفعل ذلك.</p>
      <h2>رسائلنا إليك</h2>
      <p>نراسلك فقط بشأن طلب بدأته أنت، أو بعد موافقتك. أرسل «إلغاء» لإيقاف رسائلنا.</p>
      <h2>بياناتك</h2>
      <p>كيف نعالج بياناتك مكتوب في <Link href={`/b/${b.slug}/privacy`}>سياسة الخصوصيّة</Link>.</p>
      <h2>القانون الحاكم</h2>
      <p>تخضع هذه الشروط لقوانين {b.profile.country}.</p>
      <h2>التواصل</h2>
      <p><Ltr>{b.profile.email}</Ltr></p>
    </>
  );
}

export function DeletionBody({ b, l }: { b: PublicBusinessDTO; l: Lang }) {
  const ch = channelsText(b, l);
  return l === 'en' ? (
    <>
      <p>You can ask {brand(b, l)} to delete your data at any time.</p>
      <h2>Option 1: message us</h2>
      <p>
        Send «احذف بياناتي» or «delete my data» to us on {ch}
        {b.channels.whatsapp && <> (WhatsApp <Ltr>{b.profile.phone}</Ltr>)</>}.
        The request is recorded immediately and we stop messaging you.
      </p>
      <h2>Option 2: email</h2>
      <p>Email <Ltr>{b.profile.email}</Ltr> and include the number or account to delete.</p>
      <h2>What is deleted</h2>
      <p>
        Your conversations, your number or account ID, and your profile name — within 30 days.
        We keep only what the law requires us to keep, and we tell you what it is.
      </p>
    </>
  ) : (
    <>
      <p>يمكنك أن تطلب من {brand(b, l)} حذف بياناتك في أيّ وقت.</p>
      <h2>الطريقة الأولى: راسلنا</h2>
      <p>
        أرسل «احذف بياناتي» إلينا على {ch}
        {b.channels.whatsapp && <> (واتساب <Ltr>{b.profile.phone}</Ltr>)</>}.
        يسجّل الطلب فورا وتتوقّف رسائلنا إليك.
      </p>
      <h2>الطريقة الثانية: البريد</h2>
      <p>راسل <Ltr>{b.profile.email}</Ltr> واذكر الرقم أو الحساب المطلوب حذفه.</p>
      <h2>ما يحذف</h2>
      <p>
        محادثاتك ورقمك أو معرّف حسابك واسم ملفّك، خلال <Ltr>30</Ltr> يوما.
        ولا نبقي إلّا ما يلزمنا القانون بحفظه، ونخبرك به.
      </p>
    </>
  );
}
