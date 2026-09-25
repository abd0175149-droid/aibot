import { lookup } from 'node:dns/promises';
import { lookup as dnsLookup } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

/**
 * ★ مُنفّذ أدوات HTTP.
 *
 * العميل يعرّف أداةً تنادي نظامه — أي أنّك **منحته قدرة إرسال طلبات من خادمك**،
 * وهذه ناقل SSRF بالتصميم لا بالخطأ. كلّ حدٍّ هنا مفروضٌ بالكود لا بالتوثيق.
 */

export interface HttpToolSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  timeoutMs?: number;
}

export interface HttpToolResult {
  ok: boolean;
  status?: number;
  mapped: Record<string, unknown>;
  error?: string;
  ms: number;
  /**
   * للعرض في زرّ «تجربة» بالواجهة — لا يدخل سياق النموذج أبداً.
   *
   * ★ وكلُّ حقلٍ فيه **محجوبُ الأسرار** قبل أن يخرج: القيمُ هنا هي القيمُ
   *   **المُستبدَلة** — أي أنّ `{{secret.X}}` صارت السرَّ نفسَه. انظر
   *   `redactSecrets`.
   */
  debug?: { url: string; requestBody?: string; responseSnippet: string };
}

export const LIMITS = {
  timeoutMs: 8_000,
  maxBytes: 256 * 1024,
  maxRedirects: 3,
} as const;

/** ما يُكتب بدل السرّ. */
export const MASKED = '•••';

/**
 * ★ **مخرَجُ التشخيص كان يُعيد الأسرار إلى الشاشة.**
 *
 *   `debug.url` و`debug.requestBody` يُبنيان **بعد** `renderUrl`
 *   و`renderTemplate` — أي أنّ `{{secret.API_TOKEN}}` فيهما صارت التوكنَ
 *   نفسَه. والواجهة تطبعهما في كتلةٍ قابلةٍ للنسخ («العنوان الذي نودي
 *   فعلاً»)، فتوكنُ نظام العميل يظهر على شاشةٍ قد تُصوَّر أو تُشارَك، ويسكن
 *   ذاكرةَ المتصفّح.
 *
 *   والحجبُ هنا لا في الواجهة: الواجهةُ ليست الحدَّ الأمنيّ — نفسُ الحمولة
 *   تُقرأ من أدوات المتصفّح ومن أيّ مُنادٍ آخر لنفس المسار.
 *
 * ⚠️ والقيمةُ تُحجب بصيغتها الخام **وبصيغتها المُشفَّرة للعنوان**: `renderUrl`
 *    يمرّ كلَّ قيمةٍ على `encodeURIComponent`، فسرٌّ فيه `/` أو `+` يظهر في
 *    العنوان بشكلٍ لا يطابق النصَّ الأصليّ.
 */
export function redactSecrets(text: string, masks: Iterable<string>): string {
  let out = text;
  for (const raw of masks) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    /* ★ وأقلُّ من ستّة محارف لا يُحجب: قيمةٌ مثل «1» أو «ar» تُشطب من كلّ
       موضعٍ في الاستجابة فيصير التشخيصُ بلا معنى — وهو الغرضُ منه. */
    if (v.length < 6) continue;
    for (const form of new Set([v, encodeURIComponent(v)])) {
      /* `split/join` لا `RegExp`: السرُّ نصٌّ حرفيٌّ قد يحمل `.` و`+` و`?`. */
      if (out.includes(form)) out = out.split(form).join(MASKED);
    }
  }
  return out;
}

/**
 * ★★★ **فرعُ IPv6 كان مقارنةَ بادئاتٍ نصّيّة — ومقارنةُ النصّ لا تفهم العنوان.**
 *
 *   `startsWith('fe80')` يترك `fe90::1` و`feb0::1` يمرّان وهما في `fe80::/10`.
 *   و`::7f00:1` (رابعٌ متوافقٌ = 127.0.0.1) و`64:ff9b::7f00:1` (NAT64) و
 *   `2002:7f00:1::` (‏6to4) كلُّها تصل الحلقةَ المحلّيّة وكلُّها كانت **مقبولة**.
 *   وتحويلُ العنوان إلى ستّةَ عشرَ بايتاً يُنهي هذا الصنفَ كلَّه: القرارُ على
 *   البتّات كما تفهمها الشبكة، لا على شكل الكتابة.
 */
