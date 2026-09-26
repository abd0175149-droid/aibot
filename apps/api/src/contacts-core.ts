/**
 * ★ **ما لا يحتاج قاعدةً في جهات الاتّصال — فيُختبَر وحده.**
 *
 *   كان هذا في `routes/contacts.ts` مع الاستعلامات والمسارات في ١٢٠٠ سطر (#84):
 *   قرارُ الدمج الخالص (`foldContacts`) والتراجعُ عنه (`undoPatch`) ومؤشّرُ
 *   الترقيم — لا استيرادَ قاعدةٍ هنا، فالاختبارُ ينفّذها بلا اتّصال.
 */
import { phoneTail } from './search.js';

/**
 * ★ حقول البطاقة التي **تُدمَج** — مجرّدةٌ عن الصفّ عمداً.
 *
 * والتجريدُ ليس تجميلاً: قرارُ «أيّ قيمةٍ تبقى» هو الموضع الذي يُفقد فيه
 * رقمُ هاتفٍ أو يُنسى فيه **عدولٌ عن الاشتراك**، وهو أمرٌ لا يجوز أن يسقط
 * في دمج. فالقرار دالّةٌ خالصةٌ لها اختبارٌ لا فرعٌ داخل معاملة.
 */
export interface ContactCore {
  phone: string | null;
  displayName: string | null;
  attributes: Record<string, unknown>;
  tags: string[];
  /** ISO — أو `null`. والتواريخ نصوصٌ هنا كي تبقى الدالّة خالصةً وقابلةً للمقارنة. */
  optedOutAt: string | null;
  blockedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** سطرٌ يُقرأ في المراجعة: ما كان، وما سيصير، ولماذا. */
export interface FoldNote {
  k: keyof ContactCore;
  label: string;
  was: string | null;
  now: string | null;
  why: string;
}

function earlier(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function later(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * ★ دمجُ حقلَي بطاقتين — والقواعد مكتوبةٌ لأنّ كلَّ واحدةٍ منها خسارةٌ لو عُكست:
 *
 *  · **الباقيةُ تفوز بما تملك**، والمُدمَجةُ تسدّ الفراغ وحده (`phone` ·
 *    `displayName`). فلا يُبدَّل اسمٌ كتبه صاحبُ الحساب بمقبضٍ جاء من ميتا.
 *  · **الوسوم اتّحادٌ**: وسمٌ وُضع على أحد الوجهين وُضع على الإنسان نفسه.
 *  · **السماتُ تُدمَج والباقيةُ تغلب** عند التعارض — لا حذفَ لمفتاحٍ كان
 *    موجوداً في أحدهما.
 *  · **العدولُ عن الاشتراك والحجبُ: الأسبقُ يفوز.** وهذا معكوسُ ما يبدو
 *    «الأحدثَ أصحّ»: من قال «لا تراسلني» على رقمه القديم قال ذلك عن نفسه لا
 *    عن مقبضه، ودمجٌ يُسقط ذلك يُعيد مراسلةَ من طلب أن يُترك.
 *  · **أوّلُ ظهورٍ أقدمُهما، وآخرُ نشاطٍ أحدثُهما** — وإلّا بدا عميلٌ قديمٌ
 *    جديداً أو نشِطٌ صامتاً.
 */
export function foldContacts(
  keep: ContactCore,
  absorb: ContactCore,
): { patch: Partial<ContactCore>; notes: FoldNote[] } {
  const patch: Partial<ContactCore> = {};
  const notes: FoldNote[] = [];

  if (!keep.phone && absorb.phone) {
    patch.phone = absorb.phone;
    notes.push({
      k: 'phone', label: 'الرقم', was: null, now: absorb.phone,
      why: 'البطاقة الباقية بلا رقم، فأخذت رقم المُدمَجة',
    });
  } else if (keep.phone && absorb.phone && keep.phone !== absorb.phone) {
    notes.push({
      k: 'phone', label: 'الرقم', was: keep.phone, now: keep.phone,
      why: `رقمُ المُدمَجة (${absorb.phone}) يبقى مقبضاً في محادثته ولا يستبدل الرقم الأساس`,
    });
  }

  if (!keep.displayName && absorb.displayName) {
    patch.displayName = absorb.displayName;
    notes.push({
      k: 'displayName', label: 'الاسم', was: null, now: absorb.displayName,
      why: 'البطاقة الباقية بلا اسم، فأخذت اسم المُدمَجة',
    });
  } else if (keep.displayName && absorb.displayName && keep.displayName !== absorb.displayName) {
    notes.push({
      k: 'displayName', label: 'الاسم', was: keep.displayName, now: keep.displayName,
      why: `اسمُ المُدمَجة (${absorb.displayName}) لا يُستبدل به اسمُ البطاقة الباقية`,
    });
  }

  const addedTags = absorb.tags.filter((t) => !keep.tags.includes(t));
  if (addedTags.length) {
    patch.tags = [...keep.tags, ...addedTags];
    notes.push({
      k: 'tags', label: 'الوسوم', was: keep.tags.join(' · ') || null,
      now: patch.tags.join(' · '),
      why: 'وسمٌ على أحد الوجهين وسمٌ على الإنسان نفسه',
    });
  }

  const newKeys = Object.keys(absorb.attributes).filter((k) => !(k in keep.attributes));
  if (newKeys.length) {
    patch.attributes = { ...absorb.attributes, ...keep.attributes };
    notes.push({
      k: 'attributes', label: 'السمات', was: String(Object.keys(keep.attributes).length),
      now: String(Object.keys(patch.attributes).length),
      why: `أُضيفت سماتٌ من المُدمَجة: ${newKeys.join(' · ')}`,
    });
  }

  const opted = earlier(keep.optedOutAt, absorb.optedOutAt);
  if (opted !== keep.optedOutAt) {
    patch.optedOutAt = opted;
    notes.push({
      k: 'optedOutAt', label: 'عدولٌ عن الاشتراك', was: keep.optedOutAt, now: opted,
      why: 'العدولُ يسري على الإنسان لا على مقبضه — فالأسبق يفوز ولا يُلغى بالدمج',
    });
  }

  const blocked = earlier(keep.blockedAt, absorb.blockedAt);
  if (blocked !== keep.blockedAt) {
    patch.blockedAt = blocked;
    notes.push({
      k: 'blockedAt', label: 'الحجب', was: keep.blockedAt, now: blocked,
      why: 'الحجبُ يسري على الإنسان — فالأسبق يفوز',
    });
  }

  const first = earlier(keep.firstSeenAt, absorb.firstSeenAt)!;
  if (first !== keep.firstSeenAt) {
    patch.firstSeenAt = first;
    notes.push({
      k: 'firstSeenAt', label: 'أوّل ظهور', was: keep.firstSeenAt, now: first,
      why: 'عميلٌ قديمٌ لا يصير جديداً بدمج',
    });
  }

  const last = later(keep.lastSeenAt, absorb.lastSeenAt);
  if (last !== keep.lastSeenAt) {
    patch.lastSeenAt = last;
    notes.push({
      k: 'lastSeenAt', label: 'آخر نشاط', was: keep.lastSeenAt, now: last,
      why: 'آخرُ نشاطٍ أحدثُ الوجهين',
    });
  }

  return { patch, notes };
}

/**
 * ★ التراجع **لا يستعيد إلّا ما لم يتغيّر بعده.**
 *
 * لو حُرّر اسمُ البطاقة بعد الدمج، فإعادةُ الاسم القديم تمحو تحريراً لم
 * يطلب أحدٌ محوَه — وهذا تراجعٌ يفقد بياناً، أي بعينه ما وُجد ليمنعه. فلكلّ
 * حقلٍ شرطٌ واحد: **قيمتُه الآن هي التي كتبها الدمج**.
 */
export function undoPatch(
  before: Partial<ContactCore>,
  after: Partial<ContactCore>,
  current: ContactCore,
): { patch: Partial<ContactCore>; skipped: Array<keyof ContactCore> } {
  const patch: Partial<ContactCore> = {};
  const skipped: Array<keyof ContactCore> = [];
  for (const k of Object.keys(after) as Array<keyof ContactCore>) {
    const same = JSON.stringify(current[k]) === JSON.stringify(after[k]);
    if (!same) { skipped.push(k); continue; }
    (patch as Record<string, unknown>)[k] = before[k] ?? null;
  }
  return { patch, skipped };
}

/**
 * مؤشّرُ الصفحة: `آخر نشاط|المعرّف`.
 *
 * ★ وهو مركَّبٌ من حقلَين لا من الوقت وحده: جهتان بنفس `last_seen_at`
 *   (بذرةٌ واحدة، أو توريدٌ مجمَّع) تجعلان المؤشّرَ الزمنيَّ يُسقط إحداهما
 *   أو يُعيدها إلى الأبد. والمعرّفُ uuid v7 مرتَّبٌ زمنيّاً فيصلح فاصلاً.
 */
export function encodeCursor(lastSeenAt: Date | string, id: string): string {
  return `${typeof lastSeenAt === 'string' ? lastSeenAt : lastSeenAt.toISOString()}|${id}`;
}

export function decodeCursor(raw: string | undefined): { ts: string; id: string } | null {
  if (!raw) return null;
  const at = raw.indexOf('|');
  if (at <= 0) return null;
  const ts = raw.slice(0, at);
  const id = raw.slice(at + 1);
  if (Number.isNaN(Date.parse(ts))) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { ts, id };
}
