/**
 * ★★★ **رمز QR — يُولَّد عندنا، ولا يُرسَل السرُّ إلى خدمةٍ ترسمه.**
 *
 *   شاشةُ تفعيل المصادقة الثنائيّة كانت تعرض السرَّ نصّاً يُلصق باليد. ونقلُ
 *   اثنين وثلاثين محرفاً من شاشةٍ إلى هاتفٍ هو الخطوةُ التي يُخطئ فيها الناس
 *   ويتركونها — وحرفٌ واحدٌ خاطئ يعني رمزاً لا يُقبل أبداً بلا سببٍ ظاهر.
 *
 * ⚠️ **ولا يُرسَم عند طرفٍ ثالث.** خدماتُ توليد QR بالرابط (‏`api.qrserver.com`
 *    وأمثالُها) تعني إرسالَ `otpauth://…secret=…` إلى خادمٍ لا نملكه — أي
 *    تسليمَ العامل الثاني لمن يرسم صورته. فالتوليدُ محلّيٌّ صرف.
 *
 * ⚠️ **ولا مكتبةَ خارجيّة**: المصفوفةُ تُبنى هنا وتُرسَل أرقاماً، وترسمها
 *    الواجهةُ `rect`ات — فلا `dangerouslySetInnerHTML` ولا سطحَ حقنٍ جديد.
 *
 * والخوارزميّة معياريّة (ISO/IEC 18004): نمطُ البايت، وتصحيحُ Reed-Solomon على
 * GF(256)، وتشابكُ الكتل، ثمّ ثمانيةُ أقنعةٍ يُختار أقلُّها عقوبة.
 */

/** مستوى التصحيح. `M` توازنٌ معتاد: ١٥٪ تحمّلٍ بحجمٍ معقول. */
export type EcLevel = 'L' | 'M' | 'Q' | 'H';

const EC_ORDER: EcLevel[] = ['L', 'M', 'Q', 'H'];

/* عددُ كلمات التصحيح لكلّ كتلة — [مستوى][إصدار]، والإصدارُ يبدأ من ١ فالخانةُ صفرٌ حشو. */
const ECC_PER_BLOCK: Record<EcLevel, number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/* عددُ كتل التصحيح — [مستوى][إصدار]. */
const EC_BLOCKS: Record<EcLevel, number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** إجماليُّ خانات البيانات الخام (بتّات) لإصدارٍ ما — قبل طرح التصحيح. */
function rawDataModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

function dataCodewords(ver: number, ec: EcLevel): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ec][ver]! * EC_BLOCKS[ec][ver]!;
}

/* ───────────────── GF(256) — الحقل الذي يعمل عليه Reed-Solomon ───────────────── */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;   // كثيرُ الحدود البدئيّ في المعيار
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]!;
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!;
}

/**
 * كثيرُ حدود المولِّد بطول `degree` — **بلا** الحدّ الأعلى المونيك، والفهرسُ
 * صفرٌ أعلى درجة.
 *
 * ⚠️ وترتيبُ المعاملات هو الفخّ: بناءٌ يضع المونيك في الفهرس صفر ثمّ يُفهرَس
 *    بإزاحةٍ واحدة يُنتج بقيّةً **معقولةَ الشكل وخاطئة** — عشرةُ بايتاتٍ تبدو
 *    سليمة، والرمزُ لا يُقرأ بأيّ قارئ. قِيس بمقارنة البقيّة بمرجعٍ مستقلّ.
 */
function rsGenerator(degree: number): number[] {
  const g = new Array<number>(degree).fill(0);
  g[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      g[j] = gfMul(g[j]!, root);
      if (j + 1 < degree) g[j] = g[j]! ^ g[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return g;
}

function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const out = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ out.shift()!;
    out.push(0);
    for (let i = 0; i < degree; i += 1) out[i] = out[i]! ^ gfMul(gen[i]!, factor);
  }
  return out;
}

