import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  getDb, withTenant, conversations, conversationWindows, messages, aiRuns,
  tenantChannels, contacts, channelIdentities, botConfigs, subscriptions, plans, tenants,
  auditLog, withPlatform, quotaAlerts,
  eq, and, asc, desc, isNull, sql,
} from '@aibot/db';
import { capabilitiesFor, getAdapter, type ChannelKind } from '@aibot/channels';
import { open as decrypt, seal, fingerprint, publicId } from '@aibot/crypto';
import { requireAuth, tenantOf } from '../auth.js';
import { AppError, ErrorCode, capConsequence } from '@aibot/shared';
import {
  REPORT_TZ, MIN_FOR_TREND, PRESET_DAYS, parseRange, shiftDay, fillDays,
  type Range,
} from './reports-range.js';

/**
 * ★ **تعريفٌ واحدٌ للاكتفاء الذاتيّ** — لا نسختان تتباعدان.
 *
 * «أنهاها البوت وحده» = نافذةٌ ردَّ فيها البوت **ولم يكتب فيها موظّفٌ بعد
 * فتحها**. وكان هذا المسند مكتوباً داخل استعلام «نبض اليوم» وحده؛ ولمّا
 * جاءت شاشةُ الاتّجاه احتاجته يوماً بيوم — ونسخُه كان يعني أنّ الرئيسيّة
 * والتقارير تعرضان **رقمَين مختلفَين لنفس المقياس** بعد أوّل تصحيحٍ يُكتب
 * في أحدهما. فصار جزءاً واحداً يُحقَن في الاستعلامَين.
 *
 * ⚠️ يستعمل اسمَ الجدول عارياً (`conversation_windows`) لا كنيةً: فمن يحقنه
 *    يستعلم `FROM conversation_windows` بلا `AS` — وكنيةٌ هنا تكسر الاستعلام
 *    بخطإٍ صريحٍ لا بصمت، وذاك مقصود.
 */
const SOLO = sql`(
        conversation_windows.bot_replies > 0
        AND NOT EXISTS (SELECT 1 FROM messages m
                         WHERE m.conversation_id = conversation_windows.conversation_id
                           AND m.source = 'agent'
                           AND m.created_at >= conversation_windows.opened_at)
      )`;

/** الشهر بتوقيت المستأجر — نافذةٌ تُفتح آخر الشهر تُفوتَر على شهر فتحها. */
function period(tz = 'Asia/Amman'): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
}

/**
 * العتباتُ التي أُنذر بها العميل في هذه الدورة.
 *
 * ★ تُقرأ من نفس الجدول الذي يكتبه العامل (`quota_alerts`) — فالشاشة تعرض
 *   **ما أُرسل فعلاً** لا ما كان يُفترض أن يُرسَل. وشاشةٌ تقول «أنذرناك» وهي
 *   تستنتج ذلك من النسبة تكذب حين يتعطّل الدفع، وهي أسوأ كذبةٍ ممكنة هنا.
 */
async function alertsOf(tx: never, period: string): Promise<Array<{ threshold: number; firedAt: Date }>> {
  return (tx as unknown as ReturnType<typeof getDb>)
    .select({ threshold: quotaAlerts.threshold, firedAt: quotaAlerts.firedAt })
    .from(quotaAlerts)
    .where(eq(quotaAlerts.billingPeriod, period))
    .orderBy(asc(quotaAlerts.threshold));
}

async function limitsOf(tx: never, tenantId: string): Promise<Record<string, number>> {
  const rows = await (tx as unknown as ReturnType<typeof getDb>)
    .select({ limits: plans.limits, override: subscriptions.limitsOverride })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.status, 'active')))
    .orderBy(desc(subscriptions.periodEnd))
    .limit(1);
  return {
    ...((rows[0]?.limits ?? {}) as Record<string, number>),
    ...((rows[0]?.override ?? {}) as Record<string, number>),
  };
}

