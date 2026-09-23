import {
  getDb, withTenant, quotaAlerts, users, eq, and,
} from '@aibot/db';
import { crossedThresholds, capConsequence } from '@aibot/shared';
import { handleNotify, type NotifyJob } from './notify.js';
import { raiseIncident, type IncidentInput } from './incidents.js';

/**
 * ★ إنذارُ السقف — العميل لا يصل إلى سقفه بلا إنذارٍ مسبق.
 *
 * العطل الذي وُلد منه هذا الملفّ: لم يكن في المنصّة تنبيهٌ **واحد** عند
 * اقتراب السقف. فكان العميل يكتشف سقفَه من أنّ بوته صمت — وهي أشيع شكوى
 * في هذا النوع من المنتجات، وأسوأها أثراً لأنّها تقع على زبائنه لا عليه.
 *
 * ثلاث قواعد تحكم الملفّ كلَّه:
 *
 *  ① **العبورُ يُحسب على الحافّة لا على الحال.** «هو فوق الثمانين الآن» شرطٌ
 *    يصدُق على كلّ نافذةٍ بعد الثمانين — فيُطلق إنذاراً مع كلّ نافذةٍ تقريباً.
 *    والحافّة: كان دون العتبة وصار عليها أو فوقها. مرّةً واحدة.
 *
 *  ② **والحافّةُ وحدها لا تكفي.** إنذارٌ في الذاكرة يضيع مع أوّل إعادة تشغيل،
 *    وعاملان متزامنان يعبران نفس العتبة مرّتين. فالحجزُ في القاعدة على فريدٍ
 *    `(مستأجر · دورة · عتبة)` — والفائزُ وحده يُنذر.
 *
 *  ③ **والنصُّ يقول العاقبة لا الحالة.** «استهلكتَ 80٪» معلومةٌ لا تُفيد قراراً.
 *    «عند بلوغ السقف يتوقّف الردّ على المحادثات الجديدة» قرارٌ يُتّخذ عليه.
 *    والعاقبةُ **تُقرأ من المنطق القائم** (`checkQuota` في `outbound.ts`) لا
 *    تُخترع — انظر `capConsequence` في `@aibot/shared`.
 */

/* العتباتُ (`QUOTA_THRESHOLDS`) وحسابُ العبور (`crossedThresholds`) ونصُّ
   العاقبة (`capConsequence`) كلُّها في `@aibot/shared`: النصُّ يُقال في موضعين
   — إشعارٌ من هنا، وشاشتان عبر الـAPI — ونسختان منه تتباعدان. */

export interface QuotaCrossing {
  tenantId: string;
  /** عددُ النوافذ المُفوترة **قبل** هذه النافذة. */
  before: number;
  /** وبعدها. */
  after: number;
  limit: number;
  policy: string;
  /** دورةُ الفوترة «YYYY-MM» — جزءٌ من مفتاح الحجز، وبه يتصفّر الإنذار. */
  period: string;
}

/**
 * ما تحتاجه الدالّة من العالم الخارجيّ — مُمرَّرٌ لا مُستورَدٌ صلباً، فيُختبر
 * «مرّةً واحدةً لكلّ عتبةٍ لكلّ دورة» بلا قاعدةٍ ولا شبكة.
 */
export interface QuotaAlertDeps {
  /** يحجز العتبة لهذه الدورة. `true` للفائز وحده — والضمانةُ فريدٌ في القاعدة. */
  claim(a: {
    tenantId: string; period: string; threshold: number;
    used: number; limit: number; policy: string;
  }): Promise<boolean>;
  /** مُلّاك المستأجر النشطون — هم من يُشعَر، لا كلُّ موظّفٍ في الفريق. */
  owners(tenantId: string): Promise<string[]>;
  push(job: NotifyJob): Promise<void>;
  incident(i: IncidentInput): Promise<unknown>;
  log(line: Record<string, unknown>): void;
}

const TITLE: Record<number, string> = {
  80: 'استهلكتَ 80٪ من نوافذ باقتك',
  95: 'استهلكتَ 95٪ من نوافذ باقتك',
  100: 'بلغتَ سقف نوافذ باقتك',
};

/**
 * يُطلق ما عبره هذا الانتقال — ولا شيءَ آخر.
 *
 * ⚠️ تُنادى **بعد إيداع** معاملة الختم لا داخلها: الدفعُ نداءٌ شبكيّ، ومعاملةٌ
 *    مفتوحة أثناءه تحتجز اتّصالاً لثوانٍ وتخنق البِرْكة — وهو الدرس نفسه الذي
 *    جمّد عامل الردّ.
 *
 * وتُرجع العتبات التي أُطلِقت فعلاً (لا التي عُبرت) — فالاختبار يقيس الإطلاق.
 */
