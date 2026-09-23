/**
 * تمرين الفشل (ج): **املأ القرص — ضغطٌ حقيقيٌّ بلا أن يُعطب الخادم.**
 *
 * ⚠️ `/` على هذا الخادم ممتلئٌ ٧٥٪ (١١٤ جيجا حرّة) وفيه ٥٩ حاوية لتطبيقاتٍ
 *    أخرى. فملءُ `/` ليس تمريناً بل حادثة. ولذلك **لا يُملأ `/` إطلاقاً**:
 *    التمرين يبني مِنصَّةً معزولةً صغيرة ويملأها.
 *
 * ما يُبنى بالضبط:
 *  ① مجلَّدٌ من نوع `tmpfs` بحجمٍ محدود (افتراضاً 64 ميجا) — في الذاكرة، فلا
 *     بايتَ واحدٍ يُكتب على `/`، والحدّ يفرضه النظام لا انتباهُنا.
 *  ② ريدِسٌ ثانٍ (`drill-redis`) مجلّدُ بياناته ذاك الـtmpfs، وبنفس إعداد
 *     الإنتاج: `appendonly yes` و`appendfsync everysec`.
 *  ③ عاملٌ ثانٍ من **نفس صورة الإنتاج ونفس أمرها**، لا يختلف إلّا في
 *     `REDIS_URL` — فالمقيس هو كود الإنتاج لا نسخةٌ منه.
 *
 * وريدِسُ الإنتاج وقاعدتُه لا يُمَسّان: المستأجرَان الحقيقيّان يعملان أثناء
 * التمرين كلّه. ثمّ يُملأ الـtmpfs حتّى يرفض ريدِس الكتابة (`MISCONF`)، ويُقاس:
 *
 *  ① **هل يتعافى؟** بعد تحرير المساحة، هل تعود الكتابة والمعالجة وحدهما؟
 *  ② **هل يُنتج حادثةً؟** صفٌّ في `incidents` عن طابورٍ لا يقبل الكتابة؟
 *  ③ **هل ضاع شيء؟** رسالةٌ رُفض دفعُها للطابور — من يعلم بها؟
 *     (في الإنتاج ينادي الويبهوك `enqueueInbound` **بعد** أن ردّ 200 على ميتا،
 *      والخطأ يُبتلع في `catch` — فميتا لن تُعيد الإرسال أبداً.)
 *
 * ⚠️ العامل الثاني يُشغّل كلّ الطوابير ومنها `health-poll` و`maintenance`.
 *    أقصر تكرارٍ فيها خمس دقائق، ولذلك يبقى التمرين تحتها — ولا تُطل `FILL_MB`.
 *
 * يُشغَّل على الخادم من مضيفه (البيئة في رأس `drill-kit.ts`):
 *   TENANT_SLUG=drill-disk TMPFS_MB=64 \
 *     node --import tsx apps/worker/scripts/drill-disk.ts
 *
 * ويهدم المِنصَّة حتماً في `finally`: الحاويتان والمجلَّد.
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { closeDb } from '@aibot/db';
import {
  sleep, log, step, docker, compose, ensureDrillTenant, purgeDrillData, inboundJob,
  storedCount, incidentsSince, reportRecovery, getDbOrDie,
} from './drill-kit.js';

const SLUG = process.env.TENANT_SLUG ?? 'drill-disk';
const TMPFS_MB = Number(process.env.TMPFS_MB ?? '64');
/** منفذٌ محلّيٌّ للمِنصَّة وحدها — المضيف يحتاجه ليضخّ ويقيس. */
const PORT = Number(process.env.DRILL_REDIS_PORT ?? '6399');
const NETWORK = process.env.DOCKER_NETWORK ?? 'aibot_default';
const VOLUME = process.env.DRILL_VOLUME ?? 'aibot_drill_disk';
const RIG_REDIS = 'aibot-drill-redis';
const RIG_WORKER = 'aibot-drill-worker';
const REDIS_IMAGE = process.env.REDIS_IMAGE ?? 'redis:7-alpine';
/** دفعاتُ القياس: قبل الملء، وأثناء الامتلاء، وبعد التحرير. */
const BATCH = Number(process.env.BATCH ?? '3');
const TAG = `disk-${Date.now()}`;

/** استعمالُ `/` — يُطبع قبل وبعد، فادّعاء «لم يُمَسّ الجذر» يُقاس لا يُقال. */
function rootUsage(): string {
  return docker(['run', '--rm', '-v', '/:/host:ro', REDIS_IMAGE, 'df', '-h', '/host'],
    { allowFail: true }).split('\n').pop()?.trim() ?? '؟';
}

