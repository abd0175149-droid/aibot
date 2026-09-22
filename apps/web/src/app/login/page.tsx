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

interface LoginResult {
  access: string;
  user: { role: string; mustChangePassword: boolean };
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
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر تسجيل الدخول. حاول ثانيةً.');
      setBusy(false);
    }
  }

  return (
    <form className="authcard" onSubmit={submit}>
      {/* الترويسة: الهويّة وحدها — نفسُ موضعها في القشرة وبنفس نحوها */}
      <header className="auth-top">
        <b className="auth-mark">AiBot</b>
        <span className="auth-org">لوحة إدارة بوتك</span>
      </header>

      <div className="auth-b">
        <div className="auth-h">
          <h1>سجّل الدخول</h1>
          <p>بوتك ومحادثات زبائنك — من مكانٍ واحد.</p>
        </div>

        {/* ★ يُنطَق: نفسُ نبرة `Note` ودورُها حيٌّ، فيُسمع الفشلُ لا يُرى فقط */}
        {error && <Alert tone="crit">{error}</Alert>}

        {/* وجهةٌ محفوظةٌ: عاقبةٌ لا حالة — «تعود إلى حيث كنت» لا «انتهت جلستك»،
            فقد يكون أوّلَ دخولٍ له من رابطٍ مباشرٍ ولم تنتهِ له جلسة. */}
        {!error && next && (
          <Note tone="brand">بعد الدخول تعود إلى الصفحة التي طلبتها.</Note>
        )}

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

        {/* طيٌّ تدريجيّ: لا قرارَ يُتّخذ على هذا في هذه اللحظة */}
        <details className="auth-fold">
          <summary>نسيت كلمة السرّ؟</summary>
          <p>
            راسل من أنشأ حسابك — هو وحده من يستطيع ضبط كلمةٍ مؤقّتةٍ لك الآن،
            وستُطلب منك كلمتك الخاصّة عند أوّل دخول. والاستعادة الذاتيّة قادمة.
          </p>
        </details>
      </div>

      {/* الرصيف: الفعلُ الأوّل وحده، وسطرٌ يقول عاقبتَه قبل الضغط لا بعده */}
      <Dock hint="تبقى جلستك مفتوحةً على هذا المتصفّح حتّى تخرج بنفسك.">
        <Button type="submit" variant="primary" size="lg" wide busy={busy}>
          دخول
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
