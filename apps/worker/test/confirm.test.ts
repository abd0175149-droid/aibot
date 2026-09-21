import { describe, it, expect } from 'vitest';
import { isPendingStale } from '../src/reply';

/**
 * نمط الزرّ: النموذج يقترح، والمنصّة تنفّذ.
 *
 * العطل الذي وُلد منه هذا الملفّ: النصف المُرسِل للأزرار كان مبنيّاً والنصف
 * المنفّذ لم يُبنَ قطّ. الزبون يضغط «أكّد» فيصل `buttonPayload` ويُخزَّن في
 * `messages.payload` **ولا يقرأه أحد** — فلا `request_quote` تُنفَّذ ولا
 * `confirm_booking`، ثمّ يقول النموذج «تم تسجيل طلبك» وهو لم يُسجَّل.
 * رُصد على زبونٍ حقيقيّ على رقم LIVE.
 *
 * وهذه الدالّة هي الحدّ: الضغط وحده **لا يكفي** للتنفيذ.
 */
describe('صلاحيّة الإجراء المعلَّق — الضغط وحده لا يكفي', () => {
  const T0 = new Date('2026-09-21T20:00:00Z');
  const fresh = {
    key: 'request_quote',
    args: { type: 'عمرة', details: 'شخصين' },
    expiresAt: new Date('2026-09-21T21:00:00Z').toISOString(),
  };

  it('إجراءٌ طازجٌ مطابقٌ ⟵ يُنفَّذ', () => {
    expect(isPendingStale(fresh, 'request_quote', T0)).toBe(false);
  });

  it('لا إجراءَ محفوظ ⟵ لا تنفيذ (زرٌّ من محادثةٍ انتهت)', () => {
    expect(isPendingStale(null, 'request_quote', T0)).toBe(true);
    expect(isPendingStale(undefined, 'request_quote', T0)).toBe(true);
    expect(isPendingStale({}, 'request_quote', T0)).toBe(true);
  });

  it('★ الزرّ لا يطابق المحفوظ ⟵ لا تنفيذ', () => {
    // الزبون طلب تسعيراً، ثمّ طلب حجزاً، ثمّ ضغط زرّ التسعير القديم أعلى الشاشة.
    // بلا هذا الفحص يُنفَّذ الحجز بوسائط التسعير — أو العكس.
    expect(isPendingStale({ ...fresh, key: 'confirm_booking' }, 'request_quote', T0)).toBe(true);
  });

  it('★ انقضت الصلاحيّة ⟵ لا تنفيذ بوسائطٍ بائتة', () => {
    const old = { ...fresh, expiresAt: new Date('2026-09-21T19:59:59Z').toISOString() };
    expect(isPendingStale(old, 'request_quote', T0)).toBe(true);
  });

  it('لحظة الانقضاء نفسها تُرفَض — الحدّ مغلقٌ لا مفتوح', () => {
    const exactly = { ...fresh, expiresAt: T0.toISOString() };
    expect(isPendingStale(exactly, 'request_quote', T0)).toBe(true);
  });

  it('غياب expiresAt يُعامَل كصالح — لا رفضَ بأثرٍ رجعيّ لبياناتٍ أقدم من العمود', () => {
    expect(isPendingStale({ key: 'request_quote', args: {} }, 'request_quote', T0)).toBe(false);
  });
});
