import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ ورقةُ العميل في لوحة المالك: ثلاثةُ تبويبات، والأحمرُ لما لا رجعةَ فيه وحده
 *   (خطّة الواجهات، المرحلة ٤). كان عموداً واحداً فيه ستّةُ أزرارٍ في الذيل،
 *   وإعادةُ كلمة المرور بالأحمر نفسِه الذي يُسكت بوتاً عن زبائنه.
 */
const PAGE = readFileSync(join(__dirname, '..', 'src', 'app', 'console', 'page.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

describe('ورقةُ العميل', () => {
  it('★ ثلاثةُ تبويبات', () => {
    for (const l of ['نظرة عامّة', 'الإعداد', 'الحالة والخطر']) expect(PAGE).toContain(`label: '${l}'`);
    expect(PAGE).toMatch(/setSheetTab\('over'\)/);
  });

  it('★★ الأحمرُ لزرَّين فقط: الإيقافُ والأرشفة', () => {
    expect((PAGE.match(/variant="danger"/g) ?? []).length).toBe(2);
    const reset = PAGE.slice(PAGE.indexOf('أعد كلمة مرور مالكه'), PAGE.indexOf('ولّد كلمة مؤقّتة'));
    expect(reset).not.toContain('danger');
    expect(reset).not.toContain('cn-gate');
  });

  it('★ والجدولُ خمسةُ أعمدة', () => {
    const cols = PAGE.slice(PAGE.indexOf('const columns: Array<Column<TenantRow>>'), PAGE.indexOf('];', PAGE.indexOf('const columns: Array<Column<TenantRow>>')));
    expect((cols.match(/head: '/g) ?? []).length).toBe(5);
  });
});
