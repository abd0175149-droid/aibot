import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TENANT_SCOPED, GLOBAL_TABLES } from '@aibot/db';
import { PERMISSIONS, signAccess, verifyAccess, requireAuth, tenantOf } from '../src/auth.js';
import type { FastifyRequest } from 'fastify';

/**
 * ★ **حرّاسُ العزل** — مكتوبون بعد مراجعةِ ٠٥.٩ على الخادم الحيّ، وكلُّ دعوى
 *   فيهم لها أثرٌ مقيسٌ لا احتمالٌ نظريّ.
 *
 * ما أثبته القياس (٢٣ أيلول ٢٠٢٦، `drill` و`drill-price` على الإنتاج):
 *  · **لا تسريبَ بين مستأجرَين** في أيّ نقطةٍ تأخذ معرّفاً — المحادثات
 *    والرسائل وجهاتُ الاتّصال والمعرفةُ والأدواتُ والفريق: ٤٠٤ أو صفرُ صفوف.
 *  · و**عطلٌ حقيقيٌّ في الإبلاغ**: خمسُ نقاطٍ كانت تردّ ٢٠٠ (وإحداها
 *    `{"ok":true}`) على معرّفٍ يملكه مستأجرٌ آخر. RLS منعت الكتابة فعلاً،
 *    والردُّ قال إنّها تمّت. وهذا الشكلُ بعينه يُخفي عطلَ سياقٍ حقيقيّاً
 *    يوماً: استعلامٌ بلا `app.tenant_id` يمسّ صفراً ويقول «تمّ».
 *
 * فالحرّاسُ أربعةُ طبقات:
 *  ① لا جدولَ مستأجَرٍ خارج `TENANT_SCOPED` (وهي مصدرُ ترحيل RLS نفسِه).
 *  ② لا نقطةَ تقرأ `tenantId` من الطلب — يُشتقّ من التوكن وحده.
 *  ③ كلّ مسارٍ يمسّ جدولاً مستأجَراً داخل `withTenant` أو `withPlatform`.
 *  ④ الانتحال قراءةٌ فقط، ولا نقطةَ تُبلّغ نجاحاً على صفرِ صفوف.
 */

