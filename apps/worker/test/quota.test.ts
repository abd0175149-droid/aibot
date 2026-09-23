import { describe, it, expect } from 'vitest';
import { crossedThresholds, capConsequence } from '@aibot/shared';
import {
  announceQuotaCrossing, type QuotaAlertDeps, type QuotaCrossing,
} from '../src/quota.js';
import type { NotifyJob } from '../src/notify.js';
import type { IncidentInput } from '../src/incidents.js';

/**
 * ★ ما يُختبر هنا ليس «هل تُرسَل رسالة» بل **مرّةً واحدةً لكلّ عتبةٍ لكلّ دورة**.
 *
 * العطل الذي يمنعه هذا الملفّ ليس غياب التنبيه — بل تنبيهٌ مع كلّ نافذةٍ بعد
 * الثمانين. شرطُ «هو فوق العتبة الآن» يصدُق على العشرين نافذةً الباقية كلِّها،
 * فيغرق صندوقُ العميل ويُطفئ الإشعارات — ويعود إلى حيث بدأنا: بلا إنذار.
 *
 * ولذلك `claim` مُمرَّرةٌ لا مستوردة: فريدُ القاعدة هو الضمانةُ في الإنتاج،
 * و`Set` تحاكيه هنا بالضبط — فيُختبر السلوك كلُّه بلا قاعدةٍ ولا شبكة.
 */

