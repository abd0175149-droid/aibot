import Fastify from 'fastify';
import { REDACT_PATHS } from '@aibot/crypto';
import { AppError } from '@aibot/shared';
import { pingDb, closeDb } from '@aibot/db';
import { parseJsonBody } from './json-body.js';
import { registerWebhooks } from './webhooks.js';
import { registerAuth, requireAuth } from './auth.js';
import { registerInbox } from './routes/inbox.js';
import { registerContacts } from './routes/contacts.js';
import { registerBot } from './routes/bot.js';
import { registerConsole } from './routes/console.js';
import { registerReports } from './routes/reports.js';
import { registerPlayground } from './routes/playground.js';
import { registerTeam } from './routes/team.js';
import { registerAudit } from './routes/audit.js';
import { registerPrivacy } from './routes/privacy.js';
import { registerPush } from './routes/push.js';
import { registerNotifications, alertingReachable } from './routes/notifications.js';
import { configuredKeyVersions, currentKeyVersion } from '@aibot/crypto';
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
    /**
     * ★ **السجلُّ كان يحفظ أرقامَ هواتف الزبائن وأسماءَهم.**
     *
     *   مُسلسِلُ `req` الافتراضيّ في Fastify يكتب `req.url` كاملاً — بالمسار
     *   **وسلسلة الاستعلام** — في كلّ طلبٍ عند مستوى `info`. وثلاثُ شاشاتٍ
     *   تضع كلامَ الزبون في `?q=`: بحثُ الإنبوكس وبحثُ جهات الاتّصال وبحثُ
     *   المحادثات. فموظّفٌ يبحث عن «0791234567» ليفتح محادثةَ من اتّصل به
     *   يكتب ذلك الرقمَ في سجلٍّ يُحتفظ به ويُشحن إلى أيّ مجمِّع.
     *   و`REDACT_PATHS` لا تغطّي `req.url` — هي لأسماء الحقول لا للعناوين.
     *
     *   والمسارُ يبقى كاملاً (هو ما يُشخَّص به)، والاستعلامُ تُحجب **قيمُه**
     *   وتبقى **مفاتيحُه**: «ما الذي بُحث عنه» سرٌّ، و«أنّ بحثاً جرى» ليس
     *   سرّاً وهو ما يُقرأ في التشخيص.
     */
    serializers: {
      req(req: { method: string; url: string; ip?: string; id?: string }) {
        const [path, query] = req.url.split('?');
        const safe = query
          ? `${path}?${query.split('&').map((kv) => `${kv.split('=')[0]}=[محجوب]`).join('&')}`
          : path;
        return { method: req.method, url: safe, ip: req.ip, id: req.id };
      },
    },
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
  const raw = body as Buffer;
  /* البايتاتُ أوّلاً وقبل أيّ قرار: توقيعُ الويبهوك يُحسب عليها حتّى لو
     رُفض الجسم — فلا يُفقَد ما يُثبت أنّ الطلب من ميتا. */
  (req as unknown as { rawBody: Buffer }).rawBody = raw;
  try {
    done(null, parseJsonBody(req.url, raw));
  } catch (e) {
    done(e as Error, undefined);
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
    /* ★ وعددُ المجدوِلات: «العاملُ حيّ» وحدها لا تُفرّق عاملاً يعمل من عاملٍ
       يدور بلا مهمّةٍ متكرّرةٍ واحدة — ولا فحصَ صحّةٍ حينها ولا إغلاقَ نوافذَ
       ولا إشارةً سلبيّة، وكلُّ شاشةٍ خضراء. */
    workerSched: beat.sched,
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
/** تهيئةُ المفاتيح كما يراها هذا التشغيل — بلا أيّ قيمةٍ سرّيّة. */
function keyCoverage(): { current: number; configured: number[] } {
  return { current: currentKeyVersion(), configured: configuredKeyVersions() };
}

app.get('/api/health/deep', { preHandler: requireAuth({ console: true }) }, async () => ({
  service: 'aibot' as const,
  rev: GIT_REV,
  db: await pingDb(),
  redis: await pingRedis(),
  queues: await queueDepths(),
  worker: await workerBeat(),
  /* ★★★ **هل يُبلَّغ أحدٌ أصلاً؟** — والجوابُ كان مفترضاً لا مقروءاً.
     كلُّ ما بُني في `notify.ts` و`incidents.ts` و`quota.ts` يفترض أنّ لمالك
     المنصّة اشتراكَ دفعٍ مسجَّلاً، و`Promise.all` على مصفوفةٍ **فارغة** ينجح:
     فالتنبيهُ الحرج «يُرسَل» بنجاحٍ إلى لا أحد، بلا سطرٍ في السجلّ.
     ومنصّةٌ عمياءُ عن أعطالها حالةٌ تُعلَن لا تُفترض — فتظهر هنا حيث تُقرأ. */
  alerting: await alertingReachable(),
  /* ★ وتغطيةُ مفاتيح التشفير: صفٌّ بإصدارٍ لا مفتاحَ له يُفكّ برميٍ يُبتلع —
     في الويبهوك بعد إرسال 200 (فميتا لا تُعيد)، وفي فحص الصحّة بلا سطر.
     فالعطلُ صمتٌ كامل، وهذا يجعله رقماً يُقرأ. */
  keys: keyCoverage(),
  uptimeSec: Math.round(process.uptime()),
}));

/* ★ ويُسجَّل **قبل** المسارات: خطأُ محلّل المحتوى يقع خارج أيّ مسار، فمعالجٌ
   مسجَّلٌ بعده لا يلتقطه — ويخرج ٥٠٠ إنجليزيّةً بدل ٤٠٠ عربيّةٍ مفهومة. */
app.setErrorHandler((err, req, reply) => {
  // أخطاء المجال تُعاد بكودها الثابت القابل للترجمة — لا بنصٍّ إنجليزيّ للمستخدم
  if (err instanceof AppError) return reply.code(err.status).send(err.toJSON());
  req.log.error({ err }, 'خطأ غير متوقَّع');
  reply.code(500).send({ error: { code: 'INTERNAL', message: 'خطأ داخليّ' } });
});

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
  await registerAudit(api);
  await registerPrivacy(api);
  await registerPush(api);
  await registerNotifications(api);
}, { prefix: '/api' });

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
