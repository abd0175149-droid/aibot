'use client';

import { BotBehavior } from '@/components/BotBehavior';
import { Button, Empty, Stack, Tag } from '@/components/ui';
import { fmt } from '@/lib/useApi';
import { MODEL } from './parts';
import type { BotCtx } from './state';

/** لوحةُ «behave» من شاشة البوت — تقرأ الحالةَ المشتركة ولا تملك حالةً خاصّة. */
export function BehaveTab({ c }: { c: BotCtx }) {
  const { bot, can, cfg, pub, setTab, toast } = c;
  return (
          cfg ? (
            <Stack gap="lg">
              {/* ★ كانت ثلاثَ بطاقاتِ **قراءةٍ** تشرح أربعةَ سلوكيّاتٍ بعناية
                  ثمّ تقول «لا تُعدَّل من هنا» — وهي لم تكن تُعدَّل من أيّ
                  مكان. صارت نموذجاً يحفظ في `PATCH /bot/config`. */}
              <BotBehavior
                cfg={cfg}
                readOnly={!can.settings || can.readOnly}
                onSaved={() => void bot.reload()}
                onToast={toast}
              />

              {/* ★ التبويب كان ثلاثَ بطاقاتِ قراءةٍ بلا جملةٍ تقول من أين تُضبط،
                  وأرقاماً بلا وحدةٍ ولا عاقبة («دورات الأدوات: 3»). فما لا يُعدَّل
                  من هنا يُقال صريحاً ويُطوى، وكلّ رقمٍ معه عاقبتُه. */}
              <details className="bot-more">
                <summary>ثلاثةٌ يضبطها فريق المنصّة معك — لا تُعدَّل من هذه الشاشة</summary>
                <div className="bot-more-b">
                  <div className="sect">
                    <div className="rows bot-rows">
                      <div className="row-m">
                        <span className="rm-k">
                          النموذج الذي يفكّر به
                          <span className="rm-note">
                            {MODEL[pub?.model ?? ''] ?? 'النموذج الذي نشغّله لحسابك'}
                          </span>
                        </span>
                        <span className="rm-c">
                          {pub?.model
                            ? <span className="mono bot-toolkey">{pub.model}</span>
                            : <Tag line label="لم يُنشر بعد" />}
                        </span>
                      </div>
                      <div className="row-m">
                        <span className="rm-k">
                          كم مرّةً يسأل نظامك في الردّ الواحد
                          <span className="rm-note">
                            وبعدها يجيب بما عنده ولا يسأل مرّةً أخرى — سقفٌ يمنع الدوران.
                          </span>
                        </span>
                        <span className="rm-v">
                          <span className="num">{fmt.num(cfg.maxToolLoops)}</span>{' '}
                          <small>على الأكثر</small>
                        </span>
                      </div>
                      <div className="row-m">
                        <span className="rm-k">
                          كم رسالةً من المحادثة يتذكّر
                          <span className="rm-note">
                            آخرُ الرسائل وحدها تُرسَل معه — فما قبلها لا يذكره.
                          </span>
                        </span>
                        <span className="rm-v">
                          <span className="num">{fmt.num(cfg.contextMessages)}</span>{' '}
                          <small>رسالة</small>
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="muted-p">
                    هذه الثلاثة تُضبط معك عند التهيئة، ولو احتجت تغيير واحدةٍ منها فاطلبها من
                    فريقنا — ولا تُعدَّل من هنا لأنّ لها أثراً على كلفة كلّ ردّ.
                  </p>
                </div>
              </details>
            </Stack>
          ) : (
            <Empty
              title="لا سلوكَ محفوظاً بعد"
              hint="هذه الحدود تُنشأ مع أوّل نشرٍ لشخصيّة بوتك: مدّة سكوته بعد تدخّل موظّف، وكم مرّةً يسأل نظامك، وما يقوله حين يعجز. اكتب الشخصيّة وانشرها لتظهر."
              action={<Button onClick={() => setTab('persona')}>اذهب إلى الشخصيّة</Button>}
            />
          )
  );
}
