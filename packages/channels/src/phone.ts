/**
 * توحيد الأرقام — منقولٌ من الإنتاج بعد عطلٍ حقيقيّ.
 *
 * القاعدة: الأردنيّ يُخزَّن محلّيّاً `07XXXXXXXX`، وغيره بصيغة E.164 `+…`.
 * ولا تصادم بينهما لأنّ المحلّيّ يبدأ بصفرٍ والدوليّ لا يبدأ به أبداً.
 *
 * ⚠️ العطل الذي كشف هذا: الأرقام غير الأردنيّة كانت **تُسقَط بصمت** —
 *    رسالةٌ تصل، ولا محادثة تُنشأ، ولا خطأ في السجلّ.
 */

const JO_CC = '962';

/** ما يصل من ميتا دائماً بلا `+` وبرمز الدولة: `962791234567`. */
export function normalizeAnyPhone(raw: string): string {
  const d = raw.replace(/[^\d]/g, '');
  if (!d) return raw;
  if (d.startsWith(JO_CC) && d.length === 12) return '0' + d.slice(JO_CC.length);
  if (d.startsWith('00')) return normalizeAnyPhone(d.slice(2));
  if (d.startsWith('0') && d.length === 10) return d; // أردنيّ محلّيّ كما هو
  return '+' + d;
}

/** ما يُرسل إلى ميتا: دائماً بلا `+` وبرمز الدولة. */
export function toWaPhone(stored: string): string {
  if (stored.startsWith('+')) return stored.slice(1);
  if (stored.startsWith('0')) return JO_CC + stored.slice(1);
  return stored.replace(/[^\d]/g, '');
}

/** للعرض في الواجهة — لا يُستعمل في مفتاحٍ ولا في استعلام. */
export function displayPhone(stored: string): string {
  if (stored.startsWith('0') && stored.length === 10) {
    return `${stored.slice(0, 4)} ${stored.slice(4, 7)} ${stored.slice(7)}`;
  }
  return stored;
}
