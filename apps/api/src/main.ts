import Fastify from 'fastify';
import { REDACT_PATHS } from '@aibot/crypto';
import { AppError } from '@aibot/shared';
import { pingDb, closeDb } from '@aibot/db';
import { registerWebhooks } from './webhooks.js';
import { registerAuth, requireAuth } from './auth.js';
import { registerInbox } from './routes/inbox.js';
import { registerContacts } from './routes/contacts.js';
import { registerBot } from './routes/bot.js';
import { registerConsole } from './routes/console.js';
import { registerReports } from './routes/reports.js';
import { registerPlayground } from './routes/playground.js';
import { registerTeam } from './routes/team.js';
import { registerPush } from './routes/push.js';
import { attachRealtime, closeRealtime } from './realtime.js';
import { pingRedis, closeQueues, queueDepths, workerBeat } from './queues.js';
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
  const [db, redis, beat] = await Promise.all([pingDb(), pingRedis(), workerBeat()]);
  /* ★ `worker` معروضٌ ولا يُغيّر كودَ الحالة **بعد**: بوّابةُ النشر تحرس على
     هذه النقطة، وتحويلُ عاملٍ بطيء الإقلاع إلى فشلِ نشرٍ قرارٌ يُتّخذ في
     خطوته لا كأثرٍ جانبيٍّ لإضافة حقل. وحتّى ذلك الحين يراه المراقبُ
     الخارجيّ في الجسم — وهو أوّل مرّةٍ يُرى فيها من خارج المضيف. */
  const body = {
    service: 'aibot' as const, rev: GIT_REV, db, redis,
    worker: beat.alive, workerAgeSec: beat.ageSec,
  };
  return reply.code(db && redis ? 200 : 503).send(body);
});

/**
 * ★ **الفحصُ العميق خلف توكن — وكان مفتوحاً للعموم عبر النفق.**
 *
 *   `/api/health` السطحيّ يبقى مفتوحاً: بوّابةُ النشر ومراقبٌ خارجيٌّ يحتاجانه،
 *   وما فيه هو ما يُعلَن أصلاً (خدمةٌ · نسخةٌ · حيٌّ أم لا).
 *   و`deep` غيرُه: أعماقُ الطوابير وعدَدُ الفاشلة و`uptime` — وهي خريطةُ حملٍ
 *   وتوقيتٍ تُقرأ من الخارج. عمقُ طابورٍ يرتفع يقول إنّ العامل متعثّر، وهي
 *   اللحظةُ التي يُختار فيها الضغط. والنفقُ يمرّر `api/*` كلَّه، فما كان
 *   «داخليّاً» لم يكن داخليّاً يوماً.
 *
 * ⚠️ ويُسجَّل خلف `preHandler` لا `onRequest`: `requireAuth` يقرأ الترويسة
 *    وحدها فلا فرق أمنيّ، والتسجيلُ على مستوى المسار يُبقيه خارج موجّه
 *    `/api` المُسجَّل أدناه — فلا يتغيّر عنوانُه.
 */
app.get('/api/health/deep', { preHandler: requireAuth({ console: true }) }, async () => ({
  service: 'aibot' as const,
  rev: GIT_REV,
  db: await pingDb(),
  redis: await pingRedis(),
  queues: await queueDepths(),
  worker: await workerBeat(),
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
  await registerPush(api);
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
