#!/bin/bash
# ════════════════════════════════════════════════════════════════
# ترحيل AiBot إلى مضيفٍ جديد.
#
# العتبة المكتوبة في الخطّة: **العميل الثالث المدفوع ⟵ VPS**.
# ثلاثة عملاء يغطّون كلفة VPS خمس مرّات، والاستمرار على اللابتوب بعدها
# قرارٌ خاطئ لا وفر.
#
# الهدف: زمن تعطّلٍ أقلّ من 15 دقيقة.
# ════════════════════════════════════════════════════════════════
set -Eeuo pipefail

NEW_HOST="${1:?الاستعمال: ./migrate-host.sh user@new-host}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="/tmp/aibot-migrate-${STAMP}"

say() { echo -e "\n▶ $1"; }

say "1/7 — تجميد الكتابة: إيقاف العمّال والـAPI (القاعدة تبقى تعمل)"
docker compose stop api worker web

say "2/7 — نسخة القاعدة"
mkdir -p "$WORK"
docker compose exec -T db pg_dump -U "${DB_USER}" "${DB_NAME:-aibot}" | gzip > "${WORK}/db.sql.gz"
SZ=$(stat -c%s "${WORK}/db.sql.gz")
[ "$SZ" -gt 10000 ] || { echo "❌ النسخة ${SZ} بايت — pg_dump فشل صامتاً"; docker compose start api worker web; exit 1; }

say "3/7 — نسخة الوسائط"
docker run --rm -v aibot_media_data:/data -v "${WORK}":/out alpine \
  tar czf /out/media.tar.gz -C /data .

say "4/7 — النقل"
scp "${WORK}/db.sql.gz" "${WORK}/media.tar.gz" .env "${NEW_HOST}:/tmp/"

say "5/7 — الاستعادة على المضيف الجديد"
# ⚠️ ريدِس **لا يُنقل**: مهامّ الطوابير حالةٌ عابرة، ونقلها ينقل مهامّ
#    فاشلة ومؤجَّلة تُنفَّذ مرّتين. القاعدة هي مصدر الحقيقة الوحيد.
ssh "$NEW_HOST" bash -s <<'REMOTE'
set -Eeuo pipefail
mkdir -p ~/aibot && cd ~/aibot
[ -d .git ] || git clone https://github.com/<user>/aibot.git .
git pull origin master
cp /tmp/.env .env
docker compose up -d db redis
sleep 8
gunzip -c /tmp/db.sql.gz | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "${DB_USER}" -d "${DB_NAME:-aibot}"
docker run --rm -v aibot_media_data:/data -v /tmp:/in alpine tar xzf /in/media.tar.gz -C /data
docker compose up -d --build api worker web
REMOTE

say "6/7 — بوّابة الصحّة على المضيف الجديد"
ssh "$NEW_HOST" 'for i in $(seq 1 30); do
  curl -fsS -m 5 http://127.0.0.1:4100/api/health 2>/dev/null | grep -q "\"service\":\"aibot\"" && { echo "  ✔ حيّ"; exit 0; }
  sleep 1
done; echo "  ❌ لم يستجب"; exit 1'

cat <<MSG

✅ نُقلت البيانات. بقيت خطوةٌ واحدة **يدويّة**:

7/7 — تحويل النفق إلى المضيف الجديد:
   • ثبّت cloudflared على المضيف الجديد واربطه بنفس النفق، أو أنشئ نفقاً جديداً
   • بدّل الـPublic Hostname لـaibot.masaros.net إلى المضيف الجديد
   • تحقّق: curl -s https://aibot.masaros.net/api/health | grep '"service":"aibot"'

⚠️ لا توقف المضيف القديم قبل أن يمرّ الفحص العامّ — الرسائل الواردة
   خلال التحويل تضيع نهائيّاً (ميتا تُعيد المحاولة مدّةً محدودة ثمّ تستسلم).

النسخ في: ${WORK}
MSG