beforeAll(() => { process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long!!'; });

const API_SRC = join(__dirname, '..', 'src');
const ROUTES_DIR = join(API_SRC, 'routes');

function maskComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

const routeFiles = readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'));
const routeSrc = new Map(routeFiles.map((f) => [f, readFileSync(join(ROUTES_DIR, f), 'utf8')]));
const routeCode = new Map([...routeSrc].map(([f, s]) => [f, maskComments(s)]));

/* ───────────────────────── ① القائمة كاملة ───────────────────────── */

describe('① كلُّ جدولٍ مستأجَرٍ في TENANT_SCOPED', () => {
  /**
   * ★ الجداولُ تُقرأ من **المخطّط** لا من قائمةٍ مكتوبةٍ بيد: جدولٌ يُضاف في
   *   `schema/` وينسى صاحبُه `TENANT_SCOPED` يسقط هنا — ولو نجح كلُّ شيءٍ آخر.
   *   وهذا هو العطلُ الذي لا يُرى في الإنتاج إلّا كتسريبٍ بين عميلين.
   */
  const schemaFiles = readdirSync(join(__dirname, '..', '..', '..', 'packages', 'db', 'src', 'schema'))
    .filter((f) => f.endsWith('.ts') && f !== '_common.ts');
  const declared = schemaFiles.flatMap((f) => {
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'packages', 'db', 'src', 'schema', f), 'utf8',
    );
    return [...src.matchAll(/pgTable\(\s*'([a-z_]+)'/g)].map((m) => m[1]!);
  });

  it('لا جدولَ في المخطّط خارج TENANT_SCOPED ولا GLOBAL_TABLES', () => {
    const known = new Set<string>([...TENANT_SCOPED, ...GLOBAL_TABLES]);
    expect(declared.filter((t) => !known.has(t))).toEqual([]);
  });

  it('ولا اسمَ في TENANT_SCOPED بلا جدولٍ يقابله', () => {
    const inSchema = new Set(declared);
    expect(TENANT_SCOPED.filter((t) => !inSchema.has(t))).toEqual([]);
  });

  it('★ الجداولُ العامّة أربعةٌ بالاسم — إضافةٌ خامسةٌ قرارٌ لا سهو', () => {
    expect([...GLOBAL_TABLES].sort()).toEqual(['plans', 'prices', 'sessions', 'tenants']);
  });
});

/* ───────────── ② المستأجر من التوكن لا من الطلب ───────────── */

describe('② المستأجرُ يُشتقّ من التوكن وحده', () => {
  it('`tenantOf` يقرأ المطالبة لا الجسم ولا المسار', () => {
    const req = { auth: verifyAccess(signAccess({ sub: 'u', tid: 't-1', role: 'tenant_owner', sid: 's' }))! };
    expect(tenantOf(req as unknown as FastifyRequest)).toBe('t-1');
  });

  it('مالكُ المنصّة بلا مستأجرٍ يُرفض من مسارات المستأجرين بـ٤٠٣', () => {
    const req = { auth: { sub: 'u', tid: null, role: 'platform_owner' as const, sid: 's', exp: 9e9 } };
    expect(() => tenantOf(req as unknown as FastifyRequest)).toThrowError(/لمستخدمي المستأجرين/);
  });

  it('★ لا مسارَ يقرأ معرّف المستأجر من جسمِ الطلب أو مسارِه', () => {
    /* قراءةٌ **مباشرة** فقط: `req.body.tenantId` وأخواتها وتفكيكُها. ولا يُوسَّع
       النمطُ إلى «السطر يحوي `req.x` و`tenantId`» — فذاك يُنذر كاذباً على سطرٍ
       يمزج فلتراً من الطلب بـ`tenantId` المشتقِّ من التوكن، وإنذارٌ كاذبٌ واحدٌ
       أسرعُ طريقٍ إلى إطفاء الحارس. */
    const direct = /req\s*\.\s*(?:body|query|params)\s*\??\s*\.\s*tenantId/gi;
    // `[^}\n]` لا `[^}]`: الثاني يعبر الأسطر فيصطاد قوساً في دالّةٍ أعلى بلا علاقة
    const destructured = /\{[^}\n]*\btenantId\b[^}\n]*\}\s*=\s*req\s*\.\s*(?:body|query|params)/gi;
    const offenders: string[] = [];
    for (const [f, code] of routeCode) {
      const bad = [...code.matchAll(direct), ...code.matchAll(destructured)].map((m) => m[0]);
      if (bad.length) offenders.push(`${f}: ${bad.join(' | ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('★ ولا `tenantId` في مخطّطات أجسامِ الطلبات', () => {
    for (const [f, code] of routeCode) {
      expect(code, f).not.toMatch(/Body:\s*\{[^}]*tenantId/);
    }
  });
});

/* ───────────── ③ كلّ مسّ للجداول خلف بوّابة ───────────── */

describe('③ لا استعلامَ على المقبض العاري', () => {
  /**
   * ★ الفشلُ الصامتُ الذي يجعل هذا الحارس ضروريّاً: استعلامٌ على `db` بدور
   *   `aibot_app` **يعيد صفر صفوفٍ بلا خطأ**. فسكربتُ تهيئةٍ يقول «تمّ» ولا
   *   يكتب شيئاً، ونقطةُ قراءةٍ تقول «لا نتائج» على بياناتٍ موجودة.
   */
  it('لا `getDb().select/insert/update/delete` مباشرةً في المسارات', () => {
    for (const [f, code] of routeCode) {
      expect(code, f).not.toMatch(/getDb\(\)\s*\.\s*(select|insert|update|delete)/);
    }
  });

  it('★ وكلُّ نداءٍ لـ`withPlatform` يحمل سبباً مكتوباً لا فراغاً', () => {
    for (const [f, code] of routeCode) {
      for (const m of code.matchAll(/withPlatform\(\s*[^,]+,\s*(['"`])((?:[^'"`\\]|\\.)*)\1/g)) {
        expect(m[2]!.trim().length, `${f}: ${m[0]}`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('★ ولا `withPlatform` في إدارة الفريق — ليست فعلاً عابراً للمستأجرين', () => {
    expect(routeCode.get('team.ts')).not.toContain('withPlatform');
  });
});

/* ───────────── ④ الانتحال ونجاحُ صفرِ الصفوف ───────────── */

/** يُنفّذ الـpreHandler بطلبٍ مُصطنع ويعيد الخطأ إن رُمي. */
async function run(
  hook: ReturnType<typeof requireAuth>,
  method: string,
  token: string,
): Promise<{ status: number; message?: string } | { status: 200 }> {
  const req = { method, headers: { authorization: `Bearer ${token}` } } as unknown as FastifyRequest;
  try {
    await hook(req, {} as never);
    return { status: 200 };
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return { status: err.status ?? 500, message: err.message };
  }
}

describe('④ الانتحالُ قراءةٌ فقط — مفروضٌ في الكود لا في الواجهة', () => {
  const base = { sub: 'owner', tid: 't-1', role: 'platform_owner' as const, sid: 's' };
  const plain = () => signAccess(base);
  const imp = () => signAccess({ ...base, imp: 't-1' });

  it('توكنٌ بلا انتحالٍ يكتب', async () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await run(requireAuth(), m, plain())).status, m).toBe(200);
    }
  });

  it('★ توكنُ انتحالٍ يقرأ', async () => {
    for (const m of ['GET', 'HEAD']) {
      expect((await run(requireAuth(), m, imp())).status, m).toBe(200);
    }
  });

  it('★ وتوكنُ انتحالٍ يُرفض بـ٤٠٣ على كلّ فعلٍ كاتب — ولو كان الدور يسمح', async () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await run(requireAuth(), m, imp());
      expect(r.status, m).toBe(403);
      expect((r as { message: string }).message).toMatch(/قراءةٌ فقط/);
    }
  });

  it('★ والرفضُ لا يُلتَفُّ عليه بدورٍ أعلى ولا ببوّابةِ لوحةِ المالك', async () => {
    const r = await run(requireAuth({ console: true, settings: true, billing: true }), 'POST', imp());
    expect(r.status).toBe(403);
  });

  it('المطالبةُ مُعلَنةٌ في الواجهة أيضاً — `/me` تُرجع `impersonating`', () => {
    expect(maskComments(readFileSync(join(API_SRC, 'auth.ts'), 'utf8')))
      .toContain('impersonating');
  });

  it('لا دورَ يملك كتابةً ولا يملكها في المصفوفة — الأدوارُ ثلاثةٌ بالاسم', () => {
    expect(Object.keys(PERMISSIONS).sort())
      .toEqual(['platform_owner', 'tenant_agent', 'tenant_owner']);
    expect(PERMISSIONS.tenant_agent.settings).toBe(false);
    expect(PERMISSIONS.tenant_owner.console).toBe(false);
  });
});

