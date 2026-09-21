import { customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * اصطلاحات ملزِمة (06-data-model + 03-قناتان في نظامٍ واحد):
 *  • المفاتيح uuid v7 — مرتَّبة زمنيّاً فتُبقي الفهارس متراصّة.
 *  • التواريخ timestamptz بالـUTC. العرض بتوقيت المستأجر لا التخزين.
 *  • كلّ جدولٍ مستأجَر: tenant_id NOT NULL + ON DELETE CASCADE + RLS — من الترحيل الأوّل.
 *  • كلّ فهرسٍ مركَّب يبدأ بـtenant_id.
 *  • numeric للنقود والكلفة — لا float أبداً.
 */

/** دالّة uuid v7 تُنشأ في الترحيل الأوّل — راجع migrations/0000_init.sql */
export const uuid7 = sql`gen_uuid_v7()`;
export const now = sql`now()`;

/**
 * pgvector — بُعد 768.
 * يطابق `gemini-embedding-001` بعد اقتطاع Matryoshka وتطبيع L2.
 * ⚠️ تغيير هذا البُعد أو نموذج التضمين = إعادة تضمينٍ كاملة، لا ترقيةٌ تدريجيّة.
 */
export const vector768 = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector(768)',
  toDriver: (v) => `[${v.join(',')}]`,
  fromDriver: (v) => JSON.parse(v) as number[],
});