function v6Bytes(ip: string): number[] | null {
  let t = ip.toLowerCase();
  const pct = t.indexOf('%');            // fe80::1%eth0
  if (pct >= 0) t = t.slice(0, pct);

  /* ذيلٌ رابعٌ في سادس (`::ffff:1.2.3.4`) يُحوَّل إلى مجموعتَين سداسيّتَين
     قبل التوسيع، فلا يحتاج التوسيعُ أن يعرف شكلَين. */
  const lastColon = t.lastIndexOf(':');
  const tail4 = t.slice(lastColon + 1);
  if (tail4.includes('.')) {
    const q = tail4.split('.');
    if (q.length !== 4) return null;
    const n = q.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : -1));
    if (n.some((x) => x < 0 || x > 255)) return null;
    t = `${t.slice(0, lastColon + 1)}${(((n[0]! << 8) | n[1]!) >>> 0).toString(16)}`
      + `:${(((n[2]! << 8) | n[3]!) >>> 0).toString(16)}`;
  }

  const halves = t.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (groups.length !== 8) return null;

  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    out.push((n >> 8) & 0xff, n & 0xff);
  }
  return out;
}

function isPrivateIp6(ip: string): boolean {
  const b = v6Bytes(ip);
  /* ما لا يُفهَم يُرفَض: الرفضُ افتراضيٌّ في كلّ هذا الملفّ. */
  if (!b) return true;
  const b0 = b[0]!;
  const b1 = b[1]!;

  /* ثمانون بتاً أصفار: `::` و`::1` و`::a.b.c.d` (رابعٌ متوافق) و`::ffff:…`.
     والأخيرُ يُقاس بقواعد الرابع، والبقيّةُ تُرفض جملةً — `::7f00:1` هي
     127.0.0.1 عند مكدّساتٍ كثيرة. */
  if (b.slice(0, 10).every((x) => x === 0)) {
    if (b[10] === 0xff && b[11] === 0xff) {
      return isPrivateIp(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
    }
    return true;
  }

  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return true;   // fe80::/10 رابطٌ محلّيّ
  if ((b0 & 0xfe) === 0xfc) return true;                  // fc00::/7 محلّيٌّ فريد
  if (b0 === 0xff) return true;                           // ff00::/8 بثٌّ جماعيّ
  // 64:ff9b::/96 و64:ff9b:1::/48 — NAT64: يُترجَم إلى عنوانٍ رابعٍ عند البوّابة
  if (b0 === 0x00 && b1 === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true;
  // 2002::/16 — 6to4: الرابعُ في البايتات ٢..٥، فـ2002:7f00:1:: هي 127.0.0.1
  if (b0 === 0x20 && b1 === 0x02) return true;
  // 2001:0000::/32 — Teredo: نفقٌ يحمل رابعاً
  if (b0 === 0x20 && b1 === 0x01 && b[2] === 0 && b[3] === 0) return true;
  // 100::/64 — مدى الحجب
  if (b0 === 0x01 && b1 === 0x00 && b.slice(2, 8).every((x) => x === 0)) return true;

  return false;
}

/** شبكاتٌ خاصّة ومحجوزة — تُرفض **بعد** حلّ DNS لا قبله. */
function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) return isPrivateIp6(ip);
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;   // بيانات وصف السحابة
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;                  // بثّ ومحجوز
  return false;
}

/** يتحقّق من العنوان ومن كلّ ما يحلّ إليه DNS. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('عنوانٌ غير صالح'); }

  if (u.protocol !== 'https:') throw new Error('HTTPS فقط — لا يُسمح بغيره');
  if (u.port && !['', '443'].includes(u.port)) throw new Error('المنفذ 443 فقط');

  /* ★★★ **والأقواسُ كانت تُبطل فرعَ العناوين الحرفيّة كلَّه.**
     `new URL('https://[::1]/x').hostname` يُعيد `[::1]` بأقواسه، و
     `isIP('[::1]')` صفر — فلا يدخل الفرعُ أصلاً ويهبط العنوانُ إلى مسار
     حلّ DNS. وعلى صورة الإنتاج (alpine) يفشل الحلُّ فيُرفَض **بالمصادفة**،
     وعلى مكدّسٍ يحلّ الحرفيَّ يمرّ. أي أنّ الفحصَ لم يكن يعمل قطّ. */
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`عنوانٌ خاصّ مرفوض: ${host}`);
    return u;
  }
  if (/^localhost$|\.local$|\.internal$/i.test(host)) throw new Error(`مضيفٌ داخليّ مرفوض: ${host}`);

  const addrs = await lookup(host, { all: true }).catch(() => {
    throw new Error(`تعذّر حلّ ${host}`);
  });
  if (!addrs.length) throw new Error(`تعذّر حلّ ${host}`);
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error(`${host} يحلّ إلى عنوانٍ خاصّ (${a.address})`);
  }
  return u;
}

