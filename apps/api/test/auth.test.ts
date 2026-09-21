import { describe, it, expect, beforeAll } from 'vitest';
import {
  hashPassword, verifyPassword, signAccess, verifyAccess,
  PERMISSIONS, refreshCookie, clearRefreshCookie, readRefreshCookie,
} from '../src/auth.js';

beforeAll(() => { process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long!!'; });

describe('كلمات السرّ', () => {
  it('تتحقّق من الصحيحة وترفض الخاطئة', async () => {
    const h = await hashPassword('كلمة-سرّ-قويّة-123');
    expect(await verifyPassword('كلمة-سرّ-قويّة-123', h)).toBe(true);
    expect(await verifyPassword('كلمة-سرّ-خاطئة', h)).toBe(false);
  });

  it('لا تُنتج نفس التجزئة مرّتين — ملحٌ عشوائيّ لكلّ كلمة', async () => {
    expect(await hashPassword('x')).not.toBe(await hashPassword('x'));
  });

  it('لا تنهار على تجزئةٍ مشوّهة', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});

describe('توكن الوصول', () => {
  const claims = { sub: 'u1', tid: 't1', role: 'tenant_owner' as const, sid: 's1' };

  it('يوقّع ويتحقّق', () => {
    const c = verifyAccess(signAccess(claims));
    expect(c).toMatchObject(claims);
  });

  it('يرفض توقيعاً مزوَّراً', () => {
    const t = signAccess(claims);
    const parts = t.split('.');
    expect(verifyAccess(`${parts[0]}.${parts[1]}.AAAA${parts[2]!.slice(4)}`)).toBeNull();
  });

  it('يرفض حمولةً عُدِّلت بعد التوقيع — لا ترقية دورٍ بتحرير النصّ', () => {
    const t = signAccess(claims);
    const [h, , s] = t.split('.');
    const tampered = Buffer.from(JSON.stringify({ ...claims, role: 'platform_owner', exp: 9e9 }))
      .toString('base64url');
    expect(verifyAccess(`${h}.${tampered}.${s}`)).toBeNull();
  });

  it('يرفض المنتهي', () => {
    expect(verifyAccess(signAccess(claims, -1))).toBeNull();
  });

  it('يرفض المشوّه بلا رمي', () => {
    for (const t of ['', 'a', 'a.b', 'a.b.c']) expect(verifyAccess(t)).toBeNull();
  });
});

describe('الصلاحيّات', () => {
  it('الموظّف يردّ ولا يضبط ولا يرى فوترة', () => {
    expect(PERMISSIONS.tenant_agent).toEqual({ write: true, settings: false, billing: false, console: false });
  });

  it('مالك الحساب لا يرى لوحة المالك', () => {
    expect(PERMISSIONS.tenant_owner.console).toBe(false);
    expect(PERMISSIONS.tenant_owner.settings).toBe(true);
  });

  it('مالك المنصّة يرى كلّ شيء', () => {
    expect(Object.values(PERMISSIONS.platform_owner).every(Boolean)).toBe(true);
  });
});

describe('كوكي التحديث', () => {
  it('HttpOnly و Secure و SameSite ومقصورةٌ على مسار المصادقة', () => {
    const c = refreshCookie('abc');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/api/auth'); // لا تُرسل مع كلّ طلب
  });

  it('المسح يصفّر العمر', () => {
    expect(clearRefreshCookie()).toContain('Max-Age=0');
  });

  it('يقرأ الكوكي من بين غيره', () => {
    expect(readRefreshCookie('other=1; aibot_rt=TOKEN123; more=2')).toBe('TOKEN123');
    expect(readRefreshCookie('other=1')).toBeNull();
    expect(readRefreshCookie(undefined)).toBeNull();
  });
});