function rigUsage(): string {
  return docker(['exec', RIG_REDIS, 'df', '-h', '/data'], { allowFail: true })
    .split('\n').pop()?.trim() ?? '؟';
}

/* ★ حالةُ المِنصَّة على مستوى الوحدة: مُعالِجُ السقوط الأخير كان يهدم **دائماً**
   — أي ينادي `docker` حتّى لو سقط السكربت قبل أن يبني شيئاً أو شُغِّل على غير
   الخادم. تنظيفُ ما لم يُنشأ ليس تنظيفاً. */
let rigBuilt = false;

function rigUp(): void {
  rigBuilt = true;
  docker(['volume', 'create', '--driver', 'local',
    '--opt', 'type=tmpfs', '--opt', 'device=tmpfs', '--opt', `o=size=${TMPFS_MB}m`, VOLUME]);
  docker(['run', '-d', '--name', RIG_REDIS, '--network', NETWORK, '--network-alias', 'drill-redis',
    '-p', `127.0.0.1:${PORT}:6379`, '-v', `${VOLUME}:/data`, REDIS_IMAGE,
    'redis-server', '--appendonly', 'yes', '--appendfsync', 'everysec', '--dir', '/data']);
  /* عاملٌ من نفس صورة الإنتاج ونفس أمرها — `--no-deps` فلا تُلمس خدمةٌ قائمة. */
  compose(['run', '-d', '--no-deps', '--name', RIG_WORKER,
    '-e', 'REDIS_URL=redis://drill-redis:6379', 'worker']);
}

function rigDown(): void {
  docker(['rm', '-f', RIG_WORKER], { allowFail: true });
  docker(['rm', '-f', RIG_REDIS], { allowFail: true });
  docker(['volume', 'rm', '-f', VOLUME], { allowFail: true });
}

/**
 * الملء بـ**ملفِّ ثِقَلٍ** يُكتب في `/data` مباشرةً — لا بمفاتيحَ في ريدِس.
 *
 * ★ وهذا الفرق هو كلُّ التمرين، وأوّلُ تصميمٍ أخطأه: لو مُلئ القرص بمفاتيحَ
 *   عبر ريدِس، صار التحريرُ مستحيلاً — `DEL` أمرُ **كتابة**، وريدِس يرفض
 *   الكتابة كلَّها بـ`MISCONF` حين يفشل سجلُّه، فلا الحشوُ يُحذف ولا السجلّ
 *   يُعاد كتابته. وهذه هي الحقيقة في الحياة أيضاً: قرصٌ ممتلئ لا يُفرَّج
 *   بحذفٍ من داخل قاعدة البيانات، بل بتحرير مساحةٍ على نظام الملفّات. فليكن
 *   الثِقَلُ ملفّاً يُحذف بـ`rm` كما يُحذف سجلٌّ قديم.
 *
 * و`dd` ستفشل عند الامتلاء («No space left») وهذا هو المقصود — لا خطأ.
 */
function fillUntilFull(): { probe: string; usage: string } {
  const script = [
    `dd if=/dev/zero of=/data/ballast.bin bs=1048576 count=${TMPFS_MB + 8} 2>&1 | tail -1`,
    /* استفزازُ الكتابة: `appendfsync everysec` يكتشف الفشل بعد ثانية، فبلا
       استفزازٍ وانتظارٍ يُقاس الطابور قبل أن يعلم ريدِس أنّه عاطل. */
    'echo "PROBE1 $(redis-cli set drill:probe 1 2>&1)"',
    'sleep 3',
    'echo "PROBE2 $(redis-cli set drill:probe 2 2>&1)"',
    'echo "AOF $(redis-cli info persistence | tr -d "\\r" | grep aof_last_write_status)"',
    'df -h /data | tail -1',
  ].join('\n');
  const out = docker(['exec', RIG_REDIS, 'sh', '-c', script], { allowFail: true });
  return {
    probe: out.split('\n').filter((l) => /^(PROBE|AOF)/.test(l.trim())).join(' · '),
    usage: out.split('\n').pop()?.trim() ?? '؟',
  };
}

