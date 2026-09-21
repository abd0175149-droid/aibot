import {
  getDb, withTenant, botVersions, botConfigs, knowledgeSources, kbChunks,
  eq, and, sql, inArray,
} from '@aibot/db';
import { getProvider, DEFAULT_EMBED_MODEL, EMBED_DIMS } from '@aibot/ai';
import { estimateTokens } from '@aibot/core';
import { sha256 } from '@aibot/crypto';
import { raiseIncident } from './incidents.js';

/**
 * ★ خطّ التضمين: من نصٍّ إلى فكتور.
 *
 * يجري في الطابور بعد النشر، ولا شيء منه في مسار الردّ.
 * والنسخة لا تُنشر قبل أن يكتمل — فلا محادثةٌ جارية ترى معرفةً نصفَ مضمَّنة.
 */
export async function handleEmbed(job: { tenantId: string; versionId: string }): Promise<void> {
  const db = getDb();

  try {
    await withTenant(db, job.tenantId, async (tx) => {
      const ver = (await tx.select().from(botVersions).where(eq(botVersions.id, job.versionId)).limit(1))[0];
      if (!ver) return;

      const sources = await tx.select().from(knowledgeSources).where(and(
        eq(knowledgeSources.tenantId, job.tenantId),
        eq(knowledgeSources.status, 'ready'),
      ));

      /* ① التقطيع الواعي بالعناوين، ثمّ بالحجم. */
      const pieces: Array<{ sourceId: string | null; ord: number; heading: string | null; body: string; pinned: boolean }> = [];

      // البطاقة الأساسيّة والمحظورات: مقاطع مثبَّتة تُحقن دائماً
      const core = ((ver.params ?? {}) as { coreCard?: string }).coreCard ?? '';
      if (core.trim()) {
        pieces.push({ sourceId: null, ord: 0, heading: 'الأساسيات', body: core.trim(), pinned: true });
      }

      let ord = 1;
      for (const s of sources) {
        for (const c of chunkText(s.extractedText ?? '')) {
          pieces.push({ sourceId: s.id, ord: ord++, heading: c.heading, body: c.body, pinned: false });
        }
      }
      if (!pieces.length && ver.knowledgeBase.trim()) {
        for (const c of chunkText(ver.knowledgeBase)) {
          pieces.push({ sourceId: null, ord: ord++, heading: c.heading, body: c.body, pinned: false });
        }
      }

      /* ② بصمة المحتوى: لا يُعاد تضمين ما لم يتغيّر.
         عميلٌ يصحّح سعراً واحداً لا يعيد تضمين 400 مقطع. */
      const hashes = pieces.map((p) => sha256(`${p.heading ?? ''}\n${p.body}`).slice(0, 40));
      const existing = hashes.length
        ? await tx.select({ hash: kbChunks.contentHash, embedding: kbChunks.embedding, body: kbChunks.body })
            .from(kbChunks)
            .where(and(eq(kbChunks.tenantId, job.tenantId), inArray(kbChunks.contentHash, hashes),
                       eq(kbChunks.embedModel, DEFAULT_EMBED_MODEL)))
        : [];
      const reuse = new Map(existing.map((e) => [e.hash, e.embedding]));

      const toEmbed = pieces.filter((_, i) => !reuse.has(hashes[i]!));

      /* ③ التضمين على دفعات. RETRIEVAL_DOCUMENT للمقاطع — لا RETRIEVAL_QUERY. */
      const fresh = new Map<string, number[]>();
      const provider = getProvider('google');
      for (let i = 0; i < toEmbed.length; i += 32) {
        const batch = toEmbed.slice(i, i + 32);
        const vecs = await provider.embed({
          texts: batch.map((p) => `${p.heading ? p.heading + '\n' : ''}${p.body}`),
          model: DEFAULT_EMBED_MODEL,
          taskType: 'RETRIEVAL_DOCUMENT',
          dimensions: EMBED_DIMS,
        }, process.env.PLATFORM_AI_KEY!);
        batch.forEach((p, j) => {
          fresh.set(sha256(`${p.heading ?? ''}\n${p.body}`).slice(0, 40), vecs[j]!);
        });
      }

      /* ④ الكتابة: نسخةٌ جديدة تعني مجموعةً جديدة من المقاطع. */
      await tx.delete(kbChunks).where(eq(kbChunks.versionId, job.versionId));

      const rows = pieces.map((p, i) => {
        const hash = hashes[i]!;
        const vec = reuse.get(hash) ?? fresh.get(hash);
        if (!vec) throw new Error(`لا متجه للمقطع ${i}`);
        return {
          tenantId: job.tenantId,
          versionId: job.versionId,
          sourceId: p.sourceId,
          ord: p.ord,
          headingPath: p.heading,
          body: p.body,
          kind: 'chunk' as const,
          pinned: p.pinned,
          tokenCount: estimateTokens(p.body),
          contentHash: hash,
          embedModel: DEFAULT_EMBED_MODEL,
          embedding: vec,
        };
      });
      for (let i = 0; i < rows.length; i += 100) {
        await tx.insert(kbChunks).values(rows.slice(i, i + 100));
      }

      /* ⑤ النشر يكتمل الآن — والنسخة القديمة خدمت حتّى هذه اللحظة. */
      await tx.update(botVersions).set({ embedStatus: 'ready' }).where(eq(botVersions.id, job.versionId));
      await tx.update(botConfigs).set({ publishedVersionId: job.versionId })
        .where(eq(botConfigs.tenantId, job.tenantId));
    });
  } catch (e) {
    /* ⚠️ `withTenant` هنا أيضاً — ولا سيّما هنا. `bot_versions` تحت RLS،
       فتحديثٌ بلا سياق يمرّ على صفر صفوف بلا خطأ، فتبقى النسخة `pending`
       إلى الأبد، وتُسكِت بوّابة `embedStatus === 'pending'` في عامل الردّ
       بوتَ العميل **بلا رجعة**. عطلٌ دائمٌ من سطرٍ ناقصٍ واحد. */
    await withTenant(db, job.tenantId, (tx) => tx.update(botVersions)
      .set({ embedStatus: 'failed' })
      .where(eq(botVersions.id, job.versionId)));
    await raiseIncident({
      tenantId: job.tenantId, kind: 'kb_embed_failed', severity: 'warn',
      title: 'فشل تجهيز المعرفة — النسخة السابقة ما زالت تعمل',
      detail: { versionId: job.versionId, error: (e as Error).message },
      causeKey: job.versionId,
    });
    throw e;
  }
}

