import IORedis from 'ioredis';
import { getDb, kbChunks, kbRetrievals, sql, eq, and } from '@aibot/db';
import { getProvider, DEFAULT_EMBED_MODEL, EMBED_DIMS } from '@aibot/ai';
import {
  normalizeArabic, shouldSkipRetrieval, rrf, fitChunks,
  type KnowledgeChunk, type KnowledgeProvider,
} from '@aibot/core';
import { sha256 } from '@aibot/crypto';

/**
 * ★ الاسترجاع الهجين.
 *
 * **لماذا هجين ولا متجهيّ وحده:** البحث المتجهيّ يُجيد المعنى ويفشل في الرموز
 * الحرفيّة — سعرٌ محدَّد، رقم فرع، كود صنف، اسم طبيب. وهذه بالضبط ما يسأل عنه
 * زبون المطعم والعيادة. البحث اللفظيّ يلتقطها، والدمج بـRRF لا يحتاج معايرة أوزان.
 */

let redis: IORedis | null = null;
function cache(): IORedis {
  if (!redis) redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null, enableReadyCheck: false });
  return redis;
}

const EMBED_CACHE_TTL = 7 * 24 * 60 * 60;

/**
 * تضمين الاستعلام، بكاشٍ على النصّ **المطبَّع**.
 * التطبيع يرفع الإصابة كثيراً: «بكم السعر» و«بكم السّعر؟» و«بِكَم السعر»
 * تصير مفتاحاً واحداً — فلا نداء تضمينٍ لكلّ صياغة.
 */
export async function embedQuery(text: string): Promise<{ vec: number[]; cacheHit: boolean }> {
  const norm = normalizeArabic(text);
  const key = `emb:q:${DEFAULT_EMBED_MODEL}:${sha256(norm).slice(0, 32)}`;

  const hit = await cache().get(key).catch(() => null);
  if (hit) return { vec: JSON.parse(hit) as number[], cacheHit: true };

  const [vec] = await getProvider('google').embed({
    texts: [norm],
    model: DEFAULT_EMBED_MODEL,
    // ⚠️ RETRIEVAL_QUERY للاستعلام — لا RETRIEVAL_DOCUMENT.
    //    الخلط لا يُنتج خطأً، يُنتج ترتيباً أسوأ بصمت.
    taskType: 'RETRIEVAL_QUERY',
    dimensions: EMBED_DIMS,
  }, process.env.PLATFORM_AI_KEY!);

  await cache().setex(key, EMBED_CACHE_TTL, JSON.stringify(vec)).catch(() => undefined);
  return { vec: vec!, cacheHit: false };
}

export class RagKnowledge implements KnowledgeProvider {
  private lastQuery = '';
  constructor(
    private readonly tenantId: string,
    private readonly versionId: string,
    readonly mode: 'hybrid' | 'rag',
  ) {}

  /** الأساسيات — تُحقن دائماً ولا تنافس على مقاعد الاسترجاع. */
  async pinned(): Promise<KnowledgeChunk[]> {
    const rows = await getDb().select({
      id: kbChunks.id, headingPath: kbChunks.headingPath,
      body: kbChunks.body, tokenCount: kbChunks.tokenCount,
    }).from(kbChunks).where(and(
      eq(kbChunks.versionId, this.versionId),
      eq(kbChunks.pinned, true),
      eq(kbChunks.kind, 'chunk'),
    )).orderBy(kbChunks.ord);
    return rows.map((r) => ({ ...r, pinned: true }));
  }

  async retrieve(query: string, budgetTokens: number) {
    const started = Date.now();
    this.lastQuery = query;

    if (shouldSkipRetrieval(query)) {
      return { chunks: [], skipped: true, cacheHit: false, latencyMs: Date.now() - started };
    }

    const { vec, cacheHit } = await embedQuery(query);
    const lists = await hybridSearch(this.versionId, query, vec, 20);
    const top = rrf(lists, 60, 6).map((f) => f.item);

    return {
      chunks: fitChunks(top, budgetTokens),
      skipped: false,
      cacheHit,
      latencyMs: Date.now() - started,
    };
  }

  get query(): string { return this.lastQuery; }
}

/** صفٌّ خام من القاعدة — الفهرس النصّيّ يلزم لأنّ drizzle يُرجع سجلّاً عامّاً. */
interface Hit extends KnowledgeChunk {
  score: number;
  [k: string]: unknown;
}

/**
 * مساران متوازيان ثمّ دمجٌ بـRRF.
 *
 * ملاحظة أداء مقصودة: **لا فهرس HNSW** حتّى يتجاوز الجدول ~100 ألف صفّ.
 * معرفةُ عميلٍ في باقة «أعمال» ≈ 400 مقطع؛ المسح الدقيق ضمن `version_id`
 * على مئات الصفوف أسرع من الفهرس التقريبيّ **وأدقّ منه**.
 */
export async function hybridSearch(
  versionId: string,
  queryText: string,
  queryVec: number[],
  limit = 20,
): Promise<Hit[][]> {
  const db = getDb();
  const vecLiteral = `[${queryVec.join(',')}]`;
  const norm = normalizeArabic(queryText);

  const [vector, lexical] = await Promise.all([
    db.execute<Hit>(sql`
      SELECT c.id, c.heading_path AS "headingPath", c.body, c.token_count AS "tokenCount",
             false AS pinned,
             1 - (c.embedding <=> ${vecLiteral}::vector) AS score
        FROM kb_chunks c
       WHERE c.version_id = ${versionId} AND c.pinned = false
       ORDER BY c.embedding <=> ${vecLiteral}::vector
       LIMIT ${limit}
    `),
    db.execute<Hit>(sql`
      SELECT c.id, c.heading_path AS "headingPath", c.body, c.token_count AS "tokenCount",
             false AS pinned,
             ts_rank(c.tsv, plainto_tsquery('arabic', ${norm}))
               + similarity(c.body, ${norm}) AS score
        FROM kb_chunks c
       WHERE c.version_id = ${versionId} AND c.pinned = false
         AND (c.tsv @@ plainto_tsquery('arabic', ${norm}) OR c.body % ${norm})
       ORDER BY score DESC
       LIMIT ${limit}
    `),
  ]);

  // مفاتيح العاميّة (kind='question') تشير إلى المقطع الأمّ — تُستبدل به قبل الدمج
  return [resolveParents(vector as unknown as Hit[]), resolveParents(lexical as unknown as Hit[])];
}

function resolveParents(rows: Hit[]): Hit[] {
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/** يُسجَّل لكلّ ردّ — ومنه تُبنى بوّابة التبديل وقياس جودة الاسترجاع. */
export async function logRetrieval(row: {
  tenantId: string; conversationId: string; aiRunId?: string; mode: string;
  queryText: string; chunkIds: string[]; retrievedTokens: number;
  cacheHit: boolean; skipped: boolean; toolFallbackUsed: boolean; latencyMs: number;
}): Promise<void> {
  await getDb().insert(kbRetrievals).values({
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    aiRunId: row.aiRunId ?? null,
    mode: row.mode,
    queryText: row.queryText.slice(0, 500),
    chunkIds: row.chunkIds,
    retrievedTokens: row.retrievedTokens,
    cacheHit: row.cacheHit,
    skipped: row.skipped,
    toolFallbackUsed: row.toolFallbackUsed,
    latencyMs: row.latencyMs,
  }).catch(() => undefined); // القياس لا يُسقط ردّاً
}
