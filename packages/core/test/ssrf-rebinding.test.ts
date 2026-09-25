import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertPublicUrl, guardedLookup, ownHeadersOnly, tenantHeaderNames,
} from '../src/tools/http.js';

/**
 * ★★★ **ثلاثُ ثغراتٍ في حارس SSRF نفسِه — وكلُّها تصل الحلقةَ المحلّيّة.**
 *
 *  ① **الأقواسُ تُبطل فرعَ العناوين الحرفيّة كلَّه.**
 *    `new URL('https://[::1]/x').hostname` يُعيد `[::1]` بأقواسه، و
 *    `isIP('[::1]')` صفر — فلا يدخل الفرعُ أصلاً. ورفضُ `[::1]` اليوم يأتي
 *    **بالمصادفة** من فشل حلّ DNS على alpine، فالصفّان القائمان في
 *    `http-tool.test.ts` ينجحان بلا أن يُثبتا شيئاً.
 *
 *  ② **وفحصُ IPv6 كان مقارنةَ بادئاتٍ نصّيّة.** `startsWith('fe80')` يترك
 *    `fe90::1` يمرّ وهو في `fe80::/10`؛ و`::7f00:1` و`64:ff9b::7f00:1` و
 *    `2002:7f00:1::` كلُّها تصل 127.0.0.1 وكلُّها كانت مقبولة — قِيس.
 *
 *  ③ **والفحصُ يسبق الاتّصال، والاتّصالُ يحلّ الاسمَ من جديد.** مضيفٌ يردّ
 *    عنواناً عامّاً في الحلّ الأوّل وداخليّاً في الثاني (‏TTL صفر) يعبر
 *    الفحصَ ويقع على الشبكة الداخليّة. فالفحصُ انتقل إلى لحظة الاتّصال.
 *
 * ★ ورابعةٌ ليست SSRF: سرُّ العميل كان يُرسَل إلى المضيف الذي **يختاره المصدر**
 *   عبر التحويل — والتحويلُ اليدويُّ يُفقدنا إسقاطَ `Authorization` الذي تفعله
 *   مواصفةُ Fetch نفسُها عند عبور الأصل.
 */

