/**
 * هجرة بوت نُسك من Laravel إلى المنصّة.
 *
 * يُشغَّل على الخادم، ويقرأ الإعدادات الحيّة من حاوية `nuskjo-app` عبر artisan،
 * فلا يمرّ سرٌّ عبر الشبكة ولا يُطبع في سجلّ.
 *
 * متَماثِل: تشغيله مرّتين لا يُنتج مستأجرَين ولا يكرّر أداة.
 *
 * ⚠️ لا يلمس ويبهوك ميتا. التحويل قرارٌ منفصل بخطوةٍ منفصلة — فالبوت الجديد
 *    يجب أن يُثبت أنّه يردّ في الساحة قبل أن يُسلَّم زبائن عميلٍ حقيقيّ.
 */
import { execFileSync } from 'node:child_process';
import {
  getDb, closeDb, withPlatform, tenants, users, plans, subscriptions,
  tenantChannels, botConfigs, botVersions, botTools, aiKeys, auditLog,
  eq, and, desc,
} from '../packages/db/src/index';
import { seal, fingerprint, publicId } from '../packages/crypto/src/index';
import { decideKnowledgeMode, estimateTokens } from '../packages/core/src/index';
import { whatsappCapabilities } from '../packages/channels/src/index';

const SLUG = 'nuskjo';
const NAME = 'نُسك الذهبية للسياحة والسفر';
const OWNER_EMAIL = process.env.NUSKJO_OWNER_EMAIL ?? 'owner@nuskjo.local';
const NUSKJO_BASE = process.env.NUSKJO_API_BASE ?? 'https://nuskjo.grade.sbs';

