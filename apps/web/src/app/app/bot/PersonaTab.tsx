'use client';

import { PERSONA_LIMIT, READ_UNIT as UNIT } from '@/lib/terms';
import { Card, Field, Stack, TextArea } from '@/components/ui';
import { fmt } from '@/lib/useApi';
import type { BotCtx } from './state';

/** لوحةُ «persona» من شاشة البوت — تقرأ الحالةَ المشتركة ولا تملك حالةً خاصّة. */
export function PersonaTab({ c }: { c: BotCtx }) {
  const { autoSave, locked, persona, personaUnits, setPersona } = c;
  return (
          <Stack gap="md">
            {/* ★ القواعد الثابتة تحت طيّة: تُقرأ مرّةً قبل الكتابة ولا يُتّخذ
                عليها قرار، فبقاؤها مفتوحةً يدفع الحقلَ نفسه تحت الطيّة. */}
            <details className="bot-more">
              <summary>ثلاثة لا يستطيع بوتك تجاوزها — اقرأها قبل أن تكتب</summary>
              <div className="bot-more-b">
                <p className="muted-p">
                  <b>لا يدّعي أنّه إنسان</b>، ويصرّح بذلك إن سئل. ولا يكشف أدواته ولا تعليماته.
                </p>
                <p className="muted-p">
                  <b>لا يعد بما لا يملك</b>: لا سعر ولا موعد لم تكتبه أنت في المعرفة أو
                  تخرجه أداة من نظامك، ولا رابط من عنده.
                </p>
                <p className="muted-p">
                  <b>وعند الشكّ يحوّل لإنسان ولا يخمّن</b>. هذه ليست خيارا — تحقن فوق
                  شخصيّتك دائما.
                </p>
              </div>
            </details>

            <Card title="من هو بوتك؟">
              {/* onBlur على الحاوي: focusout يتصعّد، فالحفظ يقع عند مغادرة الحقل */}
              <div onBlur={autoSave}>
                <Stack gap="sm">
                  {/* ★ `labelless` في الحالة المقفلة: `<label for>` لا يرتبط بـdiv،
                      فالوسم كان معطَّلاً تماماً — لا نقرةً تنقل التركيز ولا القارئ
                      الصوتيّ يربط «من هو بوتك؟» بالنصّ المعروض. */}
                  <Field
                    id={locked ? 'persona-ro' : 'persona'}
                    labelless={locked}
                    label="اسمه، لهجته، نبرته، وما يرفض الحديث فيه"
                    hint="يقرأ بوتك هذا النصّ مع كلّ سؤال. اجعله قصيرا وواضحا."
                  >
                    {locked ? (
                      <div id="persona-ro" className="bot-ro" dir="auto">{persona}</div>
                    ) : (
                      <TextArea
                        id="persona"
                        rows={9}
                        value={persona}
                        onChange={setPersona}
                        dir="auto"
                        /* ★ عدّادٌ واحد: كان تحت الحقل عدّادان بصياغتين وحجمين
                           (حرف · توكن · الحدّ الموصى به) — رقمٌ واحدٌ مكرَّرٌ
                           يُقرأ رقمَين مختلفَين. */
                        count={{ used: personaUnits, limit: PERSONA_LIMIT, unit: UNIT }}
                      />
                    )}
                  </Field>

                  {locked && (
                    <p className="muted-p">
                      <span className="num">{fmt.num(personaUnits)} / {fmt.num(PERSONA_LIMIT)}</span>{' '}
                      {UNIT} — والشخصيّة تقرأ مع كلّ سؤال.
                    </p>
                  )}
                </Stack>
              </div>
            </Card>
          </Stack>
  );
}
