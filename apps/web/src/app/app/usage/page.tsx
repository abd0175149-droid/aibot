'use client';

import { useState } from 'react';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { download, ApiError } from '@/lib/api';
import {
  PageHead, Grid, Stack, Stat, Pill, Note, Skeleton, ErrorBox, Table, Empty, Button, type Column,
} from '@/components/ui';

/**
 * الاستهلاك.
 *
 * ★ المبدأ الذي يحكم الشاشة: **الرقم وأصله معاً.** هذا هو جدول النوافذ نفسه
 *   الذي تُفوتَر عليه، لا ملخّصاً مشتقّاً منه — فالرقم المجرَّد يُناقَش، والرقم
 *   الذي ترى صفوفه يُقبَل. ولذلك التصدير هنا لا في مكانٍ آخر.
 *
 * ★ وصفّ «لم تُفوتَر» هو أهمّ صفٍّ في الجدول: رسالةٌ لم يردّ عليها أحدٌ لا
 *   تُحسب. إظهاره يحوّل الفوترة من ادّعاءٍ إلى حساب.
 */

interface Window {
  id: string;
  handle: string;
  contactName: string | null;
  channelKind: string;
  openedAt: string;
  billedAt: string | null;
  messagesIn: number;
  messagesOut: number;
  aiCostUsd: string;
}

interface Usage {
  period: string;
  windowsBilled: number;
  windowsOpened: number;
  windowsLimit: number;
  aiTokens: number;
  aiTokensLimit: number;
  aiCostUsd: number;
  avgRepliesPerWindow: number;
  items: Window[];
}

const CH: Record<string, { label: string; tone: 'brand' | 'violet' }> = {
  whatsapp_cloud: { label: 'واتساب', tone: 'brand' },
  instagram: { label: 'إنستجرام', tone: 'violet' },
};

export default function UsagePage() {
  const { data, loading, error, reload } = useApi<Usage>('/usage');
  const { toast, node: toastNode } = useToast();
  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    try {
      await download('/usage/windows.csv', `aibot-windows-${data?.period ?? 'export'}.csv`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر التصدير');
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <Skeleton rows={5} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const pct = data.windowsLimit ? data.windowsBilled / data.windowsLimit : 0;
  const unbilled = data.windowsOpened - data.windowsBilled;

  const columns: Array<Column<Window>> = [
    { key: 'who', head: 'الزبون', /* اسمٌ يكتبه الزبون — اتّجاهه من محتواه، ولا مونو عليه (بلا تغطيةٍ عربيّة) */
      cell: (w) => <span dir="auto">{w.contactName ?? w.handle}</span> },
    {
      key: 'ch',
      head: 'القناة',
      cell: (w) => <Pill tone={CH[w.channelKind]?.tone ?? 'neutral'} label={CH[w.channelKind]?.label ?? w.channelKind} />,
    },
    { key: 'open', head: 'فُتحت', cell: (w) => fmt.when(w.openedAt) },
    {
      key: 'billed',
      head: 'فُوتِرت',
      cell: (w) => (w.billedAt
        ? fmt.when(w.billedAt)
        : <Pill tone="neutral" label="لم تُفوتَر — لا ردّ" />),
    },
    { key: 'msgs', head: 'رسائل', num: true, cell: (w) => w.messagesIn + w.messagesOut },
    { key: 'cost', head: 'كلفة الذكاء', num: true, cell: (w) => fmt.money(w.aiCostUsd) },
  ];

  return (
    <Stack gap="lg">
      {toastNode}
      <PageHead
        title="الاستهلاك"
        sub="هذا هو جدول النوافذ نفسه الذي تُفوتَر عليه — لا ملخّصاً مشتقّاً منه."
        actions={(
          <>
            <Pill tone="neutral" label={data.period} mark={false} />
            <Button size="sm" busy={exporting} onClick={() => void exportCsv()}>تصدير CSV</Button>
          </>
        )}
      />

      <Grid min={220}>
        <Stat
          hero={pct >= 0.8}
          value={fmt.num(data.windowsBilled)}
          unit={`/ ${fmt.num(data.windowsLimit)}`}
          label="نوافذ مُفوتَرة هذا الشهر"
          tone={pct >= 1 ? 'crit' : pct >= 0.95 ? 'serious' : pct >= 0.8 ? 'warn' : undefined}
          meter={{ pct }}
        />
        <Stat value={fmt.num(data.windowsOpened)} label={`نافذة فُتحت — منها ${fmt.num(unbilled)} بلا ردّ فلم تُفوتَر`} />
        <Stat
          value={(data.aiTokens / 1e6).toFixed(1)} unit="M"
          label={`توكن · من ${(data.aiTokensLimit / 1e6).toFixed(0)}M`}
          meter={data.aiTokensLimit ? { pct: data.aiTokens / data.aiTokensLimit } : undefined}
        />
        <Stat value={data.avgRepliesPerWindow.toFixed(1)} label="وسيط الردود لكلّ نافذة" tone="ok" />
      </Grid>

      {!data.items.length ? (
        <Empty
          title="لا نوافذ هذا الشهر"
          hint="ستظهر هنا أوّل ما يراسلك زبونٌ ويردّ عليه بوتك. والنافذة لا تُحتسب إلّا عند أوّل ردٍّ منك داخلها."
        />
      ) : (
        <Table columns={columns} rows={data.items} keyOf={(w) => w.id} />
      )}

      <Note>
        <b>النافذة لكلّ قناة لا لكلّ إنسان.</b> زبونٌ يراسلك على واتساب وإنستجرام يستهلك
        نافذتين — لأنّهما محادثتان منفصلتان عند ميتا، وكلفتهما علينا منفصلة.
      </Note>

      <Note>
        <b>ومتى تُحتسب النافذة؟</b> عند <b>أوّل ردٍّ منك داخلها</b>، لا عند وصول رسالة الزبون.
        فرسالةٌ لم يردّ عليها أحدٌ لا تُحسب عليك — وذاك ما يعنيه صفّ «لم تُفوتَر».
        العدّاد كلّه أمامك لتراجعه، وتصدّره متى شئت.
      </Note>
    </Stack>
  );
}
