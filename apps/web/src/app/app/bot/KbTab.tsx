'use client';

import { KnowledgeFiles, type KbSource } from '@/components/KnowledgeFiles';
import { Card, ErrorBox, Field, Note, Skeleton, Stack, Stat, Tag, TextArea } from '@/components/ui';
import { KB_MODE as MODE, READ_UNIT as UNIT } from '@/lib/terms';
import { fmt } from '@/lib/useApi';
import { Amount, HEAD_FORMS, KbScale, amountText, headingsOf } from './parts';
import type { BotCtx } from './state';

/** لوحةُ «kb» من شاشة البوت — تقرأ الحالةَ المشتركة ولا تملك حالةً خاصّة. */
export function KbTab({ c }: { c: BotCtx }) {
  const { autoSave, draftMode, fileSources, fileUnits, filesStalled, kb, kbUnits, knowledge, liveMode, lockReason, locked, pub, publishedAt, setKnowledge } = c;
  return (
          <Stack gap="lg">
            {/* الهيكلُ للتحميل الأوّل وحده — والاستقصاء يعيد الجلب كلّ أربع
                ثوانٍ ما دام ملفٌّ قيد المعالجة، فلا يومض الجدول معه. */}
            {kb.loading && !kb.data && <Skeleton rows={3} />}
            {/* ★ فشل النداء لا يُعرض خبراً ساراً: بلا فحص الخطأ هنا تُرسم
                «لا ملفّات» على نداءٍ فشل — وطمأنينةٌ كاذبة أسوأ من خطأٍ ظاهر.
                وصندوقُ خطأٍ **واحد** لنداءٍ واحد: تكراره مرّتين يُقرأ عطلَين. */}
            {kb.error && <ErrorBox message={kb.error} onRetry={kb.reload} />}

            {kb.data && !kb.error && (
              <>
                {/* ★ الرقمُ البطوليُّ الواحد في هذه الشاشة: حجمُ نصّ معرفتك —
                    وهو ما يقرّر وضعَ القراءة عند النشر (‏`estimateTokens` على
                    حقل المسوّدة، لا على مجموع المصادر). ومعه سياقُه ملاصقاً:
                    تركيبُه، وسلّمُ عتبتَيه، وما يعنيه موقعُه عليه. */}
                <div className="bot-hero">
                  <Stat
                    hero
                    value={fmt.num(kbUnits)}
                    unit={UNIT}
                    label="في نصّ معرفتك — وهو ما يقرّر كيف يقرأ بوتك معرفته"
                  />
                  <KbScale units={kbUnits} />
                  <p className="muted-p">
                    <b>{MODE[draftMode]!.label}.</b> {MODE[draftMode]!.how}{' '}
                    والعلامتان على السلّم هما العتبتان التي يتحوّل عندهما الوضع.
                  </p>
                </div>

                <div className="sect">
                  <div className="sect-h">
                    <h2>كيف يقرأ بوتك معرفته</h2>
                    <span className="sect-c">المسوّدة مقابل ما يخدم زبائنك الآن</span>
                  </div>
                  <div className="rows bot-rows">
                    <div className="row-m">
                      <span className="rm-k">
                        وضعُ مسوّدتك
                        <span className="rm-note">ما سيصير عليه بوتك عند أوّل نشر</span>
                      </span>
                      <span className="rm-c">
                        <Tag tone="cool" label={MODE[draftMode]!.label} />
                      </span>
                    </div>
                    <div className="row-m">
                      <span className="rm-k">
                        الوضع الذي يخدم زبائنك الآن
                        <span className="rm-note">
                          {pub ? 'من النسخة المنشورة، لا من المسوّدة' : 'لا نسخةَ منشورةَ بعد'}
                        </span>
                      </span>
                      <span className="rm-c">
                        {liveMode
                          ? <Tag line label={MODE[liveMode]!.label} />
                          : <Tag line label="لم يُنشر بعد" />}
                        {liveMode && liveMode === draftMode && <Tag line label="لا فرق" />}
                      </span>
                    </div>
                    <div className="row-m">
                      <span className="rm-k">
                        ملفّاتك
                        <span className="rm-note">
                          {fileSources.length === 0
                            ? 'لا ملفّات — نصُّك وحده معرفتُه'
                            : liveMode === 'full'
                              ? `في وضع «${MODE.full.label}» لا تدخل ردودَه — يُرسَل نصُّك وحده`
                              : liveMode
                                ? 'منها يستخرج بوتك ما يرتبط بالسؤال'
                                : 'تدخل معرفته عند أوّل نشرٍ يتجاوز العتبة الأولى'}
                        </span>
                      </span>
                      <span className="rm-v">
                        <span className="num">{fmt.num(fileUnits)}</span> <small>{UNIT}</small>
                      </span>
                      <span className="rm-c">
                        <Tag
                          line
                          label={fileSources.length === 0
                            ? 'لا ملفّات'
                            : amountText(fileSources.length, ['ملفٌّ واحد', 'ملفّان', 'ملفّات', 'ملفّاً'])}
                        />
                        {liveMode !== 'full' && kb.data && kb.data.chunks > 0 && (
                          <Tag line label={`${fmt.num(kb.data.chunks)} مقطعاً مُضمَّناً`} />
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ★ عاقبةٌ لا حالة: في وضع «يقرأ نصَّك كاملاً» **لا تُقرأ
                    الملفّات إطلاقاً** — العامل لا يُضمِّنها أصلاً، وعاملُ الردّ
                    يُرسل النصّ وحده. وعميلٌ رفع كتيّب خدماتٍ وظنّ بوته يقرؤه
                    يكتشف ذلك من ردٍّ خاطئٍ أمام زبون. */}
                {liveMode === 'full' && fileSources.length > 0 && (
                  <Note tone="warn">
                    <b>ملفّاتك لا تدخل ردود بوتك في الوضع الحاليّ.</b> دون العتبة الأولى يُرسَل
                    نصُّ معرفتك كاملاً ويكفيه، فلا يستخرج من الملفّات. انقل ما يجب أن يعرفه
                    منها إلى نصّ المعرفة أدناه — أو أبقِها حتّى يتجاوز نصُّك العتبة.
                  </Note>
                )}

                {/* ★ والوجه الآخر للعملة نفسها، وهو الأخطر لأنّه معكوسُ التوقّع:
                    فوق العتبة تُبنى معرفةُ النسخة من **الملفّات الجاهزة**، ولا
                    يُقطَّع نصُّ الحقل ما دام لها نصٌّ مستخرَج. فمن كتب سعراً في
                    الحقل ورفع كتيّباً يظنّ الاثنين يعملان — وواحدٌ منهما فقط. */}
                {liveMode !== null && liveMode !== 'full'
                  && fileSources.some((s) => s.status === 'ready' && s.charCount > 0) && (
                  <Note tone="warn">
                    <b>في الوضع الحاليّ يجيب بوتك من ملفّاتك، لا من نصّ المعرفة.</b> فوق العتبة
                    الأولى تُبنى معرفتُه من ملفّاتك الجاهزة وحدها، ويبقى النصّ أدناه مسوّدةً
                    لا يقرأها. فضَع ما يجب أن يعرفه في ملفّاتك — أو احذفها ليعود نصُّك هو
                    المصدر.
                  </Note>
                )}

                {/* ملفٌّ جاهزٌ رُفع بعد آخر نشر: مقاطعُ المعرفة تُبنى لكلّ نسخةٍ
                    عند نشرها، فما رُفع بعدها ليس فيها. */}
                {draftMode !== 'full' && publishedAt
                  && fileSources.some((s) => s.status === 'ready' && s.createdAt > publishedAt) && (
                  <Note tone="warn">
                    <b>رفعتَ ملفّاً بعد آخر نشر.</b> معرفةُ كلّ نسخةٍ تُبنى لحظةَ نشرها،
                    فلا يدخل هذا الملفّ ردودَ بوتك قبل أن تنشر من جديد.
                  </Note>
                )}
              </>
            )}

            <Card title="نصّ المعرفة">
              <div onBlur={autoSave}>
                <Stack gap="sm">
                  <Field
                    id={locked ? 'kb-text-ro' : 'kb-text'}
                    labelless={locked}
                    label="ماذا يعرف بوتك عن نشاطك؟"
                    hint="ابدأ كلّ قسمٍ بسطر عنوانٍ ينتهي بنقطتين — فالبوت يستخرج بالأقسام، والعنوان يرفع دقّة ما يجده."
                  >
                    {locked ? (
                      <div id="kb-text-ro" className="bot-ro" dir="auto">{knowledge}</div>
                    ) : (
                      <TextArea id="kb-text" rows={14} value={knowledge} onChange={setKnowledge} dir="auto" />
                    )}
                  </Field>

                  {/* لا تكرارَ لرقم الرقم البطوليّ أعلاه: هنا ما لا يقوله هو —
                      عددُ الأقسام المعنونة، وهو ما يرفع دقّة الاسترجاع. */}
                  <p className="muted-p">
                    <Amount n={headingsOf(knowledge)} forms={HEAD_FORMS} />
                    {headingsOf(knowledge) === 0
                      ? ' — أضِف عناوين («الأسعار:» · «ساعات العمل:») ترفع دقّة بوتك كثيراً.'
                      : ' — وكلّ قسمٍ بعنوانه يُسترجَع وحدةً واحدة.'}
                  </p>
                </Stack>
              </div>
            </Card>

            {/* لا قائمةَ ملفّاتٍ على نداءٍ فشل: صندوق الخطأ أعلاه يحمل «أعِد
                المحاولة»، وقائمةٌ فارغةٌ تحته تقول «لا ملفّات لديك» وهي كاذبة. */}
            {!kb.error && (
              /* ★ **لا `.sect` حول هذا الجزء** — والسبب بنيويّ لا ذوقيّ:
                  `.sect` حاويةٌ مسمّاة (`container-type: inline-size`)، ومواصفةُ
                  الاحتواء تنصّ على أنّ احتواء التخطيط يجعل العنصر **كتلةً حاويةً
                  لكلّ `position: fixed` بداخله**. وهذا الجزء يفتح نافذة معاينةٍ
                  وورقةَ حذفٍ كلتاهما `fixed`: لو سرى ذلك لحُبستا في صندوق القسم
                  بدل أن تغطّيا الشاشة.
                  وقِسته في كروم 153: لا يُطبِّقها على `container-type` (يُطبّقها
                  على `contain: layout` و`paint` صراحةً) — فالعطل لا يظهر هنا
                  اليوم، وقد يظهر في متصفّحٍ آخر أو إصدارٍ لاحق. وثمنُ تجنّبه
                  صفر: الرأسُ وحده يُؤخذ من القسم، والمحتوى في عمودٍ عاديّ. */
              <div className="stack md" id="kb-files">
                <div className="sect-h">
                  <h2>ملفّاتك</h2>
                  <span className="sect-c">نستخرج نصّها وتعاينه قبل أن تنشر</span>
                </div>
                <KnowledgeFiles
                  sources={(kb.data?.sources ?? []) as KbSource[]}
                  loading={kb.loading && !kb.data}
                  readOnly={locked}
                  lockReason={lockReason ?? undefined}
                  stalled={filesStalled}
                  onChanged={() => void kb.reload()}
                />
              </div>
            )}
          </Stack>
  );
}
