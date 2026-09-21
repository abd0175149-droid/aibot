'use client';

import { useState } from 'react';
import { post, ApiError } from '@/lib/api';
import { PERSONA_TEMPLATES } from '@/lib/personas';
import {
  Modal, Button, Field, Input, TextArea, Select, Stack, Row,
  Pill, Note, CodeBlock, KV, KVRow,
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

type Step = 1 | 2 | 3 | 4 | 5;

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

  // ③ الشخصيّة ④ المعرفة
  const [tpl, setTpl] = useState(PERSONA_TEMPLATES[0]!.id);
  const [persona, setPersona] = useState(PERSONA_TEMPLATES[0]!.persona);
  const [knowledge, setKnowledge] = useState('');

  const template = PERSONA_TEMPLATES.find((t) => t.id === tpl)!;

  function pickTemplate(id: string) {
    setTpl(id);
    const t = PERSONA_TEMPLATES.find((x) => x.id === id);
    // لا نمسح تعديلات العميل بلا إذنه — نستبدل فقط إن لم يُعدّل بعد
    if (t && (persona === template.persona || !persona.trim())) setPersona(t.persona);
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

  async function publish() {
    if (!created) return;
    setBusy(true); setErr(null);
    try {
      /* بذرٌ لا استبدال: الخادم يرفض إن كان للعميل نسخةٌ منشورةٌ أصلاً، فلا
         يمسح معالجٌ فُتح بالخطأ شخصيّةَ عميلٍ يعمل. */
      await post(`/console/tenants/${created.tenant.id}/bot/seed`, {
        persona, knowledgeBase: knowledge,
      });
      setStep(5);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر النشر');
    } finally { setBusy(false); }
  }

  const STEPS: Array<{ n: Step; label: string }> = [
    { n: 1, label: 'النشاط' },
    { n: 2, label: 'القناة' },
    { n: 3, label: 'الشخصيّة' },
    { n: 4, label: 'المعرفة' },
    { n: 5, label: 'تمّ' },
  ];

  return (
    <Modal
      wide
      title="عميلٌ جديد"
      onClose={onClose}
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
          {step === 3 && <Button variant="primary" onClick={() => setStep(4)}>التالي</Button>}
          {step === 4 && (
            <Button variant="primary" busy={busy} onClick={publish}
              disabled={knowledge.trim().length < 40}
              reason="اكتب معرفةً أساسيّة أوّلاً — بوتٌ بلا معرفةٍ يقول «لا أعرف» فقط">
              انشر وابدأ
            </Button>
          )}
          {step === 5 && <Button variant="primary" onClick={onDone}>أنهِ</Button>}
          {step > 1 && step < 5 && <Button onClick={() => setStep((s) => (s - 1) as Step)}>السابق</Button>}
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

        {step === 3 && (
          <Stack gap="sm">
            {conn && (
              <KV>
                <KVRow k="الرقم">{conn.displayName ?? '—'}</KVRow>
                <KVRow k="جودة الرقم">{conn.qualityRating ?? '—'}</KVRow>
                <KVRow k="اشتراك الويبهوك">
                  {conn.webhookSubscribed === null
                    ? <Pill tone="neutral" label="تعذّر التحقّق" />
                    : conn.webhookSubscribed
                      ? <Pill tone="ok" label="مشترك" />
                      : <Pill tone="crit" label="غير مشترك — لن تصل رسالة" />}
                </KVRow>
              </KV>
            )}
            <Field id="o-tpl" label="القطاع" hint="القالب نقطة بداية — عدّله بحرّية.">
              <Select id="o-tpl" value={tpl} onChange={pickTemplate}
                options={PERSONA_TEMPLATES.map((t) => ({ value: t.id, label: `${t.label} — ${t.hint}` }))} />
            </Field>
            <Field id="o-persona" label="شخصيّة البوت" hint="ما لا يفعله البوت أهمّ من قدراته.">
              <TextArea id="o-persona" rows={14} value={persona} onChange={setPersona}
                count={{ used: Math.ceil(persona.length / 2.5), limit: 2000, unit: 'توكن' }} />
            </Field>
          </Stack>
        )}

        {step === 4 && (
          <Stack gap="sm">
            <Note>
              <b>أجِب عن هذه، ولا تكتب أكثر.</b> المعرفة المرتّبة تهزم المعرفة الكثيرة:
              <ul>{template.knowledgePrompts.map((q) => <li key={q}>{q}</li>)}</ul>
            </Note>
            <Field id="o-kb" label="معرفة البوت" hint="استعمل عناوين (سطرٌ يبدأ بـ# أو ينتهي بنقطتين) — تُحسّن الدقّة كثيراً.">
              <TextArea id="o-kb" rows={14} value={knowledge} onChange={setKnowledge}
                count={{ used: Math.ceil(knowledge.length / 2.5), limit: 8000, unit: 'توكن' }} />
            </Field>
            <p className="muted-p">
              فوق 8 آلاف توكن يتحوّل البوت تلقائيّاً إلى إرسال «الأساسيات والقيود وما يرتبط
              بالسؤال» — فمعرفةٌ أكبر لا تعني فاتورةً أكبر. والملفّات تُرفع لاحقاً من شاشة البوت.
            </p>
          </Stack>
        )}

        {step === 5 && created && (
          <Stack gap="md">
            <Note>
              <b>جاهز.</b> بوت «{created.tenant.name}» منشورٌ ويستقبل. والخطوة الأخيرة عند ميتا:
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
