'use client';

import { useState, type FormEvent } from 'react';
import { post, ApiError } from '@/lib/api';
import {
  Button, Field, FormInput, Note, Stack, CodeBlock, Dock,
} from '@/components/ui';

/**
 * ★★★ **حسابُ مالك المنصّة كان بعاملٍ واحد.**
 *
 *   كلمةُ سرٍّ واحدةٌ تفتح: قائمةَ كلّ العملاء، وتوكنَ انتحالٍ داخل أيٍّ منهم،
 *   ومقبضاً يسمع غرفةَ **كلّ** مستأجر — أي نصَّ كلّ رسالةِ زبونٍ في المنصّة،
 *   حيّاً. وليس في المستودع كلُّه أثرٌ لعاملٍ ثانٍ: لا TOTP ولا مفتاحٌ ولا
 *   خطوةٌ ثانيةٌ من أيّ نوع.
 *
 * ⚠️ والشاشةُ تُعرض **بدل** اللوحة لا فوقها: مالكٌ لم يُسجّل بعدُ تُردّ عليه
 *    كلُّ نداءات اللوحة بـ٤٠٣، فذيلُ القشرة يقول «تعذّر جلب الحوادث» — يخبره
 *    أنّ جلبَ الحوادث معطوبٌ في اللحظة التي الحقيقةُ فيها أنّ حسابَه هو غيرُ
 *    محميّ. فالشاشةُ تسبق أيَّ جلب.
 */
export function MfaEnroll() {
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ totpSecret: string; otpauth: string }>('/auth/mfa/enroll');
      setSecret(r.totpSecret);
      setOtpauth(r.otpauth);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر بدء التسجيل.');
    } finally { setBusy(false); }
  }

  async function activate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await post('/auth/mfa/activate', { code });
      setDone(true);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'تعذّر التفعيل.');
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <main className="auth auth-vp">
        <div className="authcard">
          <header className="auth-top"><b className="auth-mark">AiBot</b></header>
          <div className="auth-b">
            <div className="auth-h">
              <h1>فُعِّل العامل الثاني</h1>
              <p>سجّل الدخول من جديد ليحمل توكنُك الخطوةَ الثانية — عندها تُفتح اللوحة.</p>
            </div>
            <Note tone="brand">
              وأُبطلت كلُّ جلساتك الأخرى: تفعيلُ قفلٍ مع إبقاء بابٍ قديمٍ مفتوحاً ليس تفعيلاً.
            </Note>
          </div>
          <Dock hint="ولا بابَ ذاتيّاً لمسحه — أيُّ بابٍ ذاتيٍّ هو بعينه ما يُبطله.">
            <a className="btn primary lg wide sc-link" href="/login">اذهب إلى الدخول</a>
          </Dock>
        </div>
      </main>
    );
  }

  return (
    <main className="auth auth-vp">
      <form className="authcard" onSubmit={(e) => void activate(e)}>
        <header className="auth-top">
          <b className="auth-mark">AiBot</b>
          <span className="auth-org">لوحة المنصّة</span>
        </header>

        <div className="auth-b">
          <div className="auth-h">
            <h1>فعّل المصادقة الثنائيّة</h1>
            <p>
              حسابك يفتح بيانات كلّ عملائك — فلا يُفتح بكلمة سرٍّ وحدها. واللوحة مغلقةٌ
              حتّى تُفعّلها.
            </p>
          </div>

          {err && <Note tone="crit">{err}</Note>}

          {!secret ? (
            <Note>
              <b>ما ستحتاجه:</b> تطبيقُ مصادقةٍ على هاتفك (Google Authenticator أو
              Microsoft Authenticator أو ما يشبههما). اضغط «ابدأ» ثمّ الصق السرَّ فيه.
            </Note>
          ) : (
            <Stack gap="sm">
              <Note tone="warn">
                <b>يُعرض مرّةً واحدة.</b> الصقه في تطبيق المصادقة الآن — لا يُعاد إلى أيّ
                شاشةٍ بعدها، ولا نخزّنه نصّاً عندنا.
              </Note>
              <CodeBlock label="السرّ" text={secret} />
              {otpauth && <CodeBlock label="رابط otpauth (إن دعمه تطبيقك)" text={otpauth} />}

              <Field id="mfa-code" label="الرمز الظاهر في التطبيق الآن">
                <FormInput
                  id="mfa-code"
                  name="one-time-code"
                  value={code}
                  onChange={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  enterKeyHint="go"
                  dir="ltr"
                  autoFocus
                  required
                />
              </Field>
              {/* ★ ولا تفعيلَ بلا رمزٍ صحيح: حفظُ سرٍّ لم يصل الهاتفَ يُقفل
                  الحسابَ بسرٍّ لا يملكه أحد — ولا بابَ ذاتيٍّ للخروج. */}
              <Note>
                الرمز يُثبت أنّ السرَّ وصل هاتفك فعلاً. وبلا هذه الخطوة قد يُحفظ سرٌّ لا
                يملكه أحد، فتُقفل اللوحة إلى الأبد.
              </Note>
            </Stack>
          )}
        </div>

        <Dock hint="ستّةُ أرقامٍ تتبدّل كلّ نصف دقيقة — وتُقبل نافذةٌ قبلَها وأخرى بعدها، فانحرافُ ساعة الهاتف لا يمنعك.">
          {secret
            ? (
              <Button type="submit" variant="primary" size="lg" wide busy={busy} disabled={code.length !== 6}
                reason="اكتب الرمز الظاهر في التطبيق">
                فعّل
              </Button>
            )
            : (
              <Button variant="primary" size="lg" wide busy={busy} onClick={() => void start()}>
                ابدأ
              </Button>
            )}
        </Dock>
      </form>
    </main>
  );
}
