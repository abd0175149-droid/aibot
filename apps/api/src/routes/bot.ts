import type { FastifyInstance } from 'fastify';
import {
  getDb, withTenant, withPlatform, botConfigs, botVersions, botTools, knowledgeSources, aiRuns,
  kbChunks, auditLog, prices, eq, and, desc, sql,
} from '@aibot/db';
import { AppError, ErrorCode } from '@aibot/shared';
import { seal } from '@aibot/crypto';
import { decideKnowledgeMode, estimateTokens, execHttpTool, assertPublicUrl, type HttpToolSpec } from '@aibot/core';
import { requireAuth, tenantOf } from '../auth.js';
import { enqueueEmbed, enqueueIngest } from '../queues.js';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

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
  /**
   * النشر — مُستخرَجٌ بمعرّف مستأجرٍ صريح ليُستدعى من مسار العميل **ومن معالج
   * التهيئة في لوحة المالك** بلا نسخ منطق. نسخُ منطق النشر كان سيُنتج مسارَين
   * يتباعدان مع أوّل تعديلٍ على وضع المعرفة.
   */
  async function publishVersion(tenantId: string, actorUserId: string, note: string | null) {
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

      const provider = String(draft.provider ?? 'google');
      const model = String(draft.model ?? 'gemini-2.5-flash');

      /* ★ لا نشرَ لنموذجٍ بلا سعر.
         العطل الذي وُلد منه هذا الفحص: نسخةٌ نُشرت على نموذجٍ لا صفَّ سعرٍ له،
         فصار كلّ ردٍّ يُفوتَر **صفراً** بصمت — والتقارير تُظهر هامشاً كاملاً
         عن نموذجٍ يُكلّف فعلاً — ويرفع حادثة price_missing مع كلّ ردّ.
         والمنع هنا لا في العامل: العامل يكتشفه بعد أن يُنفَق المال، وهذا
         يمنعه قبل أن يُنشر. والرسالة تقول ما يُفعل لا «قيمةٌ غير صالحة». */
      const priced = await tx.select({ model: prices.model }).from(prices)
        .where(and(eq(prices.provider, provider), eq(prices.model, model))).limit(1);
      if (!priced.length) {
        throw new AppError(
          ErrorCode.VALIDATION,
          `لا سعرَ مسجَّلٌ للنموذج ${model} — أضِف صفّه في جدول prices قبل النشر، `
          + 'وإلّا فكلفة كلّ ردٍّ تُحسب صفراً بصمت.',
          400,
        );
      }

      const [ver] = await tx.insert(botVersions).values({
        tenantId,
        version: (last?.v ?? 0) + 1,
        persona: String(draft.persona ?? ''),
        knowledgeBase: kb,
        toolsConfig: (draft.toolsConfig ?? {}) as object,
        provider,
        model,
        params: (draft.params ?? {}) as object,
        knowledgeMode: mode,
        knowledgeBudget: (draft.knowledgeBudget ?? {}) as object,
        embedStatus: mode === 'full' ? 'skipped' : 'pending',
        publishedBy: actorUserId,
        publishedAt: new Date(),
        note,
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
  }

  app.post<{ Body: { note?: string } }>('/bot/publish', { preHandler: auth }, async (req) =>
    publishVersion(tenantOf(req), req.auth!.sub, req.body?.note ?? null));

  /**
   * ★ بذرُ بوتٍ لعميلٍ من لوحة المالك — الخطوتان ٣ و٤ في معالج التهيئة.
   *
   * ولماذا مسارٌ صريحٌ لا انتحال: الانتحال **قراءةٌ فقط** وذاك قرارٌ يُصان،
   * فلو سُمح له بالكتابة صار لدينا مسارٌ يكتب في بيانات عميلٍ بهويّةٍ مستعارة
   * وصار سجلّ التدقيق كاذباً. هنا المستأجر في العنوان، والفعل مسجَّلٌ باسم
   * فاعلٍ حقيقيّ، والعميل يراه في سجلّه.
   *
   * وهو **بذرٌ لا استبدال**: يرفض إن كان للعميل نسخةٌ منشورةٌ أصلاً، فلا يمسح
   * معالجُ تهيئةٍ فُتح بالخطأ شخصيّةَ عميلٍ يعمل.
   */
  app.post<{ Params: { id: string }; Body: { persona?: string; knowledgeBase?: string; note?: string } }>(
    '/console/tenants/:id/bot/seed',
    { preHandler: requireAuth({ console: true }) },
    async (req) => {
      const tenantId = req.params.id;
      const persona = String(req.body?.persona ?? '').trim();
      const knowledgeBase = String(req.body?.knowledgeBase ?? '').trim();
      if (!persona || !knowledgeBase) {
        throw new AppError(ErrorCode.VALIDATION, 'الشخصيّة والمعرفة مطلوبتان', 400);
      }

      await withTenant(getDb(), tenantId, async (tx) => {
        const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
        if (!cfg) throw new AppError(ErrorCode.VALIDATION, 'لا إعداداتَ بوتٍ لهذا العميل', 404);
        if (cfg.publishedVersionId) {
          throw new AppError(
            ErrorCode.VALIDATION,
            'لهذا العميل نسخةٌ منشورةٌ بالفعل — عدّلها من شاشة بوته لا من معالج التهيئة.',
            409,
          );
        }
        await tx.update(botConfigs).set({ draft: { persona, knowledgeBase } })
          .where(eq(botConfigs.tenantId, tenantId));
      });

      const out = await publishVersion(tenantId, req.auth!.sub, req.body?.note ?? 'أوّل نشرٍ من معالج التهيئة');

      await withPlatform(getDb(), 'تدقيق: بذر بوتٍ لعميل من لوحة المالك', (tx) =>
        tx.insert(auditLog).values({
          tenantId, actorUserId: req.auth!.sub,
          action: 'bot.seed', entity: 'bot_version', entityId: out.version!.id, ip: req.ip,
        }));

      return out;
    },
  );

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

  /**
   * تعديل أداة.
   *
   * ★ `key` **لا يُعدَّل**: هو الاسم الذي يناديه النموذج، وتغييره يكسر كلّ
   *   إجراءٍ معلَّقٍ يحمله وكلّ سجلّ استعمالٍ سابق. الاسم يُستبدل بأداةٍ جديدة.
   *
   * و`secrets` تُستبدل أو تُترك: إغفالها يحفظ القديمة، و`{}` يمحوها. فلا
   * يمحو حفظُ تسميةٍ سرَّ الأداة بالخطأ.
   */
  app.patch<{ Params: { id: string }; Body: Record<string, any> }>(
    '/bot/tools/:id',
    { preHandler: auth },
    async (req) => {
      const tenantId = tenantOf(req);
      const b = req.body ?? {};
      if (b.http?.url) {
        await assertPublicUrl(String(b.http.url)).catch((e) => {
          throw new AppError(ErrorCode.TOOL_BLOCKED, (e as Error).message, 400);
        });
      }
      return withTenant(getDb(), tenantId, async (tx) => {
        const cur = (await tx.select().from(botTools).where(eq(botTools.id, req.params.id)).limit(1))[0];
        if (!cur) throw new AppError(ErrorCode.VALIDATION, 'أداةٌ غير موجودة', 404);

        const patch: Record<string, unknown> = {};
        if (b.titleAr !== undefined) patch.titleAr = String(b.titleAr);
        if (b.description !== undefined) patch.description = String(b.description);
        if (b.paramsSchema !== undefined) patch.paramsSchema = b.paramsSchema;
        if (b.http !== undefined) patch.http = b.http;
        if (b.responseMap !== undefined) patch.responseMap = b.responseMap;
        if (b.requiresCapabilities !== undefined) {
          patch.requiresCapabilities = Array.isArray(b.requiresCapabilities) ? b.requiresCapabilities : [];
        }
        if (b.confirmRequired !== undefined) patch.confirmRequired = Boolean(b.confirmRequired);
        if (b.confirmTemplate !== undefined) patch.confirmTemplate = b.confirmTemplate ?? null;
        if (b.secrets !== undefined) {
          const sealed = Object.keys(b.secrets ?? {}).length ? seal(JSON.stringify(b.secrets)) : null;
          patch.secretsEnc = sealed?.enc ?? null;
          patch.keyVersion = sealed?.keyVersion ?? cur.keyVersion;
        }
        if (b.enabled !== undefined) {
          patch.enabled = Boolean(b.enabled);
          /* التفعيل اليدويّ يُصفّر قاطع الدائرة وسببَ التعطيل: العميل أصلح
             الخلل عند نظامه، فإبقاء السبب يعطّلها من جديد عند أوّل نداء. */
          if (b.enabled) { patch.failureCount = 0; patch.disabledReason = null; }
        }

        const [row] = await tx.update(botTools).set(patch)
          .where(eq(botTools.id, req.params.id)).returning();
        const { secretsEnc, ...safe } = row!;
        return { ...safe, hasSecrets: Boolean(secretsEnc) };
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

  /* ───────────────────── ملفّات المعرفة ───────────────────── */

  /**
   * ★ رفع ملفّ معرفة — الميزة التي كانت **مبنيّةً وميّتة**: عامل الاستيعاب
   *   مسجَّلٌ والمستخرِج جاهز، ولا نقطةَ رفعٍ ولا منتِجَ مهمّة. أي أنّ تبويب
   *   «المعرفة» كان يعرض قائمةً لا يمكن أن تمتلئ.
   *
   * ولماذا بايتاتٌ خام لا multipart: ملفٌّ واحدٌ لكلّ طلب — فلا حاجة لتحليل
   * حدودٍ ولا لمُلحقٍ جديد، والتقدّم والحالة تصير لكلّ ملفٍّ على حدة. الاسم
   * يأتي في ترويسةٍ مرمَّزة لأنّ الترويسات لاتينيّةٌ وأسماء الملفّات عربيّة.
   *
   * وثلاثة حدودٍ يفرضها الخادم:
   *  ① نوعٌ من قائمةٍ بيضاء — لا استنتاجَ من الامتداد.
   *  ② حجمٌ أقصى 12 ميجابايت.
   *  ③ الاسم يُطهَّر ولا يُستعمل مساراً — الملفّ يُحفظ بـuuid، والاسم الأصليّ
   *     بيانٌ في القاعدة فقط. بلا هذا يكتب `../../` في أيّ مكان.
   */
  const KB_MIMES = new Set([
    'text/plain', 'text/markdown', 'text/csv', 'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]);
  const KB_MAX = 12 * 1024 * 1024;
  const KB_ROOT = process.env.MEDIA_ROOT ?? '/app/media';

  /* محلّل يبتلع البايتات كما وصلت للأنواع المسموحة وحدها. */
  for (const mime of KB_MIMES) {
    app.addContentTypeParser(mime, { parseAs: 'buffer', bodyLimit: KB_MAX }, (_req, body, done) => {
      done(null, body);
    });
  }

  app.post('/bot/knowledge/files', { preHandler: auth }, async (req, reply) => {
    const tenantId = tenantOf(req);
    const mime = String(req.headers['content-type'] ?? '').split(';')[0]!.trim();
    if (!KB_MIMES.has(mime)) {
      throw new AppError(
        ErrorCode.VALIDATION,
        'نوع ملفٍّ غير مدعوم. المدعوم: نصّ، Markdown، CSV، PDF، Word، Excel.',
        415,
      );
    }
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) {
      throw new AppError(ErrorCode.VALIDATION, 'الملفّ فارغ', 400);
    }
    if (buf.length > KB_MAX) {
      throw new AppError(ErrorCode.VALIDATION, 'الملفّ أكبر من 12 ميجابايت', 413);
    }

    const raw = String(req.headers['x-file-name'] ?? 'ملفّ');
    let original = raw;
    try { original = decodeURIComponent(raw); } catch { /* اسمٌ غير مرمَّز — يُقبل كما هو */ }
    // ★ لا يُستعمل الاسم مساراً أبداً: نحفظ بـuuid، والاسم بيانٌ في القاعدة
    const title = original.replace(/\s+/g, ' ').slice(0, 160).trim() || 'ملفّ';

    const dir = join(KB_ROOT, 'kb', tenantId);
    const storagePath = join(dir, randomUUID());
    await mkdir(dir, { recursive: true });
    await writeFile(storagePath, buf);

    let sourceId: string;
    try {
      sourceId = await withTenant(getDb(), tenantId, async (tx) => {
        const [row] = await tx.insert(knowledgeSources).values({
          tenantId, kind: 'file', title,
          originalName: original.slice(0, 255),
          storagePath,
          status: 'pending',
        }).returning({ id: knowledgeSources.id });
        return row!.id;
      });
    } catch (e) {
      // لا ملفٌّ يتيمٌ على القرص إن فشل الصفّ — وإلّا امتلأ القرص بما لا يُرى
      await unlink(storagePath).catch(() => undefined);
      throw e;
    }

    await enqueueIngest({ tenantId, sourceId, path: storagePath, mime });
    return reply.code(202).send({ id: sourceId, title, status: 'pending' });
  });

  /** النصّ المستخرَج للمعاينة — «ready» لا تعني «معتمدة»: العميل يعاين ثمّ ينشر. */
  app.get<{ Params: { id: string } }>(
    '/bot/knowledge/files/:id',
    { preHandler: requireAuth() },
    async (req) => {
      const tenantId = tenantOf(req);
      return withTenant(getDb(), tenantId, async (tx) => {
        const row = (await tx.select().from(knowledgeSources)
          .where(eq(knowledgeSources.id, req.params.id)).limit(1))[0];
        if (!row) throw new AppError(ErrorCode.VALIDATION, 'مصدرٌ غير موجود', 404);
        return {
          id: row.id, title: row.title, status: row.status, error: row.error,
          charCount: row.charCount,
          // معاينةٌ لا تنزيل: أوّل 4000 محرفٍ تكفي للحكم على جودة الاستخراج
          preview: (row.extractedText ?? '').slice(0, 4000),
          truncated: (row.extractedText ?? '').length > 4000,
        };
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/bot/knowledge/files/:id',
    { preHandler: auth },
    async (req) => {
      const tenantId = tenantOf(req);
      const path = await withTenant(getDb(), tenantId, async (tx) => {
        const row = (await tx.select({ p: knowledgeSources.storagePath }).from(knowledgeSources)
          .where(eq(knowledgeSources.id, req.params.id)).limit(1))[0];
        await tx.delete(knowledgeSources).where(eq(knowledgeSources.id, req.params.id));
        return row?.p ?? null;
      });
      // الصفّ أوّلاً ثمّ الملفّ: ملفٌّ يتيمٌ أهون من صفٍّ يشير إلى لا شيء
      if (path) await unlink(path).catch(() => undefined);
      return { ok: true };
    },
  );

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
        SELECT r.query_text                                   AS query,
               count(*)::int                                  AS times,
               coalesce(max(array_length(r.chunk_ids, 1)), 0)::int AS retrieved
          FROM ai_runs a
          -- ★ INNER لا LEFT: بلا صفّ استرجاعٍ لا نعرف **ماذا** سأل الزبون،
          --    فالبطاقة تعرض «(بلا استعلام)» وتشخيصاً مبنيّاً على لا شيء.
          --    وصفرُ صفوفٍ هنا ليس عطلاً: يعني أنّ السجلّ لم يُكتب بعد.
          INNER JOIN kb_retrievals r ON r.ai_run_id = a.id
         WHERE a.tenant_id = ${tenantId}
           AND (a.flags->>'unknown')::boolean IS TRUE
           AND a.created_at > now() - interval '30 days'
           AND btrim(coalesce(r.query_text, '')) <> ''
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
