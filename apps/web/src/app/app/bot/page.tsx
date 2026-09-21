'use client';

import { useEffect, useState } from 'react';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { put, post, patch, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { Loading, ErrorBox } from '@/components/Shell';
import { ToolBuilder, EMPTY_DRAFT, type ToolDraft } from '@/components/ToolBuilder';
import { Button, Row, Empty, Note, Stack } from '@/components/ui';
import { KnowledgeFiles, type KbSource } from '@/components/KnowledgeFiles';

interface BotState {
  config: {
    enabled: boolean; pauseMinutes: number; maxToolLoops: number;
    contextMessages: number; failMessage: string | null; outsideHoursMessage: string | null;
  } | null;
  published: {
    version: number; persona: string; knowledgeBase: string;
    knowledgeMode: 'full' | 'hybrid' | 'rag'; embedStatus: string; model: string;
  } | null;
  draft: Record<string, unknown> | null;
}

interface KB {
  sources: Array<{ id: string; title: string; charCount: number; status: string }>;
  chunks: number; chars: number; tokens: number;
  suggestedMode: 'full' | 'hybrid' | 'rag';
}

interface Tool {
  id: string; key: string; titleAr: string; description: string;
  enabled: boolean; kind: string; hasSecrets: boolean;
  requiresCapabilities: string[]; disabledReason: string | null;
  paramsSchema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] } | null;
  http?: { method?: string; url?: string; headers?: Record<string, string>; bodyTemplate?: string } | null;
  responseMap?: Record<string, string> | null;
  confirmRequired?: boolean; confirmTemplate?: string | null;
}

/**
 * صفُّ القاعدة ⟶ مسوّدة الباني.
 *
 * ★ السرّ **لا يُعاد أبداً** — حتّى وجوده يأتي علماً (`hasSecrets`) لا قيمة.
 *   فحقل السرّ يبدأ فارغاً، وتركه فارغاً يعني «أبقِ القديم» لا «امحُه».
 */
function toDraft(t: Tool): ToolDraft {
  const props = t.paramsSchema?.properties ?? {};
  const required = new Set(t.paramsSchema?.required ?? []);
  return {
    id: t.id,
    key: t.key,
    titleAr: t.titleAr,
    description: t.description,
    params: Object.entries(props).map(([name, v]) => ({
      name,
      type: (v?.type as 'string') ?? 'string',
      desc: v?.description ?? '',
      required: required.has(name),
    })),
    method: (t.http?.method as 'GET') ?? 'GET',
    url: t.http?.url ?? '',
    bodyTemplate: t.http?.bodyTemplate ?? '',
    authHeader: t.http?.headers?.Authorization ?? '',
    secretValue: '',
    hasSecrets: t.hasSecrets,
    responseMap: Object.entries(t.responseMap ?? {}).map(([field, path]) => ({ field, path })),
    confirmRequired: Boolean(t.confirmRequired),
    confirmTemplate: t.confirmTemplate ?? '',
  };
}

const TABS = [
  { id: 'persona', label: 'الشخصيّة' },
  { id: 'kb', label: 'المعرفة' },
  { id: 'tools', label: 'الأدوات' },
  { id: 'behave', label: 'السلوك' },
] as const;

const MODE_LABEL: Record<string, string> = {
  full: 'حقنٌ كامل', hybrid: 'أساسيات + استرجاع', rag: 'استرجاعٌ كامل',
};

