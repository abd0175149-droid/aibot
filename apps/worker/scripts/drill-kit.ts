/**
 * عُدّة تمارين الفشل — ما تشترك فيه التمارين الخمسة.
 *
 * ★ لماذا عُدّةٌ مشتركة بعد أن نُسخ الإعداد ثلاث مرّات في `drill-restart` و
 *   `drill-debounce` و`drill-reply-cost`: التمارين الأربعة الجديدة تُضيف
 *   أربع نسخٍ أخرى من نفس الستّين سطراً، والنسخة السابعة هي التي تنحرف عن
 *   أخواتها بلا أن يلاحظ أحد. وما يُقاس هنا ليس الإعداد — فليكن الإعداد
 *   موضعاً واحداً يُقرأ مرّة.
 *
 * وما **لا** يسكن هنا عن قصد: الحكم. كلّ تمرينٍ يطبع حكمه بنفسه، فالعُدّة
 * تُهيّئ وتنظّف وتقيس، ولا تقول «نجح».
 *
 * 🔴 هذه السكربتات تُشغَّل **على الخادم من مضيفه** لا داخل حاوية: كلّها تنادي
 *    `docker`/`docker compose` لتصنع العطل. ولذلك تحتاج بيئةً صريحة:
 *      cd ~/aibot && set -a && . ./.env && set +a
 *      export DATABASE_URL="postgresql://$APP_DB_USER:$APP_DB_PASSWORD@127.0.0.1:$DB_PORT/$DB_NAME"
 *      export REDIS_URL="redis://127.0.0.1:$REDIS_PORT"
 */
import { execFileSync } from 'node:child_process';
import {
  getDb, withPlatform, tenants, tenantChannels, botConfigs, botVersions,
  contacts, channelIdentities, conversations, messages, conversationWindows,
  aiRuns, incidents, eq, and, sql,
  type Db,
} from '@aibot/db';
import { publicId, seal, fingerprint } from '@aibot/crypto';

/* ───────────────────────── أدواتٌ صغيرة ───────────────────────── */

export const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

export function log(msg: string, extra?: unknown): void {
  console.log(extra === undefined ? `  ${msg}` : `  ${msg} ${JSON.stringify(extra)}`);
}

