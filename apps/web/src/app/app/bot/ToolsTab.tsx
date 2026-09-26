'use client';

import { ToolBuilder } from '@/components/ToolBuilder';
import { Button, Card, DataView, Grid, Note, Pill, Stack, Tag } from '@/components/ui';
import { fmt } from '@/lib/useApi';
import { Amount, TOOL_FORMS, Tool, toDraft } from './parts';
import type { BotCtx } from './state';

/** لوحةُ «tools» من شاشة البوت — تقرأ الحالةَ المشتركة ولا تملك حالةً خاصّة. */
export function ToolsTab({ c }: { c: BotCtx }) {
  const { busyTool, editing, lockReason, locked, newToolBtn, setAsk, setEditing, setToolEnabled, tools } = c;
  return (
          <Stack gap="lg">
            {editing && (
              <ToolBuilder
                initial={editing}
                /* ★ الإغلاقُ يعيد الجلب دائماً: أوّلُ «جرّبها» يحفظ صفّاً
                   في القاعدة، فإغلاقُ النافذة بلا «احفظ» كان يترك أداةً
                   موجودةً **ومخفيّةً عن القائمة** حتّى تحديث الصفحة. */
                onClose={() => { setEditing(null); void tools.reload(); }}
                onSaved={() => { setEditing(null); void tools.reload(); }}
              />
            )}

            {/* الحالات الثلاث مفروضةً بالنوع: `DataView` لا تُترجم بلا `empty` */}
            <DataView
              state={tools}
              skeletonRows={3}
              empty={{
                when: (list) => list.length === 0,
                title: 'لا أدوات مخصَّصة بعد',
                hint: 'بوتك يستعمل الأدوات الجاهزة (تحويل لموظّف، ملاحظات، خيارات سريعة). أضِف أداةً حين يكون عندك نظامٌ يستعلم منه — أسعارٌ، مخزونٌ، مواعيد، أو حساب زبون.',
                action: newToolBtn(false),
              }}
            >
              {(list) => {
                const broken = list.filter((t) => t.disabledReason);
                const fine = list.filter((t) => !t.disabledReason);

                const card = (t: Tool) => (
                  <Card
                    key={t.id}
                    // اسمٌ كتبه العميل — اتّجاهه من محتواه
                    title={<span dir="auto">{t.titleAr}</span>}
                    actions={(
                      <>
                        {t.disabledReason && <Pill tone="crit" label="معطَّلة آليّاً" />}
                        {/* ★ **مسوّدةٌ لا يراها بوتك** — وكانت الأداةُ تُنشأ
                            مفعَّلةً عند أوّل «جرّبها»، فتصير في متناول البوت
                            أمام الزبائن وهي نصفُ مبنيّة. و«معطَّلةٌ بيدك»
                            غيرُ «معطَّلةٍ آليّاً»: الأولى قرارُك والثانية
                            قاطعُ دائرةٍ فُتح. */}
                        {!t.enabled && !t.disabledReason && (
                          <Pill tone="warn" label="مسوّدة — لا يراها بوتك" />
                        )}
                        {/* ★ «مخصَّصة» ليست تحذيراً: كانت `warn` فكلّ أداةٍ بناها
                            العميل تبدو عطلاً دائماً. وسمٌ بصيغة الخطّ — بلا سطحٍ
                            فلا يُقرأ حالة. */}
                        <Tag line label={t.kind === 'http' ? 'مخصَّصة' : 'جاهزة'} />
                        {t.hasSecrets && <Tag tone="violet" label="لها سرٌّ محفوظ" />}
                      </>
                    )}
                  >
                    <Stack gap="sm">
                      <p className="muted-p" dir="auto">{t.description}</p>

                      {t.disabledReason && (
                        <Note tone="crit">
                          <span dir="auto">{t.disabledReason}</span>{' '}
                          <b>وحتّى تُصلح ذلك، يجيب بوتك من نصّ معرفتك وحده.</b>
                        </Note>
                      )}

                      {!!t.requiresCapabilities.length && (
                        <p className="muted-p">
                          تُخفى تلقائيّاً على قناةٍ لا تدعم ما تحتاجه — والقنوات التي تدعمه
                          تراها كما هي.
                        </p>
                      )}

                      {/* ★ سلاسلُ الآلة مطويّة: المفتاح والمسار لا يُتّخذ عليهما
                          قرار، وصاحب المطعم لا يعرفهما — ومن يسأل الدعم يجدهما. */}
                      <details className="bot-more">
                        <summary>تفاصيلُ تقنيّة — لا يُتّخذ عليها قرار</summary>
                        <div className="bot-more-b">
                          <p className="muted-p">
                            الاسم الذي يناديها به بوتك:{' '}
                            <span className="mono bot-toolkey">{t.key}</span>
                          </p>
                          {t.http?.url && (
                            <p className="muted-p">
                              تنادي:{' '}
                              <span className="mono bot-toolkey">
                                {`${t.http.method ?? 'GET'} ${t.http.url}`}
                              </span>
                            </p>
                          )}
                          {!!t.requiresCapabilities.length && (
                            <p className="muted-p">
                              تحتاج من القناة:{' '}
                              {t.requiresCapabilities.map((c, i) => (
                                <span key={c}>
                                  {i > 0 && '، '}
                                  <span className="mono">{c}</span>
                                </span>
                              ))}
                            </p>
                          )}
                        </div>
                      </details>

                      <div className="bot-acts">
                        <Button
                          size="sm"
                          disabled={locked}
                          reason={lockReason ?? undefined}
                          onClick={() => setEditing(toDraft(t))}
                        >
                          عدّلها وجرّبها
                        </Button>
                        {t.disabledReason ? (
                          <Button
                            size="sm"
                            variant="primary"
                            busy={busyTool === t.id}
                            disabled={locked}
                            reason={lockReason ?? undefined}
                            onClick={() => void setToolEnabled(t.id, true)}
                          >
                            أعِد تفعيلها
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant={t.enabled ? 'quiet' : 'primary'}
                            busy={busyTool === t.id}
                            disabled={locked}
                            reason={lockReason ?? undefined}
                            onClick={() => void setToolEnabled(t.id, !t.enabled)}
                          >
                            {t.enabled ? 'أوقفها مؤقّتاً' : 'شغّلها'}
                          </Button>
                        )}
                        {/* ★ الحذف موجودٌ في الخادم ولم يكن له زرّ. وهو فعلٌ لا
                            يُسحب، فيُنفى إلى نهاية الصفّ وخلفه ورقةُ تأكيد.
                            ★ وللمخصَّصة وحدها: الجاهزةُ لا يبنيها الباني، فحذفُها
                            فقدٌ **لا يستطيع العميل التراجع عنه من هذه الشاشة
                            أصلاً** — والخادم يسمح به، والشاشة لا تعرضه. */}
                        {t.kind === 'http' && (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={locked}
                            reason={lockReason ?? undefined}
                            onClick={() => setAsk({ k: 'tool', id: t.id, name: t.titleAr })}
                          >
                            احذفها
                          </Button>
                        )}
                      </div>
                    </Stack>
                  </Card>
                );

                return (
                  <Stack gap="lg">
                    {/* ★ التجميع بالإلحاح قبل الزمن، والرأسُ يحمل عدده: من
                        يفتح هذا التبويب يفتحه لأنّ أداةً توقّفت. */}
                    {broken.length > 0 && (
                      <div className="sect">
                        <div className="sect-h">
                          <h2>عُطِّلت آليّاً — بوتك يجيب بلا نظامك</h2>
                          <span className="sect-c">
                            <Amount n={broken.length} forms={TOOL_FORMS} />
                            {' '}من <span className="num">{fmt.num(list.length)}</span>
                          </span>
                        </div>
                        <Grid min={400}>{broken.map(card)}</Grid>
                      </div>
                    )}

                    {fine.length > 0 && (
                      <div className="sect">
                        <div className="sect-h">
                          <h2>تعمل بسلام</h2>
                          <span className="sect-c">
                            <Amount n={fine.length} forms={TOOL_FORMS} />
                          </span>
                        </div>
                        <Grid min={400}>{fine.map(card)}</Grid>
                      </div>
                    )}

                    <details className="bot-more">
                      <summary>حدودٌ مفروضةٌ بالكود لا بالشاشة</summary>
                      <div className="bot-more-b">
                        <p className="muted-p">
                          HTTPS فقط · رفض العناوين الداخليّة بعد حلّ الاسم وعند كلّ تحويل ·
                          مهلة <span className="num">8</span> ثوانٍ · <span className="num">256</span>{' '}
                          كيلوبايت للردّ · وتعطيلٌ آليّ بعد <span className="num">5</span> إخفاقاتٍ
                          متتالية مع إشعارك.
                        </p>
                      </div>
                    </details>
                  </Stack>
                );
              }}
            </DataView>
          </Stack>
  );
}