/** تحرير المساحة: حذفُ ملفّ الثِقَل — تماماً كما يُحرَّر قرصٌ حقيقيّ. */
function freeSpace(): string {
  /* ★ `< /dev/null` على النداء داخل الحلقة: الدرس المدفوع في هذا المشروع أنّ
     نداءً يرث stdin يسرقه من `while read` فتنتهي الحلقة بعد سطرٍ واحد بلا خطأ.
     ولا حلقةَ قراءةٍ هنا، لكنّ العادة تُبنى في كلّ موضع أو لا تُبنى. */
  return docker(['exec', RIG_REDIS, 'sh', '-c',
    'rm -f /data/ballast.bin < /dev/null; '
    + 'redis-cli bgrewriteaof < /dev/null; sleep 3; '
    + 'echo "AOF $(redis-cli info persistence | tr -d "\\r" | grep aof_last_write_status)"; '
    + 'df -h /data | tail -1'], { allowFail: true });
}

interface PumpResult { sent: number; refused: number; firstError: string }

/** الدفعُ بنفس خيارات `enqueueInbound` في الإنتاج — لا خياراتٍ ألطف. */
async function pump(q: Queue, tenantId: string, channelId: string, prefix: string, n: number): Promise<PumpResult> {
  let sent = 0;
  let refused = 0;
  let firstError = '';
  for (let i = 0; i < n; i += 1) {
    try {
      await q.add('inbound', inboundJob({
        tenantId, channelId, externalId: `${TAG}-${prefix}${i}`,
        from: `96279002${String(1000 + i)}`, text: `رسالة تمرين القرص ${prefix}${i}`,
      }), { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000, removeOnFail: 5000 });
      sent += 1;
    } catch (e) {
      refused += 1;
      if (!firstError) firstError = (e as Error).message.slice(0, 160);
    }
  }
  return { sent, refused, firstError };
}

