'use client';

import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type {
  OutboundMessage, PlaygroundChunk, PlaygroundToolCall, PlaygroundTrace, PlaygroundUse,
} from '@aibot/shared';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { post, ApiError } from '@/lib/api';
/* المصطلحُ يُستورَد: كانت هذه الشاشةُ تكتب «توكن» في ستّة عشر موضعاً
   وتُعرّف خريطةَ أسماءِ أوضاعٍ ثانيةً بصياغةٍ أخرى. */
import {
  KB_MODE, KB_MODE_TERM, READ_UNIT, READ_UNIT_ACC, READ_UNIT_PL, secs,
} from '@/lib/terms';
import {
  PageHead, Stack, Row, Pill, Tag, Note, Button, Sheet, Empty, Skeleton, ErrorBox,
  KV, KVRow, Iso, Field, TextArea,
} from '@/components/ui';
import { Band, Hero, Section, Rows, MetricRow, Fold, ScreenDock, ChipRow, Vital, type Sev } from '@/components/screen';

/**
 * الساحة — الشاشة التي تبيع المنتج.
 *
 * ★ **لماذا توجد.** صاحب النشاط يضبط شخصيّةَ بوته ومعرفتَه وأدواته، ولا يعرف
 *   **ماذا سيقول للزبون** إلّا حين يقوله لزبونٍ حقيقيّ — أي أنّ أوّلَ مَن
 *   يكتشف الخطأ زبونٌ يخسره. والساحةُ تُزيل هذا الرعب: يجرّب، ويرى الردّ،
 *   ويرى **لماذا** كان الردّ هكذا، ويعدّل قبل أن يكلّفه خطأٌ زبوناً.
 *
 * ★ **ولوحُ «لماذا» هو المنتج هنا، لا الردّ.** «البوت ردّ كذا» لا يساوي شيئاً:
 *   لا يُعلّم صاحبَ النشاط كيف يُحسّن معرفته ولا شخصيّته. فاللوحُ يقول، لكلّ
 *   ردٍّ على حِدة: أيَّ مقاطع معرفةٍ استُرجعت وبأيّ درجة · أيَّ أدواتٍ نوديت
 *   وبأيّ وسائط وماذا أعادت · كم توكناً وبكم · وأيَّ حارسٍ تدخّل إن تدخّل.
 *   وكلُّ سطرٍ فيه **عاقبةٌ لا حالة**: «قال لا أعرف» ثمّ «معرفتُه ناقصةٌ لهذا
 *   السؤال — أضِف الجواب».
 *
 * ★ **والقيدُ الحاكم مكتوبٌ في الشاشة لا مُخفًى**: الساحة لا تُرسل شيئاً إلى
 *   واتساب ولا إنستجرام، ولا تُنشئ محادثةً، ولا تفتح نافذةً مفوترة —
 *   والتوكنز **تُحاسَب** لأنّ النداء حقيقيّ. وذلك مكتوبٌ في رصيف الشاشة
 *   وفي صفّ «ما أنفقته الساحة»، فلا يُفاجأ أحدٌ بفاتورةٍ من زرّ تجربة.
 *
 * ★ **والأنواع مستورَدةٌ من `@aibot/shared`** لا مكتوبةٌ هنا: نفسُ العقد يقرأه
 *   العاملُ (يكتبه) والـAPI (يمرّره) وهذه الشاشة (ترسمه). ونسخُه هنا بيدٍ
 *   يعني حقلاً يُضاف في العامل ولا يُقرأ هنا بلا أن يفشل شيء — وهو بعينه
 *   التباعدُ الذي تحرسه هذه المدوّنة في كلّ طبقة.
 */

type Use = PlaygroundUse;

interface Summary {
  botEnabled: boolean;
  draft: {
    personaChars: number; kbChars: number; kbTokens: number; model: string;
    modeAfterPublish: 'full' | 'hybrid' | 'rag'; differs: boolean;
  } | null;
  published: {
    version: number; provider: string; model: string;
    knowledgeMode: 'full' | 'hybrid' | 'rag'; embedStatus: string;
    publishedAt: string | null; kbTokens: number;
  } | null;
  channel: { kind: string | null; connected: boolean; maxTextLen: number };
  tools: Array<{ key: string; titleAr: string; confirmRequired: boolean; live: boolean; disabledReason: string | null }>;
  knowledge: { sources: number; chunks: number };
  presets: Array<{ text: string; kind: 'real' | 'common' }>;
  spend: { runs: number; tokens: number; usd: number };
  liveAvg: { runs: number; tokens: number; usd: number } | null;
}

/** دورةٌ في جلسة الجرّب — تعيش في الشاشة ولا صفَّ لها في قاعدة. */
interface Turn {
  id: number;
  ask: string;
  trace: PlaygroundTrace | null;
  error: string | null;
}


