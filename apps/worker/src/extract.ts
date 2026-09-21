import { readFile } from 'node:fs/promises';
import { getDb, withTenant, knowledgeSources, eq } from '@aibot/db';

/**
 * استيعاب المعرفة: ملفّ ← نصّ نظيف.
 *
 * التنظيف ليس تجميلاً. الملفّ الملقَّم كما هو — بجداولٍ مشوّهة وترويساتٍ
 * مكرّرة وأرقام صفحات — **يُفسد الردود**، ويُفسد التقطيع، ويُفسد التضمين.
 * ولذلك المعاينة للعميل قبل الاعتماد شرطٌ لا خيار.
 */

export interface Extracted {
  text: string;
  pages?: number;
  warnings: string[];
}

export async function handleIngest(job: { tenantId: string; sourceId: string; path: string; mime: string }): Promise<void> {
  const db = getDb();
  try {
    const buf = await readFile(job.path);
    const out = await extract(buf, job.mime);
    const clean = cleanText(out.text);

    /* `withTenant` لا `db` المجرّد: `knowledge_sources` تحت RLS، والمهمّة
       تحمل `tenantId` فلا عذر. بلا سياقٍ يمرّ التحديث على **صفر صفوف** بلا
       خطأ، فيبقى الملفّ عند العميل «قيد المعالجة» إلى الأبد. */
    await withTenant(db, job.tenantId, (tx) => tx.update(knowledgeSources).set({
      extractedText: clean,
      charCount: clean.length,
      // `ready` لا تعني «معتمدة» — العميل يعاين ثمّ ينشر
      status: clean.trim() ? 'ready' : 'failed',
      error: clean.trim() ? (out.warnings.join(' · ') || null) : 'لم يُستخرج أيّ نصّ — الملفّ صورٌ على الأرجح',
    }).where(eq(knowledgeSources.id, job.sourceId)));
  } catch (e) {
    await withTenant(db, job.tenantId, (tx) => tx.update(knowledgeSources).set({
      status: 'failed', error: (e as Error).message,
    }).where(eq(knowledgeSources.id, job.sourceId)));
    throw e;
  }
}

export async function extract(buf: Buffer, mime: string): Promise<Extracted> {
  if (mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/csv') {
    return { text: buf.toString('utf8'), warnings: [] };
  }
  if (mime === 'application/pdf') return extractPdf(buf);
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return extractDocx(buf);
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel') return extractXlsx(buf);
  throw new Error(`نوع ملفٍّ غير مدعوم: ${mime}`);
}

async function extractPdf(buf: Buffer): Promise<Extracted> {
  const { default: pdfParse } = await import('pdf-parse');
  const res = await pdfParse(buf);
  const warnings: string[] = [];
  // نصٌّ ضئيل مع صفحاتٍ كثيرة = PDF مصوَّر يحتاج OCR، لا ملفّ نصّيّ
  if (res.text.trim().length < res.numpages * 40) {
    warnings.push('النصّ المستخرَج قليلٌ جدّاً — الملفّ صورٌ على الأرجح ويحتاج OCR');
  }
  return { text: res.text, pages: res.numpages, warnings };
}

async function extractDocx(buf: Buffer): Promise<Extracted> {
  const mammoth = await import('mammoth');
  const res = await mammoth.extractRawText({ buffer: buf });
  return {
    text: res.value,
    warnings: res.messages.filter((m) => m.type === 'warning').map((m) => m.message).slice(0, 3),
  };
}

async function extractXlsx(buf: Buffer): Promise<Extracted> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    // الجداول تُحوَّل إلى «عمود: قيمة» لا إلى CSV —
    // صفٌّ مفصولٌ بفواصل يفقد معناه في التقطيع والتضمين معاً.
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    if (!rows.length) continue;
    parts.push(`# ${name}`);
    for (const row of rows) {
      const line = Object.entries(row)
        .filter(([, v]) => String(v).trim())
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
      if (line) parts.push(line);
    }
  }
  return { text: parts.join('\n'), warnings: [] };
}

/**
 * التنظيف.
 * كلّ قاعدةٍ هنا تقابل شيئاً يُفسد الردّ فعلاً، لا تحسيناً تجميليّاً.
 */
export function cleanText(raw: string): string {
  let t = raw.replace(/\r\n?/g, '\n');

  t = t.replace(/ /g, ' ');                    // مسافةٌ غير قابلة للكسر تكسر المطابقة
  t = t.replace(/[​-‏‪-‮]/g, ''); // محارف اتّجاهٍ خفيّة تُفسد RTL
  t = t.replace(/ـ{2,}/g, 'ـ');            // تطويلٌ مفرط

  // أرقام صفحاتٍ على سطرٍ وحدها — تتكرّر في كلّ مقطعٍ فتُشوّش الاسترجاع
  t = t.replace(/^\s*(?:صفحة\s*)?\d+\s*(?:\/\s*\d+)?\s*$/gm, '');

  // ترويسة/تذييلٌ يتكرّر في كلّ صفحة: أيّ سطرٍ قصير تكرّر أكثر من ثلاث مرّات
  const lines = t.split('\n');
  const counts = new Map<string, number>();
  for (const l of lines) {
    const k = l.trim();
    if (k.length > 3 && k.length < 60) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const boilerplate = new Set([...counts.entries()].filter(([, n]) => n > 3).map(([k]) => k));
  t = lines.filter((l) => !boilerplate.has(l.trim())).join('\n');

  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}
