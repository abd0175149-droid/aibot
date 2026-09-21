'use client';

import { useRef, useState } from 'react';
import { api, del, ApiError } from '@/lib/api';
import {
  Button, Row, Stack, Pill, Note, Modal, Skeleton, Empty, Table, type Column,
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
 *   ولذلك `ready` تعني «استُخرج» لا «معتمَد».
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

const STATUS: Record<string, { tone: 'ok' | 'warn' | 'crit'; label: string }> = {
  ready: { tone: 'ok', label: 'استُخرج' },
  pending: { tone: 'warn', label: 'قيد المعالجة' },
  failed: { tone: 'crit', label: 'فشل' },
};

export function KnowledgeFiles({ sources, loading, onChanged, readOnly }: {
  sources: KbSource[];
  loading: boolean;
  onChanged: () => void;
  readOnly: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  /**
   * البايتات خام لا multipart: ملفٌّ واحدٌ لكلّ طلب فالحالة والتقدّم لكلّ ملفٍّ
   * على حدة. والاسم يُرمَّز لأنّ الترويسات لاتينيّةٌ وأسماء الملفّات عربيّة.
   */
  async function upload(files: FileList | File[]) {
    setErr(null);
    setBusy(true);
    const failures: string[] = [];
    try {
      for (const f of Array.from(files)) {
        if (f.size > MAX_MB * 1024 * 1024) {
          failures.push(`${f.name}: أكبر من ${MAX_MB} ميجابايت`);
          continue;
        }
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
        } catch (e) {
          failures.push(`${f.name}: ${e instanceof ApiError ? e.message : 'تعذّر الرفع'}`);
        }
      }
      if (failures.length) setErr(failures.join(' · '));
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function openPreview(id: string) {
    try {
      setPreview(await api<Preview>(`/bot/knowledge/files/${id}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّرت المعاينة');
    }
  }

  async function remove(id: string) {
    try {
      await del(`/bot/knowledge/files/${id}`);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر الحذف');
    }
  }

  const columns: Array<Column<KbSource>> = [
    { key: 'title', head: 'الملفّ', cell: (r) => r.title },
    {
      key: 'status',
      head: 'الحالة',
      cell: (r) => <Pill tone={STATUS[r.status]?.tone ?? 'warn'} label={STATUS[r.status]?.label ?? r.status} />,
    },
    { key: 'chars', head: 'محارف', num: true, cell: (r) => r.charCount.toLocaleString('en-US') },
    {
      key: 'act',
      head: '',
      cell: (r) => (
        <Row gap="xs">
          <Button size="sm" onClick={() => void openPreview(r.id)}
            disabled={r.status === 'pending'} reason="ما زال قيد المعالجة">
            عايِن
          </Button>
          <Button size="sm" variant="danger" disabled={readOnly} reason="حسابك للقراءة فقط"
            onClick={() => void remove(r.id)}>
            احذف
          </Button>
        </Row>
      ),
    },
  ];

  const files = sources.filter((s) => s.kind === 'file');

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
        <Button variant="primary" busy={busy} disabled={readOnly} reason="حسابك للقراءة فقط"
          onClick={() => input.current?.click()}>
          اختر ملفّاً
        </Button>
        <input
          ref={input} type="file" multiple accept={ACCEPT} className="hidden-file"
          onChange={(e) => e.target.files && void upload(e.target.files)}
        />
      </div>

      {loading && <Skeleton rows={2} />}

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
        <Modal wide title={`معاينة «${preview.title}»`} onClose={() => setPreview(null)}
          footer={<Button onClick={() => setPreview(null)}>أغلِق</Button>}>
          <Stack gap="sm">
            <Row gap="sm">
              <Pill tone={STATUS[preview.status]?.tone ?? 'warn'} label={STATUS[preview.status]?.label ?? preview.status} />
              <Pill tone="neutral" label={`${preview.charCount.toLocaleString('en-US')} محرف`} />
            </Row>
            {preview.error && <Note tone="crit">{preview.error}</Note>}
            {!preview.preview.trim() && (
              <Note tone="crit">
                <b>لم يُستخرج أيّ نصّ.</b> الملفّ صورٌ ممسوحة على الأرجح. الحلّ: انسخ محتواه
                نصّاً في تبويب المعرفة، أو حوّله بأداة OCR أوّلاً.
              </Note>
            )}
            {preview.preview.trim() && <pre className="kb-prev">{preview.preview}</pre>}
            {preview.truncated && <p className="muted-p">هذه أوّل 4000 محرف — والبوت يقرأ كلّ النصّ.</p>}
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}