export default function PlaygroundPage() {
  const sum = useApi<Summary>('/playground');
  const { toast, node: toastNode } = useToast();

  const [pick, setPick] = useState<Use | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [fixFor, setFixFor] = useState<Turn | null>(null);
  const [answer, setAnswer] = useState('');
  const [fixing, setFixing] = useState(false);
  const seq = useRef(0);

  const data = sum.data;
  /* الافتراضُ **محسوبٌ من الحالة** لا مثبَّت: من له مسوّدةٌ تختلف يجرّبها (وهي
     أكبرُ قيمةِ الساحة)، ومن لا مسوّدةَ له يجرّب المنشورة. */
  const auto: Use = data?.draft && (data.draft.differs || !data.published) ? 'draft' : 'published';
  const use: Use = pick ?? auto;

  const last = [...turns].reverse().find((t) => t.trace)?.trace ?? null;
  const pending = turns.some((t) => !t.trace && !t.error);

  async function run(ask: string) {
    const body = ask.trim();
    if (!body || busy) return;
    const id = (seq.current += 1);
    /* التاريخُ يُبنى **قبل** إضافة الدور: كلُّ دورةٍ سؤالٌ وردُّه، وما فشل لا
       يدخل السياق — فلا يتعلّم البوت من فراغ. */
    const history = turns.flatMap((t) => (t.trace
      ? [
        { role: 'user' as const, text: t.ask },
        { role: 'model' as const, text: t.trace.reply.text },
      ]
      : []));

    setTurns((prev) => [...prev, { id, ask: body, trace: null, error: null }]);
    setText('');
    setBusy(true);
    try {
      const trace = await post<PlaygroundTrace>('/playground/run', { text: body, use, history });
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, trace } : t)));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'تعذّر تشغيل التجربة.';
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, error: msg } : t)));
    } finally {
      setBusy(false);
      // عدّادُ ما أنفقته الساحة يتحرّك مع كلّ تجربة — فيُقرأ حيّاً لا شهريّاً
      void sum.reload();
    }
  }

  async function addKnowledge() {
    const t = fixFor;
    if (!t || !answer.trim()) return;
    setFixing(true);
    try {
      await post('/playground/knowledge', { question: t.ask, answer });
      setFixFor(null);
      setAnswer('');
      // الإضافةُ في المسوّدة — فالجرّب ينتقل إليها، وإلّا جرّب المنشورةَ ولم يرَ فرقاً
      setPick('draft');
      setText(t.ask);
      void sum.reload();
      toast('أُضيفت إلى مسوّدة معرفتك. اضغط «جرّب» لترى الفرق، ثمّ انشر لتصل زبائنك.');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّرت الإضافة.');
    } finally {
      setFixing(false);
    }
  }

  if (sum.loading) return <Skeleton rows={5} />;
  if (sum.error) return <ErrorBox message={sum.error} onRetry={sum.reload} />;
  if (!data) return null;

  const hasAny = Boolean(data.draft || data.published);
  const kbTokens = use === 'draft'
    ? data.draft?.kbTokens ?? 0
    : data.published?.kbTokens ?? 0;
  const liveTools = data.tools.filter((t) => t.live);

  /* ══════════ الشريط الحاكم — «في شيء يحتاجني؟» قبل أيّ رقم ══════════
     والترتيبُ: **ما وقع** يسبق ما يُتوقَّع. حارسٌ تدخّل في آخر تجربةٍ خبرٌ
     واقعٌ الآن؛ و«تجرّب المسوّدة» تنبيهٌ دائمٌ لا حدث. */
  const band = bandOf({ data, use, last, hasAny });

  /* ══════════ البطوليّ — واحدٌ يُختار بالحالة ══════════
     وما يهمّ من يجرّب بوته يتبدّل بحالته: قبل أوّل تجربةٍ الرقمُ هو **ما
     يدفعه قبل أن يسأل الزبون** (معرفةٌ تُحقن مع كلّ ردّ)؛ وبعد تجربةٍ ناجحةٍ
     هو **كلفةُ الردّ بالتوكنز** مقيسةً على ردٍّ حقيقيّ؛ وحين يقول البوت «لا
     أعرف» فالخبرُ ليس الكلفة بل **أنّ المعرفة لم تُسنِد الردّ** — فيتبدّل
     البطوليّ إليها. */
  const hero = heroOf({ data, use, last, kbTokens });

  return (
    <Stack gap="lg">
      {toastNode}
      <PageHead
        title="الساحة"
        sub="جرّب بوتك كما يجرّبه زبون — وانظر لماذا ردّ هكذا قبل أن يكلّفك الخطأُ زبوناً."
        actions={<Pill tone="neutral" mark={false} label={use === 'draft' ? 'المسوّدة' : `النسخة ${data.published?.version ?? 0}`} />}
      />

      <Band sev={band.sev} head={band.head} sub={band.sub} />

      <Hero
        sev={hero.sev}
        value={hero.value}
        unit={hero.unit}
        label={hero.label}
        ctx={hero.ctx}
      />

      <Section
        title="الحوار التجريبيّ"
        sub={turns.length
          ? <><span className="num">{fmt.num(turns.length)}</span> تجربةً في هذه الجلسة — ولا أثرَ لها في إنبوكسك</>
          : 'لا شيء يُرسَل، ولا محادثةٌ تُخلَق'}
      >
        {!turns.length ? (
          <Empty
            title={hasAny ? 'اكتب سؤالاً كما يكتبه زبون' : 'لا بوتَ لتجرّبه بعد'}
            hint={hasAny
              ? 'أو اختر سؤالاً جاهزاً من الرصيف أسفل. ستظهر هنا ردودُ بوتك — وبجانب كلّ ردٍّ لوحٌ يقول لماذا ردّ هكذا: أيَّ معرفةٍ استعمل، وأيَّ أداةٍ نادى، وكم كلّف.'
              : 'الساحة تجرّب ما هو مكتوبٌ فعلاً. اكتب شخصيّةَ بوتك ومعرفتَه في شاشة البوت، ثمّ عُد إلى هنا قبل أن تنشر.'}
            action={hasAny
              ? <Button onClick={() => setPresetsOpen(true)}>افتح الأسئلة الجاهزة</Button>
              : <Link className="btn quiet sm sc-link" href="/app/bot">اذهب إلى شاشة البوت</Link>}
          />
        ) : (
          <div className="pg-thread">
            {turns.map((t) => (
              <div className="pg-turn" key={t.id}>
                <div className="pg-said">
                  <div className="ibx-msg in">
                    <div className="bub in" dir="auto">{t.ask}</div>
                    <div className="mt"><span className="src">أنت بدور زبون</span></div>
                  </div>

                  {t.error && (
                    <div className="ibx-msg sys">
                      <div className="bub sys" dir="auto">{t.error}</div>
                    </div>
                  )}

                  {!t.trace && !t.error && <Skeleton rows={2} height={38} />}

                  {t.trace && <Reply trace={t.trace} />}
                </div>

                <div className="pg-why">
                  {t.trace
                    ? <Why trace={t.trace} onWrong={() => { setFixFor(t); setAnswer(''); }} />
                    : <p className="muted-p">لوحُ «لماذا» يظهر مع الردّ: المعرفةُ المستعملة، والأدواتُ المناداة، والكلفة، والحرّاس.</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="ما تُجرّبه الآن" sub="نفسُ ما سيُشغَّل على الزبون — بلا إرسال">
        <Rows>
          {/* ★ اسمُ النموذج في عمود السياق لا في عمود القيمة: القيمةُ رُتبةٌ
              طباعيّةٌ للأرقام (‏`--t-val`)، وسلسلةُ اسمٍ فيها تدفع الصفَّ. */}
          <MetricRow
            k={use === 'draft' ? 'المسوّدة' : `النسخة ${data.published?.version ?? 0}`}
            note={use === 'draft'
              ? 'لا يراها زبونٌ حتّى تنشرها — وهذه أكبرُ قيمةِ الساحة'
              : 'هذه هي التي تردّ على زبائنك الآن'}
            mid={(
              <span className="sc-ctx">
                النموذج <Iso text={use === 'draft' ? data.draft?.model ?? '—' : data.published?.model ?? '—'} /> ·
                {use === 'draft'
                  ? <> ستُنشَر بوضع <Tag line mark={false} label={KB_MODE[data.draft?.modeAfterPublish ?? 'full'].label} /></>
                  : <> {KB_MODE_TERM} <Tag line mark={false} label={KB_MODE[data.published?.knowledgeMode ?? 'full'].label} /></>}
              </span>
            )}
          />

          <MetricRow
            k="معرفتُها"
            note={use === 'draft'
              ? 'تُحقن كاملةً في الجرّب — فلا تُضمَّن مسوّدةٌ قبل نشرها'
              : 'ما يقرأه البوت ليُجيب'}
            value={fmt.num(kbTokens)}
            unit={READ_UNIT}
            mid={(
              <span className="sc-ctx">
                {data.knowledge.sources
                  ? <><span className="num">{fmt.num(data.knowledge.sources)}</span> ملفَّ معرفةٍ مرفوعاً · </>
                  : null}
                {data.knowledge.chunks
                  ? <><span className="num">{fmt.num(data.knowledge.chunks)}</span> مقطعاً مُضمَّناً</>
                  : 'بلا مقاطعَ مُضمَّنة — المعرفةُ تُحقن كاملةً'}
              </span>
            )}
            href="/app/bot?tab=kb"
          />

          <MetricRow
            k="أدواتٌ معروضةٌ على البوت"
            note="ما لا يُعرَض لا يُنادى — والمعطَّلةُ لا تظهر له أصلاً"
            value={fmt.num(liveTools.length)}
            mid={(
              <span className="sc-ctx">
                {data.tools.length > liveTools.length
                  ? <><span className="num">{fmt.num(data.tools.length - liveTools.length)}</span> معطَّلةٌ لا يعرف بوجودها</>
                  : liveTools.length
                    ? liveTools.filter((t) => t.confirmRequired).length
                      ? <><span className="num">{fmt.num(liveTools.filter((t) => t.confirmRequired).length)}</span> منها تطلب تأكيدَ الزبون قبل التنفيذ</>
                      : 'كلُّها قراءةٌ بلا تأكيد'
                    : 'لا أدواتَ — يُجيب من معرفته وحدها'}
              </span>
            )}
            href="/app/bot?tab=tools"
          />

          <MetricRow
            k="ما أنفقته الساحة — هذا الشهر"
            note="نداءاتٌ حقيقيّةٌ تُحاسَب عليك، ولا تُفوتِر نافذةً من باقتك"
            value={fmt.num(data.spend.tokens)}
            unit={READ_UNIT}
            mid={(
              <span className="sc-ctx">
                <span className="num">{fmt.num(data.spend.runs)}</span> تجربةً ·
                {' '}<span className="num">{fmt.money(data.spend.usd)}</span>
              </span>
            )}
            href="/app/usage"
          />
        </Rows>
      </Section>

      <Fold summary="ما لا تفعله الساحة — ولماذا تُحاسَب مع ذلك">
        <Note>
          <b>لا شيء يخرج إلى قناة.</b> لا رسالةَ واتساب ولا إنستجرام، ولا محادثةٌ تُنشأ في
          إنبوكسك، ولا نافذةُ 24 ساعةٍ تُفتح — والنافذةُ هي وحدةُ فوترة باقتك، فالجرّب
          لا يستهلك منها شيئاً.
        </Note>
        <Note tone="warn">
          <b>ووحداتُ القراءة تُحاسَب.</b> النداءُ على النموذج حقيقيٌّ — وإلّا لم يكن جرّباً. وكلُّ
          تجربةٍ تُسجَّل موسومةً بأنّها جرّب، فتراها في استهلاكك منفصلةً عن ردودِ زبائنك.
        </Note>
        {last?.notes.map((n) => <Note key={n}>{n}</Note>)}
      </Fold>

      {/* ★ الرصيف: ما تُجرّبه وفعلُ الشاشة الأوّل معاً في مدى الإبهام. */}
      <ScreenDock hint={`جرّبٌ جافّ: لا يُرسَل شيءٌ لزبون. و${READ_UNIT_PL} تُحاسَب لأنّ النداء حقيقيّ.`}>
        {/* ★ غلافٌ واحدٌ للمرشِّح والمُنشئ: `.dock > *` يمنع النموَّ عن أبنائه
            المباشرين، فكان الرقاقاتُ والحقلُ يتنافسان على عرض الشريط الأفقيّ
            على الحاسوب — والحقلُ هو من ينهار (‏`min-width: 0`). */}
        <div className="pg-bar">
          <ChipRow label="ما تُجرّبه">
            {data.draft && (
              <button
                type="button" className="chipf" aria-pressed={use === 'draft'}
                onClick={() => setPick('draft')}
              >
                المسوّدة
              </button>
            )}
            {data.published && (
              <button
                type="button" className="chipf" aria-pressed={use === 'published'}
                onClick={() => setPick('published')}
              >
                النسخة <span className="num">{data.published.version}</span>
              </button>
            )}
            <button type="button" className="chipf" onClick={() => setPresetsOpen(true)}>
              أسئلة جاهزة
              {data.presets.length ? <span className="num">{data.presets.length}</span> : null}
            </button>
          </ChipRow>

          <form
            className="pg-comp"
            onSubmit={(e) => { e.preventDefault(); void run(text); }}
          >
            <textarea
              id="pg-ask"
              className="ibx-ta"
              value={text}
              dir="auto"
              rows={2}
              placeholder="اكتب رسالةَ الزبون…"
              disabled={!hasAny}
              onChange={(e) => setText(e.target.value)}
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              wide
              busy={busy || pending}
              disabled={!hasAny || !text.trim()}
              reason={!hasAny ? 'لا بوتَ لتجرّبه بعد' : !text.trim() ? 'اكتب رسالةً أوّلاً' : undefined}
            >
              جرّب
            </Button>
          </form>
        </div>
      </ScreenDock>

      {/* ورقةُ الأسئلة الجاهزة — وأصدقُها ما سأله زبونٌ فعلاً */}
      <Sheet
        open={presetsOpen}
        kind="menu"
        title="أسئلة جاهزة"
        onClose={() => setPresetsOpen(false)}
        hint={`الضغطُ يُشغّل التجربة فوراً — وكلُّ تجربةٍ نداءٌ يُحاسَب بـ${READ_UNIT_PL}.`}
        footer={<Button variant="quiet" onClick={() => setPresetsOpen(false)}>أغلِق</Button>}
      >
        <div className="opts">
          {data.presets.map((p) => (
            <button
              key={p.text}
              type="button"
              className="opt"
              disabled={busy || !hasAny}
              onClick={() => { setPresetsOpen(false); void run(p.text); }}
            >
              <span className="opt-t">
                <span dir="auto">{p.text}</span>
                <span className="opt-n">
                  {p.kind === 'real'
                    ? 'سألها زبونٌ فعلاً — من رسائلك الواردة'
                    : 'سؤالٌ شائعٌ في كلّ نشاط'}
                </span>
              </span>
              <span className="opt-ck" aria-hidden="true">←</span>
            </button>
          ))}
        </div>
      </Sheet>

      {/* ورقةُ «هذا الردّ خطأ» — الطريقُ من الخطأ إلى معرفةٍ أصحّ */}
      <Sheet
        open={Boolean(fixFor)}
        title="هذا الردّ خطأ"
        onClose={() => setFixFor(null)}
        hint="تُضاف إلى مسوّدة معرفتك — ثمّ جرّبها هنا، وانشر لتصل زبائنك."
        footer={(
          <Row gap="sm">
            <Button
              variant="primary"
              size="lg"
              wide
              busy={fixing}
              disabled={!answer.trim()}
              reason={!answer.trim() ? 'اكتب الجواب الصحيح أوّلاً' : undefined}
              onClick={() => void addKnowledge()}
            >
              أضِفها إلى المسوّدة
            </Button>
            <Button variant="quiet" onClick={() => setFixFor(null)}>أغلِق</Button>
          </Row>
        )}
      >
        <Stack gap="sm">
          <Field id="pg-q" label="سؤال الزبون" hint="كما كتبتَه في التجربة" labelless>
            <p className="pg-q" dir="auto">{fixFor?.ask ?? ''}</p>
          </Field>
          <Field id="pg-a" label="الجواب الصحيح" hint="بكلماتك — وبوتك يصوغه بشخصيّته">
            <TextArea
              id="pg-a"
              value={answer}
              onChange={setAnswer}
              rows={6}
              dir="auto"
              placeholder="مثال: التوصيل داخل عمّان بـ٢ دينار، ومجّاناً فوق ٢٠ ديناراً."
              count={{ used: answer.length, limit: 4000, unit: 'محرف' }}
            />
          </Field>
          <Note>
            <b>تذهب حيث يقرأ بوتك فعلاً.</b> تُكتب في مسوّدة معرفتك تحت عنوانِ السؤال —
            فلا تصل زبائنك حتّى تنشرها. وهذه هي الحلقة: أخطأ ⟵ أضِف ⟵ جرّب ⟵ انشر.
          </Note>
        </Stack>
      </Sheet>
    </Stack>
  );
}

/* ══════════════════ الشريط الحاكم ══════════════════ */

function bandOf({ data, use, last, hasAny }: {
  data: Summary; use: Use; last: PlaygroundTrace | null; hasAny: boolean;
}): { sev: Sev; head: ReactNode; sub: ReactNode } {
  if (!hasAny) {
    return {
      sev: 'bad',
      head: 'لا شخصيّةَ لبوتك بعد — فلا شيء يُجرَّب',
      sub: 'الساحة تُشغّل ما هو مكتوبٌ فعلاً. اكتب شخصيّته ومعرفتَه في شاشة البوت أوّلاً.',
    };
  }

  /* ما وقع في آخر تجربةٍ يسبق كلَّ تنبيهٍ دائم — وأوّلُ حارسٍ هو الأهمّ:
     الترتيبُ في العامل مقصودٌ (تسريبٌ ثمّ قصٌّ ثمّ تكرار… ثمّ «لا أعرف»). */
  const g = last?.guards[0];
  if (g) {
    return { sev: g.key === 'handoff' ? 'warn' : 'bad', head: g.label, sub: g.consequence };
  }

  if (!data.botEnabled) {
    return {
      sev: 'warn',
      head: 'بوتك مطفأٌ على قنواتك',
      sub: 'الساحة تعمل، والزبائن لا يرون شيئاً. شغّله من شاشة البوت حين ترضى عن ردوده.',
    };
  }

  if (data.published?.embedStatus === 'pending') {
    return {
      sev: 'warn',
      head: 'معرفةُ نسختك المنشورة قيد التجهيز',
      sub: 'الاسترجاع قد يرجع أقلَّ ممّا سيرجع بعد اكتماله — والنسخةُ السابقة تخدم زبائنك حتّى ذلك.',
    };
  }

  if (use === 'draft' && data.draft?.differs) {
    return {
      sev: 'plain',
      head: 'تجرّب المسوّدة — ولا يراها زبونٌ حتّى تنشرها',
      sub: data.published
        ? <>والذي يردّ على زبائنك الآن هو النسخة <span className="num">{data.published.version}</span>.</>
        : 'ولا نسخةَ منشورةً بعد — فبوتك لا يردّ على أحدٍ حتّى تنشر.',
    };
  }

  if (last) {
    return {
      sev: 'good',
      head: 'لا حارسَ تدخّل في آخر تجربة',
      sub: 'الردُّ خرج كما كتبه البوت — بلا قصٍّ ولا حذفٍ ولا تحويلٍ لموظّف.',
    };
  }

  return {
    sev: 'good',
    head: 'لا شيء يمنع التجربة',
    sub: 'اكتب سؤالاً كما يكتبه زبون — أو اختر سؤالاً سأله زبونٌ فعلاً من الرصيف أسفل.',
  };
}

/* ══════════════════ البطوليّ ══════════════════ */

function heroOf({ data, use, last, kbTokens }: {
  data: Summary; use: Use; last: PlaygroundTrace | null; kbTokens: number;
}): { sev: Sev; value: string; unit?: string; label: ReactNode; ctx: ReactNode } {
  /* ① قبل أوّل تجربة: ما تدفعه **قبل** أن يسأل الزبون. */
  if (!last) {
    if (!kbTokens) {
      return {
        sev: 'bad',
        value: '0',
        label: `${READ_UNIT_ACC} من المعرفة عند بوتك`,
        ctx: <>بلا معرفةٍ يُجيب من شخصيّته وحدها — وهذا أوّلُ سببٍ لـ«لا أعرف» في وجه زبون.</>,
      };
    }
    return {
      sev: 'plain',
      value: fmt.num(kbTokens),
      label: use === 'draft'
        ? `${READ_UNIT_ACC} من معرفتك تُحقن مع كلّ ردّ`
        : `${READ_UNIT_ACC} في معرفة نسختك المنشورة`,
      ctx: (
        <>
          الشخصيّةُ والأساسيّاتُ والقيودُ بادئةٌ ثابتةٌ تُخزَّن بخصم ·
          {data.liveAvg
            ? <> ووسطيُّ ردٍّ حقيقيٍّ عندك <span className="num">{fmt.num(data.liveAvg.tokens)}</span> {READ_UNIT_ACC} بـ<span className="num">{fmt.money(data.liveAvg.usd)}</span></>
            : <> ولا ردَّ حقيقيّاً بعد لتُقاس عليه — جرّب سؤالاً لتعرف كلفتَه</>}
        </>
      ),
    };
  }

  const unknown = last.guards.some((x) => x.key === 'unknown');
  const k = last.knowledge;

  /* ② «لا أعرف» — فالخبرُ ليس الكلفة بل أنّ المعرفة لم تُسنِد الردّ.
     والتشخيصُ يفترق بوضع المعرفة: في الحقن الكامل المعرفةُ **كلُّها** في
     السياق، فالنقصُ في محتواها لا في استرجاعها. وهذا الفرقُ يوفّر أسبوعاً. */
  if (unknown) {
    if (k.mode === 'full') {
      return {
        sev: 'bad',
        value: fmt.num(k.layers.core),
        label: `${READ_UNIT_ACC} من معرفتك كانت في السياق — وقال «لا أعرف»`,
        ctx: (
          <>
            المعرفةُ كلُّها محقونةٌ في هذا الوضع، فالنقصُ في محتواها لا في استرجاعها ·
            {' '}والكلفةُ دُفعت (<span className="num">{fmt.money(last.cost.usd)}</span>) والزبونُ لم يُجَب ·
            {' '}أضِف الجواب من «هذا الردّ خطأ»
          </>
        ),
      };
    }
    return {
      sev: 'bad',
      value: fmt.num(k.chunks.length),
      unit: k.chunksTotal ? `/ ${fmt.num(k.chunksTotal)}` : undefined,
      label: 'مقطعاً من معرفتك دخل الردّ — وقال «لا أعرف»',
      ctx: (
        <>
          {k.skipped
            ? 'تُخطّى الاسترجاعُ لقِصَر الرسالة — لا لفقدِ المعرفة'
            : k.chunks.length
              ? 'وجد ولم يُجب: راجع الشخصيّة أو تقطيعَ المعرفة'
              : 'بحث ولم يجد: المعرفةُ ناقصةٌ لهذا السؤال'}
          {' '}· والكلفةُ دُفعت (<span className="num">{fmt.money(last.cost.usd)}</span>)
        </>
      ),
    };
  }

  /* ③ تجربةٌ أجابت: الكلفةُ بالتوكنز، مقيسةً على ردٍّ حقيقيٍّ لا مطلقة. */
  const vs = data.liveAvg?.tokens ?? 0;
  return {
    sev: vs && last.cost.totalTokens > vs * 1.5 ? 'warn' : 'plain',
    value: fmt.num(last.cost.totalTokens),
    label: `${READ_UNIT_ACC} كلّفه هذا الردّ`,
    ctx: (
      <>
        {last.cost.priced
          ? <><span className="num">{fmt.money(last.cost.usd)}</span> لهذا الردّ · وألفُ ردٍّ مثلِه <span className="num">{fmt.money(last.cost.usd * 1000)}</span></>
          : <>لا سعرَ مسجَّلٌ لهذا النموذج — فالكلفةُ تُحسب صفراً</>}
        {vs
          ? <> · ووسطيُّ ردٍّ حقيقيٍّ عندك <span className="num">{fmt.num(vs)}</span> {READ_UNIT_ACC}</>
          : null}
        {last.cost.cachedTokens
          ? <> · منها <span className="num">{fmt.num(last.cost.cachedTokens)}</span> مخزَّنةٌ من قبل بخصم</>
          : null}
      </>
    ),
  };
}

/* ══════════════════ الردّ — بمفردات الإنبوكس نفسِها ══════════════════ */

/**
 * ★ نفسُ مفردات الإنبوكس (‏`.ibx-msg` · `.bub` · `.mt` · `.chips`): من يرى
 *   الجرّب يجب أن يرى **ما سيراه في إنبوكسه** لا شكلاً ثانياً — وإلّا صار
 *   للمنتج صوتان، وتعلَّم العميلُ مفردتَين لشيءٍ واحد.
 */
function Reply({ trace }: { trace: PlaygroundTrace }) {
  const parts: ReactNode[] = [];
  trace.reply.emits.forEach((m, i) => {
    parts.push(<Out key={`e${i}`} m={m} />);
  });
  if (trace.reply.text.trim()) {
    parts.push(
      <div className="ibx-msg bot" key="t">
        <div className="bub bot" dir="auto">{trace.reply.text}</div>
        <div className="mt">
          <span className="src">بوتك — لم يُرسَل</span>
          <span className="num">{(trace.cost.latencyMs / 1000).toFixed(1)}</span>
          <span>ث</span>
        </div>
      </div>,
    );
  }
  if (!parts.length) {
    parts.push(
      <div className="ibx-msg sys" key="n">
        <div className="bub sys">لم يُنتج البوت ردّاً — وفي الحيّ لا يصل الزبونَ شيء.</div>
      </div>,
    );
  }
  return <>{parts}</>;
}

function Out({ m }: { m: OutboundMessage }) {
  if (m.kind === 'choices') {
    return (
      <div className="ibx-msg bot">
        <div className="bub bot" dir="auto">
          {m.body}
          <span className="chips">
            {m.options.map((o) => <span className="c" key={o.id}>{o.title}</span>)}
            <span className="chips-n">كانت ستصل الزبونَ أزراراً — يضغط ولا يكتب</span>
          </span>
        </div>
        <div className="mt"><span className="src">أداةٌ أنتجتها — لم تُرسَل</span></div>
      </div>
    );
  }
  if (m.kind === 'location') {
    return (
      <div className="ibx-msg bot">
        <div className="bub bot" dir="auto">{m.name ?? 'موقعٌ على الخريطة'}{m.address ? ` — ${m.address}` : ''}</div>
        <div className="mt"><span className="src">موقعٌ — لم يُرسَل</span></div>
      </div>
    );
  }
  if (m.kind === 'image') {
    return (
      <div className="ibx-msg bot">
        <div className="bub bot" dir="auto">{m.caption ?? 'صورة'}</div>
        <div className="mt"><span className="src">صورةٌ — لم تُرسَل</span></div>
      </div>
    );
  }
  return (
    <div className="ibx-msg bot">
      <div className="bub bot" dir="auto">{m.body}</div>
      <div className="mt"><span className="src">أداةٌ أنتجتها — لم تُرسَل</span></div>
    </div>
  );
}

/* ══════════════════ لوحُ «لماذا» — المنتجُ في هذه الشاشة ══════════════════ */

function Why({ trace, onWrong }: { trace: PlaygroundTrace; onWrong: () => void }) {
  const k = trace.knowledge;
  const c = trace.cost;
  const trimmed = k.trimmed.filter((t) => t !== 'history');

  return (
    <div className="pg-panel">
      <div className="pg-panel-h">
        <b>لماذا ردّ هكذا</b>
        <Tag line mark={false} label={trace.version.label} />
        <Tag line mark={false} label={trace.version.model} />
        <Tag line mark={false} label={trace.channel.label} />
      </div>

      {/* ① الحرّاس أوّلاً: ما تدخّل على النصّ قبل أن يراه الزبون — بعاقبته */}
      {trace.guards.length > 0 && (
        <div className="pg-blk">
          <h3 className="pg-blk-t">حارسٌ تدخّل</h3>
          {trace.guards.map((g) => (
            <Vital key={g.key} sev={g.key === 'handoff' ? 'warn' : 'bad'} k={g.label} why={g.consequence} />
          ))}
        </div>
      )}

      {/* ② المعرفة: أيُّ مقاطعَ استُرجعت وبأيّ درجة */}
      <div className="pg-blk">
        <h3 className="pg-blk-t">
          المعرفةُ التي أسندت الردّ
          <span className="pg-blk-c">
            {k.mode === 'full'
              ? KB_MODE.full.label
              : <><span className="num">{fmt.num(k.chunks.length)}</span> من <span className="num">{fmt.num(k.chunksTotal)}</span> مقطعاً</>}
          </span>
        </h3>

        {trimmed.length > 0 && (
          <Note tone="crit">
            <b>اقتُطعت طبقةٌ من السياق:</b> {trimmed.map((t) => LAYER[t] ?? t).join(' · ')}.
            {' '}بوتك لم يرَ معرفتَك كلَّها — ارفع ميزانيّةَ هذه الطبقة أو قصّر ما فيها.
          </Note>
        )}

        {k.mode === 'full' ? (
          <p className="muted-p">
            المعرفةُ كلُّها في السياق (<span className="num">{fmt.num(k.layers.core)}</span> {READ_UNIT_ACC}) —
            فلا استرجاعَ ولا بحثَ ولا درجات. وحين تكبر معرفتك يتحوّل بوتك إلى الاسترجاع،
            فتظهر هنا المقاطعُ ودرجاتُها.
          </p>
        ) : k.skipped ? (
          <p className="muted-p">
            تُخطّي الاسترجاع مقصود: رسالةٌ قصيرةٌ أو تحيّةٌ لا تحتاج معرفةً، فلا نداءَ تضمينٍ
            ولا كلفةَ استرجاع. وهذا ليس نقصاً في معرفتك.
          </p>
        ) : !k.chunks.length ? (
          <Note tone="crit">
            <b>بحث ولم يجد.</b> لا مقطعَ في معرفتك يطابق هذا السؤال — وهذا يُحلّ بإضافة
            المحتوى الناقص لا بتعديل الشخصيّة.
          </Note>
        ) : (
          <div className="pg-chunks">
            {k.chunks.map((ch) => <Chunk key={ch.id} c={ch} />)}
          </div>
        )}

        {k.query && !k.skipped && k.mode !== 'full' && (
          <p className="muted-p">
            بُحث بهذا النصّ: <span dir="auto">«{k.query}»</span> — وهو سؤالُ الزبون مطبَّعاً
            ومدموجاً بآخر دورَين، فسؤالٌ قصيرٌ («وهاي؟») يحمل موضوعَه.
          </p>
        )}

        {k.pinned.length > 0 && (
          <p className="muted-p">
            ومعها <span className="num">{fmt.num(k.pinned.length)}</span> من الأساسيّات —
            تُحقن دائماً ولا تنافس على مقاعد الاسترجاع.
          </p>
        )}
      </div>

      {/* ③ الأدوات: بوسائطها وما أعادت */}
      <div className="pg-blk">
        <h3 className="pg-blk-t">
          الأدواتُ التي نوديت
          <span className="pg-blk-c">
            <span className="num">{fmt.num(trace.tools.length)}</span> من
            {' '}<span className="num">{fmt.num(trace.toolsOffered.length)}</span> معروضة
          </span>
        </h3>
        {trace.tools.length
          ? trace.tools.map((t, i) => <ToolCall key={`${t.name}-${i}`} t={t} />)
          : (
            <p className="muted-p">
              {trace.toolsOffered.length
                ? 'لم يحتج أداةً: أجاب من معرفته وشخصيّته. وإن توقّعتَ أداةً فراجع وصفَها — الوصفُ هو ما يقرأه البوت ليقرّر.'
                : 'لا أدواتَ معروضةً على بوتك أصلاً، فلا يستطيع أن يحجز ولا يتحقّق ولا يحوّل.'}
            </p>
          )}
      </div>

      {/* ④ الكلفة: كم توكناً وبكم */}
      <div className="pg-blk">
        <h3 className="pg-blk-t">
          الكلفة
          <span className="pg-blk-c">
            <span className="num">{fmt.num(c.calls)}</span> نداءً للنموذج
          </span>
        </h3>
        <KV>
          <KVRow k="سياقٌ ثابت (يُخزَّن بخصم)">
            <span className="num">{fmt.num(k.stablePrefixTokens)}</span> {READ_UNIT}
          </KVRow>
          <KVRow k="سياقٌ متغيّر (يُفوتَر كاملاً)">
            <span className="num">{fmt.num(k.variableTokens)}</span> {READ_UNIT}
          </KVRow>
          <KVRow k="إدخال">
            <span className="num">{fmt.num(c.promptTokens)}</span> {READ_UNIT}
            {c.cachedTokens ? <> · منها <span className="num">{fmt.num(c.cachedTokens)}</span> مخزَّنةٌ من قبل</> : null}
          </KVRow>
          <KVRow k="إخراج">
            <span className="num">{fmt.num(c.outputTokens)}</span> {READ_UNIT}
            {c.thoughtsTokens ? <> · وتفكيرٌ <span className="num">{fmt.num(c.thoughtsTokens)}</span></> : null}
          </KVRow>
          <KVRow k="المجموع">
            <span className="num">{fmt.num(c.totalTokens)}</span> {READ_UNIT}
          </KVRow>
          <KVRow k="بكم">
            {c.priced
              ? <span className="num">{fmt.money(c.usd)}</span>
              : <span className="pg-bad">لا سعرَ مسجَّلٌ لهذا النموذج</span>}
          </KVRow>
          <KVRow k="الزمن">
            <span className="num">{(c.latencyMs / 1000).toFixed(1)}</span> ث
          </KVRow>
        </KV>
      </div>

      <div className="pg-panel-f">
        <Button size="sm" onClick={onWrong}>هذا الردّ خطأ</Button>
        <span className="pg-foot">يفتح طريقاً لإضافة المعرفة الناقصة إلى مسوّدتك</span>
      </div>
    </div>
  );
}

const LAYER: Record<string, string> = {
  persona: 'الشخصيّة',
  core: 'الأساسيّات (معرفتك)',
  rules: 'القيود',
  tools: 'وصفُ الأدوات',
  retrieved: 'المعرفةُ المسترجَعة',
  live: 'الوقتُ وبطاقةُ الزبون',
  history: 'سجلُّ الحوار',
};

function Chunk({ c }: { c: PlaygroundChunk }) {
  return (
    <div className="pg-chunk">
      <div className="pg-chunk-h">
        <span className="pg-rank num">{c.rank}</span>
        <span className="pg-chunk-k" dir="auto">{c.heading ?? 'مقطعٌ بلا عنوان'}</span>
        {c.score !== null && (
          <span className="pg-chunk-s">
            درجة <span className="num">{c.score.toFixed(3)}</span>
          </span>
        )}
        <span className="pg-chunk-t"><span className="num">{fmt.num(c.tokens)}</span> {READ_UNIT}</span>
      </div>
      <p className="pg-chunk-b" dir="auto">{c.preview}…</p>
    </div>
  );
}

function ToolCall({ t }: { t: PlaygroundToolCall }) {
  const failed = isFailed(t.result);
  return (
    <div className="pg-tool">
      <div className="pg-tool-h">
        <Tag tone={failed ? 'crit' : t.ran ? 'ok' : 'cool'} label={t.name} />
        <span className="pg-tool-m">
          <span className="num">{secs(t.ms)}</span> ث
        </span>
        {!t.ran && <Tag line mark={false} label="مُثِّلت ولم تُنفَّذ" />}
      </div>
      <div className="pg-tool-b">
        <span className="pg-tool-k">بوسائط</span>
        <Pairs obj={t.args} empty="بلا وسائط" />
        <span className="pg-tool-k">فأعادت</span>
        <Pairs obj={asObject(t.result)} empty="بلا نتيجة" />
      </div>
      {t.note && <p className="muted-p">{t.note}</p>}
    </div>
  );
}

/**
 * ★ وسائطُ الأدوات ونتائجُها **لا تُعرض JSON في مدًى مونو**: قيمُها عربيّةٌ
 *   كثيراً («الزبون يسأل عن التوصيل»)، و`IBM Plex Mono` بلا تغطيةٍ عربيّةٍ
 *   إطلاقاً — فتسقط الكلمةُ إلى خطٍّ احتياطيٍّ يختلف على كلّ منصّة. فالمفتاحُ
 *   يُعزَل لاتينيّاً (‏`Iso`) والقيمةُ تُقرأ باتّجاه محتواها.
 */
function Pairs({ obj, empty }: { obj: Record<string, unknown>; empty: string }) {
  const rows = Object.entries(obj).filter(([k]) => !k.startsWith('__'));
  if (!rows.length) return <p className="pg-none">{empty}</p>;
  return (
    <KV>
      {rows.map(([k, v]) => (
        <KVRow key={k} k={<Iso text={k} />}>
          <span dir="auto">{render(v)}</span>
        </KVRow>
      ))}
    </KV>
  );
}

function render(v: unknown): ReactNode {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (typeof v === 'number') return <span className="num">{fmt.num(v)}</span>;
  if (typeof v === 'string') return v.length ? <Iso text={v} /> : '(فارغ)';
  return JSON.stringify(v);
}

function asObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (v === null || v === undefined) return {};
  return { value: v };
}

function isFailed(v: unknown): boolean {
  return Boolean(v && typeof v === 'object' && 'error' in (v as Record<string, unknown>));
}