const SRC = readFileSync(join(__dirname, '..', 'src', 'tools', 'http.ts'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*/gm, ' ');

describe('الماسحُ يُزيل التعليقات', () => {
  it('★ والملفُّ مليءٌ بشروحٍ تذكر `fetch` و`64:ff9b`', () => {
    expect(SRC).toContain('64:ff9b');
    expect(CODE, 'التعليقاتُ ما زالت تُقرأ').not.toContain('إعادةُ ربط DNS');
  });
});

describe('العناوينُ السادسةُ تُقاس بالبايتات لا بالنصّ', () => {
  /* كلُّها تصل الحلقةَ المحلّيّة أو الشبكةَ الداخليّة، وكلُّها كانت **مقبولة**
     قبل الإصلاح — مقيسةٌ بتشغيل `assertPublicUrl` الحقيقيّ. */
  const bypass = [
    ['https://[64:ff9b::7f00:1]/x', 'NAT64 ⟶ 127.0.0.1'],
    ['https://[::7f00:1]/x', 'رابعٌ متوافق ⟶ 127.0.0.1'],
    ['https://[2002:7f00:1::]/x', '6to4 ⟶ 127.0.0.1'],
    ['https://[fe90::1]/x', 'fe80::/10 — والبادئةُ النصّيّة تفوته'],
    ['https://[feb0::1]/x', 'fe80::/10 — وطرفُه الأعلى'],
    ['https://[ff02::1]/x', 'ff00::/8 بثٌّ جماعيّ'],
    ['https://[100::1]/x', '100::/64 مدى الحجب'],
    ['https://[2001:0:1:2:3:4:5:6]/x', 'Teredo — نفقٌ يحمل رابعاً'],
  ] as const;

  for (const [url, why] of bypass) {
    it(`★★ يرفض ${why}`, async () => {
      /* والسببُ يُفحَص لا الرفضُ وحده: على alpine كانت هذه تُرفض بـ«تعذّر حلّ»
         من فشل DNS — رفضٌ بالمصادفة يبقى أخضرَ ولا يُثبت أنّ الفحص يعمل. */
      await expect(assertPublicUrl(url), url).rejects.toThrow(/عنوانٌ خاصّ مرفوض/);
    });
  }

  const keep = [
    ['https://[::1]/x', 'المحلّيّ — وكان يُرفض بالمصادفة'],
    ['https://[::]/x', 'غير المحدّد'],
    ['https://[fd00::1]/x', 'محلّيٌّ فريد'],
    ['https://[fc00::99]/x', 'محلّيٌّ فريد — الطرف الأدنى'],
    ['https://[::ffff:10.0.0.1]/x', 'رابعٌ متنكّرٌ في سادس'],
  ] as const;

  for (const [url, why] of keep) {
    it(`ويبقى رفضُ ${why} — بسببه الصحيح`, async () => {
      await expect(assertPublicUrl(url), url).rejects.toThrow(/عنوانٌ خاصّ مرفوض/);
    });
  }

  it('★ والعامُّ السادسُ يمرّ — فالتشديدُ لم يُغلق الباب', async () => {
    for (const u of ['https://[2606:4700::1111]/x', 'https://[2a01::1]/x']) {
      await expect(assertPublicUrl(u), u).resolves.toBeInstanceOf(URL);
    }
  });
});

describe('الفحصُ عند الاتّصال لا قبله', () => {
  const call = (host: string, opts: Record<string, unknown> = {}) =>
    new Promise<[string | null, unknown, unknown]>((res) => {
      (guardedLookup as unknown as (h: string, o: unknown, cb: (e: Error | null, a: unknown, f?: unknown) => void) => void)(
        host, opts, (e, a, f) => res([e ? e.message : null, a, f]),
      );
    });

  it('★★★ مضيفٌ يحلّ إلى الحلقة المحلّيّة يُرفض **في الحلّ نفسِه**', async () => {
    /* `localtest.me` نطاقٌ عامٌّ يحلّ إلى 127.0.0.1 — وهو بعينه شكلُ إعادة
       ربط DNS: الاسمُ عامٌّ والعنوانُ داخليّ. */
    const [err] = await call('localtest.me');
    expect(err).toMatch(/يحلّ إلى عنوانٍ خاصّ/);
  });

  it('★ والعامُّ يمرّ بشكلَيه — مفرداً ومصفوفة', async () => {
    const [e1, a1, f1] = await call('api.github.com');
    expect(e1).toBeNull();
    expect(typeof a1).toBe('string');
    expect(f1).toBeGreaterThan(0);

    /* `net`/`tls` ينادي بـ`all: true`، فالشكلُ المُعاد يجب أن يطابق ما طُلب
       وإلّا رفض المكدّسُ النتيجةَ وسقط كلُّ نداءٍ خارجيّ. */
    const [e2, a2] = await call('api.github.com', { all: true });
    expect(e2).toBeNull();
    expect(Array.isArray(a2)).toBe(true);
  });

  it('وخطأُ الحلّ يمرّ كما هو — لا يُبتلع', async () => {
    const [err] = await call('no-such-host-xyz.invalid');
    expect(err).toMatch(/ENOTFOUND|EAI_AGAIN|تعذّر حلّ/);
  });

  it('★★★ والناقلُ يمرّر الحارسَ فعلاً — وإلّا فالحلُّ الثاني بلا فحص', () => {
    expect(CODE, '`fetch` لا يقبل `lookup`: أيُّ عودةٍ إليه تُعيد فتح إعادة الربط')
      .not.toMatch(/await fetch\(/);
    expect(CODE).toMatch(/httpsRequest\(\s*url,\s*\{[^}]*lookup: guardedLookup/);
  });
});

describe('سرُّ العميل لا يعبر إلى مضيفٍ يختاره المصدر', () => {
  it('★ ترويساتُنا وحدها تعبر — وما كتبه العميل يُجرَّد', () => {
    const h = { accept: 'application/json', 'content-type': 'application/json', authorization: 'Bearer sk-x', 'x-key': 'k' };
    expect(ownHeadersOnly(h)).toEqual({ accept: 'application/json', 'content-type': 'application/json' });
    expect(tenantHeaderNames(h).sort()).toEqual(['authorization', 'x-key']);
  });

  it('★★★ والقفزةُ العابرةُ للمضيف تُرفض برسالةٍ تُقرأ — لا تجريداً صامتاً', () => {
    /* التجريدُ وحده يُنتج ٤٠١ من نظام العميل، ثمّ خمسَ إخفاقاتٍ، ثمّ إطفاءً
       آليّاً بسببٍ لا يعني شيئاً للمالك. فالرفضُ يقول المضيفَين والسبب. */
    expect(CODE).toMatch(/const crossHost = next\.host !== url\.host;/);
    expect(CODE).toMatch(/crossHost && \(tenantHeaderNames\(headers\)\.length \|\| body !== undefined\)/);
    expect(SRC).toContain('اجعل عنوانَ الأداة يقصد المضيفَ');
    expect(CODE, 'والتجريدُ يبقى حزاماً ثانياً').toMatch(/crossHost \? ownHeadersOnly\(headers\) : headers/);
  });

  it('★★ و٣٠٧/٣٠٨ تُعيدان الجسمَ — وكان يسقط صامتاً', () => {
    /* «أعِد الطلبَ كما هو» تعني الجسمَ أيضاً؛ وبلاه يصل نظامَ العميل طلبُ
       كتابةٍ بجسمٍ فارغ فيُنشئ صفّاً ناقصاً أو يرفض بلا سببٍ مفهوم. */
    expect(CODE).toMatch(/const keep = \[307, 308\]\.includes\(res\.status\);/);
    expect(CODE).toMatch(/body: keep \? body : undefined/);
    expect(CODE).toMatch(/method: keep \? spec\.method : 'GET'/);
  });

  it('★ وسببُ العطل يُفَضّ من `cause` — لا رسالةٌ لاتينيّةٌ عامّة', () => {
    expect(CODE).toMatch(/cause\?\.message \?\? \(e as Error\)\.message/);
  });

  it('★★ والسقفُ يُفرض أثناء القراءة لا بعدها', () => {
    /* قراءةُ مئةِ ميجابايت في الذاكرة ثمّ قياسُها ليست حدّاً — هي العطل. */
    expect(CODE).toMatch(/if \(size > LIMITS\.maxBytes\) \{ over = true; res\.destroy\(\); return; \}/);
  });
});
