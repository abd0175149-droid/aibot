'use client';

import { useRef, useState } from 'react';
import { api, del, ApiError } from '@/lib/api';
import { fmt } from '@/lib/useApi';
import {
  Button, Row, Stack, Pill, Note, Modal, Sheet, Meter, Skeleton, Empty, Table, type Column,
} from '@/components/ui';

/**
 * رفع ملفّات المعرفة.
 *
 * ★ كانت هذه الميزة **مبنيّةً وميّتة**: عامل الاستيعاب مسجَّلٌ والمستخرِج جاهز
 *   (نصّ · Markdown · CSV · PDF · Word · Excel)، ولا نقطةَ رفعٍ ولا منتِجَ
 *   مهمّة. أي أنّ تبويب «المعرفة» كان يعرض قائمةً لا يمكن أن تمتلئ.
 *
 * ★ والمعاينة ليست ترفاً: الملفّ الملقَّم كما هو — بجداولٍ مشوّهة وترويساتٍ
 *   مكرّرة وأرقام صفحات — **يُفسد الردود** ويُفسد التقطيع والتضمين. فالعميل
 *   يرى ما استُخرج **قبل** أن ينشر، لا بعد أن يُخطئ البوت أمام زبون.
 *   ولذلك «استُخرج» تعني «قرأناه» لا «معتمَد».
 *
 * ★ وثلاثة أعطالٍ أُغلقت في هذه المرحلة:
 *
 *   ① **حذفٌ نهائيٌّ بنقرةٍ واحدة، وزرُّه على خمسة بكسلاتٍ من «عايِن».**
 *      وأثرُ الحذف فوريٌّ على البوت الحيّ: `kb_chunks.source_id` بـ
 *      `on delete cascade`، فمقاطعُ الملفّ تزول من النسخة **المنشورة** في
 *      نفس اللحظة — أي أنّ بوتك ينسى ما فيه من أوّل ردٍّ قادم بلا نشر. صار
 *      الزرّ في نهاية الصفّ، وخلفه ورقةٌ تقول هذا بعينه.
 *
 *   ② **علمُ رفعٍ واحدٌ للدفعة كلّها.** خمسةُ ملفّاتٍ تُرفع تتابعاً و`busy`
 *      واحدٌ لا يقول أيُّها يُرفع الآن ولا أيُّها سقط ولمَ — والأخطاء تُجمع
 *      في سطرٍ واحدٍ بعد أن ينتهي كلّ شيء. صارت الحالةُ **لكلّ ملفٍّ على
 *      حِدة** مع عدّادٍ ومقياسٍ، والقائمةُ تُحدَّث بعد كلّ ملفٍّ لا بعد الدفعة.
 *
 *   ③ **«قيد المعالجة» لا تنتهي بذاتها أبداً.** الاستيعاب في طابورٍ ولا
 *      إشعارَ منه، فالصفّ يبقى «قيد المعالجة» حتّى يُحدِّث المستخدمُ الصفحة
 *      بيده وهو لا يعلم أنّ عليه ذلك. الاستقصاءُ المحدود صار في الشاشة
 *      الأمّ (فهي تملك النداء)، وهنا يُقال ما يعنيه انقضاؤه.
 */

const ACCEPT = '.txt,.md,.csv,.pdf,.doc,.docx,.xls,.xlsx';
const MAX_MB = 12;

export interface KbSource {
  id: string;
  kind: string;
  title: string;
  charCount: number;
  status: 'pending' | 'ready' | 'failed';
  createdAt: string;
}

interface Preview {
  id: string; title: string; status: string; error: string | null;
  charCount: number; preview: string; truncated: boolean;
}

/**
 * ★ «هل قُرئ؟» لا «الحالة»: السؤال الذي يسأله العميل فعلاً. و«استُخرج»
 *   تعني أنّنا قرأنا الملفّ — لا أنّ ما قرأناه صالح، وذاك ما تقوله المعاينة.
 */
const STATUS: Record<string, { tone: 'ok' | 'warn' | 'crit'; label: string }> = {
  ready: { tone: 'ok', label: 'استُخرج نصُّه' },
  pending: { tone: 'warn', label: 'قيد المعالجة' },
  failed: { tone: 'crit', label: 'لم يُستخرج نصّ' },
};

/** حالةُ ملفٍّ واحدٍ في دفعة رفع. */
interface UpItem { name: string; state: 'wait' | 'up' | 'done' | 'fail'; err?: string }