export async function registerReports(app: FastifyInstance) {
  /** نبض اليوم — تُقرأ في كلّ تحميلٍ للوحة، فكلّ استعلامٍ هنا مفهرس. */
  app.get('/reports/overview', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const lim = await limitsOf(tx as never, tenantId);
      const p = period();

      const [today] = await tx.execute<{
        conversations: number; bot_replies: number; needs_attention: number; median_latency: number;
        self_resolved: number; total_convs: number;
      }>(sql`
        SELECT
          (SELECT count(DISTINCT conversation_id)::int FROM messages
            WHERE tenant_id = ${tenantId} AND created_at > now() - interval '24 hours') AS conversations,
          (SELECT count(*)::int FROM messages
            WHERE tenant_id = ${tenantId} AND source = 'bot' AND created_at > now() - interval '24 hours') AS bot_replies,
          (SELECT count(*)::int FROM conversations
            WHERE tenant_id = ${tenantId} AND needs_attention) AS needs_attention,
          (SELECT coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms), 0)::int FROM ai_runs
            WHERE tenant_id = ${tenantId} AND created_at > now() - interval '7 days') AS median_latency,
          (SELECT count(*)::int FROM conversation_windows
            WHERE tenant_id = ${tenantId} AND billing_period = ${p}
              AND billed_at IS NOT NULL AND ${SOLO}) AS self_resolved,
          (SELECT count(*)::int FROM conversation_windows
            WHERE tenant_id = ${tenantId} AND billing_period = ${p} AND billed_at IS NOT NULL) AS total_convs
      `) as unknown as Array<Record<string, number>>;

      const [used] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(conversationWindows)
        .where(and(
          eq(conversationWindows.billingPeriod, p),
          sql`${conversationWindows.billedAt} is not null`,
        ));

      const channels = await tx
        .select({
          kind: tenantChannels.kind, status: tenantChannels.status,
          displayName: tenantChannels.displayName,
        })
        .from(tenantChannels).where(eq(tenantChannels.tenantId, tenantId));

      const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
      const sub = (await tx.select({ policy: plans.overagePolicy }).from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.status, 'active')))
        .limit(1))[0];

      const alerts = await alertsOf(tx as never, p);

      const wLimit = Number(lim.windows ?? 0);
      const wUsed = used?.n ?? 0;
      const totalConvs = Number(today?.total_convs ?? 0);
      return {
        conversationsToday: Number(today?.conversations ?? 0),
        botReplies: Number(today?.bot_replies ?? 0),
        needsAttention: Number(today?.needs_attention ?? 0),
        medianLatencyMs: Number(today?.median_latency ?? 0),
        selfResolvedRate: totalConvs ? Number(today?.self_resolved ?? 0) / totalConvs : 0,
        windowsUsed: wUsed,
        windowsLimit: wLimit,
        botEnabled: Boolean(cfg?.enabled),
        overagePolicy: sub?.policy ?? 'handoff_only',
        /* ★ نصُّ العاقبة يأتي **من الخادم** لا من جدولٍ في الواجهة: هو نفسُه
           النصُّ الذي يدفعه العامل إشعاراً، ونسختان منه تتباعدان — وقد تباعدتا
           فعلاً، فكانت الواجهة تَعِد بأنّ «فريقك يردّ يدويّاً بلا حدّ» والحارسُ
           يرفض ردَّ الموظّف على محادثةٍ جديدة كما يرفض ردَّ البوت. */
        capConsequence: capConsequence(
          sub?.policy ?? 'handoff_only',
          wLimit > 0 && wUsed >= wLimit,
        ),
        /* ★ حالةُ العتبة: متى أُنذر العميل وبأيّ عتبة. الشاشةُ تفرّق بين
           «أنت على 84٪» و«أنذرناك عند 80٪ يوم الثلاثاء» — والثانية هي التي
           تُسقط «ما حذّرني أحد». */
        quotaAlerts: alerts,
        channels,
      };
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
     التقارير — السؤال الثالث: **هل بوتي يتحسّن؟**

     ★ ولماذا هنا لا في نقطةٍ موازية: `/reports/overview` تجيب «اليوم»،
       و`/usage` تجيب «الفاتورة». وكلتاهما **لقطة**. والاتّجاه ليس لقطةً
       ثالثةً بل نفسُ المقاييس مقسومةً على الزمن ومقارنةً بمدًى سابقٍ بطوله.
       ولذلك تعريفُ «الاكتفاء الذاتيّ» يُحقَن من `SOLO` نفسِه الذي تستعمله
       `overview` — ورقمانِ لنفس المقياس في شاشتَين عطلٌ يُبطل الشاشتَين معاً.

     ★ **والرقمُ بلا خطِّ أساسٍ ليس تقريراً.** فكلُّ استعلامٍ هنا يمسح
       **المدى والمدى السابق معاً** في نداءٍ واحدٍ ويُقسَم في الذاكرة: لا
       استعلامَين متماثلَين بحدَّين، ولا رحلةَ ذهابٍ ثانية.
     ══════════════════════════════════════════════════════════════════════ */

  /** صفُّ يومٍ واحد — مُدمَجٌ من عدّادَي الرسائل والنوافذ، فالمصدران يومٌ واحد. */
  interface TrendDay {
    day: string;
    /** رسائلُ الزبائن الواردة — هي وحدها ما يقول «متى تحتاج موظّفاً» */
    cust: number;
    bot: number;
    agent: number;
    msgs: number;
    /** محادثاتٌ فُتحت — نافذةُ الفوترة هي وحدةُ «محادثة» في هذا المنتج */
    opened: number;
    billed: number;
    /** أنهاها البوت وحده */
    solo: number;
    cost: number;
  }

  const ZERO: Omit<TrendDay, 'day'> = {
    cust: 0, bot: 0, agent: 0, msgs: 0, opened: 0, billed: 0, solo: 0, cost: 0,
  };

  function addUp(rows: TrendDay[]): Omit<TrendDay, 'day'> {
    return rows.reduce((a, r) => ({
      cust: a.cust + r.cust, bot: a.bot + r.bot, agent: a.agent + r.agent,
      msgs: a.msgs + r.msgs, opened: a.opened + r.opened, billed: a.billed + r.billed,
      solo: a.solo + r.solo, cost: a.cost + r.cost,
    }), { ...ZERO });
  }

  /**
   * الحسابُ كلُّه في دالّةٍ واحدة — تقرؤها الشاشةُ ويقرؤها الملفّ.
   *
   * ★ وهذا شرطُ «الرقمُ وأصله معاً»: لو حسب الملفُّ نسبةَ الاكتفاء بنفسه
   *   لأمكن أن يختلف عن الشاشة بعد أوّل تعديل — والعميل يفتح الملفّ **ليطابق**
   *   لا ليقرأ رقماً ثانياً. فالمصدرُ واحدٌ والمخرجان صيغتان له.
   */
  async function trend(tenantId: string, r: Range) {
    const tz = REPORT_TZ;
    /* حدُّ اليوم يتحوّل لحظةً **في Postgres** لا عندنا: هو من يملك جدول
       المناطق الحقيقيّ، ونحن نملك نصّ التاريخ وحده. */
    const at = (day: string) => sql`(${day}::timestamp AT TIME ZONE ${tz})`;

    return withTenant(getDb(), tenantId, async (tx) => {
      /* ① الرسائل يوماً بيوم — المدى والسابق معاً. والدلوُ يومٌ **عند
            المستأجر**: بلا `AT TIME ZONE` يُقسَم «أمس» بين دلوَين عند
            الساعة الثالثة صباحاً، فيُقرأ هبوطٌ لم يحدث. */
      const msgRows = await tx.execute<{
        day: string; cust: number; bot: number; agent: number; msgs: number;
      }>(sql`
        SELECT (created_at AT TIME ZONE ${tz})::date::text        AS day,
               count(*)::int                                      AS msgs,
               count(*) FILTER (WHERE source = 'customer')::int    AS cust,
               count(*) FILTER (WHERE source = 'bot')::int         AS bot,
               count(*) FILTER (WHERE source = 'agent')::int       AS agent
          FROM messages
         WHERE tenant_id = ${tenantId}
           AND created_at >= ${at(r.prevLo)} AND created_at < ${at(r.hi)}
         GROUP BY 1 ORDER BY 1
      `) as unknown as Array<Record<string, string | number>>;

      /* ② النوافذ يوماً بيوم: المفتوحُ والمُفوتَرُ وما أنهاه البوتُ وحده
            والكلفة — أربعةٌ من جدولٍ واحدٍ لأنّها كلُّها صفاتُ نفس الصفّ. */
      const winRows = await tx.execute<{
        day: string; opened: number; billed: number; solo: number; cost: number;
      }>(sql`
        SELECT (opened_at AT TIME ZONE ${tz})::date::text               AS day,
               count(*)::int                                            AS opened,
               count(*) FILTER (WHERE billed_at IS NOT NULL)::int        AS billed,
               count(*) FILTER (WHERE billed_at IS NOT NULL
                                  AND ${SOLO})::int                     AS solo,
               coalesce(sum(ai_cost_usd), 0)::float                      AS cost
          FROM conversation_windows
         WHERE tenant_id = ${tenantId}
           AND opened_at >= ${at(r.prevLo)} AND opened_at < ${at(r.hi)}
         GROUP BY 1 ORDER BY 1
      `) as unknown as Array<Record<string, string | number>>;

      /* ③ متى يكون مشغولاً — رسائلُ الزبائن وحدها: ردُّ البوت يتبع الزبون
            فلا يقول شيئاً جديداً عن وقت الضغط. و`isodow` لأنّ `dow` تُرجع
            صفراً للأحد فيسهل خلطُه بـ«لا شيء». */
      const busyRows = await tx.execute<{ dow: number; hr: number; n: number }>(sql`
        SELECT extract(isodow FROM (created_at AT TIME ZONE ${tz}))::int AS dow,
               extract(hour   FROM (created_at AT TIME ZONE ${tz}))::int AS hr,
               count(*)::int                                             AS n
          FROM messages
         WHERE tenant_id = ${tenantId} AND source = 'customer'
           AND created_at >= ${at(r.lo)} AND created_at < ${at(r.hi)}
         GROUP BY 1, 2
      `) as unknown as Array<Record<string, number>>;

      /* ④ أين يعجز — والموضوعُ **من تصنيف العميل نفسِه** لا من تصنيفٍ
            نخترعه: `heading_path` عنوانُ المقطع في معرفته هو، وسقوطُه إلى
            «لا يقابله شيء» أقوى إشارةٍ في الشاشة كلِّها — سؤالٌ لا تملك
            معرفتُك جواباً له. و«انتهى بموظّف» = كتب موظّفٌ في المحادثة خلال
            24 ساعةً من الاسترجاع، أي داخل نافذةِ نفسِ السؤال لا بعد أسبوع. */
      const gapRows = await tx.execute<{
        topic: string; asks: number; handoffs: number; sample: string | null;
      }>(sql`
        WITH r AS (
          SELECT kr.created_at, kr.query_text, (kr.chunk_ids)[1] AS top_chunk,
                 EXISTS (SELECT 1 FROM messages m
                          WHERE m.conversation_id = kr.conversation_id
                            AND m.source = 'agent'
                            AND m.created_at >= kr.created_at
                            AND m.created_at <  kr.created_at + interval '24 hours') AS handed
            FROM kb_retrievals kr
           WHERE kr.tenant_id = ${tenantId}
             AND kr.conversation_id IS NOT NULL
             AND kr.skipped = false
             AND kr.created_at >= ${at(r.lo)} AND kr.created_at < ${at(r.hi)}
        )
        SELECT coalesce(nullif(btrim(ch.heading_path), ''), ks.title,
                        'سؤالٌ لا يقابله شيءٌ في معرفتك')          AS topic,
               count(*)::int                                        AS asks,
               count(*) FILTER (WHERE r.handed)::int                AS handoffs,
               (array_agg(r.query_text ORDER BY r.created_at DESC)
                  FILTER (WHERE r.handed AND r.query_text IS NOT NULL))[1] AS sample
          FROM r
          LEFT JOIN kb_chunks         ch ON ch.id = r.top_chunk
          LEFT JOIN knowledge_sources ks ON ks.id = ch.source_id
         GROUP BY 1
        HAVING count(*) FILTER (WHERE r.handed) > 0
         ORDER BY 3 DESC, 2 DESC
         LIMIT 8
      `) as unknown as Array<Record<string, string | number | null>>;

      /* ⑤ أعلامُ التشغيل — المدى والسابق في صفَّين، والتفريقُ بعمودٍ منطقيّ
            لا باستعلامَين. و`source = 'live'` تُخرج الساحةَ: تجربةُ العميل
            في ساحته ليست محادثةَ زبون، وخلطُها يرفع «العجز» بلا سبب. */
      const flagRows = await tx.execute<{
        cur: boolean; runs: number; handoff: number; dunno: number; fail: number; p50: number;
      }>(sql`
        SELECT (created_at >= ${at(r.lo)})                                  AS cur,
               count(*)::int                                                AS runs,
               count(*) FILTER (WHERE flags->>'handoff' = 'true')::int       AS handoff,
               count(*) FILTER (WHERE flags->>'unknown' = 'true')::int       AS dunno,
               count(*) FILTER (WHERE flags->>'fail'    = 'true')::int       AS fail,
               coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms), 0)::int AS p50
          FROM ai_runs
         WHERE tenant_id = ${tenantId} AND source = 'live'
           AND created_at >= ${at(r.prevLo)} AND created_at < ${at(r.hi)}
         GROUP BY 1
      `) as unknown as Array<Record<string, boolean | number>>;

      /* ── الدمج: مصدران يوميّان يصيران صفّاً واحداً، ثمّ يُملأ الغائب أصفاراً.
            والملءُ ليس تجميلاً: خطٌّ يصل يومَين متباعدَين يوحي بهبوطٍ تدريجيٍّ
            لم يقع — والحقيقةُ هبوطٌ إلى صفرٍ وعودة. */
      const byDay = new Map<string, TrendDay>();
      const touch = (day: string): TrendDay => {
        const cur = byDay.get(day) ?? { day, ...ZERO };
        byDay.set(day, cur);
        return cur;
      };
      for (const m of msgRows) {
        const d = touch(String(m.day));
        d.msgs = Number(m.msgs); d.cust = Number(m.cust);
        d.bot = Number(m.bot); d.agent = Number(m.agent);
      }
      for (const w of winRows) {
        const d = touch(String(w.day));
        d.opened = Number(w.opened); d.billed = Number(w.billed);
        d.solo = Number(w.solo); d.cost = Number(w.cost);
      }
      const all = [...byDay.values()];
      const days = fillDays(r.lo, r.hi, all.filter((d) => d.day >= r.lo), ZERO);
      const prevDays = fillDays(r.prevLo, r.lo, all.filter((d) => d.day < r.lo), ZERO);

      const cur = addUp(days);
      const prv = addUp(prevDays);

      /* نسبةٌ لا تُحسب على صفر: صفرُ مُفوترٍ يعني «لا مقياس» لا «صفرٌ بالمئة» —
         و`null` تُقرأ في الشاشة «لا بيانات» بدل «سقط إلى الصفر». */
      const rate = cur.billed ? cur.solo / cur.billed : null;
      const prevRate = prv.billed ? prv.solo / prv.billed : null;
      const perConv = cur.billed ? cur.cost / cur.billed : null;
      const prevPerConv = prv.billed ? prv.cost / prv.billed : null;

      /* أعمدةُ الأسبوع والساعة: الأسبوعُ يبدأ بالأحد عربيّاً، و`isodow`
         تُرجع 7 للأحد — فالترتيبُ صريحٌ لا مأخوذٌ من تصاعد الأرقام. */
      const WEEK = [7, 1, 2, 3, 4, 5, 6];
      const byDow = WEEK.map((dow) => ({
        dow,
        n: busyRows.filter((b) => Number(b.dow) === dow).reduce((a, b) => a + Number(b.n), 0),
      }));
      const byHour = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        n: busyRows.filter((b) => Number(b.hr) === hour).reduce((a, b) => a + Number(b.n), 0),
      }));
      const peak = busyRows.reduce<{ dow: number; hour: number; n: number } | null>(
        (best, b) => (best && best.n >= Number(b.n)
          ? best
          : { dow: Number(b.dow), hour: Number(b.hr), n: Number(b.n) }),
        null,
      );

      const flagOf = (want: boolean) => flagRows.find((f) => Boolean(f.cur) === want);
      const fc = flagOf(true);
      const fp = flagOf(false);

      /* عددُ الأيّام التي فيها **أثرٌ فعليّ** — وهو ما يُقرَّر به هل يُرسم خطّ.
         ثلاثُ نقاطٍ أدنى ما يُقرأ اتّجاهاً؛ ونقطتان خطٌّ مستقيمٌ بلا معنى. */
      const liveDays = days.filter((d) => d.msgs > 0).length;
      const billedDays = days.filter((d) => d.billed > 0).length;

      return {
        range: {
          from: r.lo, to: r.last, days: r.days,
          preset: r.preset, openEnd: r.openEnd, tz, presets: [...PRESET_DAYS],
        },
        prev: { from: r.prevLo, to: shiftDay(r.lo, -1), days: r.days },
        days,
        prevDays,
        total: cur,
        prevTotal: prv,
        volume: { byDow, byHour, peak },
        selfServe: {
          rate, prevRate,
          solo: cur.solo, billed: cur.billed,
          prevSolo: prv.solo, prevBilled: prv.billed,
        },
        cost: { total: cur.cost, prevTotal: prv.cost, perConv, prevPerConv },
        gaps: {
          items: gapRows.map((g) => ({
            topic: String(g.topic),
            asks: Number(g.asks),
            handoffs: Number(g.handoffs),
            sample: g.sample == null ? null : String(g.sample),
          })),
          runs: Number(fc?.runs ?? 0),
          prevRuns: Number(fp?.runs ?? 0),
          handoff: Number(fc?.handoff ?? 0),
          prevHandoff: Number(fp?.handoff ?? 0),
          unknown: Number(fc?.dunno ?? 0),
          fail: Number(fc?.fail ?? 0),
          medianLatencyMs: Number(fc?.p50 ?? 0),
        },
        /* ★ **البيانُ الصادق مِلكُ الخادم لا الشاشة.** من يملك الأرقام يملك
           الحكمَ على كفايتها — وإلّا اختلفت عتبةُ الشاشة عن عتبة الملفّ،
           فقال أحدهما «لا تكفي» ورسم الآخرُ خطّاً يوحي بمعنى. */
        enough: {
          minBilled: MIN_FOR_TREND,
          /** النسبةُ نفسُها تُقرأ رقماً */
          rate: cur.billed >= MIN_FOR_TREND,
          /** والمقارنةُ بالسابق تحتاج مدًى سابقاً فيه بياناتٌ أيضاً */
          delta: cur.billed >= MIN_FOR_TREND && prv.billed >= MIN_FOR_TREND,
          /** وخطُّ الاتّجاه يحتاج ثلاثَ نقاطٍ فيها أثر */
          line: billedDays >= 3,
          volume: liveDays >= 3,
          busy: cur.cust >= 20,
          gaps: gapRows.length > 0,
          liveDays,
          billedDays,
        },
      };
    });
  }

  app.get<{ Querystring: { days?: string; from?: string; to?: string } }>(
    '/reports/trend',
    { preHandler: requireAuth({ billing: true }) },
    async (req) => {
      const parsed = parseRange(req.query ?? {});
      if (!parsed.ok) throw new AppError(ErrorCode.VALIDATION, parsed.message, 400);
      return trend(tenantOf(req), parsed.range);
    },
  );

  /**
   * تصديرُ الاتّجاه — يومٌ في كلّ سطر.
   *
   * ★ يتبع `/usage/windows.csv` حرفيّاً: BOM أوّلاً (وبلاه يعرض إكسل العربيّةَ
   *   محارفَ مشوّهة، فيُقرأ الملفُّ معطوباً لا الترميز)، ورأسٌ عربيّ،
   *   و`content-disposition` باسمٍ يحمل المدى — فملفّان لمدَيَين لا يتراكبان
   *   في مجلّد التنزيلات كما يتراكب `export.csv` مع نفسه.
   *
   * ★ والنسبةُ تُكتب **كسراً** لا نصّاً بعلامة مئة: الملفُّ يُفتح ليُحسَب
   *   عليه، و«84%» في خليّةٍ نصٌّ لا رقم. ويومٌ بلا محادثةٍ مُفوترةٍ يُترك
   *   **فارغاً** لا صفراً — فصفرُ الاكتفاء حكمٌ، والفراغُ «لا مقياس».
   */
  app.get<{ Querystring: { days?: string; from?: string; to?: string } }>(
    '/reports/trend.csv',
    { preHandler: requireAuth({ billing: true }) },
    async (req, reply) => {
      const parsed = parseRange(req.query ?? {});
      if (!parsed.ok) throw new AppError(ErrorCode.VALIDATION, parsed.message, 400);
      const data = await trend(tenantOf(req), parsed.range);

      const head = [
        'اليوم', 'رسائل الزبائن', 'ردود البوت', 'ردود الموظّف',
        'محادثات فُتحت', 'محادثات مُفوترة', 'أنهاها البوت وحده',
        'نسبة الاكتفاء', 'كلفة الذكاء',
      ].join(',');
      const body = data.days.map((d) => [
        d.day, d.cust, d.bot, d.agent, d.opened, d.billed, d.solo,
        d.billed ? (d.solo / d.billed).toFixed(4) : '',
        d.cost.toFixed(6),
      ].join(',')).join('\n');

      const name = `trend-${data.range.from}_${data.range.to}.csv`;
      // BOM ليفتح إكسل العربيّة سليمةً — بدونه يعرض محارف مشوّهة
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${name}"`)
        .send('﻿' + head + '\n' + body);
    },
  );

  /** الاستهلاك — جدول النوافذ نفسه، لا ملخّصاً مشتقّاً منه. */
  app.get('/usage', { preHandler: requireAuth({ billing: true }) }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const lim = await limitsOf(tx as never, tenantId);
      const p = period();

      const items = await tx
        .select({
          id: conversationWindows.id,
          openedAt: conversationWindows.openedAt,
          billedAt: conversationWindows.billedAt,
          messagesIn: conversationWindows.messagesIn,
          messagesOut: conversationWindows.messagesOut,
          aiCostUsd: conversationWindows.aiCostUsd,
          channelKind: tenantChannels.kind,
          handle: channelIdentities.externalId,
          contactName: contacts.displayName,
        })
        .from(conversationWindows)
        .innerJoin(tenantChannels, eq(tenantChannels.id, conversationWindows.channelId))
        .innerJoin(conversations, eq(conversations.id, conversationWindows.conversationId))
        .innerJoin(channelIdentities, eq(channelIdentities.id, conversations.identityId))
        .innerJoin(contacts, eq(contacts.id, conversationWindows.contactId))
        .where(eq(conversationWindows.billingPeriod, p))
        .orderBy(desc(conversationWindows.openedAt))
        .limit(200);

      const [agg] = await tx.execute<{
        billed: number; opened: number; tokens: number; cost: number; avg_replies: number;
      }>(sql`
        SELECT count(*) FILTER (WHERE billed_at IS NOT NULL)::int AS billed,
               count(*)::int                                      AS opened,
               coalesce(sum(bot_replies), 0)::int                 AS avg_replies,
               coalesce(sum(ai_cost_usd), 0)::float               AS cost,
               (SELECT coalesce(sum(total_tokens), 0)::int FROM ai_runs
                 WHERE tenant_id = ${tenantId}
                   AND to_char(created_at, 'YYYY-MM') = ${p})     AS tokens
          FROM conversation_windows
         WHERE tenant_id = ${tenantId} AND billing_period = ${p}
      `) as unknown as Array<Record<string, number>>;

      const alerts = await alertsOf(tx as never, p);
      const pol = await tx.select({ policy: plans.overagePolicy }).from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.status, 'active')))
        .orderBy(desc(subscriptions.periodEnd))
        .limit(1);

      const billed = Number(agg?.billed ?? 0);
      const policy = pol[0]?.policy ?? 'handoff_only';
      const wLimit = Number(lim.windows ?? 0);
      return {
        period: p,
        windowsBilled: billed,
        windowsOpened: Number(agg?.opened ?? 0),
        windowsLimit: Number(lim.windows ?? 0),
        aiTokens: Number(agg?.tokens ?? 0),
        aiTokensLimit: Number(lim.aiTokens ?? 0),
        aiCostUsd: Number(agg?.cost ?? 0),
        avgRepliesPerWindow: billed ? Number(agg?.avg_replies ?? 0) / billed : 0,
        /* ★ السياسةُ والعتباتُ معاً: شاشةُ الاستهلاك كانت تُحيل إلى الرئيسيّة
           لتقول «ماذا يحدث عند السقف» — وهي الشاشة التي يُفتحها العميل وقت
           القلق. فصارت تحمل عاقبتَها بنفسها. */
        overagePolicy: policy,
        capConsequence: capConsequence(policy, wLimit > 0 && billed >= wLimit),
        quotaAlerts: alerts,
        items,
      };
    });
  });

  /** تصديرٌ يستطيع العميل مطابقته بنفسه — عدّادٌ لا يُراجَع يُنتج نزاعاً. */
  app.get('/usage/windows.csv', { preHandler: requireAuth({ billing: true }) }, async (req, reply) => {
    const tenantId = tenantOf(req);
    const rows = await withTenant(getDb(), tenantId, async (tx) =>
      tx.select({
        handle: channelIdentities.externalId,
        kind: tenantChannels.kind,
        openedAt: conversationWindows.openedAt,
        billedAt: conversationWindows.billedAt,
        messagesIn: conversationWindows.messagesIn,
        messagesOut: conversationWindows.messagesOut,
        cost: conversationWindows.aiCostUsd,
      })
        .from(conversationWindows)
        .innerJoin(tenantChannels, eq(tenantChannels.id, conversationWindows.channelId))
        .innerJoin(conversations, eq(conversations.id, conversationWindows.conversationId))
        .innerJoin(channelIdentities, eq(channelIdentities.id, conversations.identityId))
        .where(eq(conversationWindows.billingPeriod, period()))
        .orderBy(desc(conversationWindows.openedAt)));

    const head = 'الزبون,القناة,فُتحت,فُوتِرت,واردة,صادرة,كلفة الذكاء';
    const body = rows.map((r) => [
      r.handle, r.kind, r.openedAt.toISOString(), r.billedAt?.toISOString() ?? '',
      r.messagesIn, r.messagesOut, r.cost,
    ].join(',')).join('\n');

    // BOM ليفتح إكسل العربيّة سليمةً — بدونه يعرض محارف مشوّهة
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="windows-${period()}.csv"`)
      .send('﻿' + head + '\n' + body);
  });

  /** القنوات — مع قدراتها، فالواجهة تعرض ما تدعمه كلٌّ منها بلا شرطٍ مكتوب. */
  app.get('/channel', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const rows = await tx.select().from(tenantChannels).where(eq(tenantChannels.tenantId, tenantId));
      return {
        items: rows.map(({ tokenEnc, appSecretEnc, verifyToken, ...safe }) => ({
          ...safe,
          // لا سرَّ يُعاد للواجهة أبداً — بصمةٌ وتاريخٌ فقط
          capabilities: capabilitiesFor(safe.kind as ChannelKind),
        })),
      };
    });
  });

  /**
   * ★ ربط قناة — والقاعدة التي يفرضها: **لا يُحفظ سرٌّ قبل أن يُثبت أنّه يعمل.**
   *
   * سببها مباشر: توكنٌ مكسورٌ محفوظٌ في القاعدة يُنتج **بوتاً صامتاً** لا عطلاً
   * ظاهراً — القناة تقول «موصولة»، والشاشات خضراء، ولا رسالة تصل. وذاك أسوأ
   * ما يقع لعميل. فنفحص عند ميتا أوّلاً، ولا نكتب شيئاً إن فشل الفحص.
   *
   * وما يُطلب أربع قيمٍ فقط — وهي حدّ ما يحتاجه واتساب BYO:
   * معرّف الرقم · التوكن · App Secret · (اختياريّاً) معرّف WABA.
   * وتوكن التحقّق **نولّده نحن** فلا يخترعه العميل ولا نطلبه منه.
   */
  interface ConnectBody {
    phoneNumberId?: string; token?: string; appSecret?: string; wabaId?: string;
  }

  async function connect(tenantId: string, b: ConnectBody, reply: FastifyReply) {
    if (!b.phoneNumberId || !b.token || !b.appSecret) {
      throw new AppError(
        ErrorCode.VALIDATION,
        'معرّف الرقم والتوكن وApp Secret مطلوبة — وكلّها من لوحتك عند ميتا.',
        400,
      );
    }

    /* ① الفحص عند ميتا **قبل** أيّ كتابة، وخارج أيّ معاملة. */
    const adapter = getAdapter('whatsapp_cloud');
    const report = await adapter.healthCheck({
      channelId: 'pending', tenantId, kind: 'whatsapp_cloud',
      token: b.token, externalAccountId: b.phoneNumberId,
      config: b.wabaId ? { wabaId: b.wabaId } : {},
    }).catch((e) => ({
      level: 'unreachable' as const, tokenValid: false, webhookSubscribed: null,
      qualityRating: null, messagingTier: null, issues: [(e as Error).message], detail: {},
    }));

    if (!report.tokenValid) {
      return reply.code(422).send({
        error: 'لم نحفظ شيئاً — التوكن لا يعمل.',
        issues: report.issues,
        hint: 'الأشيع أنّه توكنٌ مؤقّت عمره 24 ساعة. أنشئ توكن «مستخدم نظام» بلا انتهاء.',
      });
    }

    /* ② الكتابة بعد الإثبات. وتوكن التحقّق يبقى كما هو إن وُجد، فلا يُبطِل
          تجديدُ توكنٍ ويبهوكاً مضبوطاً عند ميتا. */
    const detail = ((report.detail as Record<string, unknown>).phone ?? {}) as Record<string, string>;
    const saved = await withTenant(getDb(), tenantId, async (tx) => {
      /* `tenants` جدولٌ عامّ خارج RLS بصلاحيّة قراءةٍ لدور التطبيق — ومنه
         `publicId` الذي يبني مسار الويبهوك. وهو ليس في مطالبات التوكن عمداً:
         التوكن يحمل ما يُصرّح به لا ما يُعرَض. */
      const t = (await tx.select({ pid: tenants.publicId }).from(tenants)
        .where(eq(tenants.id, tenantId)).limit(1))[0];
      const cur = (await tx.select().from(tenantChannels).where(and(
        eq(tenantChannels.tenantId, tenantId), eq(tenantChannels.kind, 'whatsapp_cloud'),
      )).limit(1))[0];

      const sealedToken = seal(b.token!);
      const sealedSecret = seal(b.appSecret!);
      const values = {
        tenantId, kind: 'whatsapp_cloud' as const,
        externalAccountId: b.phoneNumberId!,
        displayName: [detail.verified_name, detail.display_phone_number].filter(Boolean).join(' ') || null,
        config: b.wabaId ? { wabaId: b.wabaId } : (cur?.config ?? {}),
        tokenEnc: sealedToken.enc,
        tokenFingerprint: fingerprint(b.token!),
        appSecretEnc: sealedSecret.enc,
        keyVersion: sealedToken.keyVersion,
        verifyToken: cur?.verifyToken ?? publicId().slice(0, 20),
        status: 'connected' as const,
        qualityRating: report.qualityRating,
        messagingTier: report.messagingTier,
        lastCheckedAt: new Date(),
        lastError: report.issues[0] ?? null,
        connectedAt: cur?.connectedAt ?? new Date(),
      };

      const [row] = cur
        ? await tx.update(tenantChannels).set(values).where(eq(tenantChannels.id, cur.id)).returning()
        : await tx.insert(tenantChannels).values(values).returning();
      return { ...row!, tenantPublicId: t?.pid ?? '' };
    });

    return {
      id: saved.id,
      displayName: saved.displayName,
      tokenFingerprint: saved.tokenFingerprint,
      qualityRating: saved.qualityRating,
      webhookSubscribed: report.webhookSubscribed,
      issues: report.issues,
      /* ما يلصقه العميل في ميتا — يُعاد هنا لأنّه لا يُخزَّن في مكانٍ يراه. */
      webhookUrl: `${process.env.PUBLIC_URL ?? 'https://aibot.masaros.net'}/api/webhooks/wa/${saved.tenantPublicId}`,
      verifyToken: saved.verifyToken,
    };
  }

  /** العميل يربط قناته بنفسه. */
  app.post<{ Body: ConnectBody }>(
    '/channel/connect',
    { preHandler: requireAuth({ settings: true }) },
    async (req, reply) => connect(tenantOf(req), req.body ?? {}, reply),
  );

  /**
   * ومالك المنصّة يربطها **لعميلٍ يسمّيه صراحةً** — لا بالانتحال.
   *
   * ★ الانتحال قراءةٌ فقط، وذاك قرارٌ صحيح يُصان: لو سمحنا له بالكتابة صار
   *   لدينا مسارٌ يكتب في بيانات عميلٍ بهويّةٍ مستعارة، فيصير سجلّ التدقيق
   *   كاذباً. فالمسار هنا صريحٌ ومسجَّل، والمستأجر في العنوان لا في التوكن.
   *   وُجد لأنّ معالج التهيئة يحتاجه: المالك يربط القناة أوّل مرّةٍ مع العميل
   *   على مكالمة — وهذا واقع BYO.
   */
  app.post<{ Params: { id: string }; Body: ConnectBody }>(
    '/console/tenants/:id/channel/connect',
    { preHandler: requireAuth({ console: true }) },
    async (req, reply) => {
      const out = await connect(req.params.id, req.body ?? {}, reply);
      if (reply.sent) return out;
      await withPlatform(getDb(), 'تدقيق: ربط قناةٍ لعميل من لوحة المالك', (tx) =>
        tx.insert(auditLog).values({
          tenantId: req.params.id,
          actorUserId: req.auth!.sub,
          action: 'channel.connect',
          entity: 'tenant_channel',
          entityId: (out as { id: string }).id,
          ip: req.ip,
        }));
      return out;
    },
  );

  /**
   * ★ اختبار اتّصالٍ **حقيقيّ** بميتا — لا فحصُ صفٍّ في قاعدتنا.
   *
   * وُجد لأنّ زرّ «اختبر الاتّصال» كان موجوداً في الشاشة بلا معالج. وزرٌّ لا
   * يعمل يكسر الثقة أكثر من ميزةٍ غائبة: العميل يضغط فلا يحدث شيء، فيستنتج
   * أنّ النظام معطوب — لا أنّ الميزة لم تُبنَ.
   *
   * وأهمّ ما يفحصه **اشتراك الويبهوك**، وهو السبب الأوّل لـ«البوت لا يردّ»
   * بينما كلّ شيءٍ آخر يبدو سليماً: التوكن صالح، والرقم أخضر، ولا رسالة تصل.
   *
   * النتيجة تُحفظ في `last_checked_at` و`last_error` فتظهر في الشاشة بلا نداءٍ ثانٍ.
   */
  app.post<{ Body: { channelId?: string } }>(
    '/channel/test',
    { preHandler: requireAuth() },
    async (req, reply) => {
      const tenantId = tenantOf(req);

      const ch = await withTenant(getDb(), tenantId, async (tx) => {
        const rows = await tx.select().from(tenantChannels).where(
          req.body?.channelId
            ? and(eq(tenantChannels.tenantId, tenantId), eq(tenantChannels.id, req.body.channelId))
            : eq(tenantChannels.tenantId, tenantId),
        ).limit(1);
        return rows[0];
      });

      if (!ch) return reply.code(404).send({ error: 'لا قناةٌ لهذا الحساب' });
      if (!ch.tokenEnc) {
        return reply.code(409).send({ error: 'القناة غير مربوطة بعد — لا توكن محفوظ' });
      }

      /* النداء الشبكيّ **خارج** أيّ معاملة: فحص ميتا يأخذ ثوانٍ، ومعاملةٌ
         مفتوحة أثناءه تحتجز اتّصالاً من البِركة بلا داعٍ. */
      const adapter = getAdapter(ch.kind as ChannelKind);
      let report;
      try {
        report = await adapter.healthCheck({
          channelId: ch.id,
          tenantId,
          kind: ch.kind as ChannelKind,
          token: decrypt(ch.tokenEnc, ch.keyVersion),
          externalAccountId: ch.externalAccountId ?? '',
          config: (ch.config ?? {}) as Record<string, unknown>,
        });
      } catch (e) {
        report = {
          level: 'unreachable' as const,
          tokenValid: false, webhookSubscribed: null,
          qualityRating: null, messagingTier: null,
          issues: [(e as Error).message],
          detail: {},
        };
      }

      await withTenant(getDb(), tenantId, (tx) => tx.update(tenantChannels).set({
        lastCheckedAt: new Date(),
        lastError: report.issues[0] ?? null,
        qualityRating: report.qualityRating ?? ch.qualityRating,
        messagingTier: report.messagingTier ?? ch.messagingTier,
        // `error` فقط عند عطلٍ فعليّ: `degraded` تعني تعمل بجودةٍ أقلّ لا معطوبة
        status: report.level === 'ok' || report.level === 'degraded' ? 'connected' : 'error',
      }).where(eq(tenantChannels.id, ch.id)));

      return {
        level: report.level,
        tokenValid: report.tokenValid,
        webhookSubscribed: report.webhookSubscribed,
        qualityRating: report.qualityRating,
        messagingTier: report.messagingTier,
        issues: report.issues,
        checkedAt: new Date().toISOString(),
      };
    },
  );
}
