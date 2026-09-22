'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { post, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import {
  PageHead, Stack, Card, Field, Input, Button, Note, Skeleton, Meter,
} from '@/components/ui';

/**
 * تغيير كلمة السرّ.
 *
 * ★ وُجدت لأنّ `mustChangePassword` كان يُكتب ويُرسَل ولا يُقرأ — فمن أُنشئ له
 *   حسابٌ بكلمةٍ مؤقّتة يبقى عليها إلى الأبد، وهي كلمةٌ يعرفها من أنشأ الحساب
 *   ومرّت في نصٍّ صريح على شاشةٍ وربّما في رسالة.
 *
 * ★ ولا نفرض «حرفٌ كبير ورقمٌ ورمز»: التعقيد المفروض يُنتج كلماتٍ أسوأ تُكتب
 *   على ورقةٍ بجانب الشاشة. الطول وحده هو ما يُقاوم، فنقيسه ونشرحه.
 */

const MIN = 10;

/** مقياسٌ يشرح ولا يمنع — والطول هو ما يُقاوم فعلاً. */
function strength(pw: string): { pct: number; label: string; tone: 'crit' | 'warn' | 'ok' } {
  const unique = new Set(pw).size;
  const score = Math.min(1, (pw.length / 18) * 0.75 + (unique / 14) * 0.25);
  if (pw.length < MIN) return { pct: score * 0.5, label: `أقصر من ${MIN} محارف`, tone: 'crit' };
  if (pw.length < 14) return { pct: score, label: 'مقبولة — وأطول أفضل', tone: 'warn' };
  return { pct: score, label: 'قويّة', tone: 'ok' };
}

function PasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { reload } = useSession();
  const first = params.get('first') === '1';

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const s = strength(next);
  const mismatch = again.length > 0 && again !== next;
  const ready = current.length > 0 && next.length >= MIN && next !== current && !mismatch && again.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await post('/auth/password', { current, next });
      await reload();
      router.replace('/app');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تغيير كلمة السرّ.');
      setBusy(false);
    }
  }

  return (
    <Stack gap="lg">
      <PageHead
        title={first ? 'اختر كلمة سرّك' : 'تغيير كلمة السرّ'}
        sub={first
          ? 'دخلتَ بكلمةٍ مؤقّتة أنشأها لك غيرك — وهي معروفةٌ له. اختر كلمتك الآن.'
          : 'الكلمة القديمة مطلوبةٌ دائماً، وكلّ جلساتك الأخرى تُبطَل بعد التغيير.'}
      />

      {first && (
        <Note tone="warn">
          <b>لماذا الآن ولا نُؤجّل.</b> الكلمة المؤقّتة عبرت شاشةً وربّما رسالة، ويعرفها
          من أنشأ حسابك. حسابك يفتح محادثات زبائنك — فهذه الخطوة ليست إجراءً شكليّاً.
        </Note>
      )}

      <Card>
        <form onSubmit={submit} noValidate>
          <Stack gap="md">
            {error && <Note tone="crit">{error}</Note>}

            <Field
              id="pw-cur"
              label={first ? 'الكلمة المؤقّتة' : 'كلمة السرّ الحاليّة'}
              hint="مطلوبةٌ دائماً — فتوكنٌ مسروقٌ وحده لا يكفي لخطف حسابك."
            >
              <Input id="pw-cur" type="password" value={current} onChange={setCurrent} required />
            </Field>

            <Field
              id="pw-new"
              label="كلمة السرّ الجديدة"
              hint={`${MIN} محارف على الأقلّ. ولا نفرض رموزاً: التعقيد المفروض يُنتج كلماتٍ تُكتب على ورقة. الطول هو ما يُقاوم.`}
              error={next.length > 0 && next === current ? 'هذه هي كلمتك الحاليّة.' : undefined}
            >
              <Input id="pw-new" type="password" value={next} onChange={setNext} required />
            </Field>

            {next.length > 0 && (
              <Stack gap="xs">
                <Meter pct={s.pct} tone={s.tone} />
                <span className="muted-p">{s.label}</span>
              </Stack>
            )}

            <Field
              id="pw-again"
              label="أعِد كتابتها"
              error={mismatch ? 'الكلمتان غير متطابقتين.' : undefined}
            >
              <Input id="pw-again" type="password" value={again} onChange={setAgain} required />
            </Field>

            <Button
              type="submit" variant="primary" busy={busy} disabled={!ready}
              reason="أكمِل الحقول الثلاثة — والجديدة تختلف عن القديمة وتطابق تأكيدها"
            >
              احفظ كلمة السرّ
            </Button>
          </Stack>
        </form>
      </Card>

      <Note>
        <b>ماذا يحدث بعد الحفظ.</b> كلّ جلساتك الأخرى تُبطَل فوراً — على أيّ جهازٍ أو متصفّح.
        وجلستك هنا تبقى، فلا تُطرَد من فعلك أنت. تغييرُ كلمةِ سرٍّ لا يُخرج المتسلّل تغييرٌ شكليّ.
      </Note>
    </Stack>
  );
}

export default function PasswordPage() {
  return (
    <Suspense fallback={<Skeleton rows={5} />}>
      <PasswordForm />
    </Suspense>
  );
}
