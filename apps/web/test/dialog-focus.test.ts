import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★★★ **حقلٌ في نافذةٍ منبثقةٍ كان يقبل حرفاً واحداً.**
 *
 *   `useDialogFocus` كان يضع `onClose` في تبعيّات تأثيره، والمستدعون يمرّرونها
 *   دالّةً مضمَّنة تتجدّد مع كلّ رسم. فكلُّ ضغطةٍ تُعيد التأثير: التنظيفُ يُرجع
 *   التركيزَ إلى زرّ الفتح، والتشغيلُ يضعه على العنوان — والحقلُ يفقده. رُئي حيّاً
 *   في معالج «عميل جديد»: لا بريدَ يُكتب ولا اسمَ بمسافة (٢٦ أيلول).
 */
const src = readFileSync(join(__dirname, '..', 'src', 'components', 'ui', 'index.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('تركيزُ النافذة المنبثقة لا يُسرق مع كلّ رسم', () => {
  const at = src.indexOf('function useDialogFocus(');
  const body = src.slice(at, src.indexOf('\n}\n', at));

  it('الدالّةُ موجودة — وإلّا مرّ الحارسُ على الفراغ', () => {
    expect(at).toBeGreaterThan(0);
    expect(body).toContain("document.addEventListener('keydown', onKey, true);");
  });

  it('★ `onClose` تُقرأ من مرجع، والتأثيرُ يتبع الفتحَ وحده', () => {
    expect(body).toContain('const closeRef = useRef(onClose);');
    expect(body).toContain('closeRef.current();');
    expect(body).toMatch(/\}, \[open, focusables\]\);/);
    expect(body).not.toMatch(/\[open, onClose/);
  });
});

describe('★ خطأُ الخادم بصيغة `{ error: "نصّ", issues, hint }` يصل إلى الشاشة', () => {
  /* رُئي حيّاً: ميتا رفضت توكناً (٤٢٢) والمعالجُ قال «صار خطأ عندنا». */
  const api = readFileSync(join(__dirname, '..', 'src', 'lib', 'api.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('القارئُ يعرف الشكلين ويُرفق الجسم', () => {
    expect(api).toContain("if (typeof j.error === 'string') {");
    expect(api).toContain('message = j.error;');
    expect(api).toContain('throw new ApiError(code, message, res.status, body);');
    expect(api).toContain('readonly body?: Record<string, unknown>,');
  });
  it('والنموذجان يقرآن `e.body` لا حقلاً وهميّاً', () => {
    for (const f of ['Onboarding.tsx', 'ChannelConnectForm.tsx']) {
      const s = readFileSync(join(__dirname, '..', 'src', 'components', f), 'utf8');
      expect(s, f).toContain('e.body as { issues?: string[]; hint?: string } | undefined');
      expect(s, f).not.toContain('(e as unknown as { body?:');
    }
  });
});

describe('★ ورقتان مفتوحتان: العليا تُرى وتملك المفاتيح', () => {
  /* رُئي حيّاً: «اربط/جدّد القناة…» و«ابذر بوته…» في ورقة العميل تفتحان ورقتَيهما تحتها. */
  const page = readFileSync(join(__dirname, '..', 'src', 'app', 'console', 'page.tsx'), 'utf8');
  it('ورقتا الربط والبذر بعد ورقة العميل في الشجرة', () => {
    const client = page.indexOf('ورقةُ العميل: الوِجهةُ التي لم تكن');
    const connect = page.indexOf('endpoint={`/console/tenants/${connectFor}/channel/connect`}');
    const seed = page.indexOf('endpoint={`/console/tenants/${seedFor}/bot/seed`}');
    expect(client).toBeGreaterThan(0);
    expect(connect).toBeGreaterThan(client);
    expect(seed).toBeGreaterThan(client);
  });
  it('ومستمعُ المفاتيح يعمل للنافذة العليا وحدها', () => {
    const ui = readFileSync(join(__dirname, '..', 'src', 'components', 'ui', 'index.tsx'), 'utf8');
    expect(ui).toContain("if (open.length && open[open.length - 1] !== box.current) return;");
    expect(ui).toContain("w ? w.classList.contains('on')");
  });
});
