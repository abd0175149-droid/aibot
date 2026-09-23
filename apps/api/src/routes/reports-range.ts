/**
 * مدى التقرير — حسابٌ خالصٌ بلا تبعيّة، ولذلك يُختبَر بلا قاعدةٍ ولا خادم.
 *
 * ★ **اليوم تقويمٌ لا لحظة.** التقريرُ يُقارن مدًى بمدًى سابقٍ بنفس الطول،
 *   فحدودُه يجب أن تكون حدودَ أيّامٍ عند المستأجر لا «الآن ناقص ثلاثين يوماً».
 *   وإلّا صار «أمس» نصفَه في دلوٍ ونصفَه في آخر، وصارت الأعمدةُ السبعة في
 *   «أيّ الأيّام أكثر انشغالاً» مزيجاً من يومَين — وذاك خطأٌ يُقرأ صحيحاً.
 *
 * ★ **والحسابُ على نصِّ التاريخ لا على `Date` محلّيّ.** المرساةُ منتصفُ ليل
 *   UTC لسلسلةٍ `YYYY-MM-DD`، والزيادةُ `setUTCDate` — فلا تلمسُنا ساعةٌ
 *   صيفيّةٌ ولا منطقةُ الخادم. والتحويل إلى لحظةٍ يجري في Postgres وحده
 *   (`::date AT TIME ZONE`)، وهو الذي يملك جدولَ المناطق الحقيقيّ لا نحن.
 *
 * ★ **و`hi` مستثنًى**: `created_at < hi` لا `<= last`. فلا نكتب «آخر ثانيةٍ
 *   من اليوم» ولا نخسر رسالةً وصلت في 23:59:59.7 — وهي الرسالةُ التي تظهر
 *   في الإنبوكس ولا تظهر في التقرير فتُقرأ عطلاً في العدّاد.
 */

/** توقيتُ المستأجر — نفسُ التوقيت الذي تُقطَع به دورةُ الفوترة في `reports.ts`. */
export const REPORT_TZ = 'Asia/Amman';

/** المدَياتُ الجاهزة. والمخصَّصُ يأتي بـ`from`/`to`. */
export const PRESET_DAYS = [7, 30, 90] as const;
export type PresetDays = (typeof PRESET_DAYS)[number];

/**
 * سقفُ المدى المخصَّص. ليس ذوقاً: كلّ استعلامٍ هنا يمسح `messages` بمدى،
 * ومدًى بلا سقفٍ يجعل نقطةً واحدةً قادرةً على شلّ القاعدة بمعامل واحد.
 */
export const MAX_DAYS = 366;

/** أدنى عددِ نوافذَ مُفوترةٍ يُقرأ عليه اتّجاه — تحته يُقال ذلك صراحةً ولا يُرسم خطّ. */
export const MIN_FOR_TREND = 10;