export function step(title: string): void {
  console.log(`\n── ${title}`);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} غير مضبوط — راجع رأس drill-kit.ts`);
  return v;
}

/** مجلّد مشروع compose. التمارين تُشغَّل من `~/aibot` فالافتراض هو مجلّد العمل. */
export const COMPOSE_DIR = process.env.COMPOSE_DIR ?? process.cwd();

/**
 * نداء `docker`.
 *
 * ★ `stdio` يُعلن مصدر الإدخال صراحةً (`ignore`) لا يورثه من المنادي. الدرس
 *   من `docker compose exec -T`: نداءٌ يرث stdin يسرقه من حلقةٍ تقرأ فتنتهي
 *   بعد صفٍّ واحدٍ **بلا خطأ**. هنا لا حلقةَ قراءة، لكنّ العادة تُبنى في كلّ
 *   موضع أو لا تُبنى.
 */
export function docker(args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync('docker', args, {
      cwd: COMPOSE_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    }).trim();
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message: string };
    const detail = (err.stderr || err.stdout || err.message).trim();
    if (opts.allowFail) return `!${detail}`;
    throw new Error(`docker ${args.join(' ')} فشل: ${detail}`);
  }
}

export function compose(args: string[], opts: { allowFail?: boolean } = {}): string {
  return docker(['compose', ...args], opts);
}

/** هل الحاوية تعمل الآن؟ */
export function isRunning(container: string): boolean {
  const out = docker(['inspect', '-f', '{{.State.Running}}', container], { allowFail: true });
  return out === 'true';
}

/* ───────────────────────── تهيئة مستأجر التمرين ───────────────────────── */

export interface DrillTenant {
  tenantId: string;
  channelId: string;
  /** معرّف المستأجر العامّ — به يُبنى رابط الويبهوك. */
  publicId: string;
  versionId: string | null;
  /** سرّ التطبيق الخامّ — به يُوقَّع الويبهوك في التمرين. */
  appSecret: string;
}

export interface EnabledBot {
  provider: string;
  model: string;
  persona: string;
  knowledgeBase: string;
}

export interface EnsureOpts {
  slug: string;
  name: string;
  /** `null` = بوتٌ مطفأ (نعزل ما يُقاس عن نداء النموذج وكلفته). */
  bot: EnabledBot | null;
  /** سرٌّ ثابتٌ لهذا التمرين — التوقيع يجب أن يكون حسابيّاً لا سحريّاً. */
  appSecret?: string;
}

/**
 * مستأجرٌ تجريبيٌّ جاهزٌ للضخّ: قناةٌ موصولة بتوكن تمرينٍ وسرّ تطبيقٍ معلوم،
 * وصفحةٌ بيضاء (لا رسائل ولا أشواط ولا حوادث من تشغيلٍ سابق).
 *
 * ★ الصفحة البيضاء شرطُ صحّةٍ لا نظافة: أوّل تشغيلٍ لتمرين المتانة أعلن فشلاً
 *   بسبب أربع مهامٍّ فاشلةٍ من عطلٍ أُصلح قبل ساعات. اختبارٌ يعدّ أثر غيره
 *   يُنتج إنذاراً كاذباً، وذاك أسرع طريقٍ لإطفاء الاختبارات.
 */
export async function ensureDrillTenant(db: Db, opts: EnsureOpts): Promise<DrillTenant> {
  const appSecret = opts.appSecret ?? `DRILL_SECRET_${opts.slug}`;
  const fakeToken = `DRILL_TOKEN_${opts.slug}`;

  return withPlatform(db, `تمرين فشل: تهيئة مستأجر ${opts.slug}`, async (tx) => {
    let t = (await tx.select().from(tenants).where(eq(tenants.slug, opts.slug)).limit(1))[0];
    if (!t) {
      [t] = await tx.insert(tenants).values({
        slug: opts.slug, name: opts.name, status: 'active', publicId: publicId(),
      }).returning();
    }
    const tenantId = t!.id;

    const sealedToken = seal(fakeToken);
    const sealedSecret = seal(appSecret);
    let ch = (await tx.select().from(tenantChannels)
      .where(and(eq(tenantChannels.tenantId, tenantId), eq(tenantChannels.kind, 'whatsapp_cloud')))
      .limit(1))[0];
    const creds = {
      status: 'connected' as const,
      tokenEnc: sealedToken.enc,
      tokenFingerprint: fingerprint(fakeToken),
      appSecretEnc: sealedSecret.enc,
      verifyToken: `verify-${opts.slug}`,
      keyVersion: sealedToken.keyVersion,
    };
    if (!ch) {
      [ch] = await tx.insert(tenantChannels).values({
        tenantId, kind: 'whatsapp_cloud',
        externalAccountId: `DRILL_${opts.slug}`,
        displayName: `قناة ${opts.name} (توكن تمرين — لا ترسل شيئاً)`,
        ...creds,
      }).returning();
    } else {
      await tx.update(tenantChannels).set(creds).where(eq(tenantChannels.id, ch.id));
    }

    /* صفحةٌ بيضاء — بالترتيب العكسيّ للمراجع. */
    await tx.delete(aiRuns).where(eq(aiRuns.tenantId, tenantId));
    await tx.delete(incidents).where(eq(incidents.tenantId, tenantId));
    await tx.delete(messages).where(eq(messages.tenantId, tenantId));
    await tx.delete(conversationWindows).where(eq(conversationWindows.tenantId, tenantId));
    await tx.delete(conversations).where(eq(conversations.tenantId, tenantId));
    await tx.delete(channelIdentities).where(eq(channelIdentities.tenantId, tenantId));
    await tx.delete(contacts).where(eq(contacts.tenantId, tenantId));

    let versionId: string | null = null;
    if (opts.bot) {
      const last = (await tx.select({ v: botVersions.version }).from(botVersions)
        .where(eq(botVersions.tenantId, tenantId)).orderBy(sql`version desc`).limit(1))[0];
      const [ver] = await tx.insert(botVersions).values({
        tenantId,
        version: (last?.v ?? 0) + 1,
        persona: opts.bot.persona,
        knowledgeBase: opts.bot.knowledgeBase,
        provider: opts.bot.provider,
        model: opts.bot.model,
        // `full` فلا تضمينَ يُنتظر ولا كلفةَ استرجاعٍ بلا مقابل
        knowledgeMode: 'full',
        embedStatus: 'skipped',
        publishedAt: new Date(),
        note: `تمرين فشل: ${opts.slug}`,
      }).returning();
      versionId = ver!.id;
    }

    const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
    const wanted = { enabled: opts.bot !== null, publishedVersionId: versionId };
    if (!cfg) await tx.insert(botConfigs).values({ tenantId, ...wanted });
    else await tx.update(botConfigs).set(wanted).where(eq(botConfigs.tenantId, tenantId));

    return { tenantId, channelId: ch!.id, publicId: t!.publicId, versionId, appSecret };
  });
}

/**
 * حذف أثر التمرين — والمستأجر يبقى لتمرينٍ لاحق (كما في `drill-restart`).
 * والبوت يُطفأ حتماً: بوتٌ تجريبيٌّ يبقى مفعَّلاً بعد التمرين يردّ على كلّ
 * ما يصله بكلفةٍ حقيقيّة.
 */
export async function purgeDrillData(db: Db, tenantId: string): Promise<void> {
  await withPlatform(db, 'تمرين فشل: حذف أثر الاختبار', async (tx) => {
    await tx.update(botConfigs).set({ enabled: false, publishedVersionId: null })
      .where(eq(botConfigs.tenantId, tenantId));
    await tx.delete(aiRuns).where(eq(aiRuns.tenantId, tenantId));
    await tx.delete(incidents).where(eq(incidents.tenantId, tenantId));
    await tx.delete(messages).where(eq(messages.tenantId, tenantId));
    await tx.delete(conversationWindows).where(eq(conversationWindows.tenantId, tenantId));
    await tx.delete(conversations).where(eq(conversations.tenantId, tenantId));
    await tx.delete(channelIdentities).where(eq(channelIdentities.tenantId, tenantId));
    await tx.delete(contacts).where(eq(contacts.tenantId, tenantId));
    await tx.delete(botVersions).where(eq(botVersions.tenantId, tenantId));
  });
}

/* ───────────────────────── الحمولات ───────────────────────── */

export interface InboundOpts {
  tenantId: string;
  channelId: string;
  externalId: string;
  from: string;
  text: string;
  handle?: string;
  at?: Date;
}

/** حمولةُ مهمّةٍ بشكل الوارد الحقيقيّ — نفس المحلّل، فلا مسارٌ موازٍ يُختبر. */
export function inboundJob(o: InboundOpts) {
  return {
    tenantId: o.tenantId,
    channelId: o.channelId,
    kind: 'whatsapp_cloud' as const,
    parsed: {
      messages: [{
        externalId: o.externalId,
        from: o.from,
        fromHandle: o.handle ?? 'زبون تمرين',
        at: o.at ?? new Date(),
        type: 'text' as const,
        text: o.text,
        buttonPayload: null,
        mediaId: null,
        raw: { drill: true, externalId: o.externalId },
      }],
      statuses: [],
      accountEvents: [],
    },
  };
}

/**
 * حمولةُ ويبهوك واتساب الحقيقيّة — بشكل ميتا حرفيّاً، فيمرّ توقيعُها ومحلّلُها
 * عبر نفس الكود الذي يعمل في الإنتاج. وبلا هذا الشكل يُختبر مسارٌ لا وجود له.
 */
export function waWebhookBody(o: { externalId: string; from: string; text: string; phoneNumberId: string }) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'DRILL_WABA',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '962790000000', phone_number_id: o.phoneNumberId },
          contacts: [{ profile: { name: 'زبون تمرين الويبهوك' }, wa_id: o.from }],
          messages: [{
            from: o.from,
            id: o.externalId,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: o.text },
          }],
        },
      }],
    }],
  };
}

/* ───────────────────────── القياس ───────────────────────── */

/** كم رسالةً من هذا التمرين وصلت القاعدة فعلاً؟ */
export async function storedCount(db: Db, tenantId: string, tag: string): Promise<number> {
  const rows = await withPlatform(db, 'تمرين فشل: عدّ الرسائل المخزَّنة', (tx) => tx
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), sql`${messages.externalId} like ${`${tag}%`}`)));
  return rows[0]?.n ?? 0;
}

/** المعرّفات الخارجيّة التي وصلت — الفرق عن المضخوخ هو الضائع بالاسم. */
export async function storedIds(db: Db, tenantId: string, tag: string): Promise<string[]> {
  const rows = await withPlatform(db, 'تمرين فشل: قراءة معرّفات الرسائل المخزَّنة', (tx) => tx
    .select({ externalId: messages.externalId })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), sql`${messages.externalId} like ${`${tag}%`}`)));
  return rows.map((r) => r.externalId ?? '').filter(Boolean);
}

export interface IncidentRow {
  kind: string;
  severity: string;
  title: string;
  count: number;
  status: string;
  tenantId: string | null;
  firstSeenAt: Date;
}

/**
 * الحوادث التي وُلدت **بعد** لحظة العطل — لا كلّ الحوادث.
 *
 * ★ والعبرة من `drill-restart`: حكمٌ يعدّ أثر غيره كاذب. وهنا يُقرأ الجدول
 *   كلّه (لا حوادث المستأجر وحدها) عن قصد: عطل ريدِس أو القرص **عطل منصّة**،
 *   وحادثتُه — إن وُجدت — بلا مستأجر.
 */
export async function incidentsSince(db: Db, since: Date): Promise<IncidentRow[]> {
  return withPlatform(db, 'تمرين فشل: قراءة الحوادث بعد لحظة العطل', (tx) => tx
    .select({
      kind: incidents.kind, severity: incidents.severity, title: incidents.title,
      count: incidents.count, status: incidents.status, tenantId: incidents.tenantId,
      firstSeenAt: incidents.firstSeenAt,
    })
    .from(incidents)
    .where(sql`${incidents.lastSeenAt} >= ${since}`)
    .orderBy(incidents.firstSeenAt));
}

/**
 * اتّصالاتٌ عالقةٌ في معاملةٍ مفتوحة.
 *
 * ★ هذا هو القياس الذي يكشف «نداءُ شبكةٍ داخل معاملة»: معاملةٌ تنتظر ريدِس
 *   تظهر هنا `idle in transaction` وهي تحتجز اتّصالاً من مجمّعٍ حجمه عشرة.
 *   والقاعدة المكتوبة في `reply.ts` — «لا نداءَ شبكةٍ داخل معاملة» — تُقاس
 *   بهذا الصفّ لا بقراءة الكود.
 */
export async function idleInTransaction(db: Db): Promise<number> {
  const rows = await withPlatform(db, 'تمرين فشل: عدّ الاتّصالات العالقة في معاملة', (tx) => tx
    .execute(sql`select count(*)::int as n from pg_stat_activity
                 where state = 'idle in transaction' and application_name = 'aibot'`));
  const first = (rows as unknown as Array<{ n: number }>)[0];
  return first?.n ?? 0;
}

/** صحّة المنصّة كما تراها بوّابتها — `db` و`redis` هما الحكم. */
export interface Health { ok: boolean; status: number; db: boolean; redis: boolean; body: string }

export async function health(url = process.env.HEALTH_URL ?? 'http://127.0.0.1:4100/api/health'): Promise<Health> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const body = await res.text();
    let parsed: { db?: boolean; redis?: boolean } = {};
    try { parsed = JSON.parse(body) as typeof parsed; } catch { /* جسمٌ غير JSON — يُطبع كما هو */ }
    return {
      ok: res.status === 200, status: res.status,
      db: parsed.db === true, redis: parsed.redis === true, body: body.slice(0, 200),
    };
  } catch (e) {
    return { ok: false, status: 0, db: false, redis: false, body: `تعذّر النداء: ${(e as Error).message}` };
  }
}

/** انتظار التعافي بلا تدخّلٍ بشريّ — وهو سؤال التمرين الأوّل. */
export async function waitForHealthy(timeoutMs: number): Promise<{ healthy: boolean; ms: number; last: Health }> {
  const started = Date.now();
  let last = await health();
  while (Date.now() - started < timeoutMs) {
    if (last.db && last.redis) return { healthy: true, ms: Date.now() - started, last };
    await sleep(2000);
    last = await health();
  }
  return { healthy: last.db && last.redis, ms: Date.now() - started, last };
}

/**
 * 🔴 الحارس الذي لا يُتجاوز: البوتان الحقيقيّان يجب أن يبقيا مفعَّلَين.
 * تمرينٌ يُصلح نفسه ويكسر عميلاً ليس تمريناً.
 */
export async function realBotsEnabled(db: Db): Promise<Array<{ slug: string; enabled: boolean }>> {
  return withPlatform(db, 'تمرين فشل: التحقّق من بوتات المستأجرين الحقيقيّين', (tx) => tx
    .select({ slug: tenants.slug, enabled: botConfigs.enabled })
    .from(botConfigs)
    .innerJoin(tenants, eq(tenants.id, botConfigs.tenantId))
    .where(sql`${tenants.slug} in ('nuskjo', 'baitalsham')`)
    .orderBy(tenants.slug));
}

/** تقريرُ الخاتمة المشترك: صحّةٌ راجعة وبوتان حقيقيّان سليمان. */
export async function reportRecovery(db: Db, timeoutMs = 180_000): Promise<boolean> {
  step('التعافي والحارس');
  const rec = await waitForHealthy(timeoutMs);
  log(`الصحّة بعد ${Math.round(rec.ms / 1000)}s`, rec.last);
  const bots = await realBotsEnabled(db).catch(() => []);
  log('بوتات المستأجرين الحقيقيّين', bots);
  const botsOk = bots.length === 2 && bots.every((b) => b.enabled);
  if (!botsOk) console.log('  🔴 بوتٌ حقيقيٌّ ليس مفعَّلاً — أعِد تفعيله يدويّاً قبل أيّ شيءٍ آخر');
  return rec.healthy && botsOk;
}

export function getDbOrDie(): Db {
  requireEnv('DATABASE_URL');
  return getDb();
}
