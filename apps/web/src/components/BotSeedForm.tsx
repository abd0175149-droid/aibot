'use client';

import { useState } from 'react';
import { post, ApiError } from '@/lib/api';
import { READ_UNIT } from '@/lib/terms';
import { PERSONA_TEMPLATES } from '@/lib/personas';
import {
  Button, Field, TextArea, Select, Stack, Row, Note,
} from '@/components/ui';

/**
 * ★ **بذرُ أوّل نسخةِ بوتٍ لعميل — من موضعَين بنفس الحدود.**
 *
 *   `POST /console/tenants/:id/bot/seed` كان له مُنادٍ واحدٌ في الواجهة كلِّها:
 *   معالجُ التهيئة. فمعالجٌ أُغلق في الخطوة الثانية كان يترك عميلاً **لا يُبذر
 *   بوتُه من اللوحة إطلاقاً** — ولا مخرجَ إلّا سكربتٌ على الخادم.
 *
 *   ونسخُ الحقول نموذجاً ثانياً في ورقة العميل هو بعينه العطلُ الذي وُلد منه
 *   `ChannelConnectForm`: نسختان تتباعدان عند أوّل تعديلٍ بلا أن يفشل شيء.
 *
 * ⚠️ وبذرٌ لا استبدال: الخادم يردّ ٤٠٩ إن كان للعميل نسخةٌ منشورةٌ أصلاً، فلا
 *    يمحو نموذجٌ فُتح بالخطأ شخصيّةَ عميلٍ يعمل.
 */
export function BotSeedForm({ endpoint, onDone }: {
  endpoint: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await post(endpoint, { persona, knowledgeBase: knowledge });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر النشر');
    } finally { setBusy(false); }
  }

  return (
    <Stack gap="sm">
      {err && <Note tone="crit">{err}</Note>}

      <Field id="o-tpl" label="القطاع" hint="القالب نقطة بداية — عدّله بحرّية.">
        <Select id="o-tpl" value={tpl} onChange={pickTemplate}
          options={PERSONA_TEMPLATES.map((t) => ({ value: t.id, label: `${t.label} — ${t.hint}` }))} />
      </Field>

      <Field id="o-persona" label="شخصيّة البوت" hint="ما لا يفعله البوت أهمّ من قدراته.">
        <TextArea id="o-persona" rows={10} value={persona} onChange={setPersona}
          count={{ used: Math.ceil(persona.length / 2.5), limit: 2000, unit: READ_UNIT }} />
      </Field>

      <Note>
        <b>أجِب عن هذه، ولا تكتب أكثر.</b> المعرفة المرتّبة تهزم المعرفة الكثيرة:
        <ul>{template.knowledgePrompts.map((q) => <li key={q}>{q}</li>)}</ul>
      </Note>

      <Field id="o-kb" label="معرفة البوت" hint="استعمل عناوين (سطرٌ يبدأ بـ# أو ينتهي بنقطتين) — تُحسّن الدقّة كثيراً.">
        <TextArea id="o-kb" rows={10} value={knowledge} onChange={setKnowledge}
          count={{ used: Math.ceil(knowledge.length / 2.5), limit: 8000, unit: READ_UNIT }} />
      </Field>

      <p className="muted-p">
        فوق ثمانية آلاف وحدةِ قراءة يتحوّل البوت تلقائيّاً إلى إرسال «الأساسيات والقيود وما يرتبط
        بالسؤال» — فمعرفةٌ أكبر لا تعني فاتورةً أكبر. والملفّات تُرفع لاحقاً من شاشة البوت.
      </p>

      <Row gap="sm">
        <Button variant="primary" busy={busy} onClick={() => void submit()}
          disabled={knowledge.trim().length < 40}
          reason="اكتب معرفةً أساسيّة أوّلاً — بوتٌ بلا معرفةٍ يقول «لا أعرف» فقط">
          انشر وابدأ
        </Button>
      </Row>
    </Stack>
  );
}