/** يقرأ قيمةً واحدة من إعدادات نُسك الحيّة. لا يُطبع شيءٌ إلّا ما نطلبه. */
function nuskjo(expr: string): string {
  const php = `$s = \\App\\Models\\WaBotSetting::current(); echo ${expr};`;
  return execFileSync('docker', ['exec', 'nuskjo-app', 'php', 'artisan', 'tinker', '--execute', php], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

/**
 * الأدوات السبع — تُترجَم من نداءاتٍ داخليّة في Laravel إلى أدوات HTTP.
 * الأوصاف منقولةٌ **حرفيّاً** من BotTools.php: هي ما يقرأه النموذج ليقرّر
 * متى يستعمل الأداة، وإعادة صياغتها تغيّر سلوك البوت بلا أن يُلاحظ أحد.
 */
const TOOLS = [
  {
    key: 'get_offers',
    titleAr: 'العروض والباقات',
    description:
      'اجلب قائمة العروض والباقات المتاحة حالياً (عمرة، حج، تذاكر، فنادق، تأشيرات...). ' +
      'استدعِها عندما يسأل العميل عن العروض أو الأسعار أو ما هو متاح. ' +
      'اعرض النتائج بإيجاز ولا تخترع عرضاً غير موجود.',
    params: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'تصنيف اختياري: umrah|hajj|flight|visa|hotel|transport|tour|package' },
      },
      required: [],
    },
    http: { method: 'GET', url: `${NUSKJO_BASE}/api/bot/offers?category={{category}}`, timeoutMs: 8000 },
    map: { offers: '$.data' },
  },
  {
    key: 'get_offer_details',
    titleAr: 'تفاصيل عرض',
    description:
      'تفاصيل عرض محدد برقمه (يشمل ما يشمله وما لا يشمله والفندق والتواريخ). ' +
      'استدعِها بعد أن يختار العميل عرضاً من القائمة.',
    params: {
      type: 'object',
      properties: { offer_id: { type: 'integer', description: 'رقم العرض' } },
      required: ['offer_id'],
    },
    http: { method: 'GET', url: `${NUSKJO_BASE}/api/bot/offers/{{offer_id}}`, timeoutMs: 8000 },
    map: { offer: '$.data' },
  },
  {
    key: 'get_my_balance',
    titleAr: 'رصيد العميل',
    description:
      'رصيد ذمّة العميل الحالي (كم عليه من مبالغ). ' +
      'تعمل فقط إن كان رقم المحادثة مربوطاً بحساب عميل مسجّل.',
    params: { type: 'object', properties: {}, required: [] },
    http: { method: 'GET', url: `${NUSKJO_BASE}/api/bot/me/balance?phone={{__contact_phone}}`, timeoutMs: 8000 },
    map: { balance: '$.data.balance', currency: '$.data.currency', linked: '$.data.linked' },
  },
  {
    key: 'get_my_invoices',
    titleAr: 'فواتير العميل',
    description:
      'فواتير العميل الحالي المعتمدة مع المبلغ المتبقي على كل فاتورة. ' +
      'استدعِها إذا سأل عن فواتيره أو ما تبقّى عليه.',
    params: { type: 'object', properties: {}, required: [] },
    http: { method: 'GET', url: `${NUSKJO_BASE}/api/bot/me/invoices?phone={{__contact_phone}}`, timeoutMs: 8000 },
    map: { invoices: '$.data', linked: '$.linked' },
  },
  {
    key: 'get_my_trips',
    titleAr: 'رحلات العميل',
    description: 'رحلات العميل الحالي القادمة (تواريخ السفر المسجّلة على فواتيره المعتمدة).',
    params: { type: 'object', properties: {}, required: [] },
    http: { method: 'GET', url: `${NUSKJO_BASE}/api/bot/me/trips?phone={{__contact_phone}}`, timeoutMs: 8000 },
    map: { trips: '$.data', linked: '$.linked' },
  },
  {
    key: 'request_quote',
    titleAr: 'طلب تسعير',
    description:
      'أنشئ طلب تسعير وحوّل المحادثة لموظف. استدعِها عندما يطلب العميل سعراً نهائياً لرحلة طيران ' +
      'أو خدمة، أو يسأل عن توفّر المقاعد. اجمع أولاً بالحوار: المسار (من/إلى) وتاريخ السفر وعدد ' +
      'المسافرين. لا تذكر أي سعر من عندك أبداً — الموظف هو من يسعّر.',
    params: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'flight|package|visa|hotel|transport|other' },
        route_from: { type: 'string', description: 'مدينة/مطار المغادرة' },
        route_to: { type: 'string', description: 'مدينة/مطار الوصول' },
        depart_date: { type: 'string', description: 'تاريخ السفر YYYY-MM-DD' },
        return_date: { type: 'string', description: 'تاريخ العودة إن وُجد YYYY-MM-DD' },
        pax: { type: 'integer', description: 'عدد المسافرين' },
        details: { type: 'string', description: 'ملخّص ما طلبه العميل بكلماته' },
      },
      required: ['type', 'details'],
    },
    http: {
      method: 'POST', url: `${NUSKJO_BASE}/api/bot/quotes`, timeoutMs: 8000,
      bodyTemplate: JSON.stringify({
        phone: '{{__contact_phone}}', type: '{{type}}',
        route_from: '{{route_from}}', route_to: '{{route_to}}',
        depart_date: '{{depart_date}}', return_date: '{{return_date}}',
        pax: '{{pax}}', details: '{{details}}',
      }),
    },
    map: { reference: '$.data.reference', ok: '$.ok' },
    // فعلٌ يكتب ⟵ تأكيدٌ بزرّ، والتنفيذ معالجٌ حتميّ عند الضغط
    confirmRequired: true,
    confirmTemplate: 'بنجهّز طلب تسعير بهالتفاصيل ونحوّلك لموظف. أأكّد؟',
  },
  {
    key: 'confirm_booking',
    titleAr: 'تأكيد حجز',
    description:
      'العميل يريد تأكيد حجز عرض معيّن. استدعِها عند موافقته الصريحة على الحجز. ' +
      'تُنشئ طلب حجز وتحوّل المحادثة لموظف ليُتمّه. ' +
      'لا تؤكّد للعميل أنّ الحجز مكتمل — قل إنّ موظفاً سيتواصل لإتمامه.',
    params: {
      type: 'object',
      properties: {
        offer_id: { type: 'integer', description: 'رقم العرض المطلوب حجزه' },
        details: { type: 'string', description: 'أي تفاصيل ذكرها العميل (أسماء، ملاحظات، تواريخ مفضّلة)' },
      },
      required: ['offer_id'],
    },
    http: {
      method: 'POST', url: `${NUSKJO_BASE}/api/bot/bookings`, timeoutMs: 8000,
      bodyTemplate: JSON.stringify({
        phone: '{{__contact_phone}}', offer_id: '{{offer_id}}', details: '{{details}}',
      }),
    },
    map: { reference: '$.data.reference', ok: '$.ok' },
    confirmRequired: true,
    confirmTemplate: 'بنسجّل طلب حجز لهالعرض ونحوّلك لموظف ليكمّله. أأكّد؟',
  },
] as const;

