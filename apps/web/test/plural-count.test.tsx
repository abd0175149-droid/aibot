/** @jsxRuntime automatic @jsxImportSource react */
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../src/lib/useApi', () => ({ fmt: { num: (n: number) => String(n) } }));
import { Count, ACCOUNTS, SESSIONS } from '../src/lib/plural';

/** ★ العددُ يسقط في المفرد والمثنّى، ويُكتب في `.num` فيما عداهما. */
const txt = (n: number, f = ACCOUNTS) => renderToStaticMarkup(<Count n={n} f={f} />).replace(/<[^>]+>/g, '');

describe('Count', () => {
  it('المفردُ والمثنّى بلا رقم', () => {
    expect(txt(1)).toBe('حساب واحد');
    expect(txt(2)).toBe('حسابان');
  });
  it('٣–١٠ جمعٌ، و١١+ مفردٌ منصوب، والصفرُ جمع', () => {
    expect(txt(5, SESSIONS)).toBe('5 جلسات');
    expect(txt(12)).toBe('12 حسابا');
    expect(txt(0)).toBe('0 حسابات');
    expect(txt(103, SESSIONS)).toBe('103 جلسات');
  });
  it('والرقمُ في `.num`', () => {
    expect(renderToStaticMarkup(<Count n={7} f={ACCOUNTS} />)).toContain('<span class="num">7</span>');
  });
});
