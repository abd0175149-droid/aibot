'use client';

import { Button, DiffView, Dock, ErrorBox, Note, PageHead, Pill, Row, Sheet, Skeleton, Tabs, Tag } from '@/components/ui';
import { KB_MODE as MODE, KB_MODE_TERM, READ_UNIT as UNIT } from '@/lib/terms';
import { fmt } from '@/lib/useApi';
import { LINE_ADD, LINE_DEL, amountText } from './parts';
import { useBotState, deriveBotView } from './state';
import { PersonaTab } from './PersonaTab';
import { KbTab } from './KbTab';
import { ToolsTab } from './ToolsTab';
import { BehaveTab } from './BehaveTab';
import { VersionsTab } from './VersionsTab';


export default function BotPage() {
  const s = useBotState();
  const { bot } = s;
  if (bot.loading && !bot.data) return <Skeleton rows={5} />;
  if (bot.error && !bot.data) return <ErrorBox message={bot.error} onRetry={bot.reload} />;
  const c = deriveBotView(s);
  const { ask, bandAction, bandMark, bandSub, bandTitle, bandTone, busy, busyTool, cfg, changed, conflict, deleteTool, dockHint, dockPrimary, dockSecondary, draftMode, kbChanged, kbDelta, kbUnits, knowledge, liveMode, lockReason, locked, node, pendingEmbed, pendingVersion, persona, personaChanged, personaDelta, personaUnits, platformLock, pub, pubVersion, publish, publishReason, rollback, rollbackReason, saveDraft, setAsk, setConflict, setTab, tab, tabs, takeLatest, toggleBot, unsaved, vers } = c;
  return (
    <div className="bot-page">
      {node}

      <PageHead
        title="البوت"
        sub="خمسة أشياء تجعل بوتك مختلفاً — وكلّها بياناتٌ تضبطها أنت."
        actions={(
          <Row gap="sm">
            <Pill
              tone={cfg?.enabled ? 'ok' : 'crit'}
              label={cfg?.enabled ? 'يردّ على زبائنك' : 'متوقّف'}
            />
            {pub && <Pill tone="neutral" label={`المنشورة v${pub.version}`} mark={false} />}
            {/* ★ `pub.embedStatus === 'pending'` لا يشتعل أبداً: العامل يكتب
                `ready` و`publishedVersionId` في معاملةٍ واحدة. فالحالة الموجودة
                فعلاً — نسخةٌ نُشرت وتُجهَّز — هي التي لم يكن لها مؤشّر. */}
            {pendingEmbed && <Pill tone="warn" label={`v${pendingVersion} تُجهَّز معرفتها…`} />}
            {/* ★ أخطرُ فعلٍ في الشاشة لا يكون أضعفَ زرٍّ فيها: الإطفاء `danger`
                وخلفه ورقةٌ تقول ما يحدث لرسائل زبائنك. والتشغيل بلا ورقة. */}
            <Button
              variant={cfg?.enabled ? 'danger' : 'primary'}
              busy={busy === 'toggle'}
              disabled={locked}
              reason={lockReason ?? platformLock ?? undefined}
              onClick={() => { if (cfg?.enabled) setAsk({ k: 'stop' }); else void toggleBot(true); }}
            >
              {cfg?.enabled ? 'أوقف البوت' : 'شغّل البوت'}
            </Button>
          </Row>
        )}
      />

      {/* خطأٌ عابرٌ على بياناتٍ موجودة: يُقال ولا يهدم الشاشة — وما يُعرض
          تحته آخرُ ما وصلنا لا الحقيقةَ اللحظيّة. */}
      {bot.error && bot.data && (
        <Note tone="warn">
          <b>تعذّر تحديث حالة بوتك الآن.</b> ما تراه أدناه آخرُ ما وصلنا.{' '}
          <Button size="sm" onClick={() => { void bot.reload(); void vers.reload(); }}>
            أعِد المحاولة
          </Button>
        </Note>
      )}

      <div className={`bot-band ${bandTone}`} role="status">
        <span className="bot-band-m" aria-hidden="true">{bandMark}</span>
        <div className="bot-band-t">
          <b>{bandTitle}</b>
          <span>{bandSub}</span>
        </div>
        {bandAction && <div className="bot-band-a">{bandAction}</div>}
      </div>

      {/* ═══ ما سيصل زبائنك: الملخَّص حاضرٌ دائماً، والتفصيل تحت طيّة ═══ */}
      {changed && !pendingEmbed && (
        <div className="sect">
          <div className="sect-h">
            <h2>ما سيصل زبائنك عند النشر</h2>
            <span className="sect-c">مقارنةً بالنسخة التي تخدمهم الآن</span>
          </div>

          <div className="rows bot-rows">
            {personaChanged && (
              <div className="row-m">
                <span className="rm-k">
                  الشخصيّة
                  <span className="rm-note">من هو بوتك، ونبرته، وما يرفض الحديث فيه</span>
                </span>
                <span className="rm-v">
                  <span className="num">{fmt.num(personaUnits)}</span> <small>{UNIT}</small>
                </span>
                <span className="rm-c">
                  {personaDelta.added > 0 && (
                    <Tag tone="ok" label={amountText(personaDelta.added, LINE_ADD)} mark={false} />
                  )}
                  {personaDelta.removed > 0 && (
                    <Tag tone="crit" label={amountText(personaDelta.removed, LINE_DEL)} mark={false} />
                  )}
                </span>
              </div>
            )}
            {kbChanged && (
              <div className="row-m">
                <span className="rm-k">
                  نصّ المعرفة
                  <span className="rm-note">الأسعار والساعات والخدمات — وما يجيب به بوتك</span>
                </span>
                <span className="rm-v">
                  <span className="num">{fmt.num(kbUnits)}</span> <small>{UNIT}</small>
                </span>
                <span className="rm-c">
                  {kbDelta.added > 0 && (
                    <Tag tone="ok" label={amountText(kbDelta.added, LINE_ADD)} mark={false} />
                  )}
                  {kbDelta.removed > 0 && (
                    <Tag tone="crit" label={amountText(kbDelta.removed, LINE_DEL)} mark={false} />
                  )}
                  {draftMode !== liveMode && (
                    <Tag tone="cool" label={`${KB_MODE_TERM} يتغيّر إلى: ${MODE[draftMode]!.label}`} />
                  )}
                </span>
              </div>
            )}
          </div>

          {unsaved && (
            <Note tone="warn">
              <b>على الشاشة تغييرٌ غير محفوظ.</b> النشر ينشر المسوّدة المحفوظة على الخادم،
              لا ما تراه الآن. احفظ أوّلاً ليدخل ما كتبته في هذه النسخة.
            </Note>
          )}

          <details className="bot-more">
            <summary>أرِني الفرق سطراً سطراً</summary>
            <div className="bot-more-b">
              {personaChanged && (
                <div>
                  <span className="bot-diff-h">الشخصيّة — الفرق عن المنشورة</span>
                  {/* نصٌّ كتبه العميل: الاتّجاه من محتواه */}
                  <div className="bot-diff" dir="auto">
                    <DiffView before={pub?.persona ?? ''} after={persona} />
                  </div>
                </div>
              )}
              {kbChanged && (
                <div>
                  <span className="bot-diff-h">نصّ المعرفة — الفرق عن المنشورة</span>
                  <div className="bot-diff" dir="auto">
                    <DiffView before={pub?.knowledgeBase ?? ''} after={knowledge} />
                  </div>
                </div>
              )}
              <p className="muted-p">
                المخطوط بالأحمر يُحذف والأخضر يُضاف. ولا شيء من هذا يصل زبوناً قبل أن تنشر.
              </p>
            </div>
          </details>
        </div>
      )}

      {/* ★ التعارضُ يُعلَن فوق كلّ شيء ويوقف الحفظ التلقائيّ: من كتب بعدك
          له عملٌ لا يُمحى بضغطةٍ لم تقصدها. والخياران صريحان — تأخذ الأحدث
          وتخسر ما على شاشتك، أو تحفظ فوقه بقرارٍ منك. */}
      {conflict && (
        <Note tone="warn">
          <b>تغيّرت المسوّدة من مكانٍ آخر.</b>{' '}
          يمكن أنّك فتحتَها في تبويبٍ ثانٍ، أو أضفتَ تصحيحاً من الساحة. أوقفنا
          الحفظَ التلقائيّ حتّى لا يُمحى ذاك العمل.{' '}
          <Button size="sm" onClick={() => void takeLatest()}>حمّل الأحدث</Button>{' '}
          <Button
            size="sm" variant="quiet"
            onClick={() => { setConflict(false); void saveDraft(true); }}
          >
            احفظ ما على شاشتي فوقها
          </Button>
        </Note>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="bot-main">
        {/* ═══════════════ الشخصيّة ═══════════════ */}
        {tab === 'persona' && <PersonaTab c={c} />}

        {/* ═══════════════ المعرفة ═══════════════ */}
        {tab === 'kb' && <KbTab c={c} />}

        {/* ═══════════════ الأدوات ═══════════════ */}
        {tab === 'tools' && <ToolsTab c={c} />}

        {/* ═══════════════ السلوك ═══════════════ */}
        {tab === 'behave' && <BehaveTab c={c} />}

        {/* ═══════════════ النسخ ═══════════════ */}
        {tab === 'versions' && <VersionsTab c={c} />}
      </div>

      {/* ═══ الرصيف: آخرُ صفٍّ في العمود، لاصقٌ بأسفل المُمرِّر ═══ */}
      <div className="bot-dock">
        <Dock hint={dockHint}>
          {dockPrimary}
          {dockSecondary}
        </Dock>
      </div>

      {/* ═══ أوراقُ التأكيد: الخطوة الثانية لكلّ فعلٍ لا يُسحب ═══ */}
      <Sheet
        open={ask?.k === 'stop'}
        title="أوقف بوتك عن كلّ زبائنك؟"
        onClose={() => setAsk(null)}
        hint="ولا يمسّ هذا محادثةً يكتب فيها موظّفك — بوتك ساكتٌ عنها أصلاً."
        footer={(
          <Row gap="sm">
            <Button
              variant="danger"
              wide
              busy={busy === 'toggle'}
              onClick={() => void toggleBot(false)}
            >
              أوقفه الآن
            </Button>
            <Button onClick={() => setAsk(null)}>أبقِه يعمل</Button>
          </Row>
        )}
      >
        <p className="muted-p">
          <b>كلّ رسالةٍ تصل بعد الإيقاف تنتظر موظّفاً</b> — لا ردَّ آليّ، ولا يعلم زبونك
          أنّ أحداً سيردّ عليه.
        </p>
        <p className="muted-p">
          والأثر على قنواتك كلّها معاً، لا على محادثةٍ واحدة.
          {pub ? <> ونسختك <span className="num">{`v${pub.version}`}</span> تبقى محفوظةً كما هي،
            ويعود بوتك بضغطةٍ واحدة.</> : null}
        </p>
      </Sheet>

      <Sheet
        open={ask?.k === 'publish'}
        title="انشر للزبائن"
        onClose={() => setAsk(null)}
        hint="بعد النشر يردّ بوتك بالنسخة الجديدة على كلّ رسالةٍ قادمة — ولا تُقطع محادثةٌ جارية."
        footer={(
          <Row gap="sm">
            <Button
              variant="primary"
              wide
              busy={busy === 'publish'}
              disabled={Boolean(publishReason)}
              reason={publishReason ?? undefined}
              onClick={() => void publish()}
            >
              انشر الآن
            </Button>
            <Button onClick={() => setAsk(null)}>راجِع مرّةً أخرى</Button>
          </Row>
        )}
      >
        <div className="rows bot-rows">
          {personaChanged && (
            <div className="row-m">
              <span className="rm-k">الشخصيّة</span>
              <span className="rm-c">
                {personaDelta.added > 0 && (
                  <Tag tone="ok" mark={false} label={amountText(personaDelta.added, LINE_ADD)} />
                )}
                {personaDelta.removed > 0 && (
                  <Tag tone="crit" mark={false} label={amountText(personaDelta.removed, LINE_DEL)} />
                )}
              </span>
            </div>
          )}
          {kbChanged && (
            <div className="row-m">
              <span className="rm-k">نصّ المعرفة</span>
              <span className="rm-c">
                {kbDelta.added > 0 && (
                  <Tag tone="ok" mark={false} label={amountText(kbDelta.added, LINE_ADD)} />
                )}
                {kbDelta.removed > 0 && (
                  <Tag tone="crit" mark={false} label={amountText(kbDelta.removed, LINE_DEL)} />
                )}
              </span>
            </div>
          )}
        </div>
        {draftMode !== 'full' && (
          <p className="muted-p">
            معرفتك فوق العتبة الأولى، فتُقطَّع وتُضمَّن أوّلاً —
            و{pub ? <span className="num">{`v${pub.version}`}</span> : 'النسخة السابقة'} تخدم
            زبائنك حتّى تجهز الجديدة. قد يأخذ ذلك دقيقةً أو أكثر.
          </p>
        )}
        {draftMode !== liveMode && (
          <p className="muted-p">
            ووضعُ القراءة يتغيّر إلى <b>{MODE[draftMode]!.label}</b>: {MODE[draftMode]!.how}
          </p>
        )}
      </Sheet>

      <Sheet
        open={ask?.k === 'tool'}
        title="احذف هذه الأداة؟"
        onClose={() => setAsk(null)}
        hint="الحذف لا يُسحب: يمحو المسار والمعاملات والسرّ المحفوظ معها."
        footer={(
          <Row gap="sm">
            <Button
              variant="danger"
              wide
              busy={ask?.k === 'tool' && busyTool === ask.id}
              onClick={() => { if (ask?.k === 'tool') void deleteTool(ask.id, ask.name); }}
            >
              احذفها نهائيّاً
            </Button>
            <Button onClick={() => setAsk(null)}>أبقِها</Button>
          </Row>
        )}
      >
        <p className="muted-p">
          {ask?.k === 'tool' ? <><b dir="auto">«{ask.name}»</b> — </> : null}
          بعد الحذف يجيب بوتك من نصّ معرفتك وحده في كلّ سؤالٍ كانت تجيبه، وقد يُعطي سعراً
          قديماً أو يقول «لا أعرف» ويحوّل لموظّف.
        </p>
        <p className="muted-p">
          وإن كان العطل مؤقّتاً عند نظامك فالأفضل تعطيلها لا حذفها — تعود بنقرةٍ بعد الإصلاح.
        </p>
      </Sheet>

      <Sheet
        open={ask?.k === 'rollback'}
        title="عُد إلى نسخةٍ سابقة؟"
        onClose={() => setAsk(null)}
        hint="التراجع نشرُ نسخةٍ قديمة — لا تُحذف نسخةٌ ولا تُقطع محادثةٌ جارية."
        footer={(
          <Row gap="sm">
            <Button
              variant="primary"
              wide
              busy={busy === 'rollback'}
              disabled={Boolean(rollbackReason)}
              reason={rollbackReason ?? undefined}
              onClick={() => { if (ask?.k === 'rollback') void rollback(ask.id, ask.version); }}
            >
              عُد إليها الآن
            </Button>
            <Button onClick={() => setAsk(null)}>أبقِ الحالية</Button>
          </Row>
        )}
      >
        <p className="muted-p">
          {ask?.k === 'rollback'
            ? (
              <>
                يردّ بوتك بـ<span className="num">{`v${ask.version}`}</span> على كلّ رسالةٍ قادمة
                بدل <span className="num">{`v${pubVersion}`}</span> — بشخصيّتها ومعرفتها كما
                كانت يومَ نُشرت.
              </>
            )
            : null}
        </p>
        <p className="muted-p">
          ومسوّدتك على الشاشة <b>لا تُمسّ</b>: بعد التراجع يعود شريطُ «تغييراتك لم تصل زبائنك
          بعد» لأنّ ما كتبتَه صار مختلفاً عن النسخة الحيّة — وتنشره متى شئت.
        </p>
      </Sheet>
    </div>
  );
}
