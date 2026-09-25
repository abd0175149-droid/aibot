'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { post, setToken, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { safeNext } from '@/lib/nav';
import { Alert, Button, Dock, Field, FormInput, Note, Skeleton } from '@/components/ui';

/**
 * شاشة الدخول — الشاشة الأولى في المنتج، وأضعفُ ما كان فيه.
 *
 * ★ ثلاثةُ أعطالٍ كانت مجتمعةً في نموذجٍ من ستّة أسطر، وكلُّها من جنسٍ واحد:
 *   **نموذجٌ لا يعرفه المتصفّح**.
 *
 *   ① بلا `name` ولا `autoComplete`: مديرُ كلمات السرّ لا يرى الحقلَ أصلاً،
 *      فلا يُعرض حسابٌ محفوظ ولا تُملأ كلمةٌ تلقائيّاً — فتُكتب باليد، وما
 *      يُكتب باليد يُختار قصيراً ويُعاد استعمالُه. أي أنّ غيابَ سِمةٍ في HTML
 *      يُنتج كلماتِ سرٍّ أسوأ.
 *   ② `noValidate` مع زرٍّ صالحٍ دائماً: نموذجٌ فارغٌ يُرسَل إلى الخادم فيعود
 *      بخطأٍ عامٍّ («تحقّق من الحقول») لا يقول **أيُّ** حقلٍ ولا يُنقل التركيزُ
 *      إليه. والمتصفّح يفعل هذا كلَّه مجّاناً حين لا يُمنَع.
 *   ③ والفشلُ لا يُنطَق: `Note` بلا دورٍ حيّ، فمن يستعمل قارئَ شاشةٍ يضغط
 *      «دخول» ولا يسمع شيئاً — عنده لم يحدث شيء.
 *
 * ★ وليس فيها رقمٌ بطوليّ، وذاك قرارٌ لا سهو: لا معطى في الشاشة يُقاس، و«رقمٌ
 *   بطوليٌّ لكلّ شاشة» يُختار **بالحالة**؛ فاختراعُ رقمٍ هنا نقضٌ للقاعدة
 *   المقابلة له في نفس النظام — لا رقمَ بلا سياقٍ يبرّره.
 */

/**
 * ★★★ والدخولُ صار خطوتَين لحساب مالك المنصّة — فـ`access` **قد لا يأتي**.
 *
 *   بلا هذا: `setToken(undefined)` ثمّ تحويلٌ إلى `/console` يردّ ٤٠١ — قفلٌ
 *   كاملٌ يصنعه العميلُ لا الخادم.
 */
interface LoginResult {
  access?: string;
  mfaRequired?: boolean;
  challenge?: string;
  user?: { role: string; mustChangePassword: boolean };
}

