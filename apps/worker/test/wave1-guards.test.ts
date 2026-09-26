import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOT_SCREEN, BOT_SCREEN_ABS, readBotScreen } from '../../../test-support/bot-screen';

/**
 * ★ حرّاسُ الدفعة الأولى — «أطفئ ما هو مكسورٌ الآن عند عميلَيك».
 *
 * كلُّ ما هنا عطلٌ كان **قائماً على الخادم الحيّ** لا احتمالاً: تنبيهٌ لا يصل،
 * حادثةٌ لا تُغلق، قناةٌ خضراء وتوكنها باطل، وبوتٌ مطفأٌ تقول الشاشةُ إنّه
 * يردّ. والحرّاس هنا ساكنون عمداً: العطل في كلّ حالةٍ كان **شكلاً** —
 * سطرٌ ناقصٌ أو شرطٌ مقلوب — لا حالةً تُجرَّب.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

describe('الحوادث تُغلق حين يزول سببها', () => {
  const inc = read('apps/worker/src/incidents.ts');

  it('الأنواع التي تُرفع كلُّها قابلةٌ للحلّ الآليّ', () => {
    /* كلّ `kind` يُرفع في العامل — من `health.ts` و`reply.ts` و`outbound.ts`. */
    const raised = new Set<string>();
    for (const rel of ['apps/worker/src/health.ts', 'apps/worker/src/reply.ts', 'apps/worker/src/outbound.ts']) {
      for (const m of read(rel).matchAll(/kind:\s*'([a-z_]+)'/g)) raised.add(m[1]!);
    }
    // `kind` المحسوب في `health.ts` يُكتب متغيّراً لا نصّاً — يُضاف صراحةً
    ['token_invalid', 'webhook_unsubscribed', 'quality_drop', 'channel_down'].forEach((k) => raised.add(k));

    const listed = new Set(
      [...(/const AUTO_RESOLVABLE = new Set\(\[([\s\S]*?)\]\);/.exec(inc)?.[1] ?? '')
        .matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!),
    );
    const orphans = [...raised].filter((k) => k !== 'text' && !listed.has(k));
    expect(
      orphans,
      'أنواعٌ تُرفع ولا يُمكن حلُّها آليّاً. وحادثةٌ لا تُغلق ليست ضجيجاً فحسب: '
      + '`raiseIncident` لا يُنبّه إلّا على بصمةٍ **جديدة**، فما دامت مفتوحةً فإنّ '
      + 'كلّ تكرارٍ حقيقيٍّ لاحق يُزيد العدّاد بصمتٍ ولا يُنبّه أحداً.',
    ).toEqual([]);
  });

  it('★ لكلّ نوعٍ قابلٍ للحلّ مُنادٍ فعليّ — القائمة وحدها لا تحلّ شيئاً', () => {
    const callers = ['apps/worker/src/health.ts', 'apps/worker/src/inbound.ts',
      'apps/worker/src/outbound.ts', 'apps/worker/src/reply.ts'].map(read).join('\n');
    for (const k of ['webhook_silent', 'send_failed', 'no_reply', 'send_failure_rate',
      'token_invalid', 'channel_down', 'webhook_unsubscribed', 'quality_drop', 'ai_error']) {
      expect(callers, `لا مُنادٍ يحلّ ${k} — فهو مدرجٌ في القائمة ولا يُغلق أبداً`).toContain(`'${k}'`);
    }
  });

  it('نجاحُ الإرسال ووصولُ الوارد كلاهما يُغلق ما يخصّه', () => {
    expect(read('apps/worker/src/outbound.ts')).toMatch(/resolveOpenOfKinds\([^)]*'send_failed'/s);
    expect(read('apps/worker/src/inbound.ts')).toMatch(/resolveOpenOfKinds\([^)]*'webhook_silent'/s);
  });
});

