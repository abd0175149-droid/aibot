'use client';

import { useState } from 'react';
import { post, ApiError } from '@/lib/api';
/* ★ نموذجُ البذر مشتركٌ مع ورقة العميل في اللوحة: المسارُ نفسُه يُنادى من
   موضعَين، ونسختان من نفس الحدود تتباعدان عند أوّل تعديل. */
import { BotSeedForm } from '@/components/BotSeedForm';
import {
  Modal, Button, Field, Input, Stack, Row,
  Pill, Note, CodeBlock, KV, KVRow, Iso,
} from '@/components/ui';

/**
 * معالج تهيئة العميل — خمس خطوات.
 *
 * ★ هذا المعالج هو **معيار قبول المرحلة السادسة** حرفيّاً: «تُنشئ عميلاً
 *   وتُنهي تهيئته وبوته يردّ **بلا لمس الخادم ولا الكود**». وحتّى اليوم كانت
 *   كلّ تهيئةٍ تجري بسكربتٍ و`ssh` — أي أنّ النظام كان يعمل ولم يكن منتجاً.
 *
 * ★ والخطوة الثانية هي مفصله: **اختبار اتّصالٍ حقيقيّ بميتا قبل أيّ حفظ.**
 *   توكنٌ مكسورٌ محفوظٌ يُنتج بوتاً صامتاً لا عطلاً ظاهراً: القناة «موصولة»
 *   والشاشات خضراء ولا رسالة تصل. فالخادم يفحص أوّلاً ولا يكتب إن فشل.
 *
 * وترتيب الخطوات مقصود: **قناةٌ قبل ذكاء.** بوتٌ ذكيٌّ لا يستقبل رسائل لا
 * قيمة له، وقناةٌ سليمة بردودٍ بسيطة منتَجٌ يُعرض.
 */

type Step = 1 | 2 | 3 | 4;

interface Created {
  tenant: { id: string; name: string; slug: string; publicId: string };
  tempPassword: string;
  webhookUrl: string;
}

interface Connected {
  displayName: string | null;
  tokenFingerprint: string | null;
  qualityRating: string | null;
  webhookSubscribed: boolean | null;
  issues: string[];
  webhookUrl: string;
  verifyToken: string | null;
}

