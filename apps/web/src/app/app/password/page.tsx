'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { post, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import {
  Alert, Button, Dock, Field, FormInput, Meter, Note, Skeleton, Tag,
} from '@/components/ui';

/**
 * تغيير كلمة السرّ — **بوّابةٌ ولوحُ إعداداتٍ في عقدةٍ واحدة**.
 *
 * ★ وُجدت لأنّ `mustChangePassword` كان يُكتب ويُرسَل ولا يُقرأ — فمن أُنشئ له
 *   حسابٌ بكلمةٍ مؤقّتة يبقى عليها إلى الأبد، وهي كلمةٌ يعرفها من أنشأ الحساب
 *   ومرّت في نصٍّ صريح على شاشةٍ وربّما في رسالة.
 *
 * ★ ولا نفرض «حرفٌ كبير ورقمٌ ورمز»: التعقيد المفروض يُنتج كلماتٍ أسوأ تُكتب
 *   على ورقةٍ بجانب الشاشة. الطول وحده هو ما يُقاوم، فنقيسه ونشرحه.
 *
 * ── العطلُ الذي أُصلح هنا: «بوّابةٌ» بلا بابٍ ────────────────────────────────
 *   كانت الشاشةُ تُفتح **داخل القشرة كاملةً**: التنقّلُ حاضرٌ وعدّادُ السقف
 *   وزرُّ الخروج. فمن دخل بكلمةٍ مؤقّتة يضغط «الإنبوكس» فيمضي، وتبقى الكلمةُ
 *   التي يعرفها غيرُه صالحةً إلى الأبد — أي أنّ الخطوة كانت **اقتراحاً**
 *   مكتوباً بنبرة إلزام. وصارت الآن بوّابةً: `?first=1` يجعل الشاشةَ حواراً
 *   `aria-modal` يغطّي القشرة، فلا سطحَ يُضغَط خلفه ولا تنقّلَ يُخرج منها.
 *
 *   ولا شجرةَ ثانية: **نفسُ العقدة** تخدم البوّابةَ ولوحَ الإعدادات، والفرقُ
 *   صنفٌ على الجذر (`.auth-gate`) — كما يدور تنقّلُ القشرة نفسُه من شريطٍ
 *   سفليٍّ إلى رصيفٍ جانبيّ بلا عقدتَين تتبادلان.
 *
 * ── وما يبقى **خارج** هذه الشاشة، فلا يُدَّعى أنّه أُصلح ─────────────────────
 *   البوّابةُ تُغلق على من وصل إليها؛ ومن يكتب `/app/inbox` في العنوان لا يزال
 *   يمرّ، لأنّ `/me` لا يُرجع `mustChangePassword` أصلاً (`apps/api/src/auth.ts`
 *   يرسلها في ردّ الدخول وحده)، فلا يملك `Shell` ما يحرس به. وحرسٌ حقيقيٌّ
 *   يحتاج الحقلَ في `/me` ثمّ شرطاً في القشرة — وكلاهما خارج هذه الشاشة
 *   وخارج ورقتها.
 */

/** أدنى ما يقبله الخادم (`apps/api/src/auth.ts`) — والرقمان واحدٌ لا اثنان. */
const MIN = 10;
/** ونقطةُ الراحة: خطُّ أساسٍ ثانٍ يُقاس عليه الرقمُ البطوليّ، لا شرطٌ يُفرَض. */
const EASY = 14;

/**
 * تمييزُ المعدود — طباعةٌ لا تجميل. «1 محارف» تُقرأ خطأً، وهي أوّلُ ما يُقرأ
 * في الشاشة لأنّها تحت الرقم البطوليّ. وثلاثُ صيغٍ تكفي مدى هذه الشاشة.
 */
function charUnit(n: number): string {
  if (n === 1) return 'محرف';
  if (n === 2) return 'محرفان';
  if (n <= 10) return 'محارف';
  return 'محرفاً';
}

interface Grade {
  pct: number;
  tone: 'crit' | 'warn' | 'ok';
  /** وسمُ حالةٍ — شكلٌ ونصٌّ معاً، فلا يُحمَل المعنى باللون */
  badge: string;
  /** **عاقبةٌ لا حالة**: ما يحدث لهذه الكلمة، لا اسمُ درجتها */
  said: string;
}

/**
 * مقياسٌ يشرح ولا يمنع — والطول هو ما يُقاوم فعلاً.
 *
 * ★ كان المقياس **يقفز قفزةً مصطنعة**: `pct` يُضرب بـ0.5 تحت الحدّ الأدنى،
 *   فعند المحرف العاشر يتضاعف الشريطُ في خطوةٍ واحدةٍ بلا أن يتضاعف شيءٌ في
 *   الكلمة. وأثرُه أنّه يُقرأ **خللاً في المقياس** لا تقدّماً في الكلمة: من
 *   يرى شريطاً ينقز نصفَ عرضه بمحرفٍ واحدٍ يتوقّف عن الثقة به فلا يقرأه بعدها.
 *   والاطّرادُ (كلّ محرفٍ يزيده ولا يُنقصه، وبلا قفزةٍ عند حدّ) هو شرطُ أن
 *   يُقرأ المقياسُ مقياساً. والحدُّ الأدنى يُقال **نصّاً وشكلاً ولوناً** —
 *   ثلاثةُ ترميزاتٍ — لا بكسرةٍ في الرسم.
 */
