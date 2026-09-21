# ١٠ — عقد الـAPI والأحداث

القاعدة: `https://aibot.masaros.net/api`. كلّ المسارات (عدا الويبهوك والمصادقة) تتطلّب
`Authorization: Bearer <access>`، ويُشتقّ `tenantId` **من التوكن لا من الطلب** — لا يُرسل
معرّف المستأجر في جسمٍ أو مسار أبداً (عدا مسارات المالك الصريحة `/console/*`).

كلّ استجابة خطأ بالشكل: `{ error: { code, message, details? } }` مع `code` ثابتٍ قابلٍ
للترجمة (`WINDOW_CLOSED`, `QUOTA_EXCEEDED`, `CHANNEL_DISCONNECTED`, `TOOL_TIMEOUT` …).

## ١٠.١ الويبهوك (عامّ، بلا مصادقة توكن)

| المسار | الغرض |
|-------|-------|
| `GET /webhooks/wa/:publicId` | تحدّي ميتا: يقارن `hub.verify_token` بتوكن هذا المستأجر ويعيد `hub.challenge` |
| `POST /webhooks/wa/:publicId` | استقبال الأحداث: تحقّق توقيع بـApp Secret الخاصّ به ⟵ 200 فوراً ⟵ طابور |

## ١٠.٢ المصادقة

`POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` ·
`POST /auth/invite/accept` · `POST /auth/password/forgot` · `POST /auth/password/reset` ·
`GET /me` (المستخدم + المستأجر + الباقة + الصلاحيّات + الاستهلاك المختصر).

## ١٠.٣ لوحة العميل (`/app`)

**الإنبوكس**
```
GET    /conversations?status&needsAttention&tag&q&cursor
GET    /conversations/:id
GET    /conversations/:id/messages?before&limit
POST   /conversations/:id/messages        { text | interactive }   ← يمرّ بحارس النافذة
POST   /conversations/:id/read
POST   /conversations/:id/bot             { enabled | pauseMinutes }
POST   /conversations/:id/assign          { userId }
POST   /conversations/:id/tags            { add[], remove[] }
POST   /conversations/:id/notes           { note }
POST   /conversations/:id/close
```

**البوت**
```
GET    /bot                     الإعداد + المسوّدة + النسخة المنشورة
PUT    /bot/draft               حفظ مسوّدة
POST   /bot/publish             { note }        ← ينشئ نسخة
GET    /bot/versions            القائمة + الفروق
POST   /bot/versions/:id/rollback
POST   /bot/toggle              { enabled }
POST   /bot/playground          { messages[], simulateTools? }  → { reply, toolTrace, usage }
GET    /bot/tools · POST /bot/tools · PUT /bot/tools/:id · DELETE /bot/tools/:id
POST   /bot/tools/:id/test      { sampleParams }   → { request, response, mapped, ms }
GET    /bot/knowledge · POST /bot/knowledge (رفع) · DELETE /bot/knowledge/:id
GET    /bot/knowledge/gaps      الأسئلة التي عجز عنها
```

**القناة والحساب**
```
GET    /channel                 الحالة والجودة والمستوى وبصمة التوكن (لا التوكن)
PUT    /channel                 { phoneNumberId, wabaId, token, appSecret }
POST   /channel/test            يتحقّق فعليّاً من التوكن والرقم والاشتراك
GET    /contacts?q&tag · PUT /contacts/:id · POST /contacts/:id/optout · GET /contacts/export
GET    /reports/overview?from&to · GET /reports/quality · GET /usage · GET /usage/windows (CSV)
GET    /team · POST /team/invite · PUT /team/:id · DELETE /team/:id
GET    /notifications · POST /notifications/read · POST /push/subscribe · DELETE /push/subscribe
GET    /audit                   سجلّ هذا المستأجر (يشمل انتحالك — يراه)
```

## ١٠.٤ لوحة المالك (`/console`) — تتطلّب `platform_owner`

```
GET    /console/tenants?status&q          صفّ لكلّ عميل + صحّة + استهلاك
POST   /console/tenants                   إنشاء + دعوة المالك
GET    /console/tenants/:id               كلّ شيء
PUT    /console/tenants/:id               الحالة، القدرات، الباقة، سقفٌ خاصّ
POST   /console/tenants/:id/suspend | /resume | /kill-bot
POST   /console/tenants/:id/impersonate   → توكن قراءةٍ فقط، مسجَّل، صلاحيّته ٣٠ دقيقة
DELETE /console/tenants/:id               حذفٌ كامل متتالٍ (تأكيدٌ باسم العميل)
GET    /console/incidents?status&severity&tenant
POST   /console/incidents/:id/ack | /resolve
GET    /console/usage?period              الإيراد والكلفة والهامش لكلّ عميل
GET    /console/plans · POST · PUT
GET    /console/audit
GET    /console/health                    الطوابير، العمّال، المزوّدون
```

## ١٠.٥ أحداث Socket.io

الاتّصال بتوكن، والانضمام لغرفة `t:{tenantId}` (أو `platform` للمالك) **بعد إعادة تحقّق**
من الصلاحيّة — لا يكفي التحقّق عند الاتّصال.

| الحدث | الحمولة | من يستقبل |
|------|---------|-----------|
| `message:new` | `{ conversation, message }` | غرفة المستأجر |
| `message:status` | `{ messageId, status, error? }` | المستأجر |
| `conversation:update` | `{ conversation }` | المستأجر |
| `bot:typing` | `{ conversationId }` | المستأجر (مؤشّر «البوت يكتب») |
| `quota:update` | `{ used, limit, percent }` | المستأجر |
| `incident:new` / `incident:update` | `{ incident }` | المستأجر (خاصّته) + `platform` |
| `channel:health` | `{ level, phone, waba }` | المستأجر + `platform` |
| `tenant:update` | `{ tenant }` | `platform` |

الحمولة **تحمل الصفّ الجديد كاملاً** لا مجرّد معرّف — يوفّر جولة ذهابٍ وإياب، ويُبقي الواجهة
متّسقة عند تعدّد التبويبات.

## ١٠.٦ قواعد عامّة

- **ترقيم بالمؤشّر** (cursor) لا بالصفحات: الإنبوكس يتغيّر تحت المستخدم.
- **مفتاح تكرار** (`Idempotency-Key`) إلزاميّ على `POST /conversations/:id/messages` — ضغطتان
  على «إرسال» لا ترسلان رسالتين.
- **حدّ معدّل** لكلّ توكن ولكلّ IP، مع ترويسات `RateLimit-*`.
- **الإصدار** في المسار (`/api/v1`) من اليوم الأوّل — أرخص من إضافته لاحقاً.
- **Zod مشترك**: نفس المخطّط يتحقّق في الخادم ويولّد أنواع الواجهة (`packages/shared`).
