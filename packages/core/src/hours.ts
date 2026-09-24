/**
 * ★ **ساعاتُ الدوام — جوابٌ صادقٌ بدل «مفتوحٌ دائماً».**
 *
 *   أداةُ `check_business_hours` كانت تُعيد `{ open: true }` **ثابتةً** في
 *   العامل وفي الساحة معاً، بينما `bot_configs.business_hours` قائمٌ في
 *   المخطّط لا يقرؤه أحد. وإعلانُ الأداة يَعِد باثنتين: «هل النشاط مفتوحٌ
 *   الآن، ومتى يفتح إن كان مغلقاً» — فلا تُعطي الأولى صادقةً ولا الثانية
 *   إطلاقاً. وملاحظتُها «استعمل هذه النتيجة ولا تخترع ساعاتٍ أخرى» تمنع
 *   النموذجَ من الرجوع إلى ساعاتٍ **صحيحةٍ** قد تكون في نصّ المعرفة.
 *
 *   والساحةُ هي الموضعُ الذي يثبت فيه الخطأ: لا بوّابةَ دوامٍ فيها، فالمالك
 *   الذي يجرّب بوته الثالثةَ فجراً في يومِ عطلةٍ يُقال له «مفتوح».
 *
 * ★ **ولماذا يُعاد نصٌّ عربيٌّ جاهز (`say`) لا أرقامٌ وحدها.**
 *
 *   «الآن» يصل النموذجَ في طبقة السياق بصيغة `Intl` العربيّة: «الأحد، ٢٠
 *   أيلول في ١١:٣٠ م» — أرقامٌ هنديّةٌ وساعةٌ باثنتي عشرة. ونطاقاتُ الدوام
 *   مخزَّنةٌ «12:00–00:00» بأربعٍ وعشرين ورقمٍ لاتينيّ. ومطالبةُ النموذج أن
 *   يقارن بينهما طريقٌ **جديدةٌ** إلى نفس الجواب الخاطئ الذي وُجدت الأداةُ
 *   لمنعه. فالحسابُ يجري هنا كاملاً، ويُسلَّم للنموذج جملةٌ يقولها كما هي.
 */

/** المفاتيحُ الثلاثيّة كما يشتقّها `Intl` بـ`weekday: 'short'` ثمّ خفضِ الحالة. */
const ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const AR: Record<string, string> = {
  sat: 'السبت', sun: 'الأحد', mon: 'الإثنين', tue: 'الثلاثاء',
  wed: 'الأربعاء', thu: 'الخميس', fri: 'الجمعة',
};

export interface BusinessHours {
  tz?: string;
  days?: Record<string, Array<[string, string]>>;
}

export interface HoursSnapshot {
  /** هل النشاط مفتوحٌ الآن؟ وبلا ساعاتٍ مضبوطة: مفتوحٌ دائماً. */
  open: boolean;
  /** هل ضبط المالكُ ساعاتٍ أصلاً؟ يُفرّق «مفتوحٌ لأنّه كذلك» من «لا نعرف». */
  configured: boolean;
  /** فتراتُ اليوم كما تُقرأ: «09:00–22:00». */
  today: string[];
  /** أقربُ فتحٍ قادم — أو `null` إن كان مفتوحاً الآن أو بلا ساعات. */
  opensNext: { day: string; at: string } | null;
  /** جملةٌ عربيّةٌ جاهزةٌ يقولها النموذج كما هي — بلا حسابِ ساعات. */
  say: string;
}

/** «الآن» في منطقة النشاط: اليومُ الثلاثيُّ والساعةُ بأربعٍ وعشرين. */
function nowParts(tz: string, at: Date): { day: string; hhmm: string; idx: number } {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const day = p.find((x) => x.type === 'weekday')!.value.toLowerCase();
  const hh = p.find((x) => x.type === 'hour')!.value;
  const mm = p.find((x) => x.type === 'minute')!.value;
  return { day, hhmm: `${hh}:${mm}`, idx: ORDER.indexOf(day as typeof ORDER[number]) };
}

/** نطاقٌ يعبر منتصف الليل: `to <= from` يعني «حتّى الغد». */
function inRange(cur: string, from: string, to: string): boolean {
  return to <= from ? cur >= from || cur < to : cur >= from && cur < to;
}

