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
