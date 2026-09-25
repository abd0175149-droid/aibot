import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★★★ **قناةُ تنبيهٍ بلا مشترك = نظامُ تسجيلٍ لا مراقبة.**
 *
 *   كلُّ ما بُني في `notify.ts` و`incidents.ts` و`quota.ts` يفترض أنّ لمالك
 *   المنصّة اشتراكَ دفعٍ مسجَّلاً. و`Promise.all` على مصفوفةٍ **فارغة** ينجح:
 *   فكلُّ تنبيهٍ حرجٍ «يُرسَل» بنجاحٍ إلى لا أحد، بلا سطرٍ واحدٍ في السجلّ
 *   يشير إلى ذلك. ولمّا لم يكن ثمّة مسارٌ يكتب `push_subscriptions` أصلاً،
 *   كانت المصفوفةُ فارغةً **دائماً** — وزمنُ اكتشاف أيّ عطلٍ صار مساوياً
 *   لزمنِ فتحِ إنسانٍ شاشةَ الحوادث بيده.
 *
 *   وجدولُ `notifications` كان الوجهَ الآخر للعطل نفسِه: يُكتب في كلّ تنبيه،
 *   ولا مسارَ يقرؤه ولا شاشةَ تعرضه. صفوفٌ تُكتب ويحذفها الاحتفاظُ بعد
 *   تسعين يوماً ولا يراها إنسانٌ قطّ.
 *
 * ⚠️ وحرّاسُ هذا الملفّ تُثبت المرساةَ قبل كلّ فحصٍ سالب: حارسٌ على سلسلةٍ
 *    اختفت يمرّ دائماً فيُطَمئن دائماً.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8').replace(/\r\n/g, '\n');