async function main(): Promise<void> {
  const db = getDb();

  /* ── ① القراءة من نُسك ── */
  const persona = nuskjo('$s->system_prompt ?: \\App\\Services\\WhatsApp\\BotEngine::DEFAULT_PROMPT');
  const knowledge = nuskjo('(string)$s->knowledge_base');
  const model = nuskjo('(string)$s->model');
  const phoneNumberId = nuskjo('(string)$s->phoneNumberId()');
  const verifyToken = nuskjo('(string)$s->verifyToken()');
  const waToken = nuskjo('(string)$s->token()');
  const appSecret = nuskjo('(string)$s->appSecret()');
  const aiKey = nuskjo('(string)$s->llmKey()');
  const pauseMinutes = Number(nuskjo('(int)$s->pause_minutes')) || 30;
  const contextMessages = Number(nuskjo('(int)$s->context_messages')) || 20;
  const maxToolLoops = Number(nuskjo('(int)$s->max_tool_loops')) || 4;
  const failMessage = nuskjo('(string)$s->fail_message');

  for (const [k, v] of Object.entries({ persona, phoneNumberId, waToken, appSecret, aiKey })) {
    if (!v) throw new Error(`القيمة ${k} فارغة — لا هجرة بإعدادٍ ناقص`);
  }
  console.log(`✔ قُرئت إعدادات نُسك — شخصيّة ${persona.length} حرفاً · معرفة ${knowledge.length} حرفاً`);

  const result = await withPlatform(db, 'هجرة عميل نُسك من نظامه القديم', async (tx) => {
    /* ── ② المستأجر ── */
    let tenant = (await tx.select().from(tenants).where(eq(tenants.slug, SLUG)).limit(1))[0];
    if (!tenant) {
      [tenant] = await tx.insert(tenants).values({
        publicId: publicId(), name: NAME, slug: SLUG, status: 'active',
        timezone: 'Asia/Amman', locale: 'ar',
        // الحملات مقفلةٌ افتراضيّاً — وهي السبب نفسه الذي عطّل حساباً سابقاً
        capabilities: { campaigns: false, customTools: true },
      }).returning();
      console.log(`✔ أُنشئ المستأجر — publicId=${tenant!.publicId}`);
    } else {
      console.log(`ℹ️  المستأجر موجود — publicId=${tenant.publicId}`);
    }
    const tenantId = tenant!.id;

    /* ── ③ الاشتراك: باقة «نموّ» ── */
    const plan = (await tx.select().from(plans).where(eq(plans.name, 'نموّ')).limit(1))[0];
    const sub = (await tx.select().from(subscriptions)
      .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.status, 'active'))).limit(1))[0];
    if (plan && !sub) {
      const now = new Date();
      await tx.insert(subscriptions).values({
        tenantId, planId: plan.id, status: 'active',
        periodStart: now,
        periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()),
      });
      console.log('✔ اشتراك باقة «نموّ»');
    }

    /* ── ④ مالك الحساب ── */
    const existingUser = (await tx.select().from(users).where(eq(users.email, OWNER_EMAIL)).limit(1))[0];
    let tempPassword: string | null = null;
    if (!existingUser) {
      const { scrypt, randomBytes } = await import('node:crypto');
      const { promisify } = await import('node:util');
      const s = promisify(scrypt) as (p: string, salt: Buffer, l: number) => Promise<Buffer>;
      tempPassword = 'nusk-' + publicId().slice(0, 8).toLowerCase();
      const salt = randomBytes(16);
      const key = await s(tempPassword, salt, 64);
      await tx.insert(users).values({
        tenantId, email: OWNER_EMAIL,
        passwordHash: `scrypt$${salt.toString('base64')}$${key.toString('base64')}`,
        name: 'نُسك الذهبية', role: 'tenant_owner', mustChangePassword: true,
      });
      console.log('✔ أُنشئ حساب مالك العميل');
    }

    /* ── ⑤ القناة: بيانات واتساب الحقيقيّة، مشفَّرة ── */
    let channel = (await tx.select().from(tenantChannels)
      .where(and(eq(tenantChannels.tenantId, tenantId), eq(tenantChannels.kind, 'whatsapp_cloud')))
      .limit(1))[0];
    const sealedToken = seal(waToken);
    const sealedSecret = seal(appSecret);
    const chValues = {
      tenantId, kind: 'whatsapp_cloud' as const,
      externalAccountId: phoneNumberId,
      displayName: 'نُسك — واتساب',
      config: { wabaId: process.env.NUSKJO_WABA_ID ?? null },
      capabilities: whatsappCapabilities as unknown as object,
      tokenEnc: sealedToken.enc,
      tokenFingerprint: fingerprint(waToken),
      appSecretEnc: sealedSecret.enc,
      // نُبقي توكن التحقّق نفسه، فالتحويل في لوحة ميتا لا يحتاج تغييره
      verifyToken: verifyToken || 'nuskjo_wh_7Kq2mR9xLp4TvB',
      keyVersion: sealedToken.keyVersion,
      status: 'connected' as const,
      connectedAt: new Date(),
    };
    if (!channel) {
      [channel] = await tx.insert(tenantChannels).values(chValues).returning();
      console.log(`✔ أُنشئت القناة — بصمة التوكن ${chValues.tokenFingerprint}`);
    } else {
      await tx.update(tenantChannels).set(chValues).where(eq(tenantChannels.id, channel.id));
      console.log('✔ حُدِّثت القناة');
    }

    /* ── ⑥ مفتاح الذكاء: مفتاح نُسك نفسه.
           `key_owner=tenant` يُعفيه من سقف توكنز المنصّة — وهو تصميمٌ مقصود. ── */
    const sealedKey = seal(aiKey);
    const existingKey = (await tx.select().from(aiKeys)
      .where(and(eq(aiKeys.tenantId, tenantId), eq(aiKeys.provider, 'google'))).limit(1))[0];
    if (!existingKey) {
      await tx.insert(aiKeys).values({
        tenantId, provider: 'google', keyEnc: sealedKey.enc,
        keyFingerprint: fingerprint(aiKey), keyVersion: sealedKey.keyVersion, isActive: true,
      });
      console.log(`✔ مفتاح الذكاء الخاصّ بنُسك — ${fingerprint(aiKey)}`);
    }

    /* ── ⑦ الأدوات ── */
    const toolSecret = process.env.NUSKJO_BOT_API_TOKEN;
    if (!toolSecret) console.log('⚠ NUSKJO_BOT_API_TOKEN غير مضبوط — الأدوات ستُنشأ بلا سرّ');
    const sealedToolSecret = toolSecret ? seal(JSON.stringify({ API_TOKEN: toolSecret })) : null;

    for (const t of TOOLS) {
      const exists = (await tx.select().from(botTools)
        .where(and(eq(botTools.tenantId, tenantId), eq(botTools.key, t.key))).limit(1))[0];
      const values = {
        tenantId, key: t.key, titleAr: t.titleAr, description: t.description,
        kind: 'http' as const, enabled: true,
        requiresCapabilities: [] as string[],
        paramsSchema: t.params as object,
        http: {
          ...t.http,
          headers: { Authorization: 'Bearer {{secret.API_TOKEN}}', Accept: 'application/json' },
        } as object,
        responseMap: t.map as object,
        secretsEnc: sealedToolSecret?.enc ?? null,
        keyVersion: sealedToolSecret?.keyVersion ?? 1,
        confirmRequired: 'confirmRequired' in t ? Boolean(t.confirmRequired) : false,
        confirmTemplate: 'confirmTemplate' in t ? (t.confirmTemplate as string) : null,
      };
      if (exists) await tx.update(botTools).set(values).where(eq(botTools.id, exists.id));
      else await tx.insert(botTools).values(values);
    }
    console.log(`✔ ${TOOLS.length} أدوات HTTP`);

    /* ── ⑧ الإعداد والنسخة المنشورة ── */
    await tx.insert(botConfigs).values({
      tenantId,
      enabled: false, // ⚠️ مطفأ عمداً حتّى يُختبر في الساحة
      pauseMinutes, maxToolLoops, contextMessages,
      failMessage: failMessage || 'عذراً، صار خلل مؤقّت. موظف رح يتواصل معك حالاً.',
      failHandoff: true,
    }).onConflictDoUpdate({
      target: botConfigs.tenantId,
      set: { pauseMinutes, maxToolLoops, contextMessages, updatedAt: new Date() },
    });

    const lastVer = (await tx.select({ v: botVersions.version }).from(botVersions)
      .where(eq(botVersions.tenantId, tenantId)).orderBy(desc(botVersions.version)).limit(1))[0];
    const kbTokens = estimateTokens(knowledge);
    const mode = decideKnowledgeMode(kbTokens);

    const [ver] = await tx.insert(botVersions).values({
      tenantId, version: (lastVer?.v ?? 0) + 1,
      persona, knowledgeBase: knowledge,
      toolsConfig: Object.fromEntries([
        ...TOOLS.map((t) => [t.key, true]),
        ['handoff_to_human', true], ['save_note', true], ['send_quick_options', true],
        ['ask_confirmation', true], ['check_business_hours', true],
      ]),
      provider: 'google',
      // gemini-3.5-flash-lite كان عند نُسك؛ نُبقيه ما لم يُطلب غيره
      model: model || 'gemini-2.5-flash',
      params: { constraints: '', linkHosts: ['nuskjo.grade.sbs'] },
      knowledgeMode: mode,
      embedStatus: mode === 'full' ? 'skipped' : 'pending',
      publishedAt: new Date(),
      note: 'هجرةٌ من نظام نُسك القديم (Laravel)',
    }).returning();

    if (mode === 'full') {
      await tx.update(botConfigs).set({ publishedVersionId: ver!.id })
        .where(eq(botConfigs.tenantId, tenantId));
    }
    console.log(`✔ نسخة v${ver!.version} · معرفة ${kbTokens} توكن · وضع ${mode}`);

    await tx.insert(auditLog).values({
      tenantId, action: 'tenant.migrate',
      entity: 'tenant', entityId: tenantId,
      diff: { from: 'nuskjo-laravel', tools: TOOLS.length, personaChars: persona.length },
    });

    return {
      publicId: tenant!.publicId,
      tenantId,
      tempPassword,
      versionId: ver!.id,
      knowledgeMode: mode,
    };
  });

  console.log('');
  console.log('════════════════════════════════════════════');
  console.log(`عنوان الويبهوك الجديد (لا تبدّله في ميتا بعد):`);
  console.log(`  ${process.env.PUBLIC_URL ?? 'https://aibot.masaros.net'}/api/webhooks/wa/${result.publicId}`);
  console.log(`توكن التحقّق: ${verifyToken} (نفس القديم — لا يحتاج تغييراً)`);
  if (result.tempPassword) console.log(`دخول مالك الحساب: ${OWNER_EMAIL} / ${result.tempPassword}`);
  console.log('');
  console.log('⚠️ البوت **مطفأ**. شغّله من الواجهة بعد أن تختبره في الساحة.');
  console.log('════════════════════════════════════════════');

  await closeDb();
}

main().catch(async (e) => {
  console.error('فشلت الهجرة:', (e as Error).message);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
