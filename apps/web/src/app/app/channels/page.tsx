'use client';

import { useState } from 'react';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { post, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import {
  PageHead, Grid, Stack, Row, Card, Pill, Dot, Note, Button,
  Skeleton, ErrorBox, KV, KVRow,
} from '@/components/ui';

/**
 * القنوات.
 *
 * ★ القرار الذي تحمله الشاشة: **لا سرٌّ يُعرض أبداً** — ولا حتّى لمالك المنصّة.
 *   بصمةٌ وتاريخٌ وزرّ استبدال. سرٌّ يُعرض مرّةً يُنسخ إلى مكانٍ لا نتحكّم فيه،
 *   ثمّ يبقى هناك بعد أن يُنسى.
 *
 * ★ و«اختبر الاتّصال» فحصٌ **حقيقيّ** عند ميتا لا قراءةُ صفٍّ عندنا. وأهمّ سطرٍ
 *   في نتيجته اشتراك الويبهوك: هو السبب الأوّل لـ«البوت لا يردّ» بينما التوكن
 *   صالحٌ والرقم أخضر وكلّ شاشةٍ خضراء.
 */

interface Channel {
  id: string;
  kind: 'whatsapp_cloud' | 'instagram';
  status: 'pending' | 'connected' | 'error' | 'disabled';
  displayName: string | null;
  tokenFingerprint: string | null;
  qualityRating: string | null;
  messagingTier: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  capabilities: { buttons: number; quickReplies: number; location: boolean; windowHours: number };
}

interface TestReport {
  level: 'ok' | 'degraded' | 'blocked' | 'unreachable';
  tokenValid: boolean;
  webhookSubscribed: boolean | null;
  issues: string[];
}

const QUALITY: Record<string, { label: string; tone: 'ok' | 'warn' | 'crit' }> = {
  GREEN: { label: 'أخضر', tone: 'ok' },
  YELLOW: { label: 'أصفر — أوقف أيّ إرسالٍ جماعيّ', tone: 'warn' },
  RED: { label: 'أحمر', tone: 'crit' },
};

const LEVEL: Record<string, { label: string; tone: 'ok' | 'warn' | 'crit' }> = {
  ok: { label: 'سليمة', tone: 'ok' },
  degraded: { label: 'تعمل بجودةٍ أقلّ', tone: 'warn' },
  blocked: { label: 'محجوبة', tone: 'crit' },
  unreachable: { label: 'لا تستجيب', tone: 'crit' },
};

export default function ChannelsPage() {
  const can = useCan();
  const { data, loading, error, reload } = useApi<{ items: Channel[] }>('/channel');
  const { toast, node: toastNode } = useToast();
  const [testing, setTesting] = useState(false);
  const [report, setReport] = useState<TestReport | null>(null);

  async function runTest(channelId?: string) {
    setTesting(true);
    setReport(null);
    try {
      const r = await post<TestReport>('/channel/test', channelId ? { channelId } : {});
      setReport(r);
      toast(r.level === 'ok' ? 'القناة سليمة' : 'الفحص انتهى — اقرأ التفاصيل');
      await reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر الفحص');
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <Skeleton rows={4} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  const wa = data?.items.find((c) => c.kind === 'whatsapp_cloud');
  const ig = data?.items.find((c) => c.kind === 'instagram');

  return (
    <Stack gap="lg">
      {toastNode}
      <PageHead
        title="القنوات"
        sub="نفس البوت ونفس المعرفة على كلّ قناة. ما يختلف هو ما تسمح به القناة."
      />

      <Grid min={320}>
        {/* ── واتساب ── */}
        <Card
          title={(
            <Row gap="sm">
              <Pill tone="brand" label="واتساب" mark={false} />
              <Dot tone={wa?.status === 'connected' ? 'ok' : wa?.status === 'error' ? 'crit' : 'neutral'} />
              <span>{wa?.status === 'connected' ? 'موصول' : 'غير موصول'}</span>
            </Row>
          )}
        >
          <Stack gap="sm">
            {wa?.status === 'connected' ? (
              <KV>
                <KVRow k="الرقم"><span className="mono">{wa.displayName ?? '—'}</span></KVRow>
                <KVRow k="بصمة التوكن"><span className="mono">{wa.tokenFingerprint ?? '—'}</span></KVRow>
                <KVRow k="الجودة">
                  {wa.qualityRating
                    ? (
                      <Pill
                        tone={QUALITY[wa.qualityRating]?.tone ?? 'neutral'}
                        label={QUALITY[wa.qualityRating]?.label ?? wa.qualityRating}
                      />
                    )
                    : '—'}
                </KVRow>
                <KVRow k="مستوى الإرسال"><span className="mono">{wa.messagingTier ?? '—'}</span></KVRow>
                <KVRow k="آخر فحص">{fmt.when(wa.lastCheckedAt)}</KVRow>
                <KVRow k="النافذة">{wa.capabilities.windowHours} ساعة من آخر رسالةٍ للزبون</KVRow>
                <KVRow k="الأزرار">
                  <Row gap="xs">
                    <Pill tone="ok" label="مدعومة" />
                    <span>{wa.capabilities.buttons} كحدّ أقصى</span>
                  </Row>
                </KVRow>
                <KVRow k="إرسال الموقع"><Pill tone="ok" label="مدعوم" /></KVRow>
              </KV>
            ) : (
              <Stack gap="sm">
                <p className="muted-p">
                  رقمك وحسابك عند ميتا — لا عندنا. فاتورة ميتا عليك، وتأخذ رقمك معك إن رحلت.
                </p>
                <p className="muted-p">
                  الربط يحتاج أربع قيمٍ من لوحتك عند ميتا، ونقوم بها معك على مكالمة —
                  <b> 30 إلى 60 دقيقة أوّل مرّة</b>.
                </p>
              </Stack>
            )}

            {wa?.lastError && <Note tone="crit">{wa.lastError}</Note>}

            {report && (
              <KV>
                <KVRow k="نتيجة الفحص">
                  <Pill
                    tone={LEVEL[report.level]?.tone ?? 'neutral'}
                    label={LEVEL[report.level]?.label ?? report.level}
                  />
                </KVRow>
                <KVRow k="التوكن">
                  {report.tokenValid
                    ? <Pill tone="ok" label="صالح" />
                    : <Pill tone="crit" label="منتهٍ أو مسحوب" />}
                </KVRow>
                <KVRow k="اشتراك الويبهوك">
                  {report.webhookSubscribed === null ? <Pill tone="neutral" label="تعذّر التحقّق" />
                    : report.webhookSubscribed ? <Pill tone="ok" label="مشترك" />
                      : <Pill tone="crit" label="غير مشترك — لن تصل رسالة" />}
                </KVRow>
                {report.issues.map((x) => <KVRow key={x} k="ملاحظة">{x}</KVRow>)}
              </KV>
            )}

            <Row gap="xs">
              <Button
                size="sm" busy={testing}
                disabled={can.readOnly || wa?.status !== 'connected'}
                reason={wa?.status !== 'connected' ? 'لا قناة موصولة لتُفحص' : 'حسابك للقراءة فقط'}
                onClick={() => void runTest(wa?.id)}
              >
                اختبر الاتّصال
              </Button>
              <Button size="sm" disabled reason="الربط يجري معك على مكالمة حتّى نفتح المعالج للعملاء">
                {wa?.status === 'connected' ? 'استبدل التوكن' : 'ابدأ الربط'}
              </Button>
            </Row>
          </Stack>
        </Card>

        {/* ── إنستجرام ── */}
        <Card
          title={(
            <Row gap="sm">
              <Pill tone="violet" label="إنستجرام" mark={false} />
              <Dot tone={ig?.status === 'connected' ? 'ok' : 'neutral'} />
              <span>{ig?.status === 'connected' ? 'موصول' : 'غير موصول'}</span>
            </Row>
          )}
        >
          <Stack gap="sm">
            {ig?.status === 'connected' ? (
              <KV>
                <KVRow k="الحساب"><span className="mono">{ig.displayName ?? '—'}</span></KVRow>
                <KVRow k="ما لصقتَه"><b>لا شيء</b> — الربط بموافقةٍ لا بتوكن</KVRow>
                <KVRow k="آخر فحص">{fmt.when(ig.lastCheckedAt)}</KVRow>
                <KVRow k="النافذة">{ig.capabilities.windowHours} ساعة · <b>مستقلّة عن واتساب</b></KVRow>
                <KVRow k="الأزرار">
                  <Row gap="xs">
                    <Pill tone="warn" label="تصير ردوداً سريعة" />
                    <span>{ig.capabilities.quickReplies}</span>
                  </Row>
                </KVRow>
                <KVRow k="إرسال الموقع"><Pill tone="neutral" label="غير مدعوم — الأداة مخفيّة" /></KVRow>
              </KV>
            ) : (
              <Stack gap="sm">
                <p className="muted-p">
                  ثلاث ضغطات، ولا سرَّ تلصقه: تختار حسابك التجاريّ وتمنحنا قراءة الرسائل
                  والردّ عليها. لا صلاحيّة نشرٍ ولا إعلانات.
                </p>
                <p className="muted-p">
                  نفس البوت ونفس المعرفة — ونافذةٌ مستقلّة تُحتسب على حدة.
                </p>
              </Stack>
            )}

            <Row gap="xs">
              {ig?.status === 'connected' ? (
                <>
                  <Button size="sm" disabled reason="تدفّق الموافقة قيد البناء">أعِد المنح</Button>
                  <Button size="sm" variant="danger" disabled reason="تدفّق الموافقة قيد البناء">
                    افصل الحساب
                  </Button>
                </>
              ) : (
                <Button
                  size="sm" variant="primary" disabled
                  reason="تدفّق الموافقة قيد البناء — راسلنا لنربطه لك الآن"
                >
                  اربط حساب إنستجرام
                </Button>
              )}
            </Row>
          </Stack>
        </Card>
      </Grid>

      <Note>
        <b>لماذا الربط مختلف بين القناتين.</b> واتساب على حسابك أنت، فالمسؤوليّة والرقم لك —
        والثمن تهيئةٌ أطول. وإنستجرام على تطبيقنا، فالربط بضغطة — والرسائل المباشرة بلا
        قوالب ولا حملات، فسطح المخالفة أضيق بكثير.
      </Note>

      <Note tone="warn">
        <b>لا سرَّ يُعرض هنا أبداً</b> — ولا حتّى لنا. بصمةٌ وتاريخٌ وزرّ استبدال. وسرٌّ يُعرض
        مرّةً يُنسخ إلى مكانٍ لا نتحكّم فيه، ثمّ يبقى هناك بعد أن تنساه.
      </Note>
    </Stack>
  );
}