describe('حالة القناة تُنزَّل وتُرفَع — وتبقى تحت الفحص', () => {
  const h = read('apps/worker/src/health.ts');

  it('الفشل المتكرّر يُنزل الحالة إلى error', () => {
    expect(h, 'كان الفشل يُبقي `ch.status` كما هو، فتبقى القناة «موصولة» وتوكنها باطل')
      .toMatch(/twoBad \? 'error'/);
  });

  it('★ والقناة المعطوبة تبقى مفحوصةً — وإلّا فالتنزيل طريقٌ بلا عودة', () => {
    expect(h).toMatch(/inArray\(tenantChannels\.status, \['connected', 'error'\]\)/);
  });

  it('degraded تبقى موصولة — تعمل بجودةٍ أقلّ لا معطوبة', () => {
    expect(h).toMatch(/report\.level === 'ok' \|\| report\.level === 'degraded'\s*\n?\s*\?\s*'connected'/);
  });
});

describe('ما تقوله الشاشة يطابق ما يفعله الخادم', () => {
  it('أوّلُ نشرٍ يُشعل البوت، والتوستة تقرأ الحقيقة من الخادم', () => {
    const api = read('apps/api/src/routes/bot.ts');
    expect(api, 'كان البوت يُنشأ مطفأً ولا يشغّله شيء').toMatch(/const firstPublish = !cfg\.publishedVersionId;/);
    expect(api, '`live` تُحسب وتُعاد للشاشة').toMatch(/const live = /);
    // ويُعاد في جسم الردّ — لا يُحسب ثمّ يُهمَل
    expect(api.slice(api.indexOf('const live = '))).toMatch(/return \{[\s\S]{0,400}\blive\b/);
    const web = readBotScreen();
    expect(web, 'التوستة كانت تقول «يردّ بها من الآن» في كلّ حال').toMatch(/r\.live/);
  });

  it('التبديل يُنشئ الصفّ إن غاب — لا 200 بجسمٍ فارغ', () => {
    const api = read('apps/api/src/routes/bot.ts');
    const at = api.indexOf("'/bot/toggle'");
    expect(at).toBeGreaterThan(0);
    expect(api.slice(at - 400, at + 700)).toMatch(/onConflictDoUpdate/);
  });

  it('ذيلُ لوحة المنصّة يميّز الخطأ من الصفر', () => {
    const l = read('apps/web/src/app/console/layout.tsx');
    expect(l, 'كان `inc.data?.length ?? 0` يقرأ فشلَ الجلب «0 حادثة مفتوحة»')
      .toMatch(/inc\.error/);
  });
});

describe('لا عميلَ بلا سقف، ولا بوتَ بلا رابط', () => {
  it('إنشاء المستأجر يُنشئ اشتراكاً', () => {
    const c = read('apps/api/src/routes/console.ts');
    expect(c, 'بلا صفّ اشتراك تُرجع checkQuota سقفاً لا نهائيّاً').toMatch(/insert\(subscriptions\)/);
  });

  it('النشر يستخرج مضيفي الروابط من المعرفة', () => {
    expect(read('apps/api/src/routes/bot.ts')).toMatch(/linkHostsFrom\(/);
  });
});

describe('نبضةُ العامل تُكتب وتُقرأ', () => {
  it('العامل ينبض بعمرٍ محدود ويمحو نبضته عند الإغلاق', () => {
    const m = read('apps/worker/src/main.ts');
    expect(m).toMatch(/aibot:worker:beat/);
    expect(m, 'العمر شرط: نبضةٌ بلا انقضاء لا تقول شيئاً عن عاملٍ مات').toMatch(/'EX', BEAT_TTL_SEC/);
    expect(m).toMatch(/connection\.del\(BEAT_KEY\)/);
  });

  it('بوّابة الصحّة تعرضها — فيراها مراقبٌ خارج المضيف', () => {
    expect(read('apps/api/src/main.ts')).toMatch(/worker: beat\.alive/);
  });
});
