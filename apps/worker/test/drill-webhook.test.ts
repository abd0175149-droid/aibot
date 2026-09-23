import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { getAdapter } from '@aibot/channels';
import { waWebhookBody, inboundJob } from '../scripts/drill-kit';

/**
 * حمولةُ تمرين ريدِس تمرّ من الباب الحقيقيّ — أو لا يقيس التمرين شيئاً.
 *
 * ★ لماذا هذا الاختبار موجود: `drill-redis.ts` يُرسل **ويبهوكاً حقيقيّاً** إلى
 *   `/api/webhooks/wa/:publicId` أثناء انقطاع ريدِس، وهو أخطر ما في التمرين
 *   وأعلاه قيمةً. وإن كان التوقيع أو شكل الحمولة خاطئاً، ردّت البوّابة `200`
 *   (فهي تردّ 200 دائماً بحكم ②) **ورُفضت الحمولة بصمت** في
 *   `verifySignature` أو خرجت فارغةً من `parseWebhook` — فيُقرأ صفرُ الرسائل
 *   «ضاعت في الانقطاع» وهو **خطأ قياسٍ لا عطلُ نظام**.
 *
 *   وهذه بالضبط عائلةُ الأعطال التي يحرسها هذا المشروع: نجاحٌ كاذبٌ بلا خطأ.
 *   ولا يُمسَك إلّا بتمرير الحمولة على نفس المحوّل ونفس التوقيع.
 */

const adapter = getAdapter('whatsapp_cloud');
const SECRET = 'DRILL_SECRET_drill-redis';

function signed(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(Buffer.from(body, 'utf8')).digest('hex')}`;
}

describe('ويبهوك التمرين يُقبل ويُحلَّل كالحقيقيّ', () => {
  const body = JSON.stringify(waWebhookBody({
    externalId: 'redis-1700000000000-w0',
    from: '962791001000',
    text: 'ويبهوك أثناء انقطاع ريدِس 0',
    phoneNumberId: 'DRILL_drill-redis',
  }));

  it('التوقيع يُقبل — محسوبٌ على البايتات كما تُرسَل', () => {
    expect(adapter.verifySignature(Buffer.from(body, 'utf8'), signed(body), SECRET)).toBe(true);
  });

  it('★ وأيُّ إعادة تسلسلٍ تُفسده — ولذلك يُرسَل النصّ نفسه لا كائنٌ يُسلسَل مرّتين', () => {
    const reserialized = JSON.stringify(JSON.parse(body) as unknown, null, 2);
    expect(adapter.verifySignature(Buffer.from(reserialized, 'utf8'), signed(body), SECRET)).toBe(false);
  });

  it('المحلّل يُخرج رسالةً واحدةً بمعرّفها ونصّها', () => {
    const parsed = adapter.parseWebhook(JSON.parse(body));
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.statuses).toEqual([]);
    expect(parsed.accountEvents).toEqual([]);
    const m = parsed.messages[0]!;
    expect(m.externalId).toBe('redis-1700000000000-w0');
    expect(m.type).toBe('text');
    expect(m.text).toBe('ويبهوك أثناء انقطاع ريدِس 0');
    expect(m.at.getTime()).toBeGreaterThan(0);
  });

  it('والمستأجرُ يُحلّ من المسار — فمعرّفُ المستأجر العامّ هو كلّ ما يلزم الرابط', () => {
    expect(adapter.resolveKey({
      pathPublicId: 'pub-123', headers: {}, rawBody: Buffer.alloc(0), body: {},
    })).toEqual({ by: 'path', publicId: 'pub-123' });
  });

  it('حمولةُ المهمّة المضخوخة مباشرةً تحمل `at` تاريخاً — وريدِس يُسلسلها نصّاً', () => {
    const job = inboundJob({
      tenantId: '00000000-0000-0000-0000-000000000001',
      channelId: '00000000-0000-0000-0000-000000000002',
      externalId: 'redis-1-q0', from: '962790001000', text: 'رسالة تمرين',
    });
    expect(job.kind).toBe('whatsapp_cloud');
    expect(job.parsed.messages[0]!.at).toBeInstanceOf(Date);
    /* والإحياء عند حدّ الطابور هو ما يمنع «value.toISOString is not a function» —
       فالحمولةُ هنا مطابقةٌ لما يتوقّعه `reviveJob` حرفيّاً. */
    const round = JSON.parse(JSON.stringify(job)) as { parsed: { messages: Array<{ at: string }> } };
    expect(typeof round.parsed.messages[0]!.at).toBe('string');
    expect(new Date(round.parsed.messages[0]!.at).getTime()).toBeGreaterThan(0);
  });
});
