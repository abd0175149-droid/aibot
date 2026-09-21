# تفعيل نطاقٍ على النفق

> **النفق `cloudpanel-tunnel` مُدارٌ من لوحة Cloudflare** (`config_src: cloudflare`)،
> وفيه 44 مساراً. الملفّ المحلّيّ `/etc/cloudflared/config.yml` **أثرٌ قديم متجاهَل** —
> لا تعدّله، ولا تُعِد تشغيل الخدمة.

## كيف تتحقّق من وضع الإدارة

```bash
ssh mafia-prod
J=$(awk '/ARGO TUNNEL TOKEN/{f=1;next}/-----END/{f=0}f' ~/.cloudflared/cert.pem \
     | tr -d '\n' | base64 -d)
TOK=$(echo "$J" | python3 -c 'import sys,json;print(json.load(sys.stdin)["apiToken"])')
ACC=$(echo "$J" | python3 -c 'import sys,json;print(json.load(sys.stdin)["accountID"])')
curl -s "https://api.cloudflare.com/client/v4/accounts/${ACC}/cfd_tunnel?is_deleted=false" \
  -H "Authorization: Bearer ${TOK}" | python3 -m json.tool | grep config_src
```

`"config_src": "cloudflare"` ⟵ اللوحة هي المصدر · `"local"` ⟵ الملفّ هو المصدر.

⚠️ `ExecStart` يحوي `--config` في الحالتين، فهو **ليس دليلاً** على وضع الإدارة.
   (استنتاجٌ خاطئ كلّف جولةً كاملة من التشخيص.)

## الإضافة

**Zero Trust → Networks → Tunnels → cloudpanel-tunnel → Public Hostnames**

لـAiBot، ثلاثة مسارات **كلّها فوق `*.masaros.net`**:

| # | Subdomain | Domain | Path | Service |
|---|---|---|---|---|
| ١ | `aibot` | `masaros.net` | `api/*` | `HTTP` → `127.0.0.1:4100` |
| ٢ | `aibot` | `masaros.net` | `socket.io/*` | `HTTP` → `127.0.0.1:4100` |
| ٣ | `aibot` | `masaros.net` | *(فارغ)* | `HTTP` → `127.0.0.1:3070` |

**الترتيب حاسم مرّتين:**
- المسار الفارغ **آخر الثلاثة** — وإلّا ابتلع `api/*` و`socket.io/*`.
- الثلاثة **فوق `*.masaros.net`** — وهو المسار الجامع الذي يوجّه أيّ اسمٍ غير
  مُعرَّف إلى `localhost:5050`. (وهو سبب ظهور تطبيق MasarOS على `aibot` قبل الإضافة.)

الإضافة تُنشئ سجلّ DNS تلقائيّاً، وتسري خلال ثوانٍ **بلا إعادة تشغيلٍ وبلا انقطاعٍ لأحد**.

## التحقّق — بالجسم لا بكود الحالة

```bash
curl -s https://aibot.masaros.net/api/health | grep '"service":"aibot"'
```

كود 200 وحده **لا يُثبت شيئاً**: المسار الجامع يردّ 200 من تطبيقٍ آخر.
ولهذا السبب نفسه تُطابق بوّابة `deploy.sh` الجسم و`rev` معاً.

## ملاحظة أمنيّة

`~/.cloudflared/cert.pem` يحمل توكن API بصلاحيّة كتابةٍ على `grade.sbs`
وقراءةٍ على الحساب. من يقرأ الملفّ يستطيع تعديل DNS ذلك النطاق —
صلاحيّات الملفّ تستحقّ مراجعة.
