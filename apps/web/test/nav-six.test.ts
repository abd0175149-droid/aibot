import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ تسعُ وجهاتٍ صارت ستّةَ بنود (خطّة الواجهات، ٢٦ أيلول): الشاشاتُ المتلازمةُ
 *   تحت بندٍ واحدٍ بتبويبات. والحارسُ يمنع أمرين: عودةَ البنود التسعة، وشاشةً
 *   تسقط من التنقّل كلّه حين تُجمَع.
 */
const SRC = join(__dirname, '..', 'src');
const LAYOUT = readFileSync(join(SRC, 'app', 'app', 'layout.tsx'), 'utf8');
const SHELL = readFileSync(join(SRC, 'components', 'Shell.tsx'), 'utf8');
const navBlock = LAYOUT.slice(LAYOUT.indexOf('const nav: NavItem[] = ['), LAYOUT.indexOf('];', LAYOUT.indexOf('const nav: NavItem[] = [')));

describe('التنقّلُ ستّةُ بنود', () => {
  it('★ ستّةُ بنودٍ بالترتيب', () => {
    const labels = [...navBlock.matchAll(/href: '[^']+', label: '([^']+)', icon/g)].map((m) => m[1]);
    expect(labels).toEqual(['الرئيسيّة', 'المحادثات', 'البوت', 'الزبائن', 'الأداء', 'الإعدادات']);
  });

  it('★★ ولا شاشةَ تسقط: كلُّ الوجهات التسع بندٌ أو تبويب', () => {
    const hrefs = new Set([...navBlock.matchAll(/href: '([^']+)'/g)].map((m) => m[1]));
    for (const h of ['/app', '/app/inbox', '/app/bot', '/app/playground', '/app/contacts', '/app/reports', '/app/usage', '/app/channels', '/app/team']) {
      expect(hrefs.has(h), h).toBe(true);
    }
  });

  it('★ والبندُ نشطٌ على تبويباته، وصفُّ التبويب روابطُ حقيقيّة', () => {
    expect(SHELL).toMatch(/tabsOf\(n\)\.map\(\(t\) => \(hits\(t\.href\)/);
    expect(SHELL).toMatch(/<nav className="subnav"/);
    expect(SHELL).toMatch(/<Link key=\{t\.href\} href=\{t\.href\} className="subnav-i"/);
  });
});
