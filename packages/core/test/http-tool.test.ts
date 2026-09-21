import { describe, it, expect } from 'vitest';
import {
  assertPublicUrl, renderTemplate, applyResponseMap, jsonPath, execHttpTool, LIMITS,
} from '../src/tools/http.js';

describe('منع SSRF — أدوات العميل ناقلٌ بالتصميم', () => {
  const rejected = [
    ['http://api.client.com/x', 'HTTPS فقط'],
    ['https://127.0.0.1/x', 'المضيف المحلّيّ'],
    ['https://10.0.0.5/x', '10/8'],
    ['https://172.16.3.4/x', '172.16/12'],
    ['https://192.168.1.10/x', '192.168/16'],
    ['https://169.254.169.254/latest/meta-data', 'بيانات وصف السحابة'],
    ['https://[::1]/x', 'IPv6 محلّيّ'],
    ['https://localhost/x', 'localhost'],
    ['https://db.internal/x', 'نطاقٌ داخليّ'],
    ['https://api.client.com:8080/x', 'منفذٌ غير 443'],
    ['https://100.64.0.1/x', 'CGNAT'],
    ['https://[::ffff:10.0.0.1]/x', 'رابعٌ متنكّرٌ في سادس'],
  ] as const;

  for (const [url, why] of rejected) {
    it(`يرفض ${why}`, async () => {
      await expect(assertPublicUrl(url)).rejects.toThrow();
    });
  }

  it('يقبل عنواناً عامّاً على HTTPS', async () => {
    const u = await assertPublicUrl('https://example.com/orders/12');
    expect(u.hostname).toBe('example.com');
  });

  it('التنفيذ يرجع خطأً مفهوماً لا استثناءً عند عنوانٍ خاصّ', async () => {
    const r = await execHttpTool(
      { method: 'GET', url: 'https://127.0.0.1/orders/{{id}}' },
      { id: '4471' }, {}, null,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/خاصّ|محلّيّ/);
  });

  it('المهلة محدودةٌ بثماني ثوانٍ مهما طلبت الأداة', () => {
    expect(LIMITS.timeoutMs).toBe(8000);
    expect(LIMITS.maxBytes).toBe(262144);
    expect(LIMITS.maxRedirects).toBe(3);
  });
});

describe('القوالب — والأسرار لا تُرى إلّا في الطلب الخارج', () => {
  it('يستبدل الوسائط والأسرار', () => {
    const out = renderTemplate('Bearer {{secret.API_KEY}} / {{order_id}}',
      { order_id: '4471' }, { API_KEY: 'sk-live-xyz' });
    expect(out).toBe('Bearer sk-live-xyz / 4471');
  });

  it('سرٌّ غير معرَّف يصير فراغاً لا اسم المتغيّر', () => {
    expect(renderTemplate('{{secret.NOPE}}', {}, {})).toBe('');
  });

  it('وسيطٌ غائب يصير فراغاً — لا "undefined" في رابطٍ حقيقيّ', () => {
    expect(renderTemplate('/orders/{{id}}', {}, {})).toBe('/orders/');
  });
});

describe('response_map — إرجاع الاستجابة كاملةً يُغرق السياق', () => {
  const data = {
    data: { state: 'قيد التحضير', eta: '35 دقيقة', total: 24.5, items: [{ id: 'a' }, { id: 'b' }] },
    debug: { internalToken: 'يجب ألّا يصل النموذج' },
  };

  it('يستخرج الحقول المختارة وحدها', () => {
    const m = applyResponseMap(data, { status: '$.data.state', eta: '$.data.eta', total: '$.data.total' });
    expect(m).toEqual({ status: 'قيد التحضير', eta: '35 دقيقة', total: 24.5 });
    expect(JSON.stringify(m)).not.toContain('internalToken');
  });

  it('يفهم الفهارس', () => {
    expect(jsonPath(data, '$.data.items[1].id')).toBe('b');
  });

  it('مسارٌ غير موجود يُرجع undefined لا يرمي', () => {
    expect(jsonPath(data, '$.nope.deep[3]')).toBeUndefined();
  });
});