async function main(): Promise<void> {
  const db = getDbOrDie();

  console.log(`\n▶ تمرين (ج) املأ القرص — tmpfs ${TMPFS_MB}MB معزول، و/ لا يُمَسّ\n`);
  log('استعمال / قبل التمرين', rootUsage());

  const ctx = await ensureDrillTenant(db, { slug: SLUG, name: 'مستأجر تمرين القرص', bot: null });
  log('مستأجر التمرين جاهز، والبوت مطفأ', { tenantId: ctx.tenantId });

  let conn: IORedis | null = null;
  let q: Queue | null = null;
  const verdict = { recovered: false, incident: false, refusedLoud: false, lostSilently: 0 };

  try {
    step('بناء المِنصَّة المعزولة');
    rigUp();
    /* مهلةُ إقلاع: العامل يفتح اتّصالَي قاعدةٍ وطابورٍ ويسجّل المتكرّرات. */
    await sleep(Number(process.env.RIG_BOOT_MS ?? '12000'));
    log('ريدِس المِنصَّة', rigUsage());
    log('سجلّ العامل الثاني (آخر سطر)',
      docker(['logs', '--tail', '1', RIG_WORKER], { allowFail: true }).slice(0, 200));

    conn = new IORedis(`redis://127.0.0.1:${PORT}`, {
      maxRetriesPerRequest: 2, enableReadyCheck: true, enableOfflineQueue: false,
    });
    q = new Queue('ch-inbound', { connection: conn });

    /* ① خطُّ أساس: بلا هذا لا يُعرف هل المِنصَّة تعمل أصلاً، فيُقرأ صفرٌ
       بعد الملء «فقداناً» وهو عدمُ تشغيل. */
    step('خطّ الأساس — المِنصَّة تعمل قبل الضغط');
    const base = await pump(q, ctx.tenantId, ctx.channelId, 'a', BATCH);
    let baseStored = 0;
    for (let t = 0; t < 20 && baseStored < base.sent; t += 1) {
      await sleep(1500);
      baseStored = await storedCount(db, ctx.tenantId, `${TAG}-a`);
    }
    log(`دُفعت ${base.sent} · خُزّنت ${baseStored}`);
    if (baseStored < base.sent) throw new Error('المِنصَّة لا تعمل قبل الضغط — لا معنى لما بعدها');

    /* ② الملء. */
    step('الملء حتّى يرفض ريدِس الكتابة');
    const since = new Date();
    const fill = fillUntilFull();
    log('استفزازُ الكتابة بعد الامتلاء', fill.probe);
    log('استعمال /data في المِنصَّة', fill.usage);
    log('استعمال / الآن (يجب ألّا يتغيّر)', rootUsage());

    /* ③ الدفع والقرص ممتلئ. */
    step('رسائل تصل والقرص ممتلئ');
    const under = await pump(q, ctx.tenantId, ctx.channelId, 'b', BATCH);
    log(`حاولنا ${BATCH}: نجح ${under.sent} · رُفض ${under.refused}`);
    if (under.firstError) log('نصّ الرفض كما يراه المنادي', under.firstError);

    await sleep(6000);
    const underStored = await storedCount(db, ctx.tenantId, `${TAG}-b`);
    log(`خُزّن من دفعة الضغط: ${underStored}/${BATCH}`);

    const incUnder = await incidentsSince(db, since);
    log('حوادثُ ظهرت', incUnder.length ? incUnder.map((r) => `${r.kind}×${r.count}`) : '—');

    /* ④ التحرير والتعافي. */
    step('تحرير المساحة والتعافي');
    log('بعد التحرير', freeSpace().split('\n').pop()?.trim() ?? '؟');
    const after = await pump(q, ctx.tenantId, ctx.channelId, 'c', BATCH);
    let afterStored = 0;
    for (let t = 0; t < 20 && afterStored < after.sent; t += 1) {
      await sleep(1500);
      afterStored = await storedCount(db, ctx.tenantId, `${TAG}-c`);
    }
    log(`دُفعت ${after.sent} · خُزّنت ${afterStored}`);

    const incAll = await incidentsSince(db, since);

    /* ⑤ الحكم. */
    step('الحكم');
    verdict.recovered = after.refused === 0 && afterStored >= after.sent;
    verdict.incident = incAll.length > 0;
    verdict.refusedLoud = under.refused > 0;
    verdict.lostSilently = BATCH - underStored;

    console.log('');
    console.log(`  حجم المِنصَّة:            ${TMPFS_MB}MB tmpfs (لا شيء على /)`);
    console.log(`  بعد الامتلاء:           ${fill.probe}`);
    console.log(`  ‏/data:                  ${fill.usage}`);
    console.log(`  دفعةُ الضغط:            نجح ${under.sent} · رُفض ${under.refused} · خُزّن ${underStored}`);
    console.log(`  دفعةُ ما بعد التحرير:    نجح ${after.sent} · خُزّن ${afterStored}`);
    console.log(`  حوادث:                  ${incAll.length ? incAll.map((r) => `${r.kind}×${r.count}`).join(' · ') : '—'}`);
    console.log('');
    console.log(`① التعافي:  ${verdict.recovered
      ? '✅ الكتابة والمعالجة عادتا بمجرّد تحرير المساحة — بلا إعادة تشغيل'
      : '❌ لم تعد الكتابة بعد التحرير'}`);
    console.log(`② الحادثة:  ${verdict.incident
      ? `✅ ${incAll.map((r) => r.kind).join(', ')}`
      : '❌ لا حادثة — طابورٌ يرفض الكتابة لا يُنتج صفّاً في incidents'}`);
    console.log(`③ الضائع:   ${verdict.refusedLoud
      ? `الرفض **صريحٌ للمنادي** (${under.refused}/${BATCH}) — لكنّ منادي الإنتاج هو الويبهوك، `
        + 'وهو يبتلع الخطأ بعد أن ردّ 200 على ميتا. فلا إعادةَ إرسالٍ ولا حادثة.'
      : 'لم يُرفض دفعٌ — الحجم لم يضغط بما يكفي، زِد TMPFS_MB أو BATCH'}`);
    console.log(`    رسائلُ دفعة الضغط التي لم تصل القاعدة: ${verdict.lostSilently}`);
  } finally {
    step('هدم المِنصَّة');
    await q?.close().catch(() => undefined);
    await conn?.quit().catch(() => undefined);
    rigDown();
    log('استعمال / بعد الهدم', rootUsage());
    await purgeDrillData(db, ctx.tenantId).catch((e) => log(`تعذّر التنظيف: ${(e as Error).message}`));
    log('نُظّف أثر التمرين، والمِنصَّة والمجلَّد حُذفا');
  }

  const guard = await reportRecovery(db);
  await closeDb().catch(() => undefined);

  const pass = verdict.recovered && guard;
  console.log(`\n${pass
    ? '✅ التمرين اكتمل — الضغط كان حقيقيّاً والتعافي تلقائيّ'
    : '❌ التمرين كشف عطلاً — راجع الأحكام أعلاه'}`);
  process.exit(pass ? 0 : 1);
}

main().catch(async (e) => {
  console.error('فشل التمرين:', (e as Error).message);
  if (rigBuilt) rigDown();
  await closeDb().catch(() => undefined);
  process.exit(1);
});