/**
 * ★ **الفترةُ العابرةُ لمنتصف الليل تخصّ يومَ بدايتها — لا يومَ نهايتها.**
 *
 *   كان الفحصُ على فترات **اليوم الحاليّ** وحدها. فمطعمٌ دوامُه السبت
 *   «20:00–02:00» يُقال عنه **مغلق** الساعةَ الواحدة ليلاً — وهي من أزحم
 *   ساعاته — لأنّ الوقت حينها «الأحد ٠١:٠٠» والأحدُ لا فترةَ له. والمالكُ
 *   كتب دوامَه صحيحاً بالشكل الذي تطلبه الشاشةُ منه بالضبط.
 *   فتُفحص فتراتُ الأمس أيضاً، ومنها ما عبر وحده.
 */
function openRanges(bh: BusinessHours, day: string, hhmm: string): Array<[string, string]> {
  const today = (bh.days?.[day] ?? []).filter(([f, t]) => inRange(hhmm, f, t));
  const i = ORDER.indexOf(day as typeof ORDER[number]);
  const prevKey = i >= 0 ? ORDER[(i + 6) % 7]! : null;
  const carried = prevKey
    ? (bh.days?.[prevKey] ?? []).filter(([f, t]) => t <= f && hhmm < t)
    : [];
  return [...today, ...carried];
}

export function withinBusinessHours(bh: BusinessHours | null, at = new Date()): boolean {
  if (!bh?.days) return true;
  const { day, hhmm } = nowParts(bh.tz ?? 'Asia/Amman', at);
  return openRanges(bh, day, hhmm).length > 0;
}

/**
 * الحالةُ الكاملة — وعليها تُبنى إجابةُ الأداة.
 *
 * ⚠️ ويبدأ البحثُ عن الفتح القادم من **اليوم نفسه**: نشاطٌ يفتح يوماً واحداً
 *    في الأسبوع كان يُعطى `null` إلى الأبد لو بدأ الدَّوَران من الغد، فيبقى
 *    نصفُ الإعلان («ومتى يفتح») بلا جواب — وهو نصفُ العطل الذي وُجدت هذه
 *    الدالّة لإغلاقه.
 */
export function hoursSnapshot(bh: BusinessHours | null, at = new Date()): HoursSnapshot {
  if (!bh?.days || !Object.values(bh.days).some((r) => r?.length)) {
    return {
      open: true,
      configured: false,
      today: [],
      opensNext: null,
      say: 'لم يضبط صاحبُ النشاط ساعاتِ دوامٍ في النظام، فلا أستطيع تأكيدَ وقت الفتح من هنا.',
    };
  }

  const tz = bh.tz ?? 'Asia/Amman';
  const { day, hhmm, idx } = nowParts(tz, at);
  const today = (bh.days[day] ?? []).map(([f, t]) => `${f}–${t}`);
  const nowOpen = openRanges(bh, day, hhmm);

  if (nowOpen.length) {
    const cur = nowOpen[0]!;
    return {
      open: true,
      configured: true,
      today,
      opensNext: null,
      say: `نعم، مفتوحون الآن. دوامُ اليوم ${cur[0]} إلى ${cur[1]}.`,
    };
  }

  /* الدَّوَرانُ يبدأ من اليوم نفسِه (`d = 0`) وفيه الفتراتُ التي لم تبدأ بعد،
     ويمتدّ إلى ثمانيةٍ ليعود إلى اليوم نفسِه الأسبوعَ القادم: نشاطٌ يفتح يوماً
     واحداً كان يُعطى «لا فتحَ قادم» إلى الأبد. */
  let opensNext: HoursSnapshot['opensNext'] = null;
  let isToday = false;
  for (let d = 0; d < 8 && !opensNext && idx >= 0; d += 1) {
    const key = ORDER[(idx + d) % 7]!;
    const ranges = [...(bh.days[key] ?? [])].sort((a, b) => a[0].localeCompare(b[0]));
    const hit = d === 0 ? ranges.find(([f]) => f > hhmm) : ranges[0];
    if (hit) {
      opensNext = { day: AR[key] ?? key, at: hit[0] };
      /* ★ «اليوم» تُقال حين `d === 0` وحدها. وكانت تُقاس بمطابقة **اسم**
         اليوم، فيصير فتحُ الأحد القادم «نفتح اليوم ٩:٠٠» مساءَ الأحد. */
      isToday = d === 0;
    }
  }

  const when = opensNext
    ? (isToday ? `اليوم ${opensNext.at}` : `${opensNext.day} ${opensNext.at}`)
    : null;

  return {
    open: false,
    configured: true,
    today,
    opensNext,
    say: when
      ? `مغلقون الآن. نفتح ${when}.`
      : 'مغلقون الآن، ولا فتحَ مُسجَّلٌ في الأيّام القادمة — الأفضل أن أحوّلك لموظّف.',
  };
}
