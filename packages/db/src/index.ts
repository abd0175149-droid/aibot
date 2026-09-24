export * from './schema.js';
export * from './client.js';
export * from './tenant.js';
export { sql, eq, ne, and, or, not, desc, asc, isNull, isNotNull, inArray, notInArray, lt, gt, gte, lte } from 'drizzle-orm';

/* نوعُ ما يُلصَق في قالب `sql`: عمودٌ أو مقتطف. ويُصدَّر من هنا لأنّ التطبيقات
   لا تعتمد `drizzle-orm` مباشرةً — وحزمةُ القاعدة هي بابُها الوحيد إليها. */
export type { SQLWrapper } from 'drizzle-orm';
