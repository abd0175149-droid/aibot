/**
 * الطورُ ①: يبذر صفّاً مشفَّراً بالمفتاح الحاليّ. جزءٌ من
 * `ops/drill-key-rotation.sh` — لا يُشغَّل وحده.
 *
 * ⚠️ ولا يُطبع السرُّ ولا المفتاح: يُطبع طولُ السرّ وإصدارُه لا غير.
 */
import { getDb, closeDb, withPlatform, sql, type Tx } from '../packages/db/src/index';
import { seal } from '../packages/crypto/src/index';
import { DRILL_SECRET, DRILL_TENANT as TENANT, DRILL_CHANNEL as CHANNEL } from './drill-rot-const';

async function main(): Promise<void> {
  const db = getDb();
  const s = seal(DRILL_SECRET);
  await withPlatform(db, 'تمرين التدوير: بذرُ صفٍّ مشفَّر', async (tx: Tx) => {
    await tx.execute(sql`
      INSERT INTO tenants (id, public_id, name, slug, status)
      VALUES (${TENANT}, 'ROTDRILLAAAAAAAAAAAAAAAAAA', 'تمرين التدوير', 'rot-drill', 'active')
      ON CONFLICT DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO tenant_channels
        (id, tenant_id, kind, external_account_id, display_name, status, token_enc, key_version)
      VALUES (${CHANNEL}, ${TENANT}, 'whatsapp_cloud', 'ROTDRILL', 'قناة', 'connected',
              ${s.enc}, ${s.keyVersion})
      ON CONFLICT (id) DO UPDATE
        SET token_enc = EXCLUDED.token_enc, key_version = EXCLUDED.key_version`);
  });
  console.log(`  ✔ بُذر صفٌّ بالإصدار ${s.keyVersion} (طولُ القيمة ${DRILL_SECRET.length})`);
}

main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error('  ✘ فشل البذر:', (e as Error).message);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