/**
 * تقطيعٌ واعٍ بالعناوين ثمّ بالحجم: 600–900 توكن بتداخل 120.
 * `heading` يُحقن مع المقطع — مقطعٌ بلا عنوانٍ يفقد سياقه
 * («150 ديناراً» لأيّ خدمة؟).
 */
export function chunkText(
  text: string,
  target = 800,
  overlap = 120,
): Array<{ heading: string | null; body: string }> {
  const out: Array<{ heading: string | null; body: string }> = [];
  if (!text.trim()) return out;

  // أوّلاً على العناوين (Markdown أو سطرٌ قصيرٌ ينتهي بنقطتين)
  const sections: Array<{ heading: string | null; body: string }> = [];
  let heading: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) sections.push({ heading, body });
    buf = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const h = /^#{1,4}\s+(.+)$/.exec(line) ?? /^(.{3,60}):\s*$/.exec(line);
    if (h) { flush(); heading = h[1]!.trim(); continue; }
    buf.push(line);
  }
  flush();

  // ثمّ على الحجم، بحدود الفقرات
  for (const s of sections) {
    if (estimateTokens(s.body) <= target) { out.push(s); continue; }
    const paras = s.body.split(/\n{2,}/);
    let cur: string[] = [];
    for (const p of paras) {
      const next = [...cur, p].join('\n\n');
      if (estimateTokens(next) > target && cur.length) {
        out.push({ heading: s.heading, body: cur.join('\n\n') });
        // التداخل يمنع ضياع جملةٍ على الحدّ بين مقطعين
        const tail = cur[cur.length - 1] ?? '';
        cur = estimateTokens(tail) <= overlap ? [tail, p] : [p];
      } else {
        cur.push(p);
      }
    }
    if (cur.length) out.push({ heading: s.heading, body: cur.join('\n\n') });
  }
  return out;
}
