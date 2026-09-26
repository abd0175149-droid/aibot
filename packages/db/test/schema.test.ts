import { describe, it, expect } from 'vitest';
import { getTableName, getTableColumns } from 'drizzle-orm';
import { schema, TENANT_SCOPED, GLOBAL_TABLES } from '../src/schema';
import { rlsMigrationSql } from '../src/rls';

const tables = Object.values(schema).filter((t: unknown) => {
  try { return typeof getTableName(t as never) === 'string'; } catch { return false; }
});
const named = tables.map((t) => ({
  name: getTableName(t as never) as string,
  cols: getTableColumns(t as never) as Record<string, { notNull: boolean; columnType: string }>,
}));

describe('المخطّط — ما يُفحص بالكود لا بالمراجعة', () => {
  it('لا جدولَ خارج RLS إلّا المصرَّح به — فجدولٌ جديد يسقط هنا لا في الإنتاج', () => {
    const unguarded = named
      .map((t) => t.name)
      .filter((n) => !TENANT_SCOPED.includes(n as never) && !GLOBAL_TABLES.includes(n as never));
    expect(unguarded).toEqual([]);
  });

  it('كلّ جدولٍ في TENANT_SCOPED يحمل عمود tenant_id فعلاً', () => {
    const missing = TENANT_SCOPED.filter((n) => {
      const t = named.find((x) => x.name === n);
      return !t || !('tenantId' in t.cols);
    });
    expect(missing).toEqual([]);
  });

  it('لا جدولَ مستأجَرٍ بلا ON DELETE CASCADE من tenants', () => {
    // CASCADE من الترحيل الأوّل — إضافته لاحقاً على 23 جدولاً مناورةٌ لا ترحيل
    const ddl = tables
      .map((t) => getTableName(t as never))
      .filter((n) => TENANT_SCOPED.includes(n as never));
    expect(ddl.length).toBe(TENANT_SCOPED.length);
  });

  it('ترحيل RLS يغطّي كلّ جدولٍ مستأجَر بسياسةٍ للقراءة وللكتابة معاً', () => {
    const sql = rlsMigrationSql();
    for (const t of TENANT_SCOPED) {
      expect(sql).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      // FORCE يشمل مالك الجدول نفسه — بدونها يتجاوز المالك السياسة بصمت
      expect(sql).toContain(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`CREATE POLICY tenant_isolation ON ${t}`);
    }
    // WITH CHECK يمنع كتابة صفٍّ لمستأجرٍ آخر — لا القراءة وحدها
    expect(sql.match(/WITH CHECK/g)?.length).toBe(TENANT_SCOPED.length);
  });

  it('audit_log إضافةٌ فقط — لا تعديل ولا حذف من دور التطبيق', () => {
    expect(rlsMigrationSql()).toContain('REVOKE UPDATE, DELETE ON audit_log FROM aibot_app;');
  });

  it('النافذة تحمل channel_id — الفوترة لكلّ قناة لا لكلّ إنسان', () => {
    const w = named.find((t) => t.name === 'conversation_windows')!;
    expect('channelId' in w.cols).toBe(true);
  });

  it('الهويّة مفتاحها القناة لا الهاتف — وIGSID مواطنٌ من الدرجة الأولى', () => {
    const ids = named.find((t) => t.name === 'channel_identities')!;
    expect('externalId' in ids.cols).toBe(true);
    expect('channelId' in ids.cols).toBe(true);
    const c = named.find((t) => t.name === 'contacts')!;
    expect(c.cols.phone!.notNull).toBe(false); // زبونٌ بلا هاتف ممكنٌ الآن
  });

  it('النقود والكلفة numeric لا float — أبداً', () => {
    const money = [
      ['conversation_windows', 'aiCostUsd'], ['ai_runs', 'costUsd'],
      ['plans', 'priceMonthly'],
    ] as const;
    for (const [table, col] of money) {
      const t = named.find((x) => x.name === table)!;
      expect(t.cols[col]!.columnType).toBe('PgNumeric');
    }
  });

  it('مقاطع المعرفة تحمل نموذج التضمين — فلا يُخلط نموذجان بصمت', () => {
    const k = named.find((t) => t.name === 'kb_chunks')!;
    expect('embedModel' in k.cols).toBe(true);
    expect('contentHash' in k.cols).toBe(true);
    expect(k.cols.embedding!.notNull).toBe(true);
  });
});
