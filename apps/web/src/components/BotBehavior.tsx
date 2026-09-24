'use client';

import { useMemo, useState } from 'react';
import { DAY_KEYS, DAY_AR, type DayKey } from '@aibot/shared';
import { patch, ApiError } from '@/lib/api';
import { fmt } from '@/lib/useApi';
import {
  Button, Field, Input, Note, Stack, Tag, TextArea, Toggle,
} from '@/components/ui';

/**
 * ★ **سلوكُ البوت — أربعةُ حقولٍ يقرؤها العاملُ ولم تكن تُكتب من أيّ مكان.**
 *
 *   كان التبويبُ يشرحها بعناية ثمّ يقول «لا تُعدَّل من هنا»، وهي لم تكن
 *   تُعدَّل من أيّ مكانٍ إطلاقاً: لا مسارَ للمالك ولا للمنصّة ولا خطوةَ في
 *   معالج التهيئة. فمطعمٌ يغلق منتصف الليل يظلّ بوته يأخذ حجوزاتٍ الثالثةَ
 *   فجراً ويعد بردّ موظّفٍ لا يأتي — والمالكُ يقرأ أنّ الرسالة «لا تُستعمل»
 *   ولا يجد كيف يجعلها تُستعمل، و«اطلبها من فريقنا» تقود إلى فريقٍ لا يملك
 *   أداة.
 *
 * ★ **وهي منفصلةٌ عن المسوّدة عمداً.** لا تُنشر ولا يُتراجَع عنها بنشر نسخةٍ
 *   قديمة: إعدادُ تشغيلٍ يسري لحظةَ حفظه. وخلطُها بالمسوّدة كان سيعني أنّ
 *   تراجعاً إلى نسخة الشهر الماضي يُعيد ساعاتِ دوامٍ قديمة.
 */

export interface BehaviorConfig {
  pauseMinutes: number;
  failMessage: string | null;
  outsideHoursMessage: string | null;
  businessHours?: { tz?: string; days?: Record<string, unknown> } | null;
}

type Ranges = Record<DayKey, Array<[string, string]>>;

const EMPTY: Ranges = { sat: [], sun: [], mon: [], tue: [], wed: [], thu: [], fri: [] };

