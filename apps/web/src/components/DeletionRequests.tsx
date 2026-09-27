'use client';

import { useState } from 'react';
import { useApi, fmt } from '@/lib/useApi';
import { post, del, ApiError } from '@/lib/api';
import { Button, Note, Pill, Row, Stack, Input, Field } from '@/components/ui';
import { Section } from '@/components/screen';

/**
 * ★★ طلباتُ حذف البيانات — الوعدُ المنشور في صفحة «حذف البيانات» عند العميل.
 *
 *   زبونٌ يرسل «احذف بياناتي» فيُسجَّل صفٌّ ويُكتم. والتنفيذُ قرارُ المالك: الحذفُ
 *   لا رجعةَ فيه، وقد يُلزمه القانونُ بإبقاء شيء — فالرفضُ ممكنٌ بسببٍ مكتوب.
 *   والحذفُ نفسُه يمرّ بمساره المسجَّل (‏`DELETE /contacts/:id`) ثمّ يُغلق الطلب،
 *   فلا يُعلَن حذفٌ لم يقع.
 *
 * ⚠️ للمالك وحده (إعدادات): الموظّفُ يرى الزبونَ مكتوماً في المحادثة ولا يحذف.
 */

interface Req {
  id: string; contactId: string | null; source: string; handle: string | null; detail: string | null;
  status: 'pending' | 'done' | 'refused'; note: string | null; createdAt: string; resolvedAt: string | null;
  contactName: string | null; contactExists: boolean;
}

export function DeletionRequests({ readOnly, onChanged }: { readOnly: boolean; onChanged?: () => void }) {
  const { data, reload } = useApi<{ items: Req[] }>('/deletion-requests');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const pending = (data?.items ?? []).filter((r) => r.status === 'pending');
  if (!pending.length && !err) return null;

  async function erase(r: Req) {
    const word = 'احذف';
    // eslint-disable-next-line no-alert
    if (r.contactExists && window.prompt(`اكتب «${word}» لحذف بيانات هذا الزبون نهائيّا. لا يسحب.`)?.trim() !== word) return;
    setBusy(r.id); setErr(null);
    try {
      if (r.contactExists && r.contactId) await del(`/contacts/${r.contactId}`);
      await post(`/deletion-requests/${r.id}/resolve`, { status: 'done' });
      await reload(); onChanged?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر التنفيذ.');
    } finally { setBusy(null); }
  }

  async function refuse(r: Req) {
    setBusy(r.id); setErr(null);
    try {
      await post(`/deletion-requests/${r.id}/resolve`, { status: 'refused', note });
      setRefusing(null); setNote('');
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر الحفظ.');
    } finally { setBusy(null); }
  }

  return (
    <Section title="طلبات حذف البيانات" sub={`${fmt.num(pending.length)} بانتظارك — نفّذها خلال 30 يوما كما تعد صفحتك.`}>
      <Stack gap="sm">
        {err && <Note tone="crit">{err}</Note>}
        {pending.map((r) => (
          <div key={r.id} className="del-req">
            <Row gap="sm">
              <Pill tone="warn" label="طلب حذف" />
              <b dir="auto">{r.contactName ?? r.handle ?? 'زبون'}</b>
              {r.handle && r.contactName && <span className="muted-p" dir="ltr">{r.handle}</span>}
              <span className="muted-p">{fmt.when(r.createdAt)}</span>
            </Row>
            {r.detail && <p className="muted-p" dir="auto">«{r.detail}»</p>}
            {refusing === r.id ? (
              <Stack gap="xs">
                <Field id={`dr-note-${r.id}`} label="سبب الرفض — يحقّ للزبون أن يعرفه">
                  <Input id={`dr-note-${r.id}`} value={note} onChange={setNote} />
                </Field>
                <Row gap="sm">
                  <Button busy={busy === r.id} disabled={!note.trim()} reason="اكتب السبب." onClick={() => void refuse(r)}>احفظ الرفض</Button>
                  <Button onClick={() => { setRefusing(null); setNote(''); }}>تراجع</Button>
                </Row>
              </Stack>
            ) : (
              <Row gap="sm">
                <Button variant="danger" busy={busy === r.id} disabled={readOnly} reason={readOnly ? 'حسابك للقراءة فقط' : undefined}
                  onClick={() => void erase(r)}>
                  {r.contactExists ? 'احذف بياناته وأغلق الطلب' : 'حذفت بياناته — أغلق الطلب'}
                </Button>
                <Button disabled={readOnly} onClick={() => setRefusing(r.id)}>ارفض مع السبب</Button>
              </Row>
            )}
          </div>
        ))}
      </Stack>
    </Section>
  );
}