export function Onboarding({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  // ① النشاط
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [created, setCreated] = useState<Created | null>(null);

  // ② القناة
  const [phoneId, setPhoneId] = useState('');
  const [token, setToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [conn, setConn] = useState<Connected | null>(null);

  /**
   * ★ **إغلاقٌ يُنبّه لا يختفي.**
   *
   *   قبل الخطوة الأولى لا شيءَ كُتب فالإغلاق مجّانيّ. وبعدها صار في القاعدة
   *   مستأجرٌ ومالكٌ و**كلمةٌ مؤقّتةٌ تُعرض مرّةً واحدةً ولا تُخزَّن نصّاً** — فنقرةٌ
   *   على خلفيّة النافذة (والخلفيّةُ تُغلق) كانت تتركه نصفَ مهيَّأٍ ولا تقول ذلك.
   */
  const [leaving, setLeaving] = useState(false);

  function requestClose() {
    if (!created) { onClose(); return; }
    setLeaving(true);
  }

  async function createTenant() {
    setBusy(true); setErr(null);
    try {
      const r = await post<Created>('/console/tenants', {
        name, slug, ownerEmail: email, ownerName: name,
      });
      setCreated(r);
      setStep(2);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر إنشاء العميل');
    } finally { setBusy(false); }
  }

  /**
   * الربط بمسارٍ **صريحٍ بالمستأجر** لا بالانتحال: الانتحال قراءةٌ فقط وذاك
   * قرارٌ يُصان — فلو سُمح له بالكتابة صار سجلّ التدقيق كاذباً. المستأجر في
   * العنوان، والفعل مسجَّلٌ باسم فاعلٍ حقيقيّ، والعميل يراه في سجلّه.
   */
  async function connectChannel() {
    if (!created) return;
    setBusy(true); setErr(null); setIssues([]);
    try {
      const r = await post<Connected>(`/console/tenants/${created.tenant.id}/channel/connect`, {
        phoneNumberId: phoneId, token, appSecret, wabaId: wabaId || undefined,
      });
      setConn(r);
      setIssues(r.issues);
      setStep(3);
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.message);
        const extra = (e as unknown as { body?: { issues?: string[]; hint?: string } }).body;
        if (extra?.issues) setIssues(extra.issues);
      } else setErr('تعذّر الربط');
    } finally { setBusy(false); }
  }

  const STEPS: Array<{ n: Step; label: string }> = [
    { n: 1, label: 'النشاط' },
    { n: 2, label: 'القناة' },
    { n: 3, label: 'البوت' },
    { n: 4, label: 'تمّ' },
  ];

  return (
    <Modal
      wide
      title="عميلٌ جديد"
      onClose={requestClose}
      footer={(
        <>
          {step === 1 && (
            <Button variant="primary" busy={busy} onClick={createTenant}
              disabled={!name.trim() || !/^[a-z0-9-]{3,30}$/.test(slug) || !email.includes('@')}
              reason="الاسم والمعرّف والبريد مطلوبة">
              أنشئ العميل
            </Button>
          )}
          {step === 2 && (
            <>
              <Button variant="primary" busy={busy} onClick={connectChannel}
                disabled={!phoneId.trim() || !token.trim() || !appSecret.trim()}
                reason="القيم الثلاث مطلوبة">
                افحص واربط
              </Button>
              <Button onClick={() => setStep(3)}>أكمِل بلا ربط</Button>
            </>
          )}
          {/* الخطوةُ الثالثة لا فعلَ لها في الرصيف: زرُّ «انشر وابدأ» داخل
              النموذج نفسِه، فلا يُقسَّم فعلٌ واحدٌ على موضعَين. */}
          {step === 4 && <Button variant="primary" onClick={onDone}>أنهِ</Button>}
          {step > 1 && step < 4 && <Button onClick={() => setStep((s) => (s - 1) as Step)}>السابق</Button>}
        </>
      )}
    >
      <Stack gap="md">
        <Row gap="xs">
          {STEPS.map((s) => (
            <Pill key={s.n} mark={false} label={`${s.n}. ${s.label}`}
              tone={s.n === step ? 'brand' : s.n < step ? 'ok' : 'neutral'} />
          ))}
        </Row>

        {leaving && created && (
          <Note tone="warn">
            <b>تهيئةٌ لم تكتمل.</b> أُنشئ العميل «{created.tenant.name}» ومالكُه بالفعل
            {!conn && <>، ولم تُربَط قناتُه بعد</>}
            {step < 4 && <>، ولا نسخةَ بوتٍ منشورةً له — فلن يردّ على أحد</>}.
            <p className="muted-p">
              وهذه <b>آخرُ مرّةٍ</b> تظهر فيها كلمتُه المؤقّتة — لا تُخزَّن نصّاً في أيّ مكان.
              وما بقي يُكمَل من ورقة العميل في اللوحة: ربطُ القناة، وبذرُ بوته، وتوليدُ كلمةٍ
              مؤقّتةٍ جديدةٍ لمالكه.
            </p>
            <CodeBlock label="كلمة المرور المؤقّتة" text={created.tempPassword} />
            <Row gap="sm">
              <Button variant="primary" onClick={() => setLeaving(false)}>أكمِل التهيئة</Button>
              <Button onClick={onClose}>أغلِق — وأكمّلها من ورقة العميل</Button>
            </Row>
          </Note>
        )}

        {err && <Note tone="crit">{err}</Note>}
        {!!issues.length && (
          <Note tone="warn">
            <b>ملاحظاتٌ من ميتا:</b>
            <ul>{issues.map((x) => <li key={x}>{x}</li>)}</ul>
          </Note>
        )}

        {step === 1 && (
          <Stack gap="sm">
            <Field id="o-name" label="اسم النشاط" hint="كما يعرفه زبائنه.">
              <Input id="o-name" value={name} onChange={(v) => {
                setName(v);
                // اقتراح معرّفٍ لاتينيّ من أوّل كلمةٍ — ويبقى قابلاً للتعديل
                if (!slug) setSlug(v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24).replace(/^-|-$/g, ''));
              }} />
            </Field>
            <Field id="o-slug" label="المعرّف" hint="حروفٌ لاتينيّة وأرقامٌ وشرطات. لا يُعدَّل بعد الإنشاء.">
              <Input id="o-slug" value={slug} dir="ltr"
                onChange={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
            </Field>
            <Field id="o-mail" label="بريد المالك" hint="نُنشئ له حساباً بكلمة مرورٍ مؤقّتة يجب تغييرها.">
              <Input id="o-mail" type="email" value={email} dir="ltr" onChange={setEmail} />
            </Field>
          </Stack>
        )}

        {step === 2 && (
          <Stack gap="sm">
            {created && (
              <Note>
                <b>أُنشئ «{created.tenant.name}».</b> كلمة المرور المؤقّتة تُعرض
                <b> مرّةً واحدة</b> ولا تُخزَّن نصّاً في أيّ مكان — انسخها الآن.
                <CodeBlock label="كلمة المرور المؤقّتة" text={created.tempPassword} />
              </Note>
            )}
            <p className="muted-p">
              أربع قيمٍ من لوحة العميل عند ميتا. ولا نحفظ شيئاً قبل أن نفحصها
              <b> فعلاً عند ميتا</b> — فتوكنٌ مكسورٌ محفوظ يُنتج بوتاً صامتاً لا عطلاً ظاهراً.
            </p>
            <Field id="o-phone" label="معرّف الرقم" hint="Phone number ID — من WhatsApp ← API Setup.">
              <Input id="o-phone" value={phoneId} dir="ltr" onChange={setPhoneId} />
            </Field>
            <Field id="o-waba" label="معرّف حساب واتساب (اختياريّ)" hint="WABA ID — يُمكّن فحص اشتراك الويبهوك.">
              <Input id="o-waba" value={wabaId} dir="ltr" onChange={setWabaId} />
            </Field>
            <Field
              id="o-token" label="التوكن الدائم"
              hint="من Business Settings ← System users ← Generate token، وانتهاؤه «Never». والتوكن المؤقّت عمره 24 ساعة ويُوقف البوت بلا إنذار."
            >
              <Input id="o-token" type="password" value={token} dir="ltr" onChange={setToken} />
            </Field>
            <Field id="o-secret" label="App Secret" hint="من Settings ← Basic في نفس التطبيق الذي تضبط ويبهوكه.">
              <Input id="o-secret" type="password" value={appSecret} dir="ltr" onChange={setAppSecret} />
            </Field>
            <Note tone="warn">
              <b>السرّان لا يُعادان إلى أيّ شاشة بعد الحفظ</b> — بصمةٌ وتاريخٌ فقط، ولا حتّى لك.
            </Note>
          </Stack>
        )}

        {step === 3 && created && (
          <Stack gap="sm">
            {conn && (
              <KV>
                {/* ★ قيمتان تأتيان من ميتا فلا يُعرف شكلُهما قبل الوصول: «الرقم» قد
                    يكون رقماً لاتينيّاً أو اسمَ عرضٍ عربيّاً موثّقاً. وبلا عزلٍ ينقلب
                    «+962 7 9000 0000» إلى «0000 9000 7 962+» في فقرةٍ أساسُها RTL
                    (رأيتُها منقلبةً في لقطة الخطوة الثالثة) — ومع عزلٍ مفروضٍ تنكسر
                    العربيّة. فالقرار محسوبٌ في `Iso` لا مكتوبٌ هنا. */}
                <KVRow k="الرقم">{conn.displayName ? <Iso text={conn.displayName} /> : '—'}</KVRow>
                <KVRow k="جودة الرقم">{conn.qualityRating ? <Iso text={conn.qualityRating} /> : '—'}</KVRow>
                <KVRow k="اشتراك الويبهوك">
                  {conn.webhookSubscribed === null
                    ? <Pill tone="neutral" label="تعذّر التحقّق" />
                    : conn.webhookSubscribed
                      ? <Pill tone="ok" label="مشترك" />
                      : <Pill tone="crit" label="غير مشترك — لن تصل رسالة" />}
                </KVRow>
              </KV>
            )}
            <BotSeedForm
              endpoint={`/console/tenants/${created.tenant.id}/bot/seed`}
              onDone={() => setStep(4)}
            />
          </Stack>
        )}

        {step === 4 && created && (
          <Stack gap="md">
            <Note>
              {/* ★ «منشورٌ ويستقبل» كانت تُقال والبوتُ قد يكون مطفأً ولا قناةَ
                  موصولة. والنصّ الآن يقول ما تمّ وما بقي — لا أكثر. */}
              <b>جاهز.</b> نُشرت نسخة بوت «{created.tenant.name}» وشُغِّل. والخطوة الأخيرة عند ميتا:
              الصِق هذين في WhatsApp ← Configuration، ثمّ فعّل الحقل <b>messages</b>.
            </Note>
            <CodeBlock label="Callback URL" text={conn?.webhookUrl ?? created.webhookUrl} />
            {conn?.verifyToken && <CodeBlock label="Verify token" text={conn.verifyToken} />}
            <Note tone="warn">
              <b>بلا حقل <span className="mono">messages</span> لا تصل رسالةٌ واحدة</b> — وكلّ شيءٍ
              آخر سيبدو سليماً: التوكن صالح والرقم أخضر والشاشات خضراء. هذا أوّل ما نفحصه
              عند أيّ «البوت لا يردّ».
            </Note>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
