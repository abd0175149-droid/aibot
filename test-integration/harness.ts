import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakes, type Fakes } from './fakes';

/**
 * ★★★ **حزامُ التكامل — لماذا وُجد، ومتى يُصدَّق.**
 *
 *   كلُّ اختبارات هذا المستودع — وهي أكثرُ من ألفٍ — تعبيراتٌ نمطيّةٌ على نصّ
 *   الشيفرة. تمسك «نسيتُ `where`» و«الشكلُ تبدّل»، ولا تمسك «الاستعلامُ
 *   يرمي وقتَ التنفيذ». وقد وقع ذلك مرّتَين في يومٍ واحد: كائن `Date` يُمرَّر
 *   خامّاً إلى السائق في `reply.ts` وفي `pricing.ts`. كلاهما مرّ من ١٠٤٨
 *   اختباراً أخضر، وكلاهما أسقط مسارَ الردّ في الإنتاج.
 *
 *   وأحدُهما لا يمكن أن يمسكه حارسٌ ساكنٌ إطلاقاً: شرطُه `lastOutAt`، وهو لا
 *   يوجد إلّا **بعد أوّل صادر**. فالعطلُ يظهر في **الدور الثاني** من المحادثة
 *   وحده. ولهذا يحمل هذا الحزامُ دورَين لا دوراً واحداً — وهو سببُ وجوده.
 *
 * ⚠️ وقاعدةٌ وريدِسُ يُرميان بعد كلّ شوط (`tmpfs`، لا مجلَّدَ مسمّى): شوطٌ
 *    يبدأ على حالةٍ متّسخةٍ يمرّ لأنّ سابقَه ترك صفّاً.
 *
 * ⚠️ ولا يُشغَّل مع الاختبارات العاديّة: `vitest.itest.config.ts` وحده
 *    يجمعه (‏`*.itest.ts`)، وبوّابةُ النشر تبقى بلا دوكر.
 */

const REPO = join(__dirname, '..');
const COMPOSE = ['compose', '-f', join(REPO, 'docker-compose.itest.yml')];

function dc(args: string[], opts: { quiet?: boolean } = {}): string {
  return execFileSync('docker', [...COMPOSE, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
  });
}

function psql(env: Env, sql: string): string {
  return execFileSync('docker', [
    ...COMPOSE, 'exec', '-T', '-e', `PGPASSWORD=${env.pgPassword}`, 'db',
    'psql', '-v', 'ON_ERROR_STOP=1', '-qAt', '-U', 'aibot', '-d', 'aibot', '-c', sql,
  ], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export interface Env {
  pgPort: number;
  redisPort: number;
  pgPassword: string;
  databaseUrl: string;
  redisUrl: string;
  fakes: Fakes;
}

/** المنفذُ المربوط — عشوائيٌّ عمداً، فيُقرأ ولا يُفترض. */
function mappedPort(service: string, inner: number): number {
  const out = dc(['port', service, String(inner)], { quiet: true }).trim();
  const port = Number(out.split(':').pop());
  if (!Number.isFinite(port) || !port) throw new Error(`تعذّرت قراءةُ منفذ ${service}: «${out}»`);
  return port;
}

export async function up(): Promise<Env> {
  /* شوطٌ سابقٌ مات في منتصفه يترك حاوياتٍ تعمل — تُهدم أوّلاً بلا شكوى. */
  try { dc(['down', '-v', '--remove-orphans'], { quiet: true }); } catch { /* أوّلُ شوط */ }

  dc(['up', '-d', '--wait']);

  const pgPort = mappedPort('db', 5432);
  const redisPort = mappedPort('redis', 6379);
  const env: Env = {
    pgPort,
    redisPort,
    pgPassword: 'itest',
    databaseUrl: `postgresql://aibot_app:itest@127.0.0.1:${pgPort}/aibot`,
    redisUrl: `redis://127.0.0.1:${redisPort}`,
    fakes: await startFakes(),
  };

  /* الترحيلاتُ بنفس ترتيب النشر وبنفس الذرّيّة — حزامٌ يُرحّل بترتيبٍ آخر
     يشهد على مخطّطٍ غيرِ الذي يعمل. */
  const dir = join(REPO, 'packages', 'db', 'migrations');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    execFileSync('docker', [
      ...COMPOSE, 'exec', '-T', '-e', `PGPASSWORD=${env.pgPassword}`, 'db',
      'psql', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-q',
      '-U', 'aibot', '-d', 'aibot', '-f', '-',
    ], { cwd: REPO, input: readFileSync(join(dir, f), 'utf8'), stdio: ['pipe', 'ignore', 'pipe'] });
  }

  /* ⚠️ كلمةُ دور التطبيق تُضبط **خارج** الترحيلات — كما في `deploy.sh`.
     وحزامٌ يتخطّاها يحصل على قاعدةٍ لا يستطيع التطبيقُ الدخولَ إليها. */
  psql(env, "ALTER ROLE aibot_app LOGIN PASSWORD 'itest';");

  /* البيئةُ تُضبط قبل أوّل استيرادٍ لوحدةٍ تقرأها: `packages/db` يبني البِركةَ
     عند أوّل `getDb()`، و`packages/ai` يقرأ العنوانَ عند التحميل. */
  process.env.DATABASE_URL = env.databaseUrl;
  process.env.REDIS_URL = env.redisUrl;
  process.env.GRAPH_BASE = env.fakes.url;
  process.env.GOOGLE_AI_BASE = env.fakes.url;
  process.env.MASTER_KEY ??= Buffer.alloc(32, 7).toString('base64');
  process.env.MASTER_KEY_VERSION ??= '1';
  process.env.PLATFORM_AI_KEY ??= 'itest-key';
  process.env.JWT_SECRET ??= 'itest-jwt-secret-value-0123456789';

  return env;
}

export async function down(env?: Env): Promise<void> {
  /* يُنادى من `finally` دائماً: حاويةٌ تبقى تحجز منفذاً وذاكرةً على خادمٍ
     حِملُه سبعة، والشوطُ التالي يجدها فيبدأ متّسخاً. */
  try { await env?.fakes.close(); } catch { /* أُغلق سلفاً */ }
  try { dc(['down', '-v', '--remove-orphans'], { quiet: true }); } catch { /* سقط أصلاً */ }
}