/* ───────────────── بناء المصفوفة ───────────────── */

function alignPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const last = ver * 4 + 10;
  const step = ver === 32 ? 26 : Math.ceil((last - 6) / (n * 2 - 2)) * 2;
  const out: number[] = [];
  for (let p = last; out.length < n - 1; p -= step) out.unshift(p);
  return [6, ...out];
}

interface Grid {
  size: number;
  m: boolean[][];
  fixed: boolean[][];
}

function blank(ver: number): Grid {
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, m, fixed };
}

function set(g: Grid, x: number, y: number, v: boolean): void {
  if (x < 0 || y < 0 || x >= g.size || y >= g.size) return;
  g.m[y]![x] = v;
  g.fixed[y]![x] = true;
}

function finder(g: Grid, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(g, cx + dx, cy + dy, d !== 2 && d !== 4);
    }
  }
}

function patterns(g: Grid, ver: number): void {
  // أنماطُ التوقيت
  for (let i = 0; i < g.size; i += 1) {
    set(g, 6, i, i % 2 === 0);
    set(g, i, 6, i % 2 === 0);
  }
  // الأنماطُ الثلاثةُ الكبيرة في الأركان
  finder(g, 3, 3);
  finder(g, g.size - 4, 3);
  finder(g, 3, g.size - 4);

  // أنماطُ المحاذاة — لا توضع فوق الأنماط الكبيرة
  const pos = alignPositions(ver);
  for (const y of pos) {
    for (const x of pos) {
      const corner = (x === 6 && y === 6)
        || (x === 6 && y === g.size - 7)
        || (x === g.size - 7 && y === 6);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          set(g, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // الخانةُ الداكنة الدائمة، ومواضعُ معلومات النسق تُحجز
  set(g, 8, g.size - 8, true);
  for (let i = 0; i < 9; i += 1) {
    if (!g.fixed[i]![8]) set(g, 8, i, false);
    if (!g.fixed[8]![i]) set(g, i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    if (!g.fixed[8]![g.size - 1 - i]) set(g, g.size - 1 - i, 8, false);
    if (!g.fixed[g.size - 1 - i]![8]) set(g, 8, g.size - 1 - i, false);
  }

  // معلوماتُ الإصدار للإصدار ٧ فما فوق — BCH(18,6)
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const v = ((bits >>> i) & 1) !== 0;
      set(g, i % 3 + g.size - 11, Math.floor(i / 3), v);
      set(g, Math.floor(i / 3), i % 3 + g.size - 11, v);
    }
  }
}

function formatBits(ec: EcLevel, mask: number): number {
  const ecBits = { L: 1, M: 0, Q: 3, H: 2 }[ec];
  const data = (ecBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(g: Grid, ec: EcLevel, mask: number): void {
  const bits = formatBits(ec, mask);
  for (let i = 0; i <= 5; i += 1) set(g, 8, i, ((bits >>> i) & 1) !== 0);
  set(g, 8, 7, ((bits >>> 6) & 1) !== 0);
  set(g, 8, 8, ((bits >>> 7) & 1) !== 0);
  set(g, 7, 8, ((bits >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i += 1) set(g, 14 - i, 8, ((bits >>> i) & 1) !== 0);

  for (let i = 0; i < 8; i += 1) set(g, g.size - 1 - i, 8, ((bits >>> i) & 1) !== 0);
  for (let i = 8; i < 15; i += 1) set(g, 8, g.size - 15 + i, ((bits >>> i) & 1) !== 0);
  set(g, 8, g.size - 8, true);
}

function maskAt(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function penalty(g: Grid): number {
  const n = g.size;
  let score = 0;

  // ① خمسةٌ متتاليةٌ فأكثر بنفس اللون — أفقيّاً وعموديّاً
  for (let i = 0; i < n; i += 1) {
    for (const row of [true, false]) {
      let run = 1;
      for (let j = 1; j < n; j += 1) {
        const a = row ? g.m[i]![j]! : g.m[j]![i]!;
        const b = row ? g.m[i]![j - 1]! : g.m[j - 1]![i]!;
        if (a === b) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }

  // ② مربّعاتُ ٢×٢ بلونٍ واحد
  for (let y = 0; y < n - 1; y += 1) {
    for (let x = 0; x < n - 1; x += 1) {
      const c = g.m[y]![x]!;
      if (c === g.m[y]![x + 1] && c === g.m[y + 1]![x] && c === g.m[y + 1]![x + 1]) score += 3;
    }
  }

  /* ③ نمطٌ يشبه النمطَ الكبير (‏1:1:3:1:1) وبجانبه أربعُ خاناتٍ فاتحة.
     ⚠️ والصياغةُ المعياريّة تعدّ السلسلتَين الإحدى عشريّتَين بلا افتراضِ
        فاتحٍ خارج الحدّ: افتراضُه يُغيّر العقوبةَ فيُختار قناعٌ آخرُ غيرُ الذي
        يختاره كلُّ مُولِّدٍ معياريّ — والرمزُ يبقى صالحاً، لكنّ المطابقةَ
        ببتّ مع مرجعٍ مستقلّ تسقط، وهي أقوى ما نملك من إثباتٍ لصحّة البناء. */
  const A = '10111010000';
  const B = '00001011101';
  const count = (line: string): number => {
    let c = 0;
    for (let k = 0; k + 11 <= line.length; k += 1) {
      const w = line.slice(k, k + 11);
      if (w === A || w === B) c += 1;
    }
    return c;
  };
  for (let i = 0; i < n; i += 1) {
    let row = '';
    let col = '';
    for (let j = 0; j < n; j += 1) {
      row += g.m[i]![j] ? '1' : '0';
      col += g.m[j]![i] ? '1' : '0';
    }
    score += (count(row) + count(col)) * 40;
  }

  // ④ انحرافُ نسبة الداكن عن النصف
  let dark = 0;
  for (const row of g.m) for (const c of row) if (c) dark += 1;
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;

  return score;
}

/**
 * يُعيد مصفوفةَ الرمز (‏`true` = خانةٌ داكنة) لنصٍّ ما.
 *
 * ⚠️ ونمطُ البايت وحده: النصُّ هنا `otpauth://` بأحرفٍ صغيرةٍ ورموز، ونمطُ
 *    «الأبجديّ الرقميّ» لا يحتملها — واختيارُه خطأً يُنتج رمزاً يُقرأ محرفاً
 *    آخر بصمت.
 */
export function qrMatrix(text: string, ec: EcLevel = 'M', forceMask?: number): boolean[][] {
  const bytes = [...Buffer.from(text, 'utf8')];

  // أصغرُ إصدارٍ يتّسع — والعدُّ بالبتّات لأنّ طولَ حقل العدد يتغيّر بالإصدار
  let ver = 1;
  for (; ver <= 40; ver += 1) {
    const cap = dataCodewords(ver, ec) * 8;
    const lenBits = ver <= 9 ? 8 : 16;
    if (4 + lenBits + bytes.length * 8 <= cap) break;
  }
  if (ver > 40) throw new Error('النصُّ أطولُ من أكبر رمز QR');

  // ① سيلُ البتّات: نمطٌ + طولٌ + بيانات + إنهاءٌ + حشو
  const bits: number[] = [];
  const push = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i -= 1) bits.push((val >>> i) & 1);
  };
  push(4, 4);                                   // نمطُ البايت
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  const capBits = dataCodewords(ver, ec) * 8;
  push(0, Math.min(4, capBits - bits.length));  // الإنهاء
  while (bits.length % 8 !== 0) bits.push(0);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  for (let pad = 0xec; words.length < dataCodewords(ver, ec); pad ^= 0xec ^ 0x11) words.push(pad);

  // ② تقسيمُ الكتل وتشابكُها — والترتيبُ هو ما يجعل خدشاً موضعيّاً قابلاً للإصلاح
  const numBlocks = EC_BLOCKS[ec][ver]!;
  const eccLen = ECC_PER_BLOCK[ec][ver]!;
  const rawWords = Math.floor(rawDataModules(ver) / 8);
  const shortLen = Math.floor(rawWords / numBlocks) - eccLen;
  const numShort = numBlocks - (rawWords % numBlocks);

  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  let at = 0;
  for (let i = 0; i < numBlocks; i += 1) {
    const len = shortLen + (i < numShort ? 0 : 1);
    const blk = words.slice(at, at + len);
    at += len;
    dataBlocks.push(blk);
    eccBlocks.push(rsRemainder(blk, eccLen));
  }

  const inter: number[] = [];
  for (let i = 0; i <= shortLen; i += 1) {
    for (let b = 0; b < numBlocks; b += 1) {
      const blk = dataBlocks[b]!;
      if (i < blk.length) inter.push(blk[i]!);
    }
  }
  for (let i = 0; i < eccLen; i += 1) {
    for (let b = 0; b < numBlocks; b += 1) inter.push(eccBlocks[b]![i]!);
  }

  // ③ الرسم: الأنماطُ الثابتة ثمّ البيانات في مسارٍ متعرّج من أسفل اليمين
  const g = blank(ver);
  patterns(g, ver);

  let bit = 0;
  const total = inter.length * 8;
  for (let right = g.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;   // العمودُ السادس عمودُ توقيتٍ يُتخطّى
    for (let v = 0; v < g.size; v += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? g.size - 1 - v : v;
        if (g.fixed[y]![x]) continue;
        const on = bit < total && ((inter[bit >>> 3]! >>> (7 - (bit & 7))) & 1) !== 0;
        g.m[y]![x] = on;
        bit += 1;
      }
    }
  }

  // ④ القناعُ الأقلُّ عقوبة — والاختيارُ إلزاميٌّ في المعيار لا تحسينٌ اختياريّ
  let best = -1;
  let bestScore = Infinity;
  let bestGrid: boolean[][] | null = null;
  for (let mask = forceMask ?? 0; mask < (forceMask !== undefined ? forceMask + 1 : 8); mask += 1) {
    const t: Grid = {
      size: g.size,
      m: g.m.map((r) => [...r]),
      fixed: g.fixed,
    };
    for (let y = 0; y < g.size; y += 1) {
      for (let x = 0; x < g.size; x += 1) {
        if (!g.fixed[y]![x] && maskAt(mask, x, y)) t.m[y]![x] = !t.m[y]![x];
      }
    }
    drawFormat(t, ec, mask);
    const sc = penalty(t);
    if (sc < bestScore) { bestScore = sc; best = mask; bestGrid = t.m; }
  }
  void best;
  return bestGrid!;
}

/**
 * المصفوفةُ صفوفَ أصفارٍ وآحاد — شكلٌ يمرّ في JSON ويُرسم `rect`ات في الواجهة.
 *
 * ⚠️ ولا SVG جاهزاً من الخادم: نصُّ SVG يحتاج `dangerouslySetInnerHTML` عند
 *    الرسم، وهو سطحُ حقنٍ لا داعيَ له — والمصفوفةُ أرقامٌ لا ترسم إلّا مربّعات.
 */
export function qrRows(text: string, ec: EcLevel = 'M'): string[] {
  return qrMatrix(text, ec).map((row) => row.map((c) => (c ? '1' : '0')).join(''));
}

export { EC_ORDER };

/** مكشوفٌ للاختبار وحده: يقارن الحارسُ نواتجَه بمرجعٍ مستقلّ. */
export const __forTest = { rsRemainder, rsGenerator, dataCodewords, rawDataModules, alignPositions };

