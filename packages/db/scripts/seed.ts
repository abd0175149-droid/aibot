import { getDb, closeDb, plans, prices, users, tenants, botConfigs, subscriptions, sql } from '../src/index';
import { SEED_PRICES } from '../../ai/src/pricing';
import { hashPassword } from './hash';

/**
 * بذرة الإقلاع — تُشغَّل مرّةً بعد الترحيل الأوّل.
 *
 * تكتب ما يجب أن يكون في القاعدة قبل أوّل عميل: الباقات الثلاث، أسعار
 * النماذج، وحساب مالك المنصّة. وهي متَماثِلة: تشغيلها مرّتين لا يُنتج تكراراً.
 */

const PLANS = [
  {
    name: 'بداية', priceMonthly: '20.00',
    limits: { windows: 300, aiTokens: 5_000_000, kbChars: 20_000, seats: 2,
              customTools: 1, retentionDays: 60, dailySendCap: 200, contacts: 2000 },
    overagePolicy: 'handoff_only' as const, sort: 1,
  },
  {
    name: 'نموّ', priceMonthly: '45.00',
    limits: { windows: 1500, aiTokens: 25_000_000, kbChars: 80_000, seats: 5,
              customTools: 5, retentionDays: 180, dailySendCap: 800, contacts: 10_000 },
    overagePolicy: 'handoff_only' as const, sort: 2,
  },
  {
    name: 'أعمال', priceMonthly: '95.00',
    limits: { windows: 5000, aiTokens: 80_000_000, kbChars: 300_000, seats: 15,
              customTools: 20, retentionDays: 365, dailySendCap: 8000, contacts: 50_000 },
    overagePolicy: 'allow_bill' as const, sort: 3,
  },
];

async function main() {
  const db = getDb();

  for (const p of PLANS) {
    await db.insert(plans).values(p).onConflictDoNothing();
  }
  console.log(`✔ الباقات: ${PLANS.length}`);

  for (const p of SEED_PRICES) {
    await db.insert(prices).values({
      provider: p.provider, model: p.model,
      input: String(p.input), output: String(p.output),
      cachedInput: p.cachedInput === null ? null : String(p.cachedInput),
    }).onConflictDoNothing();
  }
  console.log(`✔ أسعار النماذج: ${SEED_PRICES.length}`);

  const email = (process.env.OWNER_EMAIL ?? 'owner@aibot.local').toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  if (!password) {
    console.log('⚠ OWNER_PASSWORD غير مضبوط — لم يُنشأ حساب مالك المنصّة.');
    console.log('  شغّل:  OWNER_EMAIL=… OWNER_PASSWORD=… pnpm --filter @aibot/db run seed');
  } else {
    await db.insert(users).values({
      email, passwordHash: await hashPassword(password),
      name: 'مالك المنصّة', role: 'platform_owner', tenantId: null,
    }).onConflictDoNothing();
    console.log(`✔ مالك المنصّة: ${email}`);
  }

  await closeDb();
}

main().catch(async (e) => {
  console.error('فشلت البذرة:', e);
  await closeDb();
  process.exit(1);
});