export default function BotPage() {
  const can = useCan();
  const { toast, node } = useToast();
  const bot = useApi<BotState>('/bot');
  const kb = useApi<KB>('/bot/knowledge');
  const tools = useApi<Tool[]>('/bot/tools');

  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('persona');
  /* المسوّدة المفتوحة في الباني. `null` = مغلق. */
  const [editing, setEditing] = useState<ToolDraft | null>(null);
  const [persona, setPersona] = useState('');
  const [knowledge, setKnowledge] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = bot.data?.draft as { persona?: string; knowledgeBase?: string } | null;
    setPersona(d?.persona ?? bot.data?.published?.persona ?? '');
    setKnowledge(d?.knowledgeBase ?? bot.data?.published?.knowledgeBase ?? '');
    setDirty(Boolean(d && Object.keys(d).length));
  }, [bot.data]);

  if (bot.loading) return <Loading rows={5} />;
  if (bot.error) return <ErrorBox message={bot.error} onRetry={bot.reload} />;

  const personaTokens = Math.ceil(persona.length / 2.5);
  const kbTokens = Math.ceil(knowledge.length / 2.5);

  async function saveDraft(next?: Partial<{ persona: string; knowledgeBase: string }>) {
    setBusy(true);
    try {
      await put('/bot/draft', {
        persona: next?.persona ?? persona,
        knowledgeBase: next?.knowledgeBase ?? knowledge,
      });
      setDirty(true);
      toast('حُفظت المسوّدة — والبوت الحيّ ما زال على النسخة المنشورة');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر الحفظ');
    } finally { setBusy(false); }
  }

  async function publish() {
    setBusy(true);
    try {
      const r = await post<{ knowledgeMode: string; embedding: boolean; kbTokens: number }>(
        '/bot/publish', { note: null },
      );
      setDirty(false);
      toast(r.embedding
        ? `نُشرت — جارٍ تجهيز المعرفة (${MODE_LABEL[r.knowledgeMode]}). النسخة السابقة تخدم حتّى تجهز.`
        : 'نُشرت النسخة الجديدة');
      await bot.reload();
      await kb.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر النشر');
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="vh">
        <div>
          <h1>البوت</h1>
          <p>خمسة أشياء تجعل بوتك مختلفاً — وكلّها بياناتٌ تضبطها أنت.</p>
        </div>
        <div className="sp">
          {bot.data?.published && (
            <span className="pill nt">المنشورة v{bot.data.published.version}</span>
          )}
          {bot.data?.published?.embedStatus === 'pending' && (
            <span className="pill warn">جارٍ تجهيز المعرفة…</span>
          )}
          <button
            className={`btn ${bot.data?.config?.enabled ? '' : 'pri'}`}
            disabled={can.readOnly || busy}
            onClick={async () => {
              await post('/bot/toggle', { enabled: !bot.data?.config?.enabled });
              await bot.reload();
            }}
          >
            {bot.data?.config?.enabled ? 'أوقف البوت' : 'شغّل البوت'}
          </button>
        </div>
      </div>

      {dirty && (
        <div className="note w" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>لديك تغييرات غير منشورة.</b>
          <span>البوت الحيّ ما زال على v{bot.data?.published?.version ?? '—'} — تعديلك لا يمسّ محادثةً جارية.</span>
          <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn sm pri" onClick={publish} disabled={busy || can.readOnly}>نشر</button>
          </span>
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'persona' && (
        <>
          <label className="field">
            <span>من هو بوتك؟ <span className="hint">اسمه، لهجته، نبرته، وما يرفض الحديث فيه</span></span>
            <textarea
              className="ta" value={persona} disabled={can.readOnly}
              onChange={(e) => setPersona(e.target.value)}
              onBlur={() => persona !== (bot.data?.published?.persona ?? '') && saveDraft()}
            />
          </label>
          <div className="cnt">
            <span>{fmt.num(persona.length)} حرف · ≈ <span className="num">{fmt.num(personaTokens)}</span> توكن</span>
            <span style={{ color: personaTokens > 800 ? 'var(--amber)' : 'var(--muted)' }}>
              الحدّ الموصى به: 800 توكن
            </span>
          </div>

          <div className="note">
            <b>ما لا تستطيع تعديله.</b> فوق شخصيّتك تُحقن قواعد ثابتة دائماً: لا يدّعي أنّه
            إنسان · لا يكشف أدواته · لا يكتب رابطاً من عنده · لا يَعِد بما لا يملك ·
            وعند الشكّ يحوّل لإنسانٍ ولا يخمّن. هذه ليست خياراً.
          </div>
        </>
      )}

      {tab === 'kb' && (
        <>
          <div className="tiles">
            <div className="tl"><span className="v">{fmt.num(kb.data?.sources.length ?? 0)}</span><span className="k">مصدر معرفة</span></div>
            <div className="tl"><span className="v">{fmt.num(kbTokens)}</span><span className="k">توكن</span></div>
            <div className="tl"><span className="v">{fmt.num(kb.data?.chunks ?? 0)}</span><span className="k">مقطع مُضمَّن</span></div>
            <div className="tl">
              <span className="v" style={{ fontSize: 15 }}>{MODE_LABEL[kb.data?.suggestedMode ?? 'full']}</span>
              <span className="k">الوضع — يتحوّل تلقائيّاً فوق 8 آلاف توكن</span>
            </div>
          </div>

          <label className="field">
            <span>
              ماذا يعرف بوتك عن نشاطك؟{' '}
              <span className="hint">الأسعار، الساعات، الخدمات، وأكثر عشرة أسئلةٍ تسمعها يوميّاً</span>
            </span>
            <textarea
              className="ta" style={{ minHeight: 260 }} value={knowledge} disabled={can.readOnly}
              onChange={(e) => setKnowledge(e.target.value)}
              onBlur={() => knowledge !== (bot.data?.published?.knowledgeBase ?? '') && saveDraft()}
            />
          </label>
          <div className="cnt">
            <span>{fmt.num(knowledge.length)} حرف · ≈ <span className="num">{fmt.num(kbTokens)}</span> توكن</span>
            <span>استعمل عناوين (سطرٌ يبدأ بـ# أو ينتهي بنقطتين) — تُحسّن دقّة البوت كثيراً</span>
          </div>

          <Note>
            <b>لماذا فاتورتك لا تكبر مع معرفتك.</b> فوق 8 آلاف توكن، البوت لم يعد يقرأ معرفتك
            كاملةً مع كلّ سؤال: يُرسَل إليه <b>الأساسيات والقيود وما يرتبط بالسؤال فقط</b>.
            فمعرفةٌ بحجم عشرة أضعاف لا تكلّفك عشرة أضعاف.
          </Note>

          <Stack gap="md">
            <h2>ملفّاتك</h2>
            <KnowledgeFiles
              sources={(kb.data?.sources ?? []) as KbSource[]}
              loading={kb.loading}
              readOnly={can.readOnly}
              onChanged={() => void kb.reload()}
            />
          </Stack>
        </>
      )}

      {tab === 'tools' && (
        <>
          <Row end>
            <span className="muted-p">
              كلّ أداةٍ نداءٌ إلى نظامك. والبوت يستعملها **بوصفها** — فالوصف هو نصف الأداة.
            </span>
            <Button variant="primary" disabled={can.readOnly} reason="حسابك للقراءة فقط"
              onClick={() => setEditing({ ...EMPTY_DRAFT })}>
              + أداةٌ جديدة
            </Button>
          </Row>

          {editing && (
            <ToolBuilder
              initial={editing}
              onClose={() => setEditing(null)}
              onSaved={() => { setEditing(null); void tools.reload(); }}
            />
          )}

          {tools.loading && <Loading rows={3} />}
          {tools.data?.map((t) => (
            <div className="card" key={t.id} style={{ padding: '12px 15px' }}>
              <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13.5 }}>{t.titleAr}</strong>
                <span className={`pill ${t.kind === 'http' ? 'warn' : 'nt'}`}>
                  {t.kind === 'http' ? 'مخصَّصة' : 'جاهزة'}
                </span>
                {t.hasSecrets && <span className="pill nt">لها سرّ</span>}
                {t.disabledReason && <span className="pill crit">معطَّلة آليّاً</span>}
                <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginInlineStart: 'auto' }}>
                  {t.key}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.55 }}>
                {t.description}
              </div>
              {t.disabledReason && (
                <div style={{ fontSize: 11.5, color: 'var(--crit)', marginTop: 6 }}>{t.disabledReason}</div>
              )}
              {!!t.requiresCapabilities.length && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
                  تحتاج من القناة: {t.requiresCapabilities.join('، ')} — وتُخفى تلقائيّاً على قناةٍ لا تدعمها
                </div>
              )}
              <Row gap="xs">
                <Button size="sm" disabled={can.readOnly} reason="حسابك للقراءة فقط"
                  onClick={() => setEditing(toDraft(t))}>
                  عدّلها وجرّبها
                </Button>
                {t.disabledReason && (
                  <Button size="sm" variant="primary" disabled={can.readOnly}
                    onClick={async () => { await patch(`/bot/tools/${t.id}`, { enabled: true }); void tools.reload(); }}>
                    أعِد تفعيلها
                  </Button>
                )}
              </Row>
            </div>
          ))}
          {!tools.loading && !tools.data?.length && (
            <Empty
              title="لا أدوات مخصَّصة بعد"
              hint="بوتك يستعمل الأدوات الجاهزة (تحويل لموظّف، ملاحظات، خيارات سريعة). أضِف أداةً حين يكون عندك نظامٌ يستعلم منه — أسعارٌ، مخزونٌ، مواعيد، أو حساب زبون."
              action={(
                <Button variant="primary" disabled={can.readOnly} reason="حسابك للقراءة فقط"
                  onClick={() => setEditing({ ...EMPTY_DRAFT })}>
                  ابنِ أوّل أداة
                </Button>
              )}
            />
          )}
          <Note tone="crit">
            <b>حدودٌ مفروضة بالكود لا بالشاشة.</b> HTTPS فقط · رفض العناوين الداخليّة بعد حلّ
            الاسم وعند كلّ تحويل · مهلة 8 ثوانٍ · 256 كيلوبايت · وتعطيلٌ آليّ بعد خمسة إخفاقاتٍ
            متتالية مع إشعارك.
          </Note>
        </>
      )}

      {tab === 'behave' && bot.data?.config && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          <div className="card">
            <h2>الإيقاف بعد الموظّف</h2>
            <dl className="kv">
              <dt>المدّة</dt><dd className="num">{bot.data.config.pauseMinutes} دقيقة</dd>
              <dt>يُستأنف</dt><dd>تلقائيّاً أو بزرّ</dd>
            </dl>
          </div>
          <div className="card">
            <h2>الحدود</h2>
            <dl className="kv">
              <dt>دورات الأدوات</dt><dd className="num">{bot.data.config.maxToolLoops}</dd>
              <dt>رسائل السياق</dt><dd className="num">{bot.data.config.contextMessages}</dd>
              <dt>النموذج</dt><dd className="mono">{bot.data.published?.model ?? '—'}</dd>
            </dl>
          </div>
          <div className="card">
            <h2>حين يعجز</h2>
            <dl className="kv">
              <dt>يقول</dt><dd>{bot.data.config.failMessage ?? 'رسالةٌ افتراضيّة ثمّ تحويل'}</dd>
              <dt>خارج الدوام</dt><dd>{bot.data.config.outsideHoursMessage ?? '—'}</dd>
            </dl>
          </div>
        </div>
      )}

      {node}
    </>
  );
}