describe('★ ٤٠٤ على صفرِ صفوفٍ — لا «تمّ» على فعلٍ لم يحدث', () => {
  /**
   * الخمسُ نقاطٍ التي قِيست على الخادم وهي تردّ ٢٠٠ على معرّف مستأجرٍ آخر:
   *   POST /conversations/:id/read · /bot · /tags
   *   DELETE /bot/tools/:id · /bot/knowledge/files/:id
   */
  const inbox = routeCode.get('inbox.ts')!;
  const bot = routeCode.get('bot.ts')!;

  it('مساراتُ المحادثةِ الثلاثةُ تمرّ بحارسٍ يرمي ٤٠٤', () => {
    // `/bot` و`/read` وقراءةُ الوسوم وكتابتُها = أربعةُ نداءات
    expect(inbox.match(/orMissing\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(inbox).toMatch(/orMissing[\s\S]{0,200}404/);
  });

  it('★ ولا صفَّ يُبَثُّ قبل الحارس — لا `undefined` يصل غرفةَ المستأجر', () => {
    /* الشكلُ الذي كان يبثّ الفراغ: `const [row] = await tx.update(conversations)`
       ثمّ بثٌّ مباشر — فتفكيكُ أوّلِ عنصرٍ من تحديث المحادثات ممنوعٌ هنا. */
    expect(inbox).not.toMatch(/const\s*\[\s*row\s*\]\s*=\s*await\s*tx\s*\.\s*update\(conversations\)/);
    expect(inbox).toContain('const row = orMissing(');
    // وكلُّ ما يُبَثّ هو `row` الذي مرّ بالحارس
    for (const m of inbox.matchAll(/emitToTenant\(([^\n]*)\)/g)) {
      expect(m[1]!, m[0]).toMatch(/,\s*row\s*$/);
    }
  });

  it('حذفُ الأداة يتحقّق من `returning()` قبل أن يقول `ok`', () => {
    expect(bot).toMatch(/delete\(botTools\)[\s\S]{0,200}returning\(/);
    expect(bot).toMatch(/gone\.length[\s\S]{0,120}404/);
  });

  it('حذفُ مصدرِ المعرفة يرمي ٤٠٤ قبل أن يمسّ ملفّاً', () => {
    const i404 = bot.indexOf("'مصدرٌ غير موجود', 404");
    const iDel = bot.indexOf('delete(knowledgeSources)');
    expect(i404).toBeGreaterThan(-1);
    expect(iDel).toBeGreaterThan(i404);
  });
});