export async function announceQuotaCrossing(
  c: QuotaCrossing,
  deps: QuotaAlertDeps = defaultDeps(),
): Promise<number[]> {
  const crossed = crossedThresholds(c.before, c.after, c.limit);
  if (!crossed.length) return [];

  const fired: number[] = [];
  for (const threshold of crossed) {
    const won = await deps.claim({
      tenantId: c.tenantId, period: c.period, threshold,
      used: c.after, limit: c.limit, policy: c.policy,
    });
    // خسِر الحجز ⟵ أُنذر في هذه الدورة سابقاً. لا إشعار، ولا سطرَ سجلٍّ صاخب.
    if (!won) continue;
    fired.push(threshold);

    const atCap = threshold >= 100;
    const consequence = capConsequence(c.policy, atCap);
    const body = `${c.after} من ${c.limit} نافذة. ${consequence}`;

    /* ★ سطرُ السجلّ هو ما يُثبت «مرّةً واحدةً لكلّ عتبة» على الخادم. */
    deps.log({
      level: atCap ? 'error' : 'warn', svc: 'worker', msg: 'عبورُ عتبةِ سقف',
      tenantId: c.tenantId, period: c.period, threshold,
      used: c.after, limit: c.limit, policy: c.policy,
    });

    /* ① دفعٌ إلى مالك المستأجر — صاحبُ القرار، لا كلُّ موظّفٍ في الفريق. */
    const owners = await deps.owners(c.tenantId);
    for (const userId of owners) {
      await deps.push({
        userId,
        tenantId: c.tenantId,
        /* التاجُ يحمل الدورة والعتبة: عتبتان في شهرٍ إشعاران مستقلّان، ودورةٌ
           جديدة إشعارٌ جديد — ولا يُحدَّث إشعارٌ قديمٌ فيُقرأ خبراً بائتاً. */
        tag: `quota:${c.period}:${threshold}`,
        title: TITLE[threshold] ?? `استهلكتَ ${threshold}٪ من نوافذ باقتك`,
        body,
        url: '/app/usage',
        severity: atCap ? 'critical' : 'warn',
      });
    }

    /* ② وحادثةٌ لمالك المنصّة عند 95٪ و100٪ — عميلٌ على حدّ باقته شأنُ المنصّة.
       والشدّةُ `warn` لا `critical` في الاثنتين **قصداً**: `critical` تدفع
       فوراً إلى مالك المنصّة **ومالك العميل** معاً (`notifyCritical`)، فيصل
       العميلَ إشعارٌ ثانٍ بعنوانٍ مكتوبٍ للمنصّة لا له. والتجميعةُ كلَّ ربع
       ساعةٍ تكفي حدثاً فاتوريّاً — وإغراقُ الصندوق هو ما يُطفئ التنبيهات.
       (ونفسُ شدّةِ `quota_exceeded` القائمة في `reply.ts` — لا لغتان.) */
    if (threshold >= 95) {
      await deps.incident({
        tenantId: c.tenantId,
        kind: 'quota_threshold',
        severity: 'warn',
        title: atCap
          ? `عميلٌ بلغ سقف باقته (${c.after}/${c.limit})`
          : `عميلٌ على ${threshold}٪ من سقف باقته (${c.after}/${c.limit})`,
        detail: { threshold, used: c.after, limit: c.limit, policy: c.policy, period: c.period },
        // بصمةٌ بالدورة والعتبة: حادثةٌ واحدة لكلّ عتبةٍ في كلّ شهر
        causeKey: `${c.period}:${threshold}`,
      });
    }
  }

  return fired;
}

/* ═══════════════ الوصلاتُ الحقيقيّة ═══════════════ */

function defaultDeps(): QuotaAlertDeps {
  return {
    claim: claimThreshold,
    owners: tenantOwners,
    push: handleNotify,
    incident: raiseIncident,
    log: (line) => console.log(JSON.stringify(line)),
  };
}

/**
 * الحجزُ الذرّيّ.
 * `ON CONFLICT DO NOTHING … RETURNING` يُرجع صفّاً للفائز وحده — فلا قراءةَ
 * ثمّ كتابةٍ، ولا سباقَ بين عاملَين، ولا حاجةَ إلى قفل.
 */
async function claimThreshold(a: {
  tenantId: string; period: string; threshold: number;
  used: number; limit: number; policy: string;
}): Promise<boolean> {
  const rows = await withTenant(getDb(), a.tenantId, (tx) => tx.insert(quotaAlerts).values({
    tenantId: a.tenantId,
    billingPeriod: a.period,
    threshold: a.threshold,
    windowsUsed: a.used,
    // سقفٌ لا نهائيّ لا يصل هنا (`crossedThresholds` تُرجع فراغاً) — والحدُّ احتياطٌ للنوع
    windowsLimit: Number.isFinite(a.limit) ? Math.trunc(a.limit) : 0,
    policy: a.policy,
  }).onConflictDoNothing({
    target: [quotaAlerts.tenantId, quotaAlerts.billingPeriod, quotaAlerts.threshold],
  }).returning({ id: quotaAlerts.id }));
  return rows.length > 0;
}

async function tenantOwners(tenantId: string): Promise<string[]> {
  const rows = await withTenant(getDb(), tenantId, (tx) => tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'tenant_owner'), eq(users.isActive, true))));
  return rows.map((r) => r.id);
}
