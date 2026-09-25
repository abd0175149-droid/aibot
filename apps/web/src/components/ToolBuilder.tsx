'use client';

import { useState } from 'react';
import { post, patch, ApiError } from '@/lib/api';
import {
  Modal, Button, Field, Input, TextArea, Select, Toggle, Note,
  Stack, Row, Pill, CodeBlock, KV, KVRow,
} from '@/components/ui';

/**
 * باني الأدوات — الشاشة التي تُحوّل المنصّة من «نظامٍ نديره لك» إلى منتج.
 *
 * ★ لماذا أربع خطوات وليست استمارةً واحدة: العميل ليس مبرمجاً. استمارةٌ واحدة
 *   فيها `bodyTemplate` و`responseMap` و`paramsSchema` تُقرأ كشيفرة، فيتّصل
 *   بنا. والسؤال الواحد في الشاشة يجعل كلّ خطوةٍ قراراً مفهوماً:
 *     ماذا تفعل؟ ← ما المدخلات؟ ← إلى أين تنادي؟ ← ماذا نأخذ من الجواب؟
 *
 * ★ وزرّ التجربة ليس زينة: يُنفّذ النداء **فعلاً** ويعرض الطلب والاستجابة
 *   الحقيقيَّين. بلا هذا يكتشف العميل خطأ مسارٍ من ردٍّ خاطئٍ لزبون — أي بعد
 *   أن يكلّفه سمعته. والـAPI لهذا كان جاهزاً منذ المرحلة الثالثة ولم يُنادَ قطّ.
 */

export interface ToolDraft {
  id?: string;
  key: string;
  titleAr: string;
  description: string;
  params: Array<{ name: string; type: 'string' | 'number' | 'integer' | 'boolean'; desc: string; required: boolean }>;
  method: 'GET' | 'POST';
  url: string;
  bodyTemplate: string;
  authHeader: string;
  secretValue: string;
  hasSecrets?: boolean;
  responseMap: Array<{ field: string; path: string }>;
  confirmRequired: boolean;
  confirmTemplate: string;
}

export const EMPTY_DRAFT: ToolDraft = {
  key: '', titleAr: '', description: '',
  params: [], method: 'GET', url: '', bodyTemplate: '',
  authHeader: '', secretValue: '',
  responseMap: [], confirmRequired: false, confirmTemplate: '',
};

const STEPS = [
  { n: 1, q: 'ماذا تفعل هذه الأداة؟' },
  { n: 2, q: 'ما المعلومات التي يحتاجها البوت ليناديها؟' },
  { n: 3, q: 'إلى أين تنادي؟' },
  { n: 4, q: 'ماذا نأخذ من الجواب؟' },
] as const;

interface TestResult {
  ok: boolean;
  status?: number;
  ms?: number;
  mapped?: unknown;
  error?: string;
  /**
   * ★ **أسماءُ الحقول كانت لا تطابق الخادم، فلم يُعرض جوابُ المصدر قطّ.**
   *
   *   الخادم يُعيد `requestBody` و`responseSnippet`، والشاشةُ كانت تقرأ
   *   `body` و`snippet` — فكتلةُ «أوّل ما ردّه» كانت `undefined` دائماً،
   *   وهي أوّلُ ما يحتاجه من يبني أداةً لا تعمل.
   *
   *   وكلُّ حقلٍ هنا **محجوبُ الأسرار من الخادم** — لا تُعِد بناءه هنا.
   */
  debug?: { url?: string; requestBody?: string; responseSnippet?: string };
}