const UP_TEXT: Record<UpItem['state'], string> = {
  wait: 'في الانتظار',
  up: 'يُرفع الآن…',
  done: 'وصل — وقيد المعالجة',
  fail: 'لم يُرفع',
};

/**
 * ★ وحدةُ القياس المعروضة «وحدة قراءة» لا «توكن»، والصيغةُ صيغةُ الخادم
 *   للملفّات (`chars / 2.5` في `/bot/knowledge`) — فالرقم المعروض هو الرقم
 *   الذي يُحاسَب عليه، لا تقديرٌ ثانٍ يخالفه.
 */
const fileUnits = (chars: number) => Math.ceil(chars / 2.5);

export function KnowledgeFiles({ sources, loading, onChanged, readOnly, lockReason, stalled }: {
  sources: KbSource[];
  loading: boolean;
  onChanged: () => void;
  readOnly: boolean;
  /**
   * سببُ القفل بعينه. كان مكتوباً هنا «حسابك للقراءة فقط» دائماً — وهي كذبةٌ
   * على الموظّف (حسابه يقرأ ويكتب، والصلاحيّة الناقصة هي إعدادات البوت) وعلى
   * المنتحِل (الانتحال قراءةٌ فقط لا حسابُه). والشاشة الأمّ تعرف السبب.
   */
  lockReason?: string;
  /** انقضت مدّةُ الاستقصاء ولم تنتهِ المعالجة — يُقال ولا يُترك دوراناً صامتاً. */
  stalled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<UpItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  /** الملفّ المرشَّح للحذف — والورقةُ هي الخطوة الثانية. */
  const [doomed, setDoomed] = useState<KbSource | null>(null);
  const [removing, setRemoving] = useState(false);

  const lock = lockReason ?? 'حسابك لا يملك ضبط البوت.';

  /**
   * البايتات خام لا multipart: ملفٌّ واحدٌ لكلّ طلب فالحالة والتقدّم لكلّ ملفٍّ
   * على حدة. والاسم يُرمَّز لأنّ الترويسات لاتينيّةٌ وأسماء الملفّات عربيّة.
   */
  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setErr(null);
    setBusy(true);
    setQueue(list.map((f) => ({ name: f.name, state: 'wait' as const })));

    const mark = (i: number, patch: Partial<UpItem>) => {
      setQueue((q) => (q ? q.map((it, j) => (j === i ? { ...it, ...patch } : it)) : q));
    };

    for (let i = 0; i < list.length; i += 1) {
      const f = list[i]!;
      // الحدُّ يُفحص هنا وفي الخادم: رفعُ 40 ميجابايت لِيُرفض بعد دقيقةٍ ليس فحصاً
      if (f.size > MAX_MB * 1024 * 1024) {
        mark(i, { state: 'fail', err: `أكبر من ${MAX_MB} ميجابايت` });
        continue;
      }
      mark(i, { state: 'up' });
      /* عبر عميل الـAPI لا `fetch` عارياً: فيه تجديد التوكن مرّةً عند 401.
         رفعٌ خامٌ مباشر كان يفشل بصمت إن انتهى توكن الوصول أثناء الجلسة. */
      try {
        await api('/bot/knowledge/files', {
          method: 'POST',
          body: f,
          headers: {
            'content-type': f.type || 'text/plain',
            // الترويسات لاتينيّة وأسماء الملفّات عربيّة — فالترميز إلزاميّ
            'x-file-name': encodeURIComponent(f.name),
          },
        });
        mark(i, { state: 'done' });
        /* ★ بعد كلّ ملفٍّ لا بعد الدفعة: من يرفع خمسةً يرى الأوّل في الجدول
           قبل أن ينتهي الخامس — وذاك الفرق بين تقدّمٍ وشاشةٍ ساكنة. */
        onChanged();
      } catch (e) {
        mark(i, { state: 'fail', err: e instanceof ApiError ? e.message : 'تعذّر الرفع' });
      }
    }

    setBusy(false);
    if (input.current) input.current.value = '';
    /* الدفعةُ التي نجحت كلُّها تُخفى — الجدول صار هو الخبر. والتي فيها إخفاقٌ
       تبقى ظاهرةً حتّى يُقرأ سببُه بجانب اسم ملفّه. */
    setQueue((q) => (q && q.some((it) => it.state === 'fail') ? q : null));
  }

  async function openPreview(id: string) {
    try {
      setPreview(await api<Preview>(`/bot/knowledge/files/${id}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّرت المعاينة');
    }
  }

  async function remove(row: KbSource) {
    setRemoving(true);
    try {
      await del(`/bot/knowledge/files/${row.id}`);
      setDoomed(null);
      onChanged();
    } catch (e) {
      setDoomed(null);
      setErr(e instanceof ApiError ? e.message : 'تعذّر الحذف');
    } finally {
      setRemoving(false);
    }
  }

  const columns: Array<Column<KbSource>> = [
    { key: 'title', head: 'الملفّ', cell: (r) => <span className="kb-name">{r.title}</span> },
    {
      key: 'status',
      head: 'هل قُرئ؟',
      cell: (r) => (
        <Pill
          tone={STATUS[r.status]?.tone ?? 'warn'}
          label={STATUS[r.status]?.label ?? r.status}
        />
      ),
    },
    {
      key: 'size',
      head: 'حجمه (وحدة قراءة)',
      num: true,
      /* الوحدةُ في رأس العمود لا في كلّ خليّة: عشرُ خلايا تكرّر «وحدة قراءة»
         تكسر تراصفَ الأرقام الذي وُضع العمودُ الرقميُّ من أجله. */
      cell: (r) => (r.status === 'ready'
        ? <span className="num">{fmt.num(fileUnits(r.charCount))}</span>
        : '—'),
    },
    { key: 'up', head: 'رُفع', cell: (r) => fmt.when(r.createdAt) },
    {
      key: 'act',
      head: 'أفعال',
      cell: (r) => (
        <div className="bot-acts">
          <Button
            size="sm"
            onClick={() => void openPreview(r.id)}
            disabled={r.status === 'pending'}
            reason="ما زال قيد المعالجة — لا نصَّ لنعرضه بعد"
          >
            عايِن
          </Button>
          {/* ★ الخطرُ في نهاية الصفّ وخلفه ورقة: كان بنقرةٍ واحدةٍ بجوار «عايِن» */}
          <Button
            size="sm"
            variant="danger"
            disabled={readOnly}
            reason={lock}
            onClick={() => setDoomed(r)}
          >
            احذفه
          </Button>
        </div>
      ),
    },
  ];

  const files = sources.filter((s) => s.kind === 'file');
  const pendingCount = files.filter((s) => s.status === 'pending').length;
  const upDone = queue ? queue.filter((it) => it.state === 'done' || it.state === 'fail').length : 0;
  const upTotal = queue?.length ?? 0;

  return (
    <Stack gap="md">
      {err && <Note tone="crit">{err}</Note>}

      {/* منطقة الإفلات: الحدث يُلغى صريحاً وإلّا فتح المتصفّح الملفّ في تبويب */}
      <div
        className={`drop${drag ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!readOnly) void upload(e.dataTransfer.files); }}
      >
        <b>أفلِت ملفّاتك هنا</b>
        <p>نصّ · Markdown · CSV · PDF · Word · Excel — حتّى {MAX_MB} ميجابايت للملفّ</p>
        <Button
          variant="primary" busy={busy} disabled={readOnly} reason={lock}
          onClick={() => input.current?.click()}
        >
          اختر ملفّاً
        </Button>
        <input
          ref={input} type="file" multiple accept={ACCEPT} className="hidden-file"
          onChange={(e) => e.target.files && void upload(e.target.files)}
        />
      </div>

      {/* ★ تقدّمٌ حقيقيّ: أيُّ ملفٍّ وصل، وأيُّها يُرفع الآن، وأيُّها سقط ولمَ. */}
      {queue && (
        <div className="kb-up" role="status" aria-live="polite">
          <div className="kb-up-h">
            <span>{busy ? 'يُرفع الآن' : 'انتهى الرفع'}</span>
            <span className="kb-up-c">
              <span className="num">{fmt.num(upDone)} / {fmt.num(upTotal)}</span> ملفّاً
            </span>
          </div>
          <Meter pct={upTotal ? upDone / upTotal : 0} tone="brand" />
          <ul className="kb-up-l">
            {queue.map((it) => (
              <li key={it.name} className={it.state === 'fail' ? 'fail' : undefined}>
                <span className="kb-name" dir="auto">{it.name}</span>
                <span>{it.state === 'fail' ? (it.err ?? UP_TEXT.fail) : UP_TEXT[it.state]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && <Skeleton rows={2} />}

      {/* ★ المعالجة في طابور: يُقال ماذا يجري، وأنّ الصفّ يتحدّث من نفسه —
          وحين تنقضي مدّةُ الاستقصاء يُقال ذلك أيضاً بدل دورانٍ صامتٍ أبديّ. */}
      {!loading && pendingCount > 0 && (
        <Note tone={stalled ? 'warn' : 'brand'}>
          {stalled
            ? (
              <>
                <b>تأخّرت المعالجة أكثر من المعتاد.</b> الملفّ ما زال في الطابور — أعِد تحميل
                الصفحة بعد قليل. وإن بقي هكذا فأبلِغنا باسم الملفّ.
              </>
            )
            : (
              <>
                <b>نقرأ ملفّك الآن</b> ونستخرج نصّه — والصفّ يتحدّث من نفسه حين يجهز، بلا أن
                تُحدِّث الصفحة.
              </>
            )}
        </Note>
      )}

      {!loading && !files.length && (
        <Empty
          title="لا ملفّات بعد"
          hint="ارفع قائمة أسعارٍ أو كتيّب خدماتٍ أو أسئلةً شائعة. نستخرج نصّه وتعاينه قبل أن تنشره — فلا يقرأ البوت جدولاً مشوّهاً."
        />
      )}

      {!loading && files.length > 0 && (
        <Table columns={columns} rows={files} keyOf={(r) => r.id} />
      )}

      <Note>
        <b>عايِن قبل أن تنشر.</b> «استُخرج» تعني أنّنا قرأنا الملفّ، لا أنّه صالح. PDF من صورٍ
        ممسوحة يُخرج فراغاً، وجدولاً معقّداً يُخرج سطوراً مشوّهة — وكلٌّ منهما يُفسد ردود بوتك
        بلا أن يُعلن. المعاينة دقيقةٌ واحدة تمنع أسبوعاً من تشخيصٍ خاطئ.
      </Note>

      {preview && (
        <Modal
          wide title={`معاينة «${preview.title}»`} onClose={() => setPreview(null)}
          footer={<Button onClick={() => setPreview(null)}>أغلِق</Button>}
        >
          <Stack gap="sm">
            <Row gap="sm">
              <Pill
                tone={STATUS[preview.status]?.tone ?? 'warn'}
                label={STATUS[preview.status]?.label ?? preview.status}
              />
              <Pill tone="neutral" label={`${fmt.num(fileUnits(preview.charCount))} وحدة قراءة`} />
            </Row>
            {preview.error && <Note tone="crit">{preview.error}</Note>}
            {!preview.preview.trim() && (
              <Note tone="crit">
                <b>لم يُستخرج أيّ نصّ.</b> الملفّ صورٌ ممسوحة على الأرجح. الحلّ: انسخ محتواه
                نصّاً في حقل المعرفة، أو حوّله بأداة OCR أوّلاً.
              </Note>
            )}
            {preview.preview.trim() && <pre className="kb-prev">{preview.preview}</pre>}
            {preview.truncated && (
              <p className="muted-p">
                هذه أوّل <span className="num">4,000</span> محرف — والبوت يقرأ كلّ النصّ.
              </p>
            )}
          </Stack>
        </Modal>
      )}

      {/* ═══ ورقةُ الحذف: الخطوة الثانية، وفيها العاقبةُ لا السؤالُ وحده ═══ */}
      <Sheet
        open={Boolean(doomed)}
        title="احذف هذا الملفّ من معرفة بوتك؟"
        onClose={() => setDoomed(null)}
        hint="ولا يُرجَع إلّا برفعه من جديد — النصّ المستخرَج يُمحى معه."
        footer={(
          <Row gap="sm">
            <Button
              variant="danger" wide busy={removing}
              onClick={() => { if (doomed) void remove(doomed); }}
            >
              احذفه نهائيّاً
            </Button>
            <Button onClick={() => setDoomed(null)}>أبقِه</Button>
          </Row>
        )}
      >
        <p className="muted-p">
          {doomed && <b dir="auto">«{doomed.title}»</b>}
          {' '}— بعد الحذف <b>ينسى بوتك ما فيه من أوّل ردٍّ قادم</b>، بلا انتظار نشر: مقاطعه
          تزول من النسخة التي تخدم زبائنك الآن.
        </p>
        <p className="muted-p">
          وإن كان فيه سعرٌ قديمٌ وحده فالأفضل رفعُ نسخةٍ محدَّثةٍ ثمّ حذفُ القديم — فلا تبقى
          فترةٌ يجيب فيها بوتك بلا هذه المعلومة.
        </p>
      </Sheet>
    </Stack>
  );
}
