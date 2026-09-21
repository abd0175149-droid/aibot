import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

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
  /** للعرض في زرّ «تجربة» بالواجهة — لا يدخل سياق النموذج أبداً. */
  debug?: { url: string; requestBody?: string; responseSnippet: string };
}

export const LIMITS = {
  timeoutMs: 8_000,
  maxBytes: 256 * 1024,
  maxRedirects: 3,
} as const;

/** شبكاتٌ خاصّة ومحجوزة — تُرفض **بعد** حلّ DNS لا قبله. */
function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' ) return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    // ::ffff:10.0.0.1 — عنوانٌ رابعٌ متنكّرٌ في سادس
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (m) return isPrivateIp(m[1]!);
    return false;
  }
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

  const host = u.hostname;
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

export async function execHttpTool(
  spec: HttpToolSpec,
  params: Record<string, unknown>,
  secrets: Record<string, string>,
  responseMap: Record<string, string> | null,
  opts: { debug?: boolean } = {},
): Promise<HttpToolResult> {
  const started = Date.now();
  const urlStr = renderUrl(spec.url, params, secrets);

  let url: URL;
  try {
    url = await assertPublicUrl(urlStr);
  } catch (e) {
    return { ok: false, mapped: {}, error: (e as Error).message, ms: Date.now() - started };
  }

  const headers: Record<string, string> = { accept: 'application/json' };
  for (const [k, v] of Object.entries(spec.headers ?? {})) {
    headers[k.toLowerCase()] = renderTemplate(v, params, secrets);
  }
  const body = spec.bodyTemplate ? renderTemplate(spec.bodyTemplate, params, secrets) : undefined;
  if (body && !headers['content-type']) headers['content-type'] = 'application/json';

  const timeout = Math.min(spec.timeoutMs ?? LIMITS.timeoutMs, LIMITS.timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: spec.method,
      headers,
      body,
      // إعادة التوجيه يدويّة: وإلّا التفّ المهاجم على الفحص بتحويلٍ إلى 127.0.0.1
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    });

    let hops = 0;
    while ([301, 302, 303, 307, 308].includes(res.status)) {
      if (++hops > LIMITS.maxRedirects) {
        return { ok: false, mapped: {}, error: 'إعادات توجيهٍ كثيرة', ms: Date.now() - started };
      }
      const loc = res.headers.get('location');
      if (!loc) break;
      const next = await assertPublicUrl(new URL(loc, url).toString()); // يُفحص كلّ هدف
      res = await fetch(next, {
        method: res.status === 303 ? 'GET' : spec.method,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
      });
      url = next;
    }
  } catch (e) {
    const msg = (e as Error).name === 'TimeoutError' ? `انتهت المهلة (${timeout}ms)` : (e as Error).message;
    return { ok: false, mapped: {}, error: msg, ms: Date.now() - started };
  }

  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > LIMITS.maxBytes) {
    return { ok: false, status: res.status, mapped: {}, error: 'الاستجابة أكبر من 256 ك.ب', ms: Date.now() - started };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > LIMITS.maxBytes) {
    return { ok: false, status: res.status, mapped: {}, error: 'الاستجابة أكبر من 256 ك.ب', ms: Date.now() - started };
  }

  const text = buf.toString('utf8');
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 2000) }; }

  const mapped = responseMap ? applyResponseMap(json, responseMap) : (json as Record<string, unknown>);

  return {
    ok: res.ok,
    status: res.status,
    mapped,
    error: res.ok ? undefined : `المصدر ردّ ${res.status}`,
    ms: Date.now() - started,
    ...(opts.debug ? { debug: { url: url.toString(), requestBody: body, responseSnippet: text.slice(0, 1000) } } : {}),
  };
}