export function ToolBuilder({ initial, onClose, onSaved }: {
  initial: ToolDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<ToolDraft>(initial);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [sample, setSample] = useState('{}');

  const set = <K extends keyof ToolDraft>(k: K, v: ToolDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  /* ── التحقّق لكلّ خطوة: لا يُمنع التقدّم بلا سببٍ مكتوب ── */
  const stepError = (): string | null => {
    if (step === 1) {
      if (!/^[a-z][a-z0-9_]{2,40}$/.test(d.key)) {
        return 'الاسم البرمجيّ حروفٌ لاتينيّة صغيرة وشرطاتٌ سفليّة، يبدأ بحرف (مثل get_offers).';
      }
      if (d.titleAr.trim().length < 2) return 'اكتب اسماً عربيّاً يفهمه فريقك.';
      if (d.description.trim().length < 10) {
        return 'الوصف هو ما يقرأه النموذج ليعرف **متى** يناديها — فاكتبه بجملةٍ كاملة.';
      }
    }
    if (step === 3) {
      if (!/^https:\/\/.+/i.test(d.url)) return 'العنوان يجب أن يبدأ بـhttps — لا http ولا عنوانٌ داخليّ.';
    }
    return null;
  };

  function toPayload() {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of d.params) {
      if (!p.name) continue;
      properties[p.name] = { type: p.type, description: p.desc };
      if (p.required) required.push(p.name);
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (d.authHeader) headers.Authorization = d.authHeader;

    const responseMap: Record<string, string> = {};
    for (const r of d.responseMap) if (r.field && r.path) responseMap[r.field] = r.path;

    return {
      key: d.key,
      titleAr: d.titleAr,
      description: d.description,
      paramsSchema: { type: 'object', properties, required },
      http: {
        method: d.method,
        url: d.url,
        headers,
        timeoutMs: 8000,
        ...(d.method === 'POST' && d.bodyTemplate ? { bodyTemplate: d.bodyTemplate } : {}),
      },
      responseMap: Object.keys(responseMap).length ? responseMap : null,
      confirmRequired: d.confirmRequired,
      confirmTemplate: d.confirmRequired ? (d.confirmTemplate || null) : null,
      ...(d.secretValue ? { secrets: { API_TOKEN: d.secretValue } } : {}),
    };
  }

  /**
   * `enabled` صريحٌ في كلّ حفظ:
   *  · التجربةُ تحفظ **معطَّلةً** — فلا يراها البوت الحيّ وهي نصفُ مبنيّة.
   *  · و«احفظ الأداة» يفعّلها — وهو القرارُ الذي يقصده المالك.
   */
  async function save(enabled: boolean): Promise<string | null> {
    setErr(null);
    try {
      const body = { ...toPayload(), enabled };
      const saved = d.id
        ? await patch<{ id: string }>(`/bot/tools/${d.id}`, body)
        : await post<{ id: string }>('/bot/tools', body);
      setD((x) => ({ ...x, id: saved.id }));
      return saved.id;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر الحفظ');
      return null;
    }
  }

  /**
   * التجربة تحتاج الأداة محفوظةً (السرّ مشفَّرٌ في القاعدة ولا يُرسَل في نداء
   * تجربة). فنحفظ أوّلاً ثمّ نجرّب — **معطَّلةً**، فلا يراها البوت الحيّ.
   * وكان الحفظُ يُنشئها مفعَّلة، فتصير في متناول البوت أمام الزبائن من لحظة
   * الضغط على «جرّبها» وهي نصفُ مبنيّة.
   */
  async function runTest() {
    setBusy(true);
    setTest(null);
    try {
      const id = d.id ?? (await save(false));
      if (!id) return;
      let sampleParams: Record<string, unknown> = {};
      try { sampleParams = JSON.parse(sample || '{}') as Record<string, unknown>; } catch {
        setErr('العيّنة ليست JSON صالحاً.');
        return;
      }
      const r = await post<TestResult>(`/bot/tools/${id}/test`, { sampleParams });
      setTest(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّرت التجربة');
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    const id = await save(true);
    if (id) onSaved();
  }

  const e = stepError();

  return (
    <Modal
      wide
      title={d.id ? `تعديل «${d.titleAr || d.key}»` : 'أداةٌ جديدة'}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={() => setStep((s) => s - 1)} disabled={step === 1}>السابق</Button>
          {step < 4 ? (
            <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={Boolean(e)} reason={e ?? undefined}>
              التالي
            </Button>
          ) : (
            <Button variant="primary" onClick={finish} busy={busy}>احفظ الأداة</Button>
          )}
          <Button onClick={runTest} busy={busy} disabled={Boolean(stepError()) || step < 3}
            reason="أكمِل خطوة العنوان أوّلاً">
            جرّبها الآن
          </Button>
        </>
      )}
    >
      <Stack gap="md">
        <Row gap="xs">
          {STEPS.map((s) => (
            <Pill key={s.n} tone={s.n === step ? 'brand' : s.n < step ? 'ok' : 'neutral'}
              label={`${s.n}. ${s.q}`} mark={false} />
          ))}
        </Row>

        {err && <Note tone="crit">{err}</Note>}

        {step === 1 && (
          <Stack gap="sm">
            <Field id="t-title" label="اسمها عندك" hint="ما يراه فريقك في القوائم.">
              <Input id="t-title" value={d.titleAr} onChange={(v) => set('titleAr', v)} placeholder="عروض السفر" />
            </Field>
            <Field
              id="t-key" label="اسمها البرمجيّ"
              hint="ما يناديه البوت. لا يُعدَّل بعد الحفظ — تغييره يكسر ما بُنِي عليه."
              error={d.id ? undefined : undefined}
            >
              <Input id="t-key" value={d.key} dir="ltr" disabled={Boolean(d.id)}
                onChange={(v) => set('key', v.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                placeholder="get_offers" />
            </Field>
            <Field
              id="t-desc" label="متى يناديها البوت؟"
              hint="هذا النصّ يقرأه النموذج ليقرّر. اكتبه كما تشرح لموظّفٍ جديد."
            >
              <TextArea id="t-desc" rows={3} value={d.description} onChange={(v) => set('description', v)}
                placeholder="تُستعمل حين يسأل الزبون عن العروض أو الباقات المتاحة. تُرجع قائمة العروض بأسعارها." />
            </Field>
            <Note>
              <b>الوصف هو نصف الأداة.</b> وصفٌ غامض يجعل البوت ينادي الأداة في غير موضعها،
              أو لا يناديها حين يجب. اذكر <b>متى</b> لا <b>ماذا</b>.
            </Note>
          </Stack>
        )}

        {step === 2 && (
          <Stack gap="sm">
            <p className="muted-p">
              المعلومات التي يستخرجها البوت من كلام الزبون ويمرّرها للأداة. اتركها فارغةً إن كانت
              الأداة لا تحتاج شيئاً (مثل «كلّ العروض»).
            </p>
            {/* ★ **كلُّ مدخلٍ مجموعةٌ مسمّاة.** كان صفّاً عارياً — وعلى الهاتف يلتفّ
                إلى أربعة أسطرٍ بلا حدٍّ ولا عنوان، فيستوي مدخلان في القراءة. رأيتُها في
                لقطة 390: ستّة ضوابطَ متتالية لا يُعرف أيُّها لأيّ. والعاقبة ليست جمالاً:
                في كلّ مجموعةٍ **زرُّ حذف**، وزرُّ حذفٍ لا يُعرف ما يحذف يُضغط على الخطأ. */}
            {d.params.map((p, i) => (
              <Field key={i} labelless id={`p-g-${i}`} label={`مدخل ${i + 1}`}>
                <Row gap="sm">
                  <Input id={`p-n-${i}`} value={p.name} dir="ltr"
                    onChange={(v) => set('params', d.params.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
                  <Select id={`p-t-${i}`} value={p.type}
                    onChange={(v) => set('params', d.params.map((x, j) => (j === i ? { ...x, type: v as 'string' } : x)))}
                    options={[
                      { value: 'string', label: 'نصّ' }, { value: 'number', label: 'رقم' },
                      { value: 'integer', label: 'عددٌ صحيح' }, { value: 'boolean', label: 'نعم/لا' },
                    ]} />
                  <Input id={`p-d-${i}`} value={p.desc}
                    onChange={(v) => set('params', d.params.map((x, j) => (j === i ? { ...x, desc: v } : x)))} />
                  <Toggle id={`p-r-${i}`} label="إلزاميّ" checked={p.required}
                    onChange={(v) => set('params', d.params.map((x, j) => (j === i ? { ...x, required: v } : x)))} />
                  <Button size="sm" variant="danger"
                    onClick={() => set('params', d.params.filter((_, j) => j !== i))}>حذف</Button>
                </Row>
              </Field>
            ))}
            <Row>
              <Button size="sm" onClick={() => set('params', [...d.params, { name: '', type: 'string', desc: '', required: false }])}>
                + مدخل
              </Button>
            </Row>
          </Stack>
        )}

        {step === 3 && (
          <Stack gap="sm">
            <Row gap="sm">
              <Field id="t-method" label="النوع">
                <Select id="t-method" value={d.method} onChange={(v) => set('method', v as 'GET')}
                  options={[{ value: 'GET', label: 'قراءة (GET)' }, { value: 'POST', label: 'كتابة (POST)' }]} />
              </Field>
            </Row>
            <Field id="t-url" label="العنوان" hint="https فقط. والعناوين الداخليّة مرفوضةٌ في الخادم لا في الشاشة.">
              <Input id="t-url" value={d.url} dir="ltr" onChange={(v) => set('url', v)}
                placeholder="https://example.com/api/offers?category={{category}}" />
            </Field>
            {d.method === 'POST' && (
              <Field id="t-body" label="جسم الطلب" hint="استعمل {{اسم_المدخل}} ليُستبدل بما استخرجه البوت.">
                <TextArea id="t-body" rows={4} value={d.bodyTemplate} onChange={(v) => set('bodyTemplate', v)}
                  placeholder={'{"phone":"{{__contact_phone}}","details":"{{details}}"}'} />
              </Field>
            )}
            <Field
              id="t-auth"
              label="ترويسة الصلاحيّة"
              hint="اتركها فارغةً إن كان العنوان عامّاً. وإن كتبتَ التوكن هنا مباشرةً نُشفّره ونضع مرجعاً إليه."
            >
              <Input id="t-auth" value={d.authHeader} dir="ltr" onChange={(v) => set('authHeader', v)}
                placeholder="Bearer {{secret.API_TOKEN}}" />
            </Field>
            <Field
              id="t-secret"
              label={d.hasSecrets ? 'استبدل السرّ' : 'السرّ'}
              hint={d.hasSecrets
                ? 'محفوظٌ ومشفَّر. اتركه فارغاً ليبقى كما هو — ولا يُعاد عرضه أبداً.'
                : 'يُشفَّر قبل الحفظ، ولا يُعاد إلى أيّ شاشةٍ بعد ذلك.'}
            >
              <Input id="t-secret" type="password" value={d.secretValue} dir="ltr"
                onChange={(v) => set('secretValue', v)} placeholder={d.hasSecrets ? '•••• محفوظ' : ''} />
            </Field>
            <Note tone="warn">
              <b>حدٌّ يفرضه الخادم لا الشاشة.</b> العنوان يُحلّ ويُفحص: العناوين الخاصّة والداخليّة
              مرفوضة، وعند كلّ تحويلٍ يُعاد الفحص. والمهلة ثماني ثوان، والحجم 256 كيلوبايت،
              وخمسة إخفاقاتٍ متتالية تُعطّل الأداة وتُشعرك.
            </Note>
          </Stack>
        )}

        {step === 4 && (
          <Stack gap="sm">
            <p className="muted-p">
              الحقول التي يراها البوت من الجواب. ما لا تذكره هنا لا يراه — وهذا يقلّل التوكنز
              ويمنع تسريب حقولٍ لا تريدها.
            </p>
            {/* ونفسُ السبب هنا: مجموعةٌ مسمّاةٌ لكلّ حقل، فلا يُضغط حذفُ غيره */}
            {d.responseMap.map((r, i) => (
              <Field key={i} labelless id={`r-g-${i}`} label={`حقل ${i + 1}`}>
                <Row gap="sm">
                  <Input id={`r-f-${i}`} value={r.field} dir="ltr"
                    onChange={(v) => set('responseMap', d.responseMap.map((x, j) => (j === i ? { ...x, field: v } : x)))} />
                  <Input id={`r-p-${i}`} value={r.path} dir="ltr"
                    onChange={(v) => set('responseMap', d.responseMap.map((x, j) => (j === i ? { ...x, path: v } : x)))} />
                  <Button size="sm" variant="danger"
                    onClick={() => set('responseMap', d.responseMap.filter((_, j) => j !== i))}>حذف</Button>
                </Row>
              </Field>
            ))}
            <Row>
              <Button size="sm" onClick={() => set('responseMap', [...d.responseMap, { field: '', path: '$.' }])}>
                + حقل
              </Button>
            </Row>

            <Toggle id="t-confirm" label="فعلٌ خطر — يحتاج تأكيد الزبون بزرّ" checked={d.confirmRequired}
              onChange={(v) => set('confirmRequired', v)} />
            {d.confirmRequired && (
              <Field id="t-ctpl" label="نصّ التأكيد" hint="ما يقرأه الزبون قبل الأزرار.">
                <Input id="t-ctpl" value={d.confirmTemplate} onChange={(v) => set('confirmTemplate', v)}
                  placeholder="بنجهّز طلبك بهالتفاصيل ونحوّلك لموظّف. أأكّد؟" />
              </Field>
            )}
            {d.confirmRequired && (
              <Note>
                <b>ما يحدث عند التأكيد.</b> البوت يقترح ولا ينفّذ: الأداة تُرسل أزراراً، والتنفيذ
                معالجٌ حتميّ عند الضغط يُعيد التحقّق — ولا يستطيع النموذج أن يقول «تمّ» قبل ذلك.
              </Note>
            )}

            <Field id="t-sample" label="عيّنة للتجربة" hint="قيم المدخلات التي نجرّب بها الآن.">
              <TextArea id="t-sample" rows={2} value={sample} onChange={setSample} />
            </Field>

            {test && (
              <Stack gap="sm">
                <Row gap="sm">
                  <Pill tone={test.ok ? 'ok' : 'crit'} label={test.ok ? 'نجح النداء' : 'فشل النداء'} />
                  {test.status !== undefined && <Pill tone="neutral" label={`HTTP ${test.status}`} />}
                  {test.ms !== undefined && <Pill tone="neutral" label={`${test.ms}ms`} />}
                </Row>
                {test.error && <Note tone="crit">{test.error}</Note>}
                {test.debug?.url && <CodeBlock label="العنوان الذي نودي فعلاً" text={test.debug.url} />}
                {test.debug?.requestBody && <CodeBlock label="الجسم الذي أُرسل" text={test.debug.requestBody} />}
                {test.debug?.responseSnippet && <CodeBlock label="أوّل ما ردّه" text={test.debug.responseSnippet} />}
                <Note>
                  الأسرارُ محجوبةٌ (<span dir="ltr">•••</span>) في هذه الكتل — يُحجبها الخادم قبل أن
                  تصل الشاشة.
                </Note>
                <KV>
                  <KVRow k="ما سيراه البوت">
                    <CodeBlock text={JSON.stringify(test.mapped ?? null, null, 2)} />
                  </KVRow>
                </KV>
              </Stack>
            )}
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