export interface Range {
  /** أوّل يومٍ في المدى — مشمول */
  lo: string;
  /** أوّل يومٍ بعد المدى — مستثنى */
  hi: string;
  /** آخرُ يومٍ مشمول — للعرض وحده */
  last: string;
  days: number;
  /** بدايةُ المدى السابق المُلاصق بنفس الطول: [prevLo, lo) */
  prevLo: string;
  /** اليومُ الجاري داخل المدى — فآخرُ نقطةٍ **ناقصةٌ لا مقيسة**، وتُقطَّع في الرسم */
  openEnd: boolean;
  /** مدًى جاهزٌ أو مخصَّص — تعرفه الواجهة لتُضيء الرقاقة الصحيحة */
  preset: PresetDays | null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** اليومُ الجاري عند المستأجر — `en-CA` تُخرج `YYYY-MM-DD` بلا تركيب. */
export function dayIn(tz: string = REPORT_TZ, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

/** يومٌ صالحٌ **فعلاً** — و«2026-02-30» يطابق الشكل ولا يوجد. */
export function isDay(s: string): boolean {
  if (!DAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** عددُ الأيّام من `a` إلى `b` — موجبٌ إن كان `b` بعده. */
export function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

export type RangeResult =
  | { ok: true; range: Range }
  | { ok: false; message: string };

/**
 * يقرأ المدى من معاملات الطلب.
 *
 * ★ **لا يرمي**: النتيجةُ مُميَّزةٌ بالنوع، والرسالةُ عربيّةٌ صالحةٌ لعرضها كما
 *   هي — فالمسارُ يحوّلها إلى `AppError` وهذا الملفُّ يبقى بلا تبعيّة فيُختبَر.
 *
 * ★ **و`to` يُقصَّ إلى اليوم ولا يُرفَض.** مستخدمٌ يختار «إلى آخر الشهر» ليس
 *   مخطئاً — هو يقصد «إلى الآن». ورفضُه يعلّمه أنّ المنتج نكِد؛ والقصُّ
 *   يعطيه ما أراد، ويُقال له في الشاشة إنّ آخرَ يومٍ لم ينتهِ.
 */
export function parseRange(
  q: { days?: string; from?: string; to?: string },
  today: string = dayIn(),
): RangeResult {
  const from = (q.from ?? '').trim();
  const to = (q.to ?? '').trim();

  if (from || to) {
    if (!from || !to) {
      return { ok: false, message: 'المدى المخصَّص يحتاج تاريخَ بدايةٍ وتاريخَ نهاية.' };
    }
    if (!isDay(from) || !isDay(to)) {
      return { ok: false, message: 'التاريخ يُكتب سنةً-شهراً-يوماً (2026-09-01).' };
    }
    if (daysBetween(today, from) > 0) {
      return { ok: false, message: 'لا تقريرَ عن مدًى لم يأتِ بعد — ابدأ من اليوم أو قبله.' };
    }
    if (daysBetween(from, to) < 0) {
      return { ok: false, message: 'تاريخُ البداية بعد تاريخ النهاية.' };
    }
    /* القصُّ لا الرفض: «إلى آخر الشهر» تعني «إلى الآن». */
    const last = daysBetween(today, to) > 0 ? today : to;
    const days = daysBetween(from, last) + 1;
    if (days > MAX_DAYS) {
      return { ok: false, message: `أطولُ مدًى ${MAX_DAYS} يوماً — وما قبله يُقرأ سنةً سنة.` };
    }
    return {
      ok: true,
      range: {
        lo: from,
        hi: shiftDay(last, 1),
        last,
        days,
        prevLo: shiftDay(from, -days),
        openEnd: last === today,
        preset: null,
      },
    };
  }

  const raw = (q.days ?? '30').trim();
  const n = Number(raw);
  const preset = PRESET_DAYS.find((d) => d === n);
  if (!preset) {
    return { ok: false, message: `المدى ${PRESET_DAYS.join(' أو ')} يوماً، أو مدًى مخصَّصٌ بتاريخَين.` };
  }
  const hi = shiftDay(today, 1);
  const lo = shiftDay(hi, -preset);
  return {
    ok: true,
    range: { lo, hi, last: today, days: preset, prevLo: shiftDay(lo, -preset), openEnd: true, preset },
  };
}

/**
 * يملأ الأيّام الغائبة بأصفار.
 *
 * ★ يومٌ بلا رسالةٍ **يومٌ بصفر** لا يومٌ غائب. وبلا هذا الملء يوصل الرسمُ
 *   نقطتَي يومَين متباعدَين بخطٍّ مستقيم، فيُقرأ هبوطٌ تدريجيٌّ لم يحدث —
 *   والحقيقةُ هبوطٌ إلى صفرٍ وعودة. والرسمُ الذي يوحي بما لم يقع أسوأ من
 *   فراغٍ يقول «لا بيانات».
 */
export function fillDays<T>(
  lo: string,
  hi: string,
  rows: Array<{ day: string } & T>,
  zero: T,
): Array<{ day: string } & T> {
  const at = new Map(rows.map((r) => [r.day, r]));
  const out: Array<{ day: string } & T> = [];
  for (let d = lo; daysBetween(d, hi) > 0; d = shiftDay(d, 1)) {
    out.push(at.get(d) ?? ({ day: d, ...zero } as { day: string } & T));
  }
  return out;
}