function toRanges(bh: BehaviorConfig['businessHours']): Ranges {
  const out: Ranges = { ...EMPTY };
  const days = (bh?.days ?? {}) as Record<string, unknown>;
  for (const d of DAY_KEYS) {
    const v = days[d];
    out[d] = Array.isArray(v)
      ? (v as unknown[]).filter((r): r is [string, string] =>
        Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string')
      : [];
  }
  return out;
}

/** اليومُ الافتراضيُّ حين يُفتَح: دوامٌ نهاريٌّ يعدّله المالك لا فراغٌ يملؤه. */
const DEFAULT_RANGE: [string, string] = ['09:00', '22:00'];

export function BotBehavior({ cfg, readOnly, onSaved, onToast }: {
  cfg: BehaviorConfig;
  readOnly: boolean;
  onSaved: () => void;
  onToast: (m: string) => void;
}) {
  const [pause, setPause] = useState(String(cfg.pauseMinutes));
  const [fail, setFail] = useState(cfg.failMessage ?? '');
  const [outside, setOutside] = useState(cfg.outsideHoursMessage ?? '');
  const [hoursOn, setHoursOn] = useState(Boolean(cfg.businessHours?.days));
  const [ranges, setRanges] = useState<Ranges>(() => toRanges(cfg.businessHours));
  const [busy, setBusy] = useState(false);

  const tz = cfg.businessHours?.tz ?? 'Asia/Amman';

  /** الآن بتوقيت النشاط — فالمالكُ يقرأ أثرَ ما ضبطه لا يحسبه. */
  const nowLabel = useMemo(() => new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
    timeZone: tz, weekday: 'long', hour: 'numeric', minute: '2-digit',
  }).format(new Date()), [tz]);

  const pauseNum = Number(pause);
  const pauseBad = !Number.isInteger(pauseNum) || pauseNum < 1 || pauseNum > 1440;

  /* ★ نطاقٌ يبدأ وينتهي في اللحظة نفسها يُرفَض قبل الإرسال — والخادمُ يرفضه
     أيضاً. وسببُه أنّ العامل يعامل `to <= from` نطاقاً **عابراً لمنتصف
     الليل**، فخطأٌ مطبعيٌّ يفتح الدوام ستّ عشرةَ ساعةً بدل ثمانٍ بلا علامة. */
  const badRange = DAY_KEYS.some((d) => ranges[d].some(([f, t]) => f === t));

  function setRange(day: DayKey, i: number, which: 0 | 1, v: string) {
    setRanges((r) => {
      const next = { ...r, [day]: r[day].map((x) => [...x] as [string, string]) };
      next[day][i]![which] = v;
      return next;
    });
  }

  function addRange(day: DayKey) {
    setRanges((r) => ({ ...r, [day]: [...r[day], [...DEFAULT_RANGE] as [string, string]] }));
  }

  function dropRange(day: DayKey, i: number) {
    setRanges((r) => ({ ...r, [day]: r[day].filter((_, j) => j !== i) }));
  }

  async function save() {
    if (pauseBad || badRange || busy) return;
    setBusy(true);
    try {
      await patch('/bot/config', {
        pauseMinutes: pauseNum,
        failMessage: fail.trim() || null,
        outsideHoursMessage: outside.trim() || null,
        businessHours: hoursOn
          ? { tz, days: Object.fromEntries(DAY_KEYS.map((d) => [d, ranges[d]])) }
          : null,
      });
      onToast('حُفظ السلوك — ويسري من الآن على كلّ محادثة');
      onSaved();
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : 'تعذّر الحفظ');
    } finally {
      setBusy(false);
    }
  }

  const openDays = DAY_KEYS.filter((d) => ranges[d].length).length;

  return (
    <Stack gap="lg">
      <div className="sect">
        <div className="sect-h">
          <h2>بعد أن يتدخّل موظّفك</h2>
        </div>
        <Field
          id="bh-pause" label="يسكت بوتك عن تلك المحادثة (بالدقائق)"
          hint="أقصرُ من اللازم يقطع على موظّفك كلامه، وأطولُ منه يترك الزبون بلا ردّ. ثمّ يُستأنف من نفسه."
          error={pauseBad ? 'رقمٌ صحيحٌ بين ١ و١٤٤٠ دقيقة' : undefined}
        >
          <Input id="bh-pause" type="number" value={pause} onChange={setPause} disabled={readOnly} />
        </Field>
      </div>

      <div className="sect">
        <div className="sect-h">
          <h2>ما يقوله حين يعجز</h2>
          <span className="sect-c">نصٌّ يقرؤه زبونك بحرفه</span>
        </div>
        <TextArea
          id="bh-fail" rows={3} value={fail} onChange={setFail} dir="auto" count={{ used: fail.length, limit: 300, unit: 'حرف' }}
          placeholder="اتركه فارغاً ليعتذر برسالةٍ افتراضيّةٍ مهذّبة"
        />
        <p className="muted-p">
          وبعدها تُحوَّل المحادثة إلى موظّف وتظهر في الإنبوكس بوسم «تحتاج تدخّلك».
        </p>
      </div>

      <div className="sect">
        <div className="sect-h">
          <h2>ساعات دوامك</h2>
          <span className="sect-c">بتوقيت {tz} · الآن {nowLabel}</span>
        </div>

        <Toggle
          id="bh-on" checked={hoursOn} disabled={readOnly}
          onChange={(v) => {
            setHoursOn(v);
            /* أوّلُ إشعالٍ يملأ الأيّام بدوامٍ نهاريٍّ يُعدَّل — لا يترك
               المالك أمام سبعة أيّامٍ فارغة تعني «مغلقٌ دائماً». */
            if (v && !DAY_KEYS.some((d) => ranges[d].length)) {
              setRanges(Object.fromEntries(
                DAY_KEYS.map((d) => [d, [[...DEFAULT_RANGE] as [string, string]]]),
              ) as Ranges);
            }
          }}
          label="بوتي يردّ في ساعات دوامي فقط"
        />

        {!hoursOn ? (
          <p className="muted-p">
            بوتك يردّ في كلّ وقت — ورسالةُ خارج الدوام أدناه لا تُستعمل.
          </p>
        ) : (
          <>
            <div className="bh-days">
              {DAY_KEYS.map((d) => (
                <div className="bh-day" key={d}>
                  <span className="bh-dn">{DAY_AR[d]}</span>
                  <div className="bh-rr">
                    {ranges[d].length === 0 && <span className="bh-off">مغلق</span>}
                    {ranges[d].map((r, i) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <span className="bh-r" key={i}>
                        <input
                          type="time" className="input bh-t" value={r[0]} disabled={readOnly}
                          aria-label={`${DAY_AR[d]} — من`}
                          onChange={(e) => setRange(d, i, 0, e.target.value)}
                        />
                        <span aria-hidden="true">–</span>
                        <input
                          type="time" className="input bh-t" value={r[1]} disabled={readOnly}
                          aria-label={`${DAY_AR[d]} — إلى`}
                          onChange={(e) => setRange(d, i, 1, e.target.value)}
                        />
                        {!readOnly && (
                          <button
                            type="button" className="bh-x" onClick={() => dropRange(d, i)}
                            aria-label={`احذف فترة ${DAY_AR[d]}`}
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    ))}
                    {!readOnly && ranges[d].length < 4 && (
                      <Button size="sm" onClick={() => addRange(d)}>+ فترة</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {badRange && (
              <Note tone="warn">
                فترةٌ تبدأ وتنتهي في اللحظة نفسها. احذفها أو صحّحها — وإلّا قُرئت
                «مفتوحٌ أربعاً وعشرين ساعة».
              </Note>
            )}

            <p className="muted-p">
              <Tag line label={`${fmt.num(openDays)} من ٧ أيّام مفتوحة`} />{' '}
              {/* ★ ولا مثالَ بصيغةٍ بعينها: حقلُ الوقت يعرض ١٢ ساعةً أو ٢٤
                  بحسب لغة الجهاز، فمثالٌ بـ«٢٠:٠٠» يناقض ما تراه عينُ من
                  يقرؤه. والقاعدةُ تُقال بالمعنى — والقيمةُ المحفوظة واحدةٌ
                  في الحالين. */}
              وإن كان دوامك يمتدّ بعد منتصف الليل فاجعل نهايةَ الفترة أبكرَ من
              بدايتها — تُقرأ امتداداً لليوم نفسه.
            </p>
          </>
        )}
      </div>

      <div className="sect">
        <div className="sect-h">
          <h2>وما يقوله خارج دوامك</h2>
        </div>
        <TextArea
          id="bh-out" rows={3} value={outside} onChange={setOutside} dir="auto" count={{ used: outside.length, limit: 300, unit: 'حرف' }}
          placeholder="اتركه فارغاً ليصمت خارج الدوام وتنتظر الرسائل في الإنبوكس"
        />
      </div>

      {!readOnly && (
        <Button
          variant="primary" busy={busy} onClick={() => void save()}
          disabled={pauseBad || badRange}
          reason={pauseBad ? 'صحّح مدّة السكوت' : badRange ? 'صحّح الفترة المعطوبة' : undefined}
        >
          احفظ السلوك
        </Button>
      )}
    </Stack>
  );
}