/**
 * قوالب `{{param}}` و`{{secret.X}}`.
 * الأسرار تُحقن **هنا وحدها**، في الطلب الخارج — ولا يُحقن سرٌّ في نصٍّ يراه النموذج.
 */
export function renderTemplate(
  tpl: string,
  params: Record<string, unknown>,
  secrets: Record<string, string>,
): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    if (key.startsWith('secret.')) return secrets[key.slice(7)] ?? '';
    const v = params[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** يشفّر قيم القالب داخل المسار لا في ترويسةٍ ولا في جسم JSON. */
function renderUrl(tpl: string, params: Record<string, unknown>, secrets: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const raw = key.startsWith('secret.') ? secrets[key.slice(7)] ?? '' : String(params[key] ?? '');
    return encodeURIComponent(raw);
  });
}

/**
 * استخراج الحقول المختارة بمسارات JSONPath مبسَّطة (`$.data.state`, `$.items[0].id`).
 *
 * ليس تجميلاً: **إرجاع الاستجابة كاملةً يُغرق السياق ويضاعف الفاتورة**،
 * ويزيد سطح الحقن لأنّ كلّ ما يعود يُقرأ من النموذج.
 */
export function applyResponseMap(
  data: unknown,
  map: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(map)) out[key] = jsonPath(data, path);
  return out;
}

export function jsonPath(data: unknown, path: string): unknown {
  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let cur: unknown = data;
  for (const part of parts) {
    const m = /^([\w-]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) return undefined;
    if (m[1]) {
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[m[1]];
    }
    for (const idx of m[2]!.matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(idx[1])];
    }
  }
  return cur;
}

/**
 * الترويساتُ التي نضعها نحن لا العميل — وهي وحدها ما يعبر تحويلاً إلى مضيفٍ آخر.
 */
const OWN_HEADERS = new Set(['accept', 'content-type']);

/**
 * ★★★ **الفحصُ كان قبل الاتّصال، والاتّصالُ يحلّ الاسمَ من جديد.**
 *
 *   `assertPublicUrl` يحلّ المضيفَ ويفحص كلَّ عنوانٍ يعود — ثمّ يُنادى الجلبُ
 *   بالاسم، فيحلّه المكدّسُ **مرّةً ثانية**. ومضيفٌ يملكه المهاجم يردّ عنواناً
 *   عامّاً في الحلّ الأوّل وعنواناً داخليّاً في الثاني (TTL يساوي صفراً): هذا
 *   «إعادةُ ربط DNS»، والفحصُ يمرّ والاتّصالُ يقع على 127.0.0.1.
 *
 *   فالفحصُ انتقل إلى **لحظة الاتّصال**: `https.request` يقبل `lookup` خاصّاً،
 *   وهو ما يُنادى فعلاً قبل فتح المقبس — فلا حلَّ ثانياً بلا فحص.
 *
 * ⚠️ و`node:https` لا مكتبةٌ خارجيّة: `fetch` لا يقبل `lookup` ولا وكيلَ
 *    `node:https`، وتمريرُه عبر `undici` مستقلٍّ يربط المستودعَ بإصدارٍ يجب أن
 *    يطابق نسخةَ Node المدمجة — وترقيةُ Node وحدها تُبطل التثبيت بصمت.
 */
export const guardedLookup: LookupFunction = (host, options, cb) => {
  const fam = typeof options.family === 'string'
    ? (options.family === 'IPv6' ? 6 : 4)
    : (options.family ?? 0);
  dnsLookup(host, { all: true, family: fam, hints: options.hints }, (err, addrs) => {
    if (err) return cb(err, '');
    if (!addrs.length) return cb(new Error(`تعذّر حلّ ${host}`), '');
    const bad = addrs.find((x) => isPrivateIp(x.address));
    if (bad) return cb(new Error(`${host} يحلّ إلى عنوانٍ خاصّ (${bad.address})`), '');
    /* `all` يُطلب من `net`/`tls` فعلاً، فيُعاد الشكلُ الذي طُلب لا شكلٌ آخر. */
    if (options.all) return (cb as unknown as (e: null, a: typeof addrs) => void)(null, addrs);
    return cb(null, addrs[0]!.address, addrs[0]!.family);
  });
};

interface RawResponse {
  status: number;
  location: string | null;
  text: string;
}