describe('صندوقُ التنبيهات — ما يُكتب يُقرأ', () => {
  const route = read('apps/api/src/routes/notifications.ts');

  it('★ جدولُ notifications له قارئٌ فعليّ', () => {
    /* 🔴 العطلُ نفسُه: كان يُكتب في كلّ تنبيهٍ حرج ولا يقرؤه مسارٌ واحد. */
    expect(route).toContain('.from(notifications)');
    expect(route).toMatch(/app\.get\(\s*'\/notifications'/);
  });

  it('★★ والعزلُ بمعرّف التوكن لا بما يرسله العميل', () => {
    /* 🔴 `notifications` مفتاحُه `user_id` و`tenant_id` فيه قابلٌ للفراغ
       (مالكُ المنصّة يُشعَر أيضاً)، فهو خارج عزل المستأجر. فتحديثٌ بلا شرطِ
       مستخدمٍ يجعل موظّفاً يُسكت تنبيهَ مالكِ المنصّة بمعرّفٍ خمّنه — وهو
       أسوأُ ما يُفعل بقناة تنبيه. */
    const reads = [...route.matchAll(/eq\(notifications\.userId, ([^)]+)\)/g)].map((m) => m[1]!);
    expect(reads.length, 'لا شرطَ مستخدمٍ إطلاقاً').toBeGreaterThanOrEqual(3);
    for (const r of reads) {
      expect(r, `شرطُ المستخدم من «${r}» لا من التوكن`).toMatch(/req\.auth!\.sub|userId/);
    }
    /* ولا يُقرأ المعرّفُ من الجسم أبداً. */
    expect(route).not.toMatch(/notifications\.userId,\s*req\.body/);
  });

  it('★ وكلُّ مسارٍ خلف requireAuth', () => {
    const routes = [...route.matchAll(/app\.(get|post|delete)<?[^(]*\(\s*\n?\s*'([^']+)'/g)];
    expect(routes.length).toBeGreaterThanOrEqual(3);
    /* مسارٌ واحدٌ مكشوفٌ يُسرّب عناوينَ الحوادث وأسماءَ القنوات. */
    const guards = (route.match(/preHandler: requireAuth\(\)/g) ?? []).length;
    expect(guards).toBeGreaterThanOrEqual(routes.length);
  });

  it('★ والجرسُ مركَّبٌ في القشرة ويستقصي', () => {
    const shell = read('apps/web/src/components/Shell.tsx');
    const bell = read('apps/web/src/components/NotifBell.tsx');
    expect(shell, 'الجرسُ مكتوبٌ وغيرُ مركَّب — ميزةٌ ميّتة').toContain('<NotifBell />');
    expect(bell).toContain("api<{ items: Notif[]; unread: number }>('/notifications')");
    /* بلا استقصاءٍ لا يظهر التنبيهُ إلّا لمن أعاد تحميل الصفحة. */
    expect(bell).toContain('setInterval(');
  });
});

describe('«هل يُبلَّغ أحدٌ أصلاً؟» — سؤالٌ يُطرح دوريّاً', () => {
  const notify = read('apps/worker/src/notify.ts');
  const main = read('apps/worker/src/main.ts');
  const api = read('apps/api/src/main.ts');
  const inc = read('apps/worker/src/incidents.ts');

  it('★ الفحصُ موجودٌ ويقيس مالكي المنصّة لا أيَّ مستخدم', () => {
    expect(notify).toContain('export async function checkAlerting');
    const at = notify.indexOf('export async function checkAlerting');
    const body = notify.slice(at);
    expect(body).toContain("eq(users.role, 'platform_owner')");
    /* ومالكٌ موقوفٌ ليس مشتركاً: حسابٌ مُطفأٌ لا يفتح شاشةً ولا يتلقّى دفعاً. */
    expect(body).toContain('eq(users.isActive, true)');
    expect(body).toContain('pushSubscriptions');
  });

  it('★★ ومفاتيحُ VAPID الغائبةُ عطلٌ مستقلٌّ ببصمةٍ مستقلّة', () => {
    const at = notify.indexOf('export async function checkAlerting');
    const body = notify.slice(at);
    /* «لا مفاتيح» و«لا اشتراك» عطلان مختلفان وعلاجُهما مختلف: بصمةٌ واحدةٌ
       لهما تجعل إصلاحَ أحدِهما يُخفي الآخر. */
    expect(body).toContain('VAPID_PRIVATE_KEY');
    expect(body).toMatch(/causeKey: missingKeys \? 'vapid' : 'nosubs'/);
  });

  it('★★★ والحادثةُ تُغلق من نفسها حين تعود القناة', () => {
    /* 🔴 حادثةٌ لا تُغلق **تُعمي عن نفسها**: `raiseIncident` لا يُنبّه إلّا
       على بصمةٍ جديدة، فما دامت مفتوحةً لا يُنبّه أيُّ انقطاعٍ لاحق. */
    expect(inc).toContain("'alerting_unsubscribed'");
    const at = notify.indexOf('export async function checkAlerting');
    expect(notify.slice(at)).toContain("resolveOpenOfKinds(null, ['alerting_unsubscribed'])");
  });

  it('★★★ و`resolveOpenOfKinds` تُطابق حوادثَ المنصّة (tenant_id IS NULL)', () => {
    /* 🔴 `eq(col, null)` يُنتج `= NULL` وهو دائماً «غيرُ معروف» في SQL: العبارةُ
       كانت تصيب صفراً **بصمت** مهما كان في الجدول، وتُرجع 0 كأنّ لا حادثةَ
       هناك. أي أنّ حوادثَ المنصّة لم تكن تُحلّ آليّاً إطلاقاً. */
    expect(inc).toContain('tenantId: string | null');
    expect(inc).toMatch(/tenantId === null \? isNull\(incidents\.tenantId\)/);
  });

  it('★ والفحصُ مجدوَلٌ دوريّاً لا عند الإقلاع وحده', () => {
    /* الاشتراكُ يموت بلا حدثٍ يُعلنه: إذنٌ يُسحب من إعدادات المتصفّح، أو
       يُبدَّل مفتاحُ VAPID فتموت الاشتراكاتُ كلُّها معاً، أو يُمسح الجهاز.
       فالعمياءُ تُولد في منتصف الطريق لا عند البداية. */
    expect(main).toContain("name: 'alerting'");
    expect(main).toContain("job.name === 'alerting'");
    expect(main).toContain('await checkAlerting()');
  });

  it('★ ويظهر الجوابُ في الصحّة العميقة', () => {
    expect(api).toContain('alerting: await alertingReachable()');
    /* والعميقةُ خلف حارس: أعماقُ الطوابير وبصمةُ git ليست للعموم. */
    const at = api.indexOf("'/api/health/deep'");
    expect(at).toBeGreaterThan(0);
    expect(api.slice(at, at + 200)).toContain('requireAuth(');
  });
});
