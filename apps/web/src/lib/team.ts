/**
 * قراءةُ حالِ الفريق — **سلّمٌ واحدٌ** يُقرأ منه الشريطُ والبطوليُّ والمرشّحات.
 *
 * ★ **لماذا خرجت من الشاشة.** الشاشةُ كانت تشتقّ نفسَ التصنيف **ثلاث مرّات**:
 *   مرّةً لتختار نصَّ الشريط الحاكم، ومرّةً لتختار الرقمَ البطوليّ، ومرّةً
 *   لتبني رقاقات الترشيح. وثلاثُ نسخٍ من شرطٍ واحد (`>= staleDays`) هي بعينها
 *   الصيغةُ التي يُصلَح فيها موضعٌ ويُنسى الآخران: فيقول الشريطُ «كلُّ حسابٍ
 *   مستعمَل» والبطوليُّ يعرض حسابَين راكدَين في نفس الرسم. وذاك لا يُمسك
 *   بالمراجعة لأنّ كلَّ فرعٍ وحده صحيح.
 *
 * ★ **ولماذا دالّةٌ خالصة.** القرارُ كلُّه حسابٌ على صفوفٍ وعتبةٍ ولحظةٍ —
 *   ولا شيءَ فيه من DOM ولا من شبكة. فهو يُختبَر بلا شجرةٍ ولا قاعدة، وعتبةُ
 *   الرُّكود تُمتحن على حدّها بالضبط بدل أن تُقرأ بالعين.
 *
 * ★ **و`now` مُمرَّرٌ لا مقروءٌ من الساعة.** دالّةٌ تقرأ `Date.now()` بنفسها
 *   لا تُختبَر على الحدّ إلّا بتجميد الزمن، وتُنتج في الرسم على الخادم قيمةً
 *   تخالف قيمةَ الرسم على العميل.
 */

/** الدورُ كما يأتي من الخادم — ولا ثالثَ لهما داخل مستأجر. */
export type TeamRole = 'tenant_owner' | 'tenant_agent';

/** أقلُّ ما يلزم للتصنيف — والشاشة تمرّر صفوفَها كما هي بحقولها الأخرى. */
export interface TeamFacts {
  isActive: boolean;
  role: TeamRole;
  lastLoginAt: string | null;
  liveSessions: number;
}

/**
 * ما يستحقّ انتباه صاحب النشاط الآن — **رتبةٌ واحدةٌ لا مجموعةُ أعلام**.
 *
 * والترتيبُ مقصودٌ ومكتوبٌ في الاختبار: **ما وقع يسبق ما يُتوقَّع.**
 *  · `rusty` — حسابٌ نشطٌ لم يُستعمل منذ العتبة: بابٌ مفتوحٌ **الآن**.
 *  · `never` — كلمةٌ مؤقّتةٌ أُنشئت ولم تُستهلك: سرٌّ سائبٌ **الآن**.
 *  · `onlyOwner` — مالكٌ نشطٌ واحدٌ ومعه غيرُه: خطرُ قفلٍ **قد لا يقع**.
 *  · `seatsFull` — مقاعدُ الباقة مشغولة: فعلٌ محجوبٌ لا خطر.
 *  · `solo` — لا فريقَ بعد: حالٌ لا عطل.
 *  · `clear` — كلُّ حسابٍ نشطٍ مستعمَلٌ حديثاً.
 */
export type TeamFocus = 'rusty' | 'never' | 'onlyOwner' | 'seatsFull' | 'solo' | 'clear';

export interface TeamRead<T extends TeamFacts> {
  active: T[];
  owners: T[];
  agents: T[];
  /** نشطٌ ولم يدخل قطّ — كلمتُه المؤقّتة لم تُستهلك. */
  never: T[];
  /** نشطٌ ومضى على آخر دخولٍ له العتبةُ أو أكثر. */
  rusty: T[];
  off: T[];
  /** مجموعُ الجلسات الحيّة على الحسابات النشطة وحدها. */
  live: number;
  /** كم حساباً نشطاً عليه جلسةٌ حيّةٌ — «على كم حساب» لا «كم جلسة». */
  liveOn: number;
  seatsFull: boolean;
  focus: TeamFocus;
}

const DAY = 86_400_000;

/**
 * كم يوماً مضى على وقتٍ ما.
 * و`floor` مقصود: «منذ 30 يوماً» تصير صحيحةً بعد اكتمال اليوم الثلاثين لا قبله.
 */
export function daysSince(iso: string, now: number): number {
  return Math.floor((now - new Date(iso).getTime()) / DAY);
}

export function readTeam<T extends TeamFacts>(
  items: T[],
  staleDays: number,
  seats: number | null,
  now: number,
): TeamRead<T> {
  const active = items.filter((m) => m.isActive);
  const off = items.filter((m) => !m.isActive);
  const owners = active.filter((m) => m.role === 'tenant_owner');
  const agents = active.filter((m) => m.role === 'tenant_agent');

  /* المعطَّلُ لا يُصنَّف راكداً ولا «لم يدخل»: هو **مقفولٌ** أصلاً، فلا بابَ
     يُنبَّه عليه. وعدُّه في الراكد يُنتج إنذاراً على ما عُولج فعلاً — وأسرعُ
     طريقٍ إلى تجاهل الشريط أن يُنذر بما لا يحتاج فعلاً. */
  const never = active.filter((m) => !m.lastLoginAt);
  const rusty = active.filter((m) => Boolean(m.lastLoginAt) && daysSince(m.lastLoginAt!, now) >= staleDays);

  const live = active.reduce((a, m) => a + m.liveSessions, 0);
  const liveOn = active.filter((m) => m.liveSessions > 0).length;
  /* المعطَّلُ لا يشغل مقعداً — وإلّا صار «عطِّل واحداً لتدعو آخر» مستحيلاً،
     وهو الخطُّ الذي يفرضه الخادم أيضاً فلا رقمان للسقف الواحد. */
  const seatsFull = seats !== null && active.length >= seats;

  const focus: TeamFocus = rusty.length
    ? 'rusty'
    : never.length
      ? 'never'
      : owners.length === 1 && items.length > 1
        ? 'onlyOwner'
        : seatsFull
          ? 'seatsFull'
          : items.length <= 1
            ? 'solo'
            : 'clear';

  return { active, owners, agents, never, rusty, off, live, liveOn, seatsFull, focus };
}