function strength(pw: string): Grade {
  const len = pw.length;
  /* التنوّعُ مسقوفٌ **قبل** القسمة: بلا سقفٍ يقدر الحدُّ الثاني على تعويض
     الطول، والطولُ هو ما يُقاوم — فلا يُشترى بتنوّعٍ في كلمةٍ قصيرة. */
  const unique = Math.min(new Set(pw).size, 14);
  const pct = Math.min(1, (len / 18) * 0.78 + (unique / 14) * 0.22);

  if (len < MIN) {
    return {
      pct,
      tone: 'crit',
      badge: 'أقصر من الحدّ',
      said: 'يرفضها الخادم — وتُخمَّن آليّاً في دقائق لو قبلها.',
    };
  }
  if (len < EASY) {
    return {
      pct,
      tone: 'warn',
      badge: 'مقبولة',
      said: 'تصمد أمام التخمين الآليّ — وكلّ محرفٍ تزيده يضاعف زمنه.',
    };
  }
  return {
    pct,
    tone: 'ok',
    badge: 'قويّة',
    said: 'خارج مدى التخمين الآليّ عمليّاً — ولا تحتاج رموزاً ولا أرقاماً.',
  };
}

function PasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { reload } = useSession();
  /* ★ هذا هو المفتاح الذي يقلب الشاشةَ بوّابةً: يأتي من تحويل الدخول وحده. */
  const first = params.get('first') === '1';

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  /* كشفٌ منفصلٌ للقديمة، وكشفٌ **واحدٌ** للجديدة وتأكيدها: كشفُ إحداهما دون
     الأخرى يجعل المقارنة بالعين مستحيلةً وهي كلُّ غرض حقل التأكيد. */
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const s = strength(next);
  const mismatch = again.length > 0 && again !== next;
  const same = next.length > 0 && next === current;
  const ready = current.length > 0 && next.length >= MIN && !same && !mismatch && again.length > 0;

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
    <div
      className={`auth${first ? ' auth-gate' : ''}`}
      /* ★ الحوارُ يُعلَن للقارئ الصوتيّ لا للفأرة وحدها: الغطاءُ يمنع الضغط،
         و`aria-modal` هو ما يُخرج القشرةَ من شجرة القراءة. وبلاه يسمع
         المستخدمُ تنقّلاً يراه هو ولا يراه من يبصر. */
      role={first ? 'dialog' : undefined}
      aria-modal={first || undefined}
      aria-labelledby={first ? 'pw-title' : undefined}
    >
      <form className={`authcard${first ? '' : ' authcard-in'}`} onSubmit={submit}>
        {/* الترويسة في البوّابة وحدها: داخل القشرة تحملها القشرةُ، وتكرارُها
            يقول «تطبيقان» في شاشةٍ واحدة. */}
        {first && (
          <header className="auth-top">
            <b className="auth-mark">AiBot</b>
            <span className="auth-org">خطوةٌ واحدةٌ قبل أن تبدأ</span>
          </header>
        )}

        <div className="auth-b">
          <div className="auth-h">
            <h1 id={first ? 'pw-title' : undefined}>
              {first ? 'اختر كلمة سرّك' : 'تغيير كلمة السرّ'}
            </h1>
            <p>
              {first
                ? 'دخلتَ بكلمةٍ مؤقّتة أنشأها لك غيرك — وهي معروفةٌ له. اختر كلمتك الآن.'
                : 'الكلمة القديمة مطلوبةٌ دائماً، وكلّ جلساتك الأخرى تُبطَل بعد التغيير.'}
            </p>
          </div>

          {error && <Alert tone="crit">{error}</Alert>}

          {first && (
            <Note tone="warn">
              <b>لماذا الآن ولا نُؤجّل.</b> الكلمة المؤقّتة عبرت شاشةً وربّما رسالة، ويعرفها
              من أنشأ حسابك. حسابك يفتح محادثات زبائنك — فهذه الخطوة ليست إجراءً شكليّاً،
              ولا تُخطّى.
            </Note>
          )}

          <Field
            id="pw-cur"
            label={first ? 'الكلمة المؤقّتة' : 'كلمة السرّ الحاليّة'}
            hint="مطلوبةٌ دائماً — فتوكنٌ مسروقٌ وحده لا يكفي لخطف حسابك."
          >
            <div className="auth-secret">
              <FormInput
                id="pw-cur"
                name="current-password"
                type={showCur ? 'text' : 'password'}
                value={current}
                onChange={setCurrent}
                autoComplete="current-password"
                enterKeyHint="next"
                autoFocus={first}
                required
                invalid={Boolean(error)}
              />
              <button
                type="button"
                className="btn quiet sm"
                aria-pressed={showCur}
                aria-controls="pw-cur"
                onClick={() => setShowCur((v) => !v)}
              >
                {showCur ? 'أخفِ' : 'أظهِر'}
              </button>
            </div>
          </Field>

          <Field
            id="pw-new"
            label="كلمة السرّ الجديدة"
            hint={`${MIN} محارف على الأقلّ. ولا نفرض رموزاً: التعقيد المفروض يُنتج كلماتٍ تُكتب على ورقة. الطول هو ما يُقاوم.`}
            error={same ? 'هذه هي كلمتك الحاليّة.' : undefined}
          >
            <div className="auth-secret">
              <FormInput
                id="pw-new"
                name="new-password"
                type={showNew ? 'text' : 'password'}
                value={next}
                onChange={setNext}
                /* `new-password` هي ما يجعل مديرَ كلمات السرّ **يقترح** كلمةً
                   طويلةً ويحفظها — وهي أقصرُ طريقٍ إلى كلمةٍ لا تُكتب على ورقة. */
                autoComplete="new-password"
                enterKeyHint="next"
                required
                invalid={same}
              />
              <button
                type="button"
                className="btn quiet sm"
                aria-pressed={showNew}
                aria-controls="pw-new pw-again"
                onClick={() => setShowNew((v) => !v)}
              >
                {showNew ? 'أخفِ' : 'أظهِر'}
              </button>
            </div>
          </Field>

          {/* ★ الرقمُ البطوليّ — واحدٌ في الشاشة، ويُختار بالحالة: سؤالُ هذه
              الشاشة الوحيد «هل كلمتك طويلةٌ كفايةً؟» فالطولُ هو الرقم. ولا
              يظهر قبل أوّل محرف: لا حالةَ تُقاس، ورقمٌ صفريٌّ بحجم 48 يُقرأ
              خللاً. ومعه سياقُه ملاصقاً: عاقبةٌ ثمّ خطَّا أساسٍ ثمّ مقياس. */}
          {next.length > 0 && (
            <div className={`auth-hero ${s.tone}`}>
              <span className="ah-v">
                {/* العازلُ أرقامٌ خالصة، والوحدةُ العربيّة **خارجه** دائماً */}
                <span className="num">{next.length}</span>
                <small>{charUnit(next.length)}</small>
              </span>
              {/* يُنطَق عند عبور العتبة وحدها — والرقمُ يتغيّر بكلّ ضغطة،
                  فلو كان الحيُّ على الكتلة كلّها لصار ثرثرةً تُطفئ المعنى. */}
              <span className="ah-k" aria-live="polite">{s.said}</span>
              <Meter pct={s.pct} tone={s.tone} />
              <p className="ah-c">
                <Tag tone={s.tone} label={s.badge} />
                <span>
                  الحدّ الأدنى <span className="num">{MIN}</span>، والمريح{' '}
                  <span className="num">{EASY}</span>. والطولُ وحده هو ما يُقاوم.
                </span>
              </p>
            </div>
          )}

          <Field
            id="pw-again"
            label="أعِد كتابتها"
            hint="تظهر وتُخفى مع الكلمة الجديدة — فالمقارنة بالعين هي غرضُ هذا الحقل."
            error={mismatch ? 'الكلمتان غير متطابقتين.' : undefined}
          >
            <FormInput
              id="pw-again"
              name="confirm-password"
              type={showNew ? 'text' : 'password'}
              value={again}
              onChange={setAgain}
              autoComplete="new-password"
              enterKeyHint="go"
              required
              invalid={mismatch}
            />
          </Field>

          {/* طيٌّ تدريجيّ: عاقبةٌ تُقرأ مرّةً، ولا قرارَ يُتّخذ عليها الآن */}
          <details className="auth-fold">
            <summary>ماذا يحدث بعد الحفظ؟</summary>
            <p>
              كلّ جلساتك الأخرى تُبطَل فوراً — على أيّ جهازٍ أو متصفّح. وجلستك هنا
              تبقى، فلا تُطرَد من فعلك أنت. وهذا هو المقصود: تغييرُ كلمةِ سرٍّ لا
              يُخرج المتسلّل تغييرٌ شكليّ.
            </p>
          </details>
        </div>

        {/* الرصيف: الفعلُ الأوّل تحت الإبهام، وعاقبتُه مكتوبةٌ قبل الضغط */}
        <Dock hint="بعد الحفظ تُبطَل كلّ جلساتك الأخرى — وجلستك هنا تبقى.">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            wide
            busy={busy}
            disabled={!ready}
            reason="أكمِل الحقول الثلاثة — والجديدة تختلف عن القديمة وتطابق تأكيدها"
          >
            احفظ كلمة السرّ
          </Button>
        </Dock>
      </form>
    </div>
  );
}

export default function PasswordPage() {
  return (
    <Suspense
      fallback={(
        <div className="auth">
          <div className="authcard authcard-in">
            <div className="auth-b"><Skeleton rows={5} /></div>
          </div>
        </div>
      )}
    >
      <PasswordForm />
    </Suspense>
  );
}
