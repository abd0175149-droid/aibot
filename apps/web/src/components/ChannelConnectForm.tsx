'use client';

import { useState } from 'react';
import { Field, Input, Note, Stack, Button } from '@/components/ui';
import { ApiError, post } from '@/lib/api';

/**
 * ★ نموذج ربط القناة — **مكوّنٌ واحدٌ لثلاثة مواضع**.
 *
 *   العطل الذي وُلد منه استخراجه: مسار `POST /channel/connect` مكتوبٌ لمالك
 *   المستأجر ويقبل التجديد (يحدّث الصفّ القائم) — **ولا شاشةَ واحدة تناديه**.
 *   المستدعي الوحيد في الواجهة كلّها كان معالجَ العميل الجديد، وهو ينادي
 *   نسخة لوحة المالك. فانتهاءُ توكنٍ عند عميلٍ قائم لم يكن له مخرجٌ إلّا
 *   سكربتاً على الخادم — بينما صفحةُ القنوات تقول «استبدالُ المفتاح يجري من
 *   لوحة المالك» ولوحةُ المالك لا زرَّ فيها، ونصُّ الحادثة يقول «جدّدها من
 *   صفحة الربط» وليس فيها ما يُجدَّد. ثلاثةُ نصوصٍ تُحيل إلى بابٍ غير موجود.
 *
 * `endpoint` وسيطٌ لا فرعٌ في الشيفرة: نفس الحقول ونفس الأخطاء ونفس التلميحات
 * في الشاشات الثلاث — ونسخُها كان سيُنتج ثلاثة نماذج تتباعد عند أوّل تعديل.
 */
export interface Connected {
  id: string;
  displayName: string | null;
  tokenFingerprint: string | null;
  qualityRating: string | null;
  webhookSubscribed: boolean | null;
  issues: string[];
  webhookUrl: string;
  verifyToken: string | null;
}

export function ChannelConnectForm({
  endpoint, submitLabel, onDone, hint,
}: {
  /** مسار الربط — مسارُ العميل أو مسارُ اللوحة لعميلٍ يُسمّى صراحةً. */
  endpoint: string;
  submitLabel: string;
  onDone: (r: Connected) => void;
  hint?: string;
}) {
  const [phoneId, setPhoneId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [token, setToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  async function submit() {
    setBusy(true); setErr(null); setIssues([]);
    try {
      const r = await post<Connected>(endpoint, {
        phoneNumberId: phoneId, token, appSecret, wabaId: wabaId || undefined,
      });
      setIssues(r.issues);
      onDone(r);
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.message);
        /* تلميحُ الخادم يُعرض إن وُجد: «التوكن مؤقّت — أنشئ توكن مستخدم نظام»
           أنفعُ بكثيرٍ من «تعذّر الربط». */
        const extra = (e as unknown as { body?: { issues?: string[]; hint?: string } }).body;
        if (extra?.issues) setIssues(extra.issues);
        if (extra?.hint) setIssues((x) => [...x, extra.hint!]);
      } else setErr('تعذّر الربط');
    } finally { setBusy(false); }
  }

  const ready = Boolean(phoneId.trim() && token.trim() && appSecret.trim());

  return (
    <Stack gap="sm">
      <p className="muted-p">
        {hint ?? 'أربع قيمٍ من لوحة العميل عند ميتا. ولا نحفظ شيئاً قبل أن نفحصها فعلاً عند ميتا — فتوكنٌ مكسورٌ محفوظ يُنتج بوتاً صامتاً لا عطلاً ظاهراً.'}
      </p>
      <Field id="cc-phone" label="معرّف الرقم" hint="Phone number ID — من WhatsApp ← API Setup.">
        <Input id="cc-phone" value={phoneId} dir="ltr" onChange={setPhoneId} />
      </Field>
      <Field id="cc-waba" label="معرّف حساب واتساب (اختياريّ)" hint="WABA ID — يُمكّن فحص اشتراك الويبهوك.">
        <Input id="cc-waba" value={wabaId} dir="ltr" onChange={setWabaId} />
      </Field>
      <Field
        id="cc-token" label="التوكن الدائم"
        hint="من Business Settings ← System users ← Generate token، وانتهاؤه «Never». والتوكن المؤقّت عمره 24 ساعة ويُوقف البوت بلا إنذار."
      >
        <Input id="cc-token" type="password" value={token} dir="ltr" onChange={setToken} />
      </Field>
      <Field id="cc-secret" label="App Secret" hint="من Settings ← Basic في نفس التطبيق الذي تضبط ويبهوكه.">
        <Input id="cc-secret" type="password" value={appSecret} dir="ltr" onChange={setAppSecret} />
      </Field>

      {err && <Note tone="crit">{err}</Note>}
      {issues.length > 0 && (
        <Note tone="warn">
          <b>ما قالته ميتا:</b>
          <ul>{issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </Note>
      )}

      <Note tone="warn">
        <b>السرّان لا يُعادان إلى أيّ شاشة بعد الحفظ</b> — بصمةٌ وتاريخٌ فقط، ولا حتّى لك.
      </Note>

      <Button variant="primary" wide busy={busy} disabled={!ready} onClick={() => void submit()}>
        {submitLabel}
      </Button>
    </Stack>
  );
}