function LoginForm() {
  const router = useRouter();
  // useSearchParams تُخرج الصفحة من التوليد الساكن — ولذلك تحتها Suspense
  const params = useSearchParams();
  const { reload } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /* كشفُ الكلمة حالةٌ محليّة — ولا تُحفظ ولا تُستأنف: من يكشف كلمته يكشفها
     للحظةٍ يراقب فيها يديه، لا تفضيلاً يُحمل إلى الجلسة التالية. */
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** تحدٍّ بيدنا = الخطوةُ الثانية مفتوحة. و`null` = ما زلنا في الأولى. */
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');

  /* وجهةٌ مطلوبةٌ سلفاً: القشرةُ تحوّل من يطلب شاشةً بلا جلسةٍ إلى هنا
     بـ`?next=`. وقولُ ذلك يمنع قراءةَ الشاشة «خرجتَ» — وقد لا يكون خرج. */
  const next = safeNext(params.get('next'));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    /* ★ حارسٌ ثانٍ خلف تحقّق المتصفّح: `required` يمنع الإرسالَ الفارغ من
       الزرّ ومن مفتاح الإدخال، ولا يمنع إرسالاً برمجيّاً. ونداءٌ فارغٌ يعود
       بخطأٍ عامٍّ يُقرأ «النظام معطوب» لا «أكمِل حقلك». */
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<LoginResult>('/auth/login', { email, password });

      /* ★ ولا `setBusy(false)` قبل تبديل الخطوة: وميضُ زرٍّ يعود صالحاً ثمّ
         تُبدَّل الشاشةُ تحته يُقرأ فشلاً. */
      if (r.mfaRequired && r.challenge) {
        setChallenge(r.challenge);
        setBusy(false);
        return;
      }
      await finish(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر تسجيل الدخول. حاول ثانيةً.');
      setBusy(false);
    }
  }

  /** ما بعد وصول التوكن — من الخطوة الأولى أو الثانية، بلا نسختَين. */
  async function finish(r: LoginResult) {
    if (!r.access || !r.user) throw new ApiError('INTERNAL', 'ردٌّ ناقصٌ من الخادم', 500);
    setToken(r.access);
    await reload();

      /* ★ كلمة السرّ المؤقّتة: الخادم يرسل `mustChangePassword` منذ البداية
         ولم يكن يُقرأ إطلاقاً — فمن أُنشئ له حسابٌ بكلمةٍ مؤقّتة يدخل بها
         ويبقى عليها إلى الأبد. وهي كلمةٌ عرفها من أنشأ الحساب.
         و`first=1` ليست تزييناً للعنوان: هي التي تُحوّل تلك الشاشة إلى
         **بوّابةٍ** تغطّي القشرة، فلا تنقّلَ يُخرج من الخطوة. */
      if (r.user.mustChangePassword) {
        router.replace('/app/password?first=1');
        return;
      }

    // مالك المنصّة يبدأ من لوحته، والعميل من لوحته — لا شاشة اختيار
    router.replace(next ?? (r.user.role === 'platform_owner' ? '/console' : '/app'));
  }

  /** الخطوةُ الثانية: رمزٌ من تطبيق المصادقة. */
  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (busy || !challenge) return;
    setBusy(true);
    setError(null);
    try {
      await finish(await post<LoginResult>('/auth/mfa/verify', { challenge, code }));
    } catch (x) {
      setError(x instanceof ApiError ? x.message : 'تعذّر التحقّق. حاول ثانيةً.');
      setBusy(false);
    }
  }

  return (
    <form className="authcard" onSubmit={challenge ? submitCode : submit}>
      {/* الترويسة: الهويّة وحدها — نفسُ موضعها في القشرة وبنفس نحوها */}
      <header className="auth-top">
        <b className="auth-mark">AiBot</b>
        <span className="auth-org">لوحة إدارة بوتك</span>
      </header>

      <div className="auth-b">
        <div className="auth-h">
          <h1>{challenge ? 'رمزُ المصادقة الثنائيّة' : 'سجّل الدخول'}</h1>
          <p>
            {challenge
              ? 'افتح تطبيق المصادقة واكتب الرمز الظاهر الآن — يتبدّل كلّ نصف دقيقة.'
              : 'بوتك ومحادثات زبائنك — من مكانٍ واحد.'}
          </p>
        </div>

        {/* ★ يُنطَق: نفسُ نبرة `Note` ودورُها حيٌّ، فيُسمع الفشلُ لا يُرى فقط */}
        {error && <Alert tone="crit">{error}</Alert>}

        {/* وجهةٌ محفوظةٌ: عاقبةٌ لا حالة — «تعود إلى حيث كنت» لا «انتهت جلستك»،
            فقد يكون أوّلَ دخولٍ له من رابطٍ مباشرٍ ولم تنتهِ له جلسة. */}
        {!error && next && (
          <Note tone="brand">بعد الدخول تعود إلى الصفحة التي طلبتها.</Note>
        )}

        {challenge && (
          <Field id="lg-code" label="الرمز">
            <FormInput
              id="lg-code"
              name="one-time-code"
              value={code}
              onChange={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
              /* `one-time-code` عقدُ المتصفّح: به يعرض الهاتفُ الرمزَ من إشعاره
                 بضغطةٍ واحدة. ورمزٌ يُنقل بالعين من شاشةٍ إلى شاشةٍ هو الخطوةُ
                 التي يتركها الناس. */
              autoComplete="one-time-code"
              inputMode="numeric"
              enterKeyHint="go"
              dir="ltr"
              autoFocus
              required
              invalid={Boolean(error)}
            />
          </Field>
        )}

        {!challenge && (
        <>
        <Field id="lg-email" label="البريد الإلكترونيّ">
          <FormInput
            id="lg-email"
            name="email"
            type="email"
            value={email}
            onChange={setEmail}
            /* `username` لا `email`: هي القيمةُ التي يربط بها مديرُ كلمات
               السرّ الحسابَ بموقعه — و`email` وحدها تُقرأ حقلَ نموذجِ اتّصال. */
            autoComplete="username"
            inputMode="email"
            enterKeyHint="next"
            /* الشاشة لا غرضَ لها إلّا هذا النموذج، فنقلُ التركيز إليه لا
               يسرق موضعَ قارئٍ من محتوًى آخر — لا محتوى آخر. */
            autoFocus
            dir="ltr"
            required
            invalid={Boolean(error)}
          />
        </Field>

        <Field id="lg-pass" label="كلمة السرّ">
          <div className="auth-secret">
            <FormInput
              id="lg-pass"
              name="password"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              enterKeyHint="go"
              required
              invalid={Boolean(error)}
            />
            {/* ★ زرٌّ خامٌ لا `Button`: الحالةُ هي المعلومة هنا، و`aria-pressed`
                هو ما يجعلها تُنطَق. و`Button` لا يقبلها — ولا يُوسَّع توقيعٌ
                مشتركٌ من أجل شاشةٍ واحدة. والأصنافُ نفسُها فلا مفردةَ ثانية. */}
            <button
              type="button"
              className="btn quiet sm"
              aria-pressed={show}
              aria-controls="lg-pass"
              onClick={() => setShow((v) => !v)}
            >
              {show ? 'أخفِ' : 'أظهِر'}
            </button>
          </div>
        </Field>

        </>
        )}

        {/* طيٌّ تدريجيّ: لا قرارَ يُتّخذ على هذا في هذه اللحظة */}
        {!challenge && (
        <details className="auth-fold">
          <summary>نسيت كلمة السرّ؟</summary>
          <p>
            راسل من أنشأ حسابك — هو وحده من يستطيع ضبط كلمةٍ مؤقّتةٍ لك الآن،
            وستُطلب منك كلمتك الخاصّة عند أوّل دخول. والاستعادة الذاتيّة قادمة.
          </p>
        </details>
        )}

        {challenge && (
          <details className="auth-fold">
            <summary>فقدتُ هاتفي</summary>
            <p>
              لا بابَ ذاتيّاً للعامل الثاني عن قصد — أيُّ بابٍ ذاتيٍّ هو بعينه ما يُبطله.
              راسل مشغّل المنصّة ليمسحه عن حسابك، ثمّ سجّل عاملاً جديداً عند أوّل دخول.
            </p>
          </details>
        )}
      </div>

      {/* الرصيف: الفعلُ الأوّل وحده، وسطرٌ يقول عاقبتَه قبل الضغط لا بعده */}
      <Dock hint={challenge
        ? 'لم تُفتح جلسةٌ بعد — كلمةُ السرّ وحدها لا تفتح لوحة المالك.'
        : 'تبقى جلستك مفتوحةً على هذا المتصفّح حتّى تخرج بنفسك.'}>
        <Button type="submit" variant="primary" size="lg" wide busy={busy}>
          {challenge ? 'تحقّق' : 'دخول'}
        </Button>
      </Dock>
    </form>
  );
}

export default function LoginPage() {
  return (
    /* الإطارُ خارج `Suspense` عن قصد: لو كان داخله لَقفزت الترويسةُ والرصيفُ
       لحظةَ استبدال الهيكل بالنموذج — والهيكلُ يحمل نفسَ مناطق اللوح. */
    <main className="auth auth-vp">
      <Suspense
        fallback={(
          <div className="authcard">
            <header className="auth-top">
              <b className="auth-mark">AiBot</b>
            </header>
            <div className="auth-b"><Skeleton rows={4} /></div>
          </div>
        )}
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
