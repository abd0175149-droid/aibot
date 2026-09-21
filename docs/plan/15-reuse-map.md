# ١٥ — خريطة الاقتباس من `unified-mafia`

> المسارات نسبيّةٌ إلى `C:\Projects\new mafia\unified-mafia\`.
> الرموز: **⇒ انقل** (بتعديلٍ طفيف) · **≈ اقتبس** (الفكرة لا الكود) · **✗ اترك**.

## ١٥.١ الباكند

| المصدر | الحكم | ماذا تحديداً |
|--------|-------|--------------|
| `backend/src/services/whatsapp-inbox.service.ts` | **⇒** | `callWaApi` · `getOrCreateConversation` · `isFreeWindowOpen` · **حارس النافذة في `sendMessage`** · `extractInbound` · `isOptoutMessage` · `handleStatusUpdate` · `processWebhookPayload` — مع استبدال `env.WA_*` ببيانات اعتماد المستأجر |
| `backend/src/utils/phone.util.ts` | **⇒** | `normalizeLocalPhone` + `normalizeAnyPhone`: الأردنيّ محلّيّاً والباقي E.164، ولا تصادم. أضف دعم دولٍ أخرى بمكتبة `libphonenumber-js` إن توسّعت |
| `backend/src/services/whatsapp-bot.service.ts` — `runAgent` | **⇒** | الحلقة كاملةً: الاستدعاءات المتوازية، إعادة الأجزاء حرفيّاً، حارس التسريب، تجميع التوكنز |
| نفسه — `detectToolLeak` / `stripToolLeak` | **⇒** | حرفيّاً. ترتيب التنظيف مهمّ: الاسم الكامل مع الأقواس **قبل** الاسم المجرّد |
| نفسه — `handleBotIncoming` (debounce) | **≈** | الفكرة تُنفَّذ بـBullMQ: `jobId` ثابت + `delay: 2000` — لا مؤقّتات ذاكرة |
| نفسه — `buildToolDeclarations` + بوّابة الأدمن | **≈** | البنية تُعمَّم: التفعيل من `bot_tools` لا من ثابتٍ في الكود |
| نفسه — `geminiGenerate` + `KNOWN_MODEL_PRICES` + `getBotUsage` | **⇒** | مع إخراج الأسعار إلى جدول `prices` والتسعير لحظة العرض |
| نفسه — الأدوات الأربعون | **✗** | كلّها خاصّة بالنادي. تبقى ثلاثة أنماط: التأكيد بالزرّ، `send_quick_options` بحدّ ٢٠ حرفاً، والتحويل لإنسان |
| نفسه — `DEFAULT_SYSTEM_PROMPT` | **≈** | **اقرأه بعناية**: أبوابه (الهويّة، الشفافيّة، الانضباط، حدود الصلاحيّات، الخصوصيّة، النطاق والتحويل) هي **هيكل قالب الشخصيّة** الذي تعطيه لكلّ عميل. اقتبس البنية واستبدل المحتوى |
| `backend/src/services/wa-health.service.ts` | **⇒** | كلّه: الفحوص، `IGNORED_CODES`، التنبيه عند التغيّر لا كلّ فحص، الرفع التلقائيّ بعد فحصين، الروابط المرفقة بكلّ عطل |
| `backend/src/services/wa-bot-ext.service.ts` — `transcribePendingAudio` | **⇒** | تفريغ الصوت عبر Gemini |
| نفسه — `auditBot` · `alertAdminsWA` | **≈** | التدقيق ⟵ `audit_log`، والتنبيه ⟵ Push لا واتساب |
| `backend/src/services/fcm.service.ts` | **≈** | خذ **مسار VAPID فقط** (`web-push`)، واترك فرع FCM/Firebase كاملاً |
| `backend/src/config/vapid.ts` | **⇒** | أولويّة: البيئة ← ملفّ محفوظ ← توليد. ثبات المفاتيح شرطٌ لبقاء المشتركين |
| `backend/src/routes/whatsapp-inbox.routes.ts` | **≈** | شكل المسارات ممتاز؛ أعد كتابتها بـFastify + Zod مع حقن المستأجر |
| `backend/src/services/whatsapp-{campaigns,broadcast,templates}` | **✗** | الحملات خارج الإصدار الأوّل عمداً (`05.7`) |
| `backend/src/schemas/admin.schema.ts` (جداول wa_*) | **≈** | الأعمدة مرجعٌ ممتاز؛ المخطّط الجديد في `06` |

## ١٥.٢ الواجهة

| المصدر | الحكم | ماذا |
|--------|-------|------|
| `frontend/src/app/admin/whatsapp/page.tsx` | **≈** | تخطيط الإنبوكس · فقاعات المصادر · شارة «يحتاج تدخّلاً» · محرّر الشخصيّة بعدّاد · مفاتيح الأدوات · الساحة بأثر الأدوات · بطاقة الاستهلاك (bento). **التخطيط والسلوك لا الكود** |
| `QualityTab.tsx` · `HealthBar.tsx` | **≈** | شكل عرض الصحّة والجودة للمستخدم غير التقنيّ |
| `frontend/public/sw.js` | **⇒** | معالج `push`/`notificationclick`، ودورة حياة الإشعار (`tag` + `renotify`)، ومزالق iOS |
| أنماط SweetAlert وSonner | **≈** | استبدلها بمكوّنات shadcn — لا تنقل تبعيّةً جديدة بلا سبب |

## ١٥.٣ البنية التحتيّة

| المصدر | الحكم | ماذا |
|--------|-------|------|
| `deploy.sh` | **⇒** | العقد العشرة كاملاً (`02.5`)، مع تبديل الأسماء والمنافذ |
| `docker-compose.yml` | **⇒** | نمط `${VAR:?}` بلا قيمة احتياطيّة · ربط مخازن البيانات بـ`127.0.0.1` · التعليقات التشخيصيّة التي تشرح سبب كلّ قرار |
| `backend/Dockerfile` | **⇒** | مع ملاحظة: الصورة تشغّل **مصادر TypeScript من `/app/src`** عبر tsx ولا يوجد `/app/dist` — تذكّرها عند التحقّق من أنّ الحاوية تحمل الكود الجديد |
| `backend/src/config/env.ts` | **⇒** | نمط التحقّق من البيئة مع تحذيراتٍ واضحة عند غياب سرّ |
| `test-game.ts` / `e2e-fnb.ts` | **≈** | أسلوب البطّاريّة: سيناريوهاتٌ مرقّمة تُشغَّل على الخادم وتطبع نجاحاً/فشلاً لكلّ واحد |

## ١٥.٤ أخطاءٌ لا تُكرَّر (مقروءة من تاريخ المشروع)

1. **صفّ إعداداتٍ واحد** ⟵ إعداداتٌ لكلّ مستأجر مع نسخٍ منشورة.
2. **حالةٌ في ذاكرة العمليّة** (مؤقّتات، أقفال، تعليق إرسال، أقفال ربط) ⟵ ريدِس.
3. **مفتاحٌ نصّ صريح في القاعدة** ⟵ تشفير بمفتاحٍ رئيس.
4. **توقيع ويبهوك اختياريّ** ⟵ إلزاميّ وإلّا فالقناة معطَّلة.
5. **`X-Forwarded-For[0]` أساساً للحدّ من المعدّل** ⟵ مزوَّر؛ اعتمد `trustProxy` للنفق فقط.
6. **٢٥ جدولاً بلا CASCADE** ⟵ CASCADE من الترحيل الأوّل.
7. **صفّ إشعارٍ لكلّ دفعة** ⟵ دورة حياةٍ واحدة لكلّ موضوع (upsert بالـtag).
8. **أداةٌ خطرة تُنفَّذ بقرار النموذج** ⟵ زرٌّ + معالجٌ حتميّ يُعيد التحقّق.
9. **«نجح النشر» تُطبع دائماً** ⟵ بوّابة صحّةٍ هي التي تقرّر.
10. **الاختبار محلّيّاً** ⟵ على الخادم، إلّا التحقّق الساكن.

## ١٥.٥ أوّل يومٍ عمليّ

```bash
mkdir C:\Projects\aibot && cd C:\Projects\aibot
pnpm init && git init
# انسخ للمرجع لا للتشغيل:
#   unified-mafia/backend/src/services/whatsapp-inbox.service.ts
#   unified-mafia/backend/src/services/whatsapp-bot.service.ts
#   unified-mafia/backend/src/services/wa-health.service.ts
#   unified-mafia/backend/src/utils/phone.util.ts
#   unified-mafia/deploy.sh · docker-compose.yml
# ثمّ ابدأ المرحلة صفر في 12-roadmap.md
```
