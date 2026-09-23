import Fastify from 'fastify';
import { REDACT_PATHS } from '@aibot/crypto';
import { AppError } from '@aibot/shared';
import { pingDb, closeDb } from '@aibot/db';
import { registerWebhooks } from './webhooks.js';
import { registerAuth } from './auth.js';
import { registerInbox } from './routes/inbox.js';
import { registerContacts } from './routes/contacts.js';
import { registerBot } from './routes/bot.js';
import { registerConsole } from './routes/console.js';
import { registerReports } from './routes/reports.js';
import { registerPlayground } from './routes/playground.js';
import { registerTeam } from './routes/team.js';
import { attachRealtime, closeRealtime } from './realtime.js';
import { pingRedis, closeQueues, queueDepths } from './queues.js';
import { closeRateLimiter } from './ratelimit.js';

const PORT = Number(process.env.PORT ?? 4100);
const GIT_REV = process.env.GIT_REV ?? 'unknown';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    // تنقيةٌ إجباريّة: سرٌّ في سجلّ هو سرٌّ مسرَّب
    redact: { paths: REDACT_PATHS, censor: '[محجوب]' },
  },
  // ميتا ترسل حمولاتٍ صغيرة؛ الحدّ يمنع إغراقاً بجسمٍ ضخم
  bodyLimit: 1_048_576,
  // ⚠️ لا تعتمد على X-Forwarded-For[0] — يُزوَّر. نثق بالنفق وحده.
  trustProxy: process.env.TRUST_PROXY ?? '127.0.0.1',
});

/** التوقيع يُحسب على البايتات كما وصلت — لا على JSON مُعاد تسلسله. */
app.addHook('onRequest', async (req) => {
  (req as unknown as { rawBody?: Buffer }).rawBody = undefined;
});
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
  try {
    done(null, (body as Buffer).length ? JSON.parse((body as Buffer).toString('utf8')) : {});
  } catch {
    done(null, {}); // حمولةٌ مشوّهة: 200 ثمّ تسجيل — لا 400 يعطّل الويبهوك
  }
});

/**
 * بوّابة الصحّة.
 *
 * `service` و`rev` ليسا زينة: `https://aibot.masaros.net/api/health` يردّ 200
 * من تطبيقٍ آخر عبر wildcard على *.masaros.net. فكودُ الحالة وحده لا يُثبت
 * شيئاً — الجسم هو ما يُثبت أنّك تكلّم AiBot، و`rev` هو ما يُثبت أنّها النسخة
 * التي نُشرت للتوّ لا القديمة التي ما زالت تعمل.
 */
app.get('/api/health', async (_req, reply) => {
  const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
  const body = { service: 'aibot' as const, rev: GIT_REV, db, redis };
  return reply.code(db && redis ? 200 : 503).send(body);
});

app.get('/api/health/deep', async () => ({
  service: 'aibot' as const,
  rev: GIT_REV,
  db: await pingDb(),
  redis: await pingRedis(),
  queues: await queueDepths(),
  uptimeSec: Math.round(process.uptime()),
}));

await app.register(async (api) => {
  await registerWebhooks(api);
  await registerAuth(api);
  await registerInbox(api);
  await registerContacts(api);
  await registerBot(api);
  await registerConsole(api);
  await registerReports(api);
  await registerPlayground(api);
  await registerTeam(api);
}, { prefix: '/api' });

app.setErrorHandler((err, req, reply) => {
  // أخطاء المجال تُعاد بكودها الثابت القابل للترجمة — لا بنصٍّ إنجليزيّ للمستخدم
  if (err instanceof AppError) return reply.code(err.status).send(err.toJSON());
  req.log.error({ err }, 'خطأ غير متوقَّع');
  reply.code(500).send({ error: { code: 'INTERNAL', message: 'خطأ داخليّ' } });
});

/** إغلاقٌ لطيف: مهمّةٌ نصف منفَّذة عند إعادة النشر تضيع بلا هذا. */
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    app.log.info('إغلاقٌ لطيف…');
    await app.close();
    await closeRealtime();
    await closeQueues();
    await closeRateLimiter();
    await closeDb();
    process.exit(0);
  });
}

attachRealtime(app);

await app.listen({ port: PORT, host: '0.0.0.0' });
app.log.info({ port: PORT, rev: GIT_REV }, `AiBot API listening on ${PORT}`);
