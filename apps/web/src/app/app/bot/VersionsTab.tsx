'use client';

import { Button, DataView, Note, Stack, Tag } from '@/components/ui';
import { fmt } from '@/lib/useApi';
import type { BotCtx } from './state';

/** لوحةُ «versions» من شاشة البوت — تقرأ الحالةَ المشتركة ولا تملك حالةً خاصّة. */
export function VersionsTab({ c }: { c: BotCtx }) {
  const { pubVersion, rollbackReason, setAsk, setTab, vers } = c;
  return (
          <Stack gap="md">
            <Note tone="brand">
              <b>التراجع نشرُ نسخةٍ قديمة</b> — لا تُحذف نسخةٌ ولا يُفقد تاريخ، ومسوّدتك على
              الشاشة تبقى كما هي. ولا تُقطع محادثةٌ جاريةٌ مع زبون.
            </Note>
            <DataView
              state={vers}
              skeletonRows={4}
              empty={{
                when: (d) => d.length === 0,
                title: 'لا نسخةَ بعد',
                hint: 'كلُّ نشرٍ يُنشئ نسخةً تبقى هنا، ومنها تعود إلى أيّ نسخةٍ سابقة. اكتب الشخصيّة والمعرفة ثمّ انشر.',
                action: <Button onClick={() => setTab('persona')}>اذهب إلى الشخصيّة</Button>,
              }}
            >
              {(rows) => (
                <div className="sect">
                  <div className="sect-h">
                    <h2>نسخُ بوتك</h2>
                    <span className="sect-c">الأحدث أوّلاً</span>
                  </div>
                  <div className="rows bot-rows">
                    {rows.map((v) => {
                      const isLive = v.version === pubVersion;
                      /* سببُ المنع يُقال في موضعه: الخادم يرفض `pending`
                         و`failed` برسالتَيه، والشاشةُ تقولهما قبل النقرة. */
                      const why = isLive
                        ? 'هذه النسخة تخدم زبائنك الآن.'
                        : v.embedStatus === 'pending'
                          ? 'ما زالت معرفتها تُجهَّز — انتظر جهوزها.'
                          : v.embedStatus === 'failed'
                            ? 'فشل تجهيز معرفتها، فلو عادت أجاب بوتك «لا أعرف» عن كلّ شيء. انشر مسوّدتك من جديد.'
                            : rollbackReason;
                      return (
                        <div className="row-m" key={v.id}>
                          <span className="rm-k">
                            <span className="num">{`v${v.version}`}</span>
                            <span className="rm-note" dir="auto">{v.note?.trim() || 'بلا ملاحظة'}</span>
                          </span>
                          {/* ★ والتاريخُ في `small`: `.rm-v` حجمُ **قيمةٍ رأسٍ**، فتاريخٌ
                              نسبيٌّ فيه يصير أعلى صوتاً من النسخة نفسِها ومن ملاحظتها
                              — وهما ما يُقرأ ليُختار. */}
                          <span className="rm-v"><small>{fmt.when(v.publishedAt)}</small></span>
                          <span className="rm-c">
                            {isLive && <Tag tone="ok" label="تخدم زبائنك الآن" />}
                            {!isLive && v.embedStatus === 'pending' && <Tag tone="warn" label="تُجهَّز معرفتها" />}
                            {!isLive && v.embedStatus === 'failed' && <Tag tone="crit" label="فشل تجهيز معرفتها" />}
                            {!isLive && (
                              <Button
                                size="sm"
                                disabled={Boolean(why)}
                                reason={why ?? undefined}
                                onClick={() => setAsk({ k: 'rollback', id: v.id, version: v.version })}
                              >
                                عُد إليها
                              </Button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </DataView>
          </Stack>
  );
}
