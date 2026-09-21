/**
 * الحرّاس — مستوردةٌ من الإنتاج لا مؤلَّفة.
 * كلّ حارسٍ هنا وُضع بعد عطلٍ حقيقيّ رآه زبون، ولكلٍّ منه اختبارٌ يُثبت أنّه
 * يمنع ما وُضع له. ترتيب التطبيق مقصود.
 */

export interface GuardContext {
  /** هل نُفِّذت أداةٌ في هذه الدورة؟ يقرّر هل تُحاوَل إعادة الصياغة أصلاً. */
  toolExecuted: boolean;
  allowedLinkHosts: string[];
  maxLen: number;
  lastOutboundText: string | null;
  toolNames: string[];
}

export interface GuardResult {
  text: string;
  flags: {
    leak: boolean;
    linkStripped: boolean;
    truncated: boolean;
    repeated: boolean;
    privacy: boolean;
  };
  /** طلبُ إعادة صياغةٍ واحدة — تُجرَّب مرّةً واحدة فقط. */
  needsRetry: boolean;
}

/**
 * ① تسريب الأدوات.
 * النموذج يكتب اسم الأداة نصّاً للعميل: `check_availability(...)`.
 * الحلّ المجرَّب: كشف ⟵ محاولة تصحيحٍ واحدة **فقط إن لم تُنفَّذ أداةٌ بعد**
 * (وإلّا ضاع التقرير) ⟵ تنظيفٌ إجباريّ قبل الإرسال على كلّ حال.
 *
 * ⚠️ ترتيب التنظيف مهمّ: الاسم الكامل مع الأقواس **قبل** الاسم المجرّد،
 *    وإلّا بقيت أقواسٌ يتيمة في وجه الزبون.
 */
export function detectToolLeak(text: string, toolNames: string[]): boolean {
  if (!text) return false;
  if (/```/.test(text)) return true;
  if (/\bfunction_call\b|\btool_code\b|\bprint\s*\(/.test(text)) return true;
  return toolNames.some((n) => new RegExp(`\\b${escapeRe(n)}\\s*\\(`).test(text));
}

export function stripToolLeak(text: string, toolNames: string[]): string {
  let out = text;
  out = out.replace(/```[\s\S]*?```/g, '').replace(/```[\s\S]*$/g, '');
  for (const n of toolNames) {
    out = out.replace(new RegExp(`\\b${escapeRe(n)}\\s*\\([^)]*\\)`, 'g'), ''); // الكامل أوّلاً
  }
  for (const n of toolNames) {
    out = out.replace(new RegExp(`\\b${escapeRe(n)}\\b`, 'g'), '');
  }
  return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

/** ② الروابط التي يخترعها النموذج تصل مكسورةً — تُزال إلّا ما جاء من أداةٍ أو قائمةٍ بيضاء. */
export function stripDisallowedLinks(text: string, allowedHosts: string[]): { text: string; stripped: boolean } {
  let stripped = false;
  const out = text.replace(/https?:\/\/[^\s<>"'،]+/g, (url) => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (allowedHosts.some((h) => host === h || host.endsWith('.' + h))) return url;
    } catch { /* رابطٌ مشوّه — يُزال */ }
    stripped = true;
    return '';
  });
  return { text: out.replace(/\s{2,}/g, ' ').trim(), stripped };
}

/** ③ الطول — جدارٌ نصّيّ في واتساب يُفقد الرسالة قيمتها. القصّ عند حدود الجُمَل. */
export function limitLength(text: string, maxLen: number): { text: string; truncated: boolean } {
  if (text.length <= maxLen) return { text, truncated: false };
  const cut = text.slice(0, maxLen);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('؟'), cut.lastIndexOf('!'), cut.lastIndexOf('\n'));
  return { text: (lastStop > maxLen * 0.6 ? cut.slice(0, lastStop + 1) : cut).trim(), truncated: true };
}

/** ④ التكرار — إعادة الترحيب مع كلّ رسالة أسرع طريقةٍ لإفقاد البوت مصداقيّته. */
export function isRepeat(text: string, last: string | null): boolean {
  if (!last) return false;
  const a = norm(text), b = norm(last);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return shorter.length > 20 && longer.includes(shorter);
}

/** ⑤ الخصوصيّة — أرقامٌ أو أسرارٌ تتسرّب في الردّ. */
export function scrubPrivacy(text: string, blocklist: string[] = []): { text: string; hit: boolean } {
  let hit = false;
  let out = text.replace(/\b(EAA[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,})\b/g, () => {
    hit = true;
    return '';
  });
  for (const w of blocklist) {
    if (!w) continue;
    const re = new RegExp(escapeRe(w), 'gi');
    if (re.test(out)) { hit = true; out = out.replace(re, ''); }
  }
  return { text: out.trim(), hit };
}

/** يطبّق الحرّاس بالترتيب ويُرجع النصّ النهائيّ وأعلامَه. */
export function applyGuards(raw: string, ctx: GuardContext): GuardResult {
  const flags = { leak: false, linkStripped: false, truncated: false, repeated: false, privacy: false };
  let text = raw ?? '';

  if (detectToolLeak(text, ctx.toolNames)) {
    flags.leak = true;
    text = stripToolLeak(text, ctx.toolNames);
  }
  const links = stripDisallowedLinks(text, ctx.allowedLinkHosts);
  text = links.text; flags.linkStripped = links.stripped;

  const priv = scrubPrivacy(text);
  text = priv.text; flags.privacy = priv.hit;

  const len = limitLength(text, ctx.maxLen);
  text = len.text; flags.truncated = len.truncated;

  flags.repeated = isRepeat(text, ctx.lastOutboundText);

  // إعادة الصياغة تُطلب فقط إن كان التسريب هو العطل ولم تُنفَّذ أداةٌ بعد.
  // بعد تنفيذ أداة، إعادة الصياغة تُضيّع نتيجتها — وهذا أسوأ من التسريب نفسه.
  const needsRetry = flags.leak && !ctx.toolExecuted;
  return { text, flags, needsRetry };
}

const norm = (s: string) => s.replace(/[ً-ْـ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
