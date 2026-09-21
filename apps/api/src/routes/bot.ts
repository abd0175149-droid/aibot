import type { FastifyInstance } from 'fastify';
import {
  getDb, withTenant, botConfigs, botVersions, botTools, knowledgeSources, aiRuns,
  kbChunks, eq, and, desc, sql,
} from '@aibot/db';
import { AppError, ErrorCode } from '@aibot/shared';
import { seal } from '@aibot/crypto';
import { decideKnowledgeMode, estimateTokens, execHttpTool, assertPublicUrl, type HttpToolSpec } from '@aibot/core';
import { requireAuth, tenantOf } from '../auth.js';
import { enqueueEmbed } from '../queues.js';

export async function registerBot(app: FastifyInstance) {
  const auth = requireAuth({ settings: true });

  app.get('/bot', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
      const published = cfg?.publishedVersionId
        ? (await tx.select().from(botVersions).where(eq(botVersions.id, cfg.publishedVersionId)).limit(1))[0]
        : null;
      return { config: cfg ?? null, published: published ?? null, draft: cfg?.draft ?? null };
    });
  });

  app.put<{ Body: Record<string, unknown> }>('/bot/draft', { preHandler: auth }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const [row] = await tx.insert(botConfigs)
        .values({ tenantId, draft: req.body as object, updatedBy: req.auth!.sub })
        .onConflictDoUpdate({
          target: botConfigs.tenantId,
          set: { draft: req.body as object, updatedBy: req.auth!.sub, updatedAt: new Date() },
        })
        .returning();
      return row;
    });
  });

  /**
   * النشر.
   *
   * ينشئ نسخةً جديدة — ولا يعدّل في مكانه أبداً، فالتراجع نشرُ نسخةٍ قديمة.
   * وحين تتجاوز المعرفة العتبة، النشر **غير متزامن**: يُوسم `pending` ويُدفع
   * التضمين للطابور، والنسخة القديمة تخدم حتّى تجهز الجديدة. فلا محادثةٌ
   * جارية ترى معرفةً نصفَ مضمَّنة.
   */
  app.post<{ Body: { note?: string } }>('/bot/publish', { preHandler: auth }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
      const draft = (cfg?.draft ?? {}) as Record<string, unknown>;
      if (!cfg || !Object.keys(draft).length) {
        throw new AppError(ErrorCode.VALIDATION, 'لا مسوّدة لنشرها', 400);
      }

      const last = (await tx.select({ v: botVersions.version }).from(botVersions)
        .where(eq(botVersions.tenantId, tenantId)).orderBy(desc(botVersions.version)).limit(1))[0];

      const kb = String(draft.knowledgeBase ?? '');
      const kbTokens = estimateTokens(kb);
      const mode = decideKnowledgeMode(kbTokens);

      const [ver] = await tx.insert(botVersions).values({
        tenantId,
        version: (last?.v ?? 0) + 1,
        persona: String(draft.persona ?? ''),
        knowledgeBase: kb,
        toolsConfig: (draft.toolsConfig ?? {}) as object,
        provider: String(draft.provider ?? 'google'),
        model: String(draft.model ?? 'gemini-2.5-flash'),
        params: (draft.params ?? {}) as object,
        knowledgeMode: mode,
        knowledgeBudget: (draft.knowledgeBudget ?? {}) as object,
        embedStatus: mode === 'full' ? 'skipped' : 'pending',
        publishedBy: req.auth!.sub,
        publishedAt: new Date(),
        note: req.body?.note ?? null,
      }).returning();

      // النسخة الجديدة تُنشر فوراً في وضع full، وتنتظر التضمين في غيره
      if (mode === 'full') {
        await tx.update(botConfigs).set({ publishedVersionId: ver!.id })
          .where(eq(botConfigs.tenantId, tenantId));
      } else {
        await enqueueEmbed({ tenantId, versionId: ver!.id });
      }

      return { version: ver, knowledgeMode: mode, kbTokens, embedding: mode !== 'full' };
    });
  });

  app.get('/bot/versions', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) =>
      tx.select({
        id: botVersions.id, version: botVersions.version, note: botVersions.note,
        publishedAt: botVersions.publishedAt, knowledgeMode: botVersions.knowledgeMode,
        embedStatus: botVersions.embedStatus,
      }).from(botVersions).where(eq(botVersions.tenantId, tenantId))
        .orderBy(desc(botVersions.version)).limit(50));
  });

  /** التراجع = نشرُ نسخةٍ قديمة. لا تعديلَ في مكانه ولا فقدان تاريخ. */
  app.post<{ Params: { id: string } }>('/bot/versions/:id/rollback', { preHandler: auth }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const ver = (await tx.select().from(botVersions).where(eq(botVersions.id, req.params.id)).limit(1))[0];
      if (!ver) throw new AppError(ErrorCode.VALIDATION, 'نسخةٌ غير موجودة', 404);
      if (ver.embedStatus === 'pending') {
        throw new AppError(ErrorCode.VALIDATION, 'هذه النسخة ما زالت تُضمَّن', 409);
      }
      await tx.update(botConfigs).set({ publishedVersionId: ver.id })
        .where(eq(botConfigs.tenantId, tenantId));
      return { ok: true, version: ver.version };
    });
  });

  app.post<{ Body: { enabled: boolean } }>('/bot/toggle', { preHandler: auth }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const [row] = await tx.update(botConfigs).set({ enabled: Boolean(req.body?.enabled) })
        .where(eq(botConfigs.tenantId, tenantId)).returning();
      return row;
    });
  });

  /* ───────────────────────── الأدوات ───────────────────────── */

  app.get('/bot/tools', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const rows = await tx.select().from(botTools).where(eq(botTools.tenantId, tenantId));
      // لا يُعاد سرٌّ للواجهة أبداً — حتّى وجوده يُعرض كعلمٍ لا كقيمة
      return rows.map(({ secretsEnc, ...rest }) => ({ ...rest, hasSecrets: Boolean(secretsEnc) }));
    });
  });

  app.post<{ Body: Record<string, any> }>('/bot/tools', { preHandler: auth }, async (req) => {
    const tenantId = tenantOf(req);
    const b = req.body ?? {};
    if (b.http?.url) await assertPublicUrl(String(b.http.url)).catch((e) => {
      throw new AppError(ErrorCode.TOOL_BLOCKED, (e as Error).message, 400);
    });
    return withTenant(getDb(), tenantId, async (tx) => {
      const sealed = b.secrets ? seal(JSON.stringify(b.secrets)) : null;
      const [row] = await tx.insert(botTools).values({
        tenantId,
        key: String(b.key), titleAr: String(b.titleAr), description: String(b.description),
        kind: 'http',
        requiresCapabilities: Array.isArray(b.requiresCapabilities) ? b.requiresCapabilities : [],
        paramsSchema: b.paramsSchema ?? { type: 'object', properties: {} },
        http: b.http ?? null,
        responseMap: b.responseMap ?? null,
        secretsEnc: sealed?.enc ?? null,
        keyVersion: sealed?.keyVersion ?? 1,
        confirmRequired: Boolean(b.confirmRequired),
        confirmTemplate: b.confirmTemplate ?? null,
      }).returning();
      const { secretsEnc, ...safe } = row!;
      return safe;
    });
  });

  /**
   * زرّ «تجربة».
   * يُنفّذ النداء بعيّنةٍ ويعرض الطلب والاستجابة والحقول المستخرَجة **قبل الحفظ** —
   * فلا يكتشف العميل خطأ المسار من ردٍّ خاطئٍ لزبون.
   */
  app.post<{ Params: { id: string }; Body: { sampleParams?: Record<string, unknown> } }>(
    '/bot/tools/:id/test',
    { preHandler: auth },
    async (req) => {
      const tenantId = tenantOf(req);
      return withTenant(getDb(), tenantId, async (tx) => {
        const tool = (await tx.select().from(botTools).where(eq(botTools.id, req.params.id)).limit(1))[0];
        if (!tool) throw new AppError(ErrorCode.VALIDATION, 'أداةٌ غير موجودة', 404);
        const secrets: Record<string, string> = tool.secretsEnc
          ? JSON.parse((await import('@aibot/crypto')).open(tool.secretsEnc, tool.keyVersion))
          : {};
        const res = await execHttpTool(
          tool.http as HttpToolSpec,
          req.body?.sampleParams ?? {},
          secrets,
          (tool.responseMap ?? null) as Record<string, string> | null,
          { debug: true },
        );
        // الترويسات لا تُعاد — فيها السرّ الذي حقنّاه للتوّ
        return { ok: res.ok, status: res.status, mapped: res.mapped, error: res.error, ms: res.ms, debug: res.debug };
      });
    },
  );

  app.delete<{ Params: { id: string } }>('/bot/tools/:id', { preHandler: auth }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      await tx.delete(botTools).where(eq(botTools.id, req.params.id));
      return { ok: true };
    });
  });

  /* ───────────────────────── المعرفة ───────────────────────── */

  app.get('/bot/knowledge', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const sources = await tx.select({
        id: knowledgeSources.id, kind: knowledgeSources.kind, title: knowledgeSources.title,
        charCount: knowledgeSources.charCount, status: knowledgeSources.status,
        createdAt: knowledgeSources.createdAt,
      }).from(knowledgeSources).where(eq(knowledgeSources.tenantId, tenantId));

      const chunks = (await tx.select({ n: sql<number>`count(*)::int` })
        .from(kbChunks).where(eq(kbChunks.tenantId, tenantId)))[0]?.n ?? 0;

      const total = sources.reduce((a, s) => a + s.charCount, 0);
      const tokens = Math.ceil(total / 2.5);
      return { sources, chunks, chars: total, tokens, suggestedMode: decideKnowledgeMode(tokens) };
    });
  });

  /**
   * فجوات المعرفة — وتمييزٌ يوفّر على العميل أسبوعاً.
   *
   * «بحث ولم يجد» = المعرفة ناقصة، يحلّها العميل بإضافة نصّ.
   * «وجد ولم يُجب» = المعرفة موجودة والمشكلة في الشخصيّة أو التقطيع، تحلّها أنت.
   * بلا هذا التمييز يضيف العميل محتوًى لمشكلةٍ ليست فيه.
   */
  app.get('/bot/knowledge/gaps', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const rows = await tx.execute<{
        query: string; times: number; retrieved: number;
      }>(sql`
        SELECT coalesce(r.query_text, '(بلا استعلام)') AS query,
               count(*)::int                           AS times,
               coalesce(max(array_length(r.chunk_ids, 1)), 0)::int AS retrieved
          FROM ai_runs a
          LEFT JOIN kb_retrievals r ON r.ai_run_id = a.id
         WHERE a.tenant_id = ${tenantId}
           AND (a.flags->>'unknown')::boolean IS TRUE
           AND a.created_at > now() - interval '30 days'
         GROUP BY 1
         ORDER BY times DESC
         LIMIT 50
      `);
      return (rows as unknown as Array<{ query: string; times: number; retrieved: number }>).map((r) => ({
        ...r,
        diagnosis: r.retrieved === 0 ? 'بحث ولم يجد — المعرفة ناقصة' : 'وجد ولم يُجب — راجع الشخصيّة أو التقطيع',
      }));
    });
  });
}
