import { describe, it, expect } from 'vitest';
import { safeNext } from '../src/lib/nav';

/**
 * ★ ثغرةٌ أمنيّة حقيقيّة كانت في شاشة الدخول: `?next=` يُمرَّر إلى
 *   `router.replace` كما جاء. فرابطٌ مصنوعٌ يقذف المستخدم خارج الموقع **بعد**
 *   ضبط توكن الوصول — وهي اللحظة التي يكون فيها أكثر استعداداً للثقة بالصفحة
 *   التالية، فيلصق كلمة سرّه في نسخةٍ مزيّفة من شاشتنا.
 *
 * وحارسٌ أمنيٌّ بلا اختبارٍ يُلغى بإعادة كتابةٍ حسنة النيّة بعد شهر.
 */
describe('حارس التحويل بعد الدخول', () => {
  it('يقبل المسار الداخليّ كما هو', () => {
    expect(safeNext('/app')).toBe('/app');
    expect(safeNext('/app/inbox')).toBe('/app/inbox');
    expect(safeNext('/console/incidents?id=7')).toBe('/console/incidents?id=7');
    expect(safeNext('/app/bot#kb')).toBe('/app/bot#kb');
  });

  it('★ يرفض العنوان المطلق ضمنيّ البروتوكول — أشيع تجاوزٍ لفحص «يبدأ بـ/»', () => {
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('//evil.example/login')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
  });

  it('يرفض العنوان المطلق الصريح', () => {
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('http://evil.example')).toBeNull();
  });

  it('يرفض مخطّطات التنفيذ ولو بدأت بشرطة', () => {
    expect(safeNext('/javascript:alert(1)')).toBeNull();
    expect(safeNext('javascript:alert(1)')).toBeNull();
    expect(safeNext('data:text/html,<script>')).toBeNull();
  });

  it('يرفض محارف التحكّم — تقسيم الردّ', () => {
    expect(safeNext('/app\nLocation: https://evil.example')).toBeNull();
    expect(safeNext('/app\r\nSet-Cookie: x=1')).toBeNull();
    expect(safeNext('/app\u0000')).toBeNull();
  });

  it('الغياب والفراغ يُعاملان كـ«لا وجهة» لا كخطأ', () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext('')).toBeNull();
  });

  it('يرفض المسار النسبيّ بلا شرطة — يُحلّ على الصفحة الحاليّة لا على الجذر', () => {
    expect(safeNext('app/inbox')).toBeNull();
    expect(safeNext('../admin')).toBeNull();
  });
});
