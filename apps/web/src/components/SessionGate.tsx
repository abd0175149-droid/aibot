'use client';

import { useState, type FormEvent } from 'react';
import { resumeSession, setToken, ApiError } from '@/lib/api';
import { loginHref } from '@/lib/nav';
import { Button, Field, FormInput, Note, Stack, Iso } from '@/components/ui';

/**
 * ★★★ **انتهاءُ الجلسة كان يمحو ما كُتب ولم يُحفَظ.**
 *
 *   `api.ts` كان يكتب `location.href` بنفسه عند فشل التجديد — تحميلٌ كاملٌ
 *   للصفحة يمحو شجرةَ React كلَّها: نصُّ الشخصيّة في شاشة البوت، وحقولُ
 *   الدعوة في الفريق، و**الكلمةُ المؤقّتة المعروضة مرّةً واحدة** — والخادم لا
 *   يخزّنها نصّاً فلا سبيل إليها بعدها.
 *
 *   والأسوأ أنّه يقع من **استقصاءٍ في الخلفيّة**: إنبوكسٌ مفتوحٌ يسأل كلّ
 *   دقيقة، فتُمحى شاشةُ من لم يلمس شيئاً منذ ساعة.
 *
 *   فصارت بوّابةٌ تُرسم **فوق** ما هو مرسوم: الكلمةُ تُكتب، والجلسةُ تُستأنف
 *   في مكانها، وما تحتها كما تُرك.
 *
 * ⚠️ وليست حاجزاً أمنيّاً: ما خلفها بياناتٌ مرسومةٌ فعلاً في الصفحة، ومن
 *    يملك الجهاز يقرؤها من أدوات المتصفّح. ولذلك **مخرجٌ نهائيّ** بعد ثلاث
 *    محاولاتٍ أو على حسابٍ معطَّل: الجهازُ المشترك في متجرٍ لا يُترك عليه
 *    محادثاتُ زبائن موظّفٍ عُطِّل حسابُه خلف نموذجٍ لا ينجح أبداً.
 */

const MAX_TRIES = 3;

export function SessionGate({ email, onDone }: { email: string; onDone: () => void }) {
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);

  /** خروجٌ صلب: توكنٌ محذوفٌ وتحميلٌ كامل — فلا يبقى على الشاشة ما لا يُستأنف. */
  function hardExit() {
    setToken(null);
    location.replace(loginHref());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await resumeSession(email, pass);
      setPass('');
      onDone();
    } catch (x) {
      const n = tries + 1;
      setTries(n);
      if (n >= MAX_TRIES) { hardExit(); return; }
      setErr(x instanceof ApiError ? x.message : 'تعذّر استئناف الجلسة.');
      setBusy(false);
    }
  }

  return (
    <div className="auth auth-gate" role="dialog" aria-modal="true" aria-labelledby="sg-h">
      <form className="authcard" onSubmit={(e) => void submit(e)}>
        <header className="auth-top">
          <b className="auth-mark">AiBot</b>
          {/* ⚠️ البريدُ نصٌّ آليٌّ فيمرّ بالعازل: لا يُدسّ في جملةٍ عربيّة. */}
          <span className="auth-org"><Iso text={email} /></span>
        </header>

        <div className="auth-b">
          <div className="auth-h">
            <h1 id="sg-h">انتهت جلستك</h1>
            <p>اكتب كلمة سرّك لتُكمل من حيث توقّفت — ما كتبتَه على الشاشة باقٍ خلف هذا اللوح.</p>
          </div>

          {err && <Note tone="crit">{err}</Note>}

          <Field id="sg-pass" label="كلمة سرّك">
            <FormInput
              id="sg-pass"
              name="password"
              type="password"
              value={pass}
              onChange={setPass}
              dir="ltr"
              /* `current-password` عقدُ المتصفّح لا تلميحٌ له: بلاه لا يملأ
                 مديرُ كلمات السرّ الحقل، فيُكتب بالإصبع عند كلّ انتهاء. */
              autoComplete="current-password"
              enterKeyHint="go"
              /* لا محتوًى آخر خلف البوّابة يُنازعها التركيز. */
              autoFocus
              required
              invalid={Boolean(err)}
            />
          </Field>

          <Stack gap="sm">
            <Button type="submit" variant="primary" size="lg" wide busy={busy} disabled={!pass}
              reason="اكتب كلمة سرّك">
              أكمِل
            </Button>
            {/* ومخرجٌ صريحٌ دائماً: من لا يريد الاستئناف لا يُحبس أمام نموذج. */}
            <Button size="lg" wide onClick={hardExit}>اخرج وسجّل الدخول من جديد</Button>
          </Stack>
        </div>
      </form>
    </div>
  );
}