/**
 * ناقلٌ واحدٌ لكلّ نداءات أدوات العميل.
 *
 * ★ والسقفُ يُفرض **أثناء** القراءة لا بعدها: `fetch` كان يقرأ الجسمَ كاملاً
 *   في الذاكرة ثمّ يقيسه، فمصدرٌ يردّ مئةَ ميجابايت يُقرأ كلُّه قبل أن يُرفَض.
 */
function send(
  url: URL,
  o: { method: string; headers: Record<string, string>; body?: string; timeoutMs: number },
): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    const req = httpsRequest(
      url,
      { method: o.method, headers: o.headers, lookup: guardedLookup, timeout: o.timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let over = false;
        res.on('data', (c: Buffer) => {
          if (over) return;
          size += c.length;
          if (size > LIMITS.maxBytes) { over = true; res.destroy(); return; }
          chunks.push(c);
        });
        res.on('end', () => {
          if (over) { reject(new Error('الاستجابة أكبر من 256 ك.ب')); return; }
          const loc = res.headers.location;
          resolve({
            status: res.statusCode ?? 0,
            location: typeof loc === 'string' ? loc : null,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      },
    );
    /* مهلةٌ على الطلب كلِّه: `timeout` في `https` مهلةُ خمولٍ على المقبس،
       فمصدرٌ يرسل بايتاً كلَّ ثانيةٍ يبقى موصولاً إلى الأبد بلا هذا. */
    const hard = setTimeout(() => { req.destroy(new Error(`انتهت المهلة (${o.timeoutMs}ms)`)); }, o.timeoutMs);
    req.on('timeout', () => { req.destroy(new Error(`انتهت المهلة (${o.timeoutMs}ms)`)); });
    req.on('error', (e) => { clearTimeout(hard); reject(e); });
    req.on('close', () => { clearTimeout(hard); });
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

/**
 * ★★★ **سرُّ العميل كان يُرسَل إلى المضيف الذي يختاره المصدر.**
 *
 *   حلقةُ التحويل كانت تُعيد استعمال `headers` كما هي في كلّ قفزة — وفيها
 *   `Authorization` بعد استبدال `{{secret.X}}` بالسرّ نفسِه. فمصدرٌ مخترَقٌ
 *   (أو أداةٌ كتبها العميل تقصد مجمّعاً يحوّل) يردّ `302` إلى مضيفٍ يملكه
 *   المهاجم فيصله توكنُ نظام العميل كاملاً في الترويسة الأولى.
 *
 *   والتحويلُ اليدويُّ هنا يُفقدنا حمايةَ `fetch` نفسِها: مواصفةُ Fetch تُسقط
 *   `Authorization` عند تحويلٍ عابرٍ للأصل، ونحن نتجاوزها بـ`redirect: 'manual'`
 *   ثمّ نُعيد الإرسالَ بأيدينا.
 *
 * ⚠️ والتجريدُ الصامتُ وحده لا يكفي: أداةٌ فقدت ترويسةَ مصادقتها تردّ ٤٠١
 *    خمسَ مرّاتٍ فيُطفئها قاطعُ الدائرة بسببٍ لا يُقرأ. فالقفزةُ العابرةُ للمضيف
 *    **تُرفض برسالةٍ تقول ما جرى** متى حملت الأداةُ ترويسةً من عندها أو جسماً،
 *    والتجريدُ يبقى حزاماً ثانياً لِما لا يحمل شيئاً.
 */
export function ownHeadersOnly(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (OWN_HEADERS.has(k)) out[k] = v;
  return out;
}

/** الترويساتُ التي كتبها العميل — وجودُها يمنع القفزَ إلى مضيفٍ آخر. */
export function tenantHeaderNames(h: Record<string, string>): string[] {
  return Object.keys(h).filter((k) => !OWN_HEADERS.has(k));
}

export async function execHttpTool(
  spec: HttpToolSpec,
  params: Record<string, unknown>,
  secrets: Record<string, string>,
  responseMap: Record<string, string> | null,
  /**
   * ★ `mask`: قيمٌ إضافيّةٌ تُحجب من التشخيص ومن رسائل الخطأ.
   *   الأسرارُ المُهرَّبة عبر `secrets` تُحجب آليّاً؛ و`mask` لبيانات الاعتماد
   *   **الحرفيّة** المكتوبة في الصفّ نفسِه (مفتاحٌ في مُعامِل عنوان)، وهي
   *   الحالةُ الأكثرُ شيوعاً عند من كتب الأداة بسرعة.
   */
  opts: { debug?: boolean; mask?: readonly string[] } = {},
): Promise<HttpToolResult> {
  const started = Date.now();
  const masks = [...Object.values(secrets), ...(opts.mask ?? [])];
  /* رسائلُ الخطأ تُحجب أيضاً: `fetch` يضع العنوانَ كاملاً في بعض أخطائه. */
  const red = (t: string) => redactSecrets(t, masks);
  const urlStr = renderUrl(spec.url, params, secrets);

  let url: URL;
  try {
    url = await assertPublicUrl(urlStr);
  } catch (e) {
    return { ok: false, mapped: {}, error: red((e as Error).message), ms: Date.now() - started };
  }

  const headers: Record<string, string> = { accept: 'application/json' };
  for (const [k, v] of Object.entries(spec.headers ?? {})) {
    headers[k.toLowerCase()] = renderTemplate(v, params, secrets);
  }
  const body = spec.bodyTemplate ? renderTemplate(spec.bodyTemplate, params, secrets) : undefined;
  if (body && !headers['content-type']) headers['content-type'] = 'application/json';

  const timeout = Math.min(spec.timeoutMs ?? LIMITS.timeoutMs, LIMITS.timeoutMs);

  let res: RawResponse;
  try {
    res = await send(url, { method: spec.method, headers, body, timeoutMs: timeout });

    let hops = 0;
    while ([301, 302, 303, 307, 308].includes(res.status)) {
      if (++hops > LIMITS.maxRedirects) {
        return { ok: false, mapped: {}, error: 'إعادات توجيهٍ كثيرة', ms: Date.now() - started };
      }
      if (!res.location) break;
      const next = await assertPublicUrl(new URL(res.location, url).toString()); // يُفحص كلّ هدف

      /* ★★★ قفزةٌ إلى **مضيفٍ آخر**: لا تعبرها ترويسةٌ من عند العميل ولا
         جسمُه. وتُرفض صراحةً متى كان هناك ما يُجرَّد — فالتجريدُ الصامت يُنتج
         ٤٠١ ثمّ إطفاءً آليّاً بسببٍ لا يُقرأ، وهو أسوأُ من رفضٍ مكتوب. */
      const crossHost = next.host !== url.host;
      if (crossHost && (tenantHeaderNames(headers).length || body !== undefined)) {
        return {
          ok: false,
          status: res.status,
          mapped: {},
          error: red(
            `المصدرُ حوّل الطلبَ من ${url.host} إلى ${next.host}، ولا تُرسَل ترويساتُ أداتك `
            + 'ولا جسمُها إلى مضيفٍ لم تكتبه أنت. اجعل عنوانَ الأداة يقصد المضيفَ '
            + 'النهائيَّ مباشرةً.',
          ),
          ms: Date.now() - started,
        };
      }

      /* و٣٠٧/٣٠٨ تعنيان «أعِد الطلبَ كما هو»، فالجسمُ يُعاد معهما — وكان يسقط
         صامتاً فيصل نظامَ العميل طلبُ كتابةٍ بجسمٍ فارغ. و٣٠١/٣٠٢ تتحوّلان
         إلى `GET` في الممارسة كما ٣٠٣. */
      const keep = [307, 308].includes(res.status);
      res = await send(next, {
        method: keep ? spec.method : 'GET',
        headers: crossHost ? ownHeadersOnly(headers) : headers,
        body: keep ? body : undefined,
        timeoutMs: timeout,
      });
      url = next;
    }
  } catch (e) {
    /* ⚠️ والسببُ الحقيقيّ قد يسكن `cause`: أخطاءُ الاتّصال تُلَفّ. فبلا فضِّه
       تصل العميلَ رسالةٌ لاتينيّةٌ عامّة — وتُكتب كذلك في `disabledReason`
       حين يُطفئ قاطعُ الدائرة أداتَه، فيقرأ المالك سبباً لا يعني شيئاً. */
    const cause = (e as { cause?: { message?: string } }).cause;
    const msg = cause?.message ?? (e as Error).message;
    return { ok: false, mapped: {}, error: red(msg), ms: Date.now() - started };
  }

  const { text } = res;
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 2000) }; }

  const mapped = responseMap ? applyResponseMap(json, responseMap) : (json as Record<string, unknown>);

  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    mapped,
    error: res.status >= 200 && res.status < 300 ? undefined : `المصدر ردّ ${res.status}`,
    ms: Date.now() - started,
    ...(opts.debug
      ? {
        debug: {
          url: red(url.toString()),
          requestBody: body === undefined ? undefined : red(body),
          responseSnippet: red(text.slice(0, 1000)),
        },
      }
      : {}),
  };
}