/** يحاكي الفريد `(مستأجر · دورة · عتبة)`: أوّل حاجزٍ يفوز، ومن بعده لا. */
function fakeWorld() {
  const claimed = new Set<string>();
  const pushes: NotifyJob[] = [];
  const incidents: IncidentInput[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const deps: QuotaAlertDeps = {
    async claim(a) {
      const key = `${a.tenantId}|${a.period}|${a.threshold}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    async owners() { return ['owner-1']; },
    async push(j) { pushes.push(j); },
    async incident(i) { incidents.push(i); return { id: 'i', isNew: true }; },
    log(l) { logs.push(l); },
  };
  return { deps, pushes, incidents, logs, claimed };
}

const base: QuotaCrossing = {
  tenantId: 't-1', before: 0, after: 0, limit: 100,
  policy: 'handoff_only', period: '2026-09',
};

describe('عبورُ العتبة — على الحافّة لا على الحال', () => {
  it('تحت العتبة: لا عبور', () => {
    expect(crossedThresholds(70, 79, 100)).toEqual([]);
  });

  it('عليها بالضبط: تُعبَر — فالثمانون عتبةٌ تُبلَغ لا تُتجاوَز', () => {
    expect(crossedThresholds(79, 80, 100)).toEqual([80]);
    expect(crossedThresholds(94, 95, 100)).toEqual([95]);
    expect(crossedThresholds(99, 100, 100)).toEqual([100]);
  });

  it('فوقها: لا عبورَ ثانياً — وهذا هو الفرق كلُّه', () => {
    /* لو كان الشرط «هو فوق الثمانين الآن» لأطلق هذا وكلُّ ما بعده. */
    expect(crossedThresholds(80, 81, 100)).toEqual([]);
    expect(crossedThresholds(95, 96, 100)).toEqual([]);
    // وما بعد السقف (سياسةُ allow_bill تستمرّ) لا يُنذر من جديد
    expect(crossedThresholds(100, 101, 100)).toEqual([]);
    expect(crossedThresholds(140, 141, 100)).toEqual([]);
  });

  it('عبورٌ مزدوج في نافذةٍ واحدة: 79٪ ⟶ 96٪ يُطلق الاثنتين', () => {
    expect(crossedThresholds(79, 96, 100)).toEqual([80, 95]);
  });

  it('سقفٌ صغير: نافذةٌ واحدة تعبر الثلاث — 75٪ ⟶ 100٪', () => {
    expect(crossedThresholds(3, 4, 4)).toEqual([80, 95, 100]);
  });

  it('الحسابُ بالضرب لا بالقسمة — فلا تُفلت عتبةٌ بكسرٍ عائم', () => {
    // سقف 3: ثمانون بالمئة منه 2.4 — النافذةُ الثانية دونها والثالثة فوق الكلّ
    expect(crossedThresholds(1, 2, 3)).toEqual([]);
    expect(crossedThresholds(2, 3, 3)).toEqual([80, 95, 100]);
  });

  it('بلا سقفٍ لا عتبة — ولا يُنذر أحدٌ بلا باقة', () => {
    expect(crossedThresholds(79, 80, Number.POSITIVE_INFINITY)).toEqual([]);
    expect(crossedThresholds(79, 80, 0)).toEqual([]);
    expect(crossedThresholds(79, 80, Number.NaN)).toEqual([]);
  });

  it('عدّادٌ لم يتحرّك (أو تراجع) لا يعبر شيئاً', () => {
    expect(crossedThresholds(80, 80, 100)).toEqual([]);
    expect(crossedThresholds(90, 80, 100)).toEqual([]);
  });
});

describe('نصُّ العاقبة — يقول ما يحدث لا ما هو الحال', () => {
  it('allow_bill تستمرّ وتُفوتَر — وهي وحدها التي تستمرّ في الكود', () => {
    expect(capConsequence('allow_bill', false)).toContain('يستمرّ');
    expect(capConsequence('allow_bill', true)).toContain('فاتورة');
  });

  it('block و handoff_only نصٌّ واحد — لأنّهما في الكود شيءٌ واحد', () => {
    expect(capConsequence('block', false)).toBe(capConsequence('handoff_only', false));
    expect(capConsequence('block', true)).toBe(capConsequence('handoff_only', true));
  });

  it('والنصُّ يذكر أنّ المنعَ يشمل الموظّف — فالحارس لا يستثني دوراً', () => {
    expect(capConsequence('handoff_only', true)).toContain('موظّفك');
    // ولا يَعِد بما لا يفعله الكود: «بلا حدّ» كان وعداً كاذباً في الواجهة
    expect(capConsequence('handoff_only', true)).not.toContain('بلا حدّ');
  });

  it('سياسةٌ مجهولة تُعامَل معاملةَ المانع — لا وعدَ استمرارٍ من مفتاحٍ غريب', () => {
    expect(capConsequence('something_new', true)).toBe(capConsequence('handoff_only', true));
  });
});

describe('الإطلاق — مرّةً واحدةً لكلّ عتبةٍ لكلّ دورة', () => {
  it('لا عبورَ ⟵ لا حجزَ ولا إشعارَ ولا سطرَ سجلّ', async () => {
    const w = fakeWorld();
    const fired = await announceQuotaCrossing({ ...base, before: 70, after: 71 }, w.deps);
    expect(fired).toEqual([]);
    expect(w.claimed.size).toBe(0);
    expect(w.pushes).toEqual([]);
    expect(w.logs).toEqual([]);
  });

  it('العبورُ الأوّل يُنذر، والنوافذُ التالية لا — ولا تكرار', async () => {
    const w = fakeWorld();
    expect(await announceQuotaCrossing({ ...base, before: 79, after: 80 }, w.deps)).toEqual([80]);
    expect(await announceQuotaCrossing({ ...base, before: 80, after: 81 }, w.deps)).toEqual([]);
    expect(await announceQuotaCrossing({ ...base, before: 81, after: 82 }, w.deps)).toEqual([]);
    expect(w.pushes).toHaveLength(1);
    expect(w.pushes[0]!.tag).toBe('quota:2026-09:80');
  });

  it('حتّى لو أُعيد **نفسُ** العبور (إعادةُ محاولةٍ من الطابور) لا يُنذر مرّتين', async () => {
    const w = fakeWorld();
    await announceQuotaCrossing({ ...base, before: 79, after: 80 }, w.deps);
    const again = await announceQuotaCrossing({ ...base, before: 79, after: 80 }, w.deps);
    expect(again).toEqual([]);
    expect(w.pushes).toHaveLength(1);
  });

  it('عبورٌ مزدوج يُطلق العتبتين — بإشعارَين وتاجَين مختلفين', async () => {
    const w = fakeWorld();
    const fired = await announceQuotaCrossing({ ...base, before: 79, after: 96 }, w.deps);
    expect(fired).toEqual([80, 95]);
    expect(w.pushes.map((p) => p.tag)).toEqual(['quota:2026-09:80', 'quota:2026-09:95']);
  });

  it('دورةٌ جديدة تُصفّر — والعتبةُ تُنذر من جديد بلا مهمّةِ تنظيف', async () => {
    const w = fakeWorld();
    await announceQuotaCrossing({ ...base, before: 79, after: 80 }, w.deps);
    const next = await announceQuotaCrossing(
      { ...base, before: 79, after: 80, period: '2026-10' }, w.deps,
    );
    expect(next).toEqual([80]);
    expect(w.pushes.map((p) => p.tag)).toEqual(['quota:2026-09:80', 'quota:2026-10:80']);
  });

  it('ومستأجرٌ آخر لا يتأثّر بإنذار جاره', async () => {
    const w = fakeWorld();
    await announceQuotaCrossing({ ...base, before: 79, after: 80 }, w.deps);
    expect(await announceQuotaCrossing(
      { ...base, tenantId: 't-2', before: 79, after: 80 }, w.deps,
    )).toEqual([80]);
  });

  it('الحادثةُ عند 95٪ و100٪ وحدهما — والثمانون شأنُ العميل لا المنصّة', async () => {
    const w = fakeWorld();
    await announceQuotaCrossing({ ...base, before: 79, after: 80 }, w.deps);
    expect(w.incidents).toHaveLength(0);

    await announceQuotaCrossing({ ...base, before: 80, after: 95 }, w.deps);
    expect(w.incidents).toHaveLength(1);
    expect(w.incidents[0]!.kind).toBe('quota_threshold');
    // البصمةُ بالدورة والعتبة ⟵ حادثةٌ واحدة لكلّ عتبةٍ في كلّ شهر
    expect(w.incidents[0]!.causeKey).toBe('2026-09:95');

    await announceQuotaCrossing({ ...base, before: 95, after: 100 }, w.deps);
    expect(w.incidents).toHaveLength(2);
    expect(w.incidents[1]!.causeKey).toBe('2026-09:100');
    /* ★ `warn` لا `critical` قصداً: الحرجُ يدفع إلى مالك العميل أيضاً، فيصله
       إشعارٌ ثانٍ بعنوانٍ مكتوبٍ للمنصّة — وإغراقُ الصندوق يُطفئ التنبيهات. */
    expect(w.incidents.every((i) => i.severity === 'warn')).toBe(true);
  });

  it('نصُّ الإشعار يحمل الرقمَ وسقفَه **والعاقبة** — لا الحالةَ وحدها', async () => {
    const w = fakeWorld();
    await announceQuotaCrossing({ ...base, before: 79, after: 80, limit: 100 }, w.deps);
    const p = w.pushes[0]!;
    expect(p.body).toContain('80 من 100');
    expect(p.body).toContain(capConsequence('handoff_only', false));
    expect(p.url).toBe('/app/usage');
    expect(p.tenantId).toBe('t-1');
  });

  it('وعند السقف يتبدّل النصُّ إلى الماضي، والشدّةُ إلى حرج', async () => {
    const w = fakeWorld();
    await announceQuotaCrossing({ ...base, before: 99, after: 100 }, w.deps);
    const p = w.pushes[0]!;
    expect(p.severity).toBe('critical');
    expect(p.title).toBe('بلغتَ سقف نوافذ باقتك');
    expect(p.body).toContain(capConsequence('handoff_only', true));
    // «عند بلوغ السقف» تُقرأ تحذيراً لمن بلغه — فلا تظهر بعد البلوغ
    expect(p.body).not.toContain('عند بلوغ السقف');
  });

  it('والسياسةُ تُبدّل العاقبة: allow_bill تُفوتِر ولا توقف', async () => {
    const w = fakeWorld();
    await announceQuotaCrossing({ ...base, before: 99, after: 100, policy: 'allow_bill' }, w.deps);
    expect(w.pushes[0]!.body).toContain('فاتورة');
    expect(w.pushes[0]!.body).not.toContain('متوقّف');
  });

  it('كلُّ مالكٍ يُشعَر — والملّاك أكثرُ من واحدٍ في شركةٍ حقيقيّة', async () => {
    const w = fakeWorld();
    const many: QuotaAlertDeps = { ...w.deps, async owners() { return ['a', 'b']; } };
    await announceQuotaCrossing({ ...base, before: 79, after: 80 }, many);
    expect(w.pushes.map((p) => p.userId)).toEqual(['a', 'b']);
  });

  it('سطرُ السجلّ يحمل العتبةَ والعدّادَ والسقف — وهو ما يُقرأ على الخادم', async () => {
    const w = fakeWorld();
    await announceQuotaCrossing({ ...base, before: 79, after: 80 }, w.deps);
    expect(w.logs).toHaveLength(1);
    expect(w.logs[0]).toMatchObject({
      msg: 'عبورُ عتبةِ سقف', threshold: 80, used: 80, limit: 100, period: '2026-09',
    });
  });
});
