#!/bin/bash
# ════════════════════════════════════════════════════════════════
# AiBot — الحزمة الاحتياطيّة المشفَّرة (تُشغَّل **على الخادم**)
#
# ★ لماذا وُجد هذا السكربت — والفرق بينه وبين لقطة `deploy.sh`:
#   لقطة النشر تحمي من «ترحيلٌ أفسد جدولاً». وهذا يحمي من «القرص مات».
#   أربع عشرة لقطةً كانت موجودةً يوم كُتب هذا السطر — **كلّها على نفس
#   اللابتوب** الذي يشغّل المنصّة، و`MASTER_KEY` في `.env` بجانبها.
#   فلو تعطّل القرص ضاعت البيانات **وضاع معها المفتاح**، فلا تُفكّ نسخةٌ
#   لو وُجدت: النسخة مشفَّرةٌ بمفتاحٍ ضائع. اللقطة وحدها ليست نسخةً
#   احتياطيّة — هي نسخةٌ من القرص على القرص نفسه.
#
# ★ ولماذا الحزمة تحمل `MASTER_KEY` مع القاعدة:
#   توكنات واتساب في القاعدة **مشفَّرةٌ** بـAES-256-GCM بذلك المفتاح
#   (`packages/crypto/src/index.ts`). فقاعدةٌ بلا مفتاحٍ = صفوفٌ تُقرأ
#   ولا تُستعمل: يُستعاد كلّ شيءٍ إلّا قدرةَ البوت على الإرسال.
#   ولهذا بالضبط **التشفير شرطٌ لا خيار**، والسكربت يرفض العمل بلا
#   عبارة مرورٍ بدل أن ينتج حزمةً عارية تحمل أخطر سرٍّ في المنصّة.
#
# 🔴 وأين تُحفظ عبارة المرور: في **مدير كلمات المرور** بجانب `MASTER_KEY`،
#    لا على هذا الخادم وحده. حزمةٌ مسحوبةٌ خارج الخادم وعبارةُ مرورها على
#    القرص الذي مات = حزمةٌ لا تُفكّ. (الملفّ المحلّيّ للجدولة فقط.)
#
# الاستعمال:
#   BACKUP_PASSPHRASE='…' ops/backup-offsite.sh
#   # أو اضبطها مرّةً في ~/.config/aibot/backup.env (chmod 600) — وهو ما
#   # تقرأه وحدةُ systemd، لأنّ المؤقّت لا يمرّ ببيئةٍ تفاعليّة.
#
# المتغيّرات:
#   BACKUP_PASSPHRASE       إلزاميّ (≥ ١٢ محرفاً)
#   BACKUP_PASSPHRASE_FILE  بديل: ملفٌّ فيه BACKUP_PASSPHRASE=… (الافتراضيّ أعلاه)
#   BACKUP_OFFSITE_DIR      الافتراضيّ ~/backups/aibot-offsite
#   BACKUP_KEEP_DAILY=7  ·  BACKUP_KEEP_WEEKLY=4
# ════════════════════════════════════════════════════════════════
set -Eeuo pipefail
# الحزمة تحمل أسراراً في مرحلتها الوسيطة — لا قراءةَ للمجموعة ولا للعالم.
umask 077
# مجلّدٌ فارغ حالةٌ مشروعة (أوّل تشغيل)، وبلا nullglob يبقى النمط نصّاً حرفيّاً
# فيُمرَّر إلى `ls` أو تُحاول `rm` حذفه. والعدّ والتنظيف أدناه يعتمدان عليه.
shopt -s nullglob

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

STAMP="$(date +%Y%m%d-%H%M%S)"
WEEK="$(date +%GW%V)"
NAME="aibot-${STAMP}"
OFFSITE="${BACKUP_OFFSITE_DIR:-${HOME}/backups/aibot-offsite}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
PASS_FILE="${BACKUP_PASSPHRASE_FILE:-${HOME}/.config/aibot/backup.env}"

ok()   { echo "  ✔ $1"; }
say()  { echo "▶ $1"; }
fail() { echo "❌ $1" >&2; }

# ── 0. عبارة المرور — قبل أيّ عملٍ آخر ───────────────────────────
# 🔴 الترتيب مقصود: لا يُلمس pg_dump قبل التأكّد أنّ ما سيُنتجه سيُشفَّر.
#    سكربتٌ يفحص العبارة في النهاية ينتج نصفَ حزمةٍ عارية ثمّ يشتكي.
if [ -z "${BACKUP_PASSPHRASE:-}" ] && [ -r "$PASS_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$PASS_FILE"; set +a
fi
if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  fail "BACKUP_PASSPHRASE غائبة — ولا حزمةَ عارية."
  {
    echo "   هذه الحزمة تحمل .env ومعه MASTER_KEY: مفتاح فكّ توكنات واتساب لكلّ عملائك."
    echo "   حزمةٌ غير مشفَّرة تُنسخ إلى جهازٍ آخر تعني أنّ كلّ من يقرأ ذلك الجهاز يقرأ"
    echo "   توكنات عملائك. فالتشفير شرطُ وجودِ الحزمة لا خطوةً إضافيّة."
    echo
    echo "   الإصلاح — مرّةً واحدة على الخادم:"
    echo "     mkdir -p ~/.config/aibot"
    echo "     install -m 600 /dev/null ${PASS_FILE}"
    echo "     printf 'BACKUP_PASSPHRASE=%s\\n' \"\$(openssl rand -base64 33)\" > ${PASS_FILE}"
    echo "   ثمّ **انسخ العبارة إلى مدير كلمات المرور** — لو بقيت هنا وحدها فهي تموت"
    echo "   مع القرص، وتموت معها كلّ حزمةٍ سُحبت خارج الخادم."
  } >&2
  exit 1
fi
if [ "${#BACKUP_PASSPHRASE}" -lt 12 ]; then
  fail "عبارة المرور ${#BACKUP_PASSPHRASE} محرفاً — الحدّ الأدنى ١٢."
  echo "   عبارةٌ قصيرة على حزمةٍ تحمل MASTER_KEY تشفيرٌ شكليّ: gpg يقاوم" >&2
  echo "   التخمين، لكنّه لا يخترع عشوائيّةً ليست في العبارة." >&2
  exit 1
fi

[ -f .env ] || { fail ".env غائب — لا حزمةَ بلا الأسرار التي تُستعاد بها"; exit 1; }
set -a; . ./.env; set +a
: "${DB_USER:?DB_USER غائبٌ من .env}"
DB="${DB_NAME:-aibot}"
[ -n "${MASTER_KEY:-}" ] || { fail "MASTER_KEY غائبٌ من .env — حزمةٌ بلا مفتاحٍ لا تُستعاد بها القناة"; exit 1; }

# gpg يحتاج مجلّد بيتٍ موجوداً حتّى في التشفير التناظريّ (لا مفاتيح، لكنّه يكتب
# random_seed). وتحت systemd لا يوجد من ينشئه، فيفشل المؤقّت وحده بعد أن ينجح يدويّاً.
export GNUPGHOME="${GNUPGHOME:-${HOME}/.gnupg}"
mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"

mkdir -p "${OFFSITE}/daily" "${OFFSITE}/weekly"
LOG="${OFFSITE}/backup.log"
log() { printf '%s  %s\n' "$(date -Is)" "$1" >> "$LOG"; }

# ── 1. مساحةُ عملٍ تُمحى حتماً ────────────────────────────────────
# داخل OFFSITE لا في /tmp: نفس نظام الملفّات (لا نسخٌ عبر الأقراص)، ولأنّ
# /tmp على بعض الأنظمة tmpfs فتذهب الحزمةُ الوسيطةُ إلى الذاكرة.
TMP="$(mktemp -d "${OFFSITE}/.work-${STAMP}-XXXXXX")"
STAGE="${TMP}/${NAME}"
mkdir -p "$STAGE"
cleanup() { rm -rf "$TMP"; }
# 🔴 EXIT لا ERR: المرحلة الوسيطة تحمل .env نصّاً صريحاً، فيجب أن تُمحى في
#    النجاح والفشل والمقاطعة جميعاً. ERR وحدها تترك الأسرار وراء Ctrl-C.
trap cleanup EXIT INT TERM

# ── 2. القاعدة ──────────────────────────────────────────────────
# 🔴 `< /dev/null` على كلّ نداء `docker compose exec -T` في هذا الملفّ ليس
#    زخرفة: الراية `-T` تمرّر stdin إلى الحاوية و**تستهلكه كلّه**. فلو نُودي
#    هذا السكربت من سياقٍ يقرأ من stdin (حلقة `while read`، أو سكربتٌ يُمرَّر
#    بـ`bash -s`) لأكل pg_dump بقيّةَ ذلك الإدخال، فيتوقّف المنادي في منتصفه
#    بلا خطأ. كُشف حين أكلت هذه السطور بقيّةَ سكربتِ اختبارٍ مُرِّر عبر ssh.
# ── 1أ. هل نُسخ شيءٌ أصلاً منذ يومَين؟ ──────────────────────────
# 🔴 المؤقّتُ قد يكون معطَّلاً، أو الوحدةُ تفشل ليلةً بعد ليلة — ولا شيءَ كان
#    يسأل «متى آخرُ حزمةٍ فعلاً؟». والسؤالُ يُطرح **هنا** لأنّ هذا أوّلُ شيءٍ
#    يعمل حين يعمل شيء: فإن كان الانقطاعُ طويلاً بقي أثرُه مكتوباً ولو نجحت
#    هذه الليلة. ولا يُفشِل التنفيذ: حزمةُ اليوم أهمُّ من الشكوى من الأمس.
NEWEST="$(find "${OFFSITE}/daily" -name '*.tar.gz.gpg' -printf '%T@\n' 2>/dev/null | sort -rn | head -1)"
if [ -n "$NEWEST" ]; then
  AGE_H=$(( ( $(date +%s) - ${NEWEST%.*} ) / 3600 ))
  if [ "$AGE_H" -gt 48 ]; then
    echo "⚠ آخرُ حزمةٍ عمرُها ${AGE_H} ساعة — انقطاعٌ لم يُبلَّغ عنه" \
      | tee -a "${OFFSITE}/BACKUP-FAILED" >&2
  fi
else
  echo "⚠ لا حزمةَ سابقةٌ إطلاقاً في ${OFFSITE}/daily" \
    | tee -a "${OFFSITE}/BACKUP-FAILED" >&2
fi

# ── 1ب. الوسائط — الأصولُ التي لا تحملها القاعدة ─────────────────
# 🔴 `knowledge_sources.storage_path` يحمل **مساراً** لا بايتات، والبايتاتُ في
#    مجلّد دوكر `media_data`. فحزمةٌ فيها القاعدةُ وحدها تُستعاد إلى صفوفٍ
#    كلُّها تشير إلى ملفّاتٍ غير موجودة: كلُّ ملفّ معرفةٍ رفعه عميلٌ يموت مع
#    القرص.
# 🔴 والفقدُ **صامتٌ تماماً**: النصُّ المستخرَج محفوظٌ في القاعدة فيبقى البوت
#    يردّ كأنّ شيئاً لم يكن، و`unlink` عند الحذف يُبلَع — فلا شيءَ في أيّ
#    شاشةٍ يقول إنّ الأصل ضاع. ولا يُكتشف إلّا يوم يُطلب الملفّ نفسُه.
# ★ و`ops/migrate-host.sh` ينسخ هذا المجلّد منذ كُتب: كان الترحيلُ بين
#   الخوادم أشملَ من النسخة الاحتياطيّة نفسِها.
say "الوسائط"
if docker compose ps --status running --services 2>/dev/null | grep -qx api; then
  # ⚠️ `tar` داخل الحاوية لا `docker cp`: الثاني يكتب إلى القرص مرّتَين (نسخةٌ
  #    ثمّ ضغط)، والأوّل يسيل مباشرةً. و`|| true` لأنّ مجلّداً فارغاً ليس عطلاً.
  docker compose exec -T api tar -C /app -cf - media < /dev/null 2>/dev/null \
    | gzip > "${STAGE}/media.tar.gz" || true
  MSZ=$(stat -c%s "${STAGE}/media.tar.gz" 2>/dev/null || echo 0)
  echo "  ✔ الوسائط ${MSZ} بايت"
else
  # ولا تُبتلع الحالة: حزمةٌ بلا وسائط تُعلن ذلك في المانيفست لا تُخفيه.
  echo "  ⚠ حاوية api ليست تعمل — لا وسائط في هذه الحزمة"
  : > "${STAGE}/media-MISSING"
fi

say "pg_dump"
docker compose exec -T db pg_dump -U "$DB_USER" "$DB" < /dev/null | gzip > "${STAGE}/db.sql.gz"
# نفس فخّ deploy.sh: pg_dump يفشل صامتاً فيُنتج ملفّاً ضئيلاً، والأنبوب يُخفي
# رمز خروجه. الحجم هو الدليل الوحيد المتاح هنا.
SZ=$(stat -c%s "${STAGE}/db.sql.gz")
[ "$SZ" -gt 10000 ] || { fail "النسخة ${SZ} بايت فقط — pg_dump فشل صامتاً"; exit 1; }
ok "db.sql.gz — ${SZ} بايت"

# ── 3. الأسرار ──────────────────────────────────────────────────
cp .env "${STAGE}/env"
cp docker-compose.yml "${STAGE}/docker-compose.yml"
# master-key.txt مكرَّرٌ عمداً: المفتاح موجودٌ في env أصلاً، لكنّ من يستعيد
# تحت ضغطٍ لا يجب أن يبحث عن سطرٍ في ملفٍّ فيه عشرون. وهو داخل نفس التشفير.
{
  echo "MASTER_KEY=${MASTER_KEY}"
  echo "MASTER_KEY_VERSION=${MASTER_KEY_VERSION:-1}"
} > "${STAGE}/master-key.txt"

# ── 4. البيان — أرقامُ لحظةِ النسخ ──────────────────────────────
# ★ عمودُ الحقيقة في تمرين الاستعادة: القاعدةُ الحيّة تتغيّر بعد الـdump،
#   فمقارنةُ المستعاد بالحيّ **تفشل بلا عطل**. المقارنة الصحيحة مع هذه الأرقام.
COUNT_SQL="select 'tenants',count(*) from tenants
union all select 'users',count(*) from users
union all select 'tenant_channels',count(*) from tenant_channels
union all select 'contacts',count(*) from contacts
union all select 'conversations',count(*) from conversations
union all select 'messages',count(*) from messages
union all select 'bot_configs',count(*) from bot_configs
union all select 'kb_chunks',count(*) from kb_chunks
union all select 'audit_log',count(*) from audit_log;"
{
  echo "bundle=${NAME}"
  echo "created=$(date -Is)"
  echo "host=$(hostname)"
  echo "git_rev=$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "db_name=${DB}"
  echo "pg_version=$(docker compose exec -T db psql -U "$DB_USER" -d "$DB" -At -c 'show server_version' < /dev/null | tr -d '\r')"
  echo "master_key_version=${MASTER_KEY_VERSION:-1}"
  echo "dump_bytes=${SZ}"
  echo "dump_sha256=$(sha256sum "${STAGE}/db.sql.gz" | cut -d' ' -f1)"
  # ★ والوسائطُ تُذكر صراحةً: مانيفستٌ يسكت عنها يجعل حزمةً ناقصةً تبدو كاملة.
  if [ -f "${STAGE}/media.tar.gz" ]; then
    echo "media_bytes=$(stat -c%s "${STAGE}/media.tar.gz")"
    echo "media_sha256=$(sha256sum "${STAGE}/media.tar.gz" | cut -d' ' -f1)"
  else
    echo "media_bytes=MISSING"
  fi
  echo "# ── عدد الصفوف لحظةَ الـdump — عمود المقارنة في ops/restore-drill.sh ──"
  docker compose exec -T db psql -U "$DB_USER" -d "$DB" -At -F= -c "$COUNT_SQL" < /dev/null | tr -d '\r' | sed 's/^/rows./'
} > "${STAGE}/MANIFEST.txt"
ok "MANIFEST.txt"

# ── 5. التشفير ──────────────────────────────────────────────────
say "gpg --symmetric AES256"
TARBALL="${TMP}/${NAME}.tar.gz"
tar -C "$TMP" -czf "$TARBALL" "$NAME"
OUT="${OFFSITE}/daily/${NAME}.tar.gz.gpg"
# 🔴 العبارة على stdin لا في argv ولا في --passphrase: كلّ من على الخادم يقرأ
#    ps، وسطرُ أوامرِ عمليّةٍ تعمل ليس سرّاً. و--no-symkey-cache يمنع gpg-agent
#    من الاحتفاظ بها في الذاكرة بعد انتهاء السكربت.
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --quiet --yes \
  --pinentry-mode loopback --passphrase-fd 0 --no-symkey-cache \
  --symmetric --cipher-algo AES256 \
  --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65011712 \
  --compress-algo none \
  --output "$OUT" "$TARBALL"
chmod 600 "$OUT"
( cd "$(dirname "$OUT")" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
ok "$(basename "$OUT") — $(stat -c%s "$OUT") بايت"

# ── 6. الفكّ للتحقّق — «نسخةٌ لم تُفكّ ليست نسخة» ────────────────
# 🔴 الفشل الذي يمنعه هذا: عبارةُ مرورٍ فيها محرفٌ زائد، أو قرصٌ امتلأ فكُتبت
#    الحزمةُ ناقصة. كلاهما ينتج ملفّاً بحجمٍ معقول لا يُفكّ **أبداً**، ولا
#    يُكتشف إلّا يوم الكارثة. الفكّ هنا يكلّف مِلّي ثانيةً ويحوّل الظنّ إلى علم.
say "تحقّق: فكٌّ وقراءة فهرس"
LIST="$(printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --quiet --decrypt \
          --pinentry-mode loopback --passphrase-fd 0 --no-symkey-cache "$OUT" 2>/dev/null \
        | tar -tzf - )"
for need in "${NAME}/db.sql.gz" "${NAME}/env" "${NAME}/master-key.txt" "${NAME}/MANIFEST.txt"; do
  if ! printf '%s\n' "$LIST" | grep -qx "$need"; then
    fail "الحزمة تُفكّ لكنّ ${need} ليس فيها"
    rm -f "$OUT" "${OUT}.sha256"
    exit 1
  fi
done
ok "الحزمة تُفكّ ومحتواها كامل"

# ── 7. الاحتفاظ المتدرّج ────────────────────────────────────────
# ترقيةٌ أسبوعيّة بـ**رابطٍ صلب** لا نسخة: نفس البايتات على القرص مرّةً
# واحدة، ويبقى المحتوى بعد تنظيف daily لأنّ عدد الروابط لم يصل صفراً.
if ! compgen -G "${OFFSITE}/weekly/aibot-${WEEK}-*.tar.gz.gpg" > /dev/null; then
  WOUT="${OFFSITE}/weekly/aibot-${WEEK}-${STAMP}.tar.gz.gpg"
  ln -f "$OUT" "$WOUT" 2>/dev/null || cp "$OUT" "$WOUT"
  # البصمة تُعاد كتابتها بالاسم الأسبوعيّ — وإلّا فشل `sha256sum -c` على اسمٍ لا يوجد.
  ( cd "${OFFSITE}/weekly" && sha256sum "$(basename "$WOUT")" > "$(basename "$WOUT").sha256" )
  ok "ترقيةٌ أسبوعيّة: $(basename "$WOUT")"
fi

# ★ الترتيب بالاسم لا بزمن التعديل، وهو **أصحّ** هنا لا أسهل: الاسم يحمل
#   الطابع الزمنيّ (`aibot-YYYYmmdd-HHMMSS` و`aibot-YYYYWww-…`) فترتيبه
#   المعجميّ هو ترتيبه الزمنيّ بعينه. أمّا mtime فيتغيّر بنسخةٍ أو لمسةٍ أو
#   نقلٍ بين أقراص، فيُصيّر «الأحدث» أقدمَ حزمةٍ لُمست آخراً — فيُحذف الجديد.
prune() {
  local dir="$1" keep="$2" i
  local all=("${dir}"/aibot-*.tar.gz.gpg)   # مرتَّبةٌ معجميّاً بفضل الصدفة
  local total=${#all[@]}
  [ "$total" -gt "$keep" ] || return 0
  for ((i = 0; i < total - keep; i++)); do
    rm -f "${all[i]}" "${all[i]}.sha256"
    echo "  – حُذف $(basename "${all[i]}")"
  done
}
prune "${OFFSITE}/daily"  "$KEEP_DAILY"
prune "${OFFSITE}/weekly" "$KEEP_WEEKLY"

count() { local a=("$@"); echo "${#a[@]}"; }
D=$(count "${OFFSITE}/daily"/aibot-*.tar.gz.gpg)
W=$(count "${OFFSITE}/weekly"/aibot-*.tar.gz.gpg)
log "ok ${NAME} ${SZ}B daily=${D} weekly=${W}"

echo
echo "✅ حزمةٌ مشفَّرة: ${OUT}"
echo "   البصمة:   ${OUT}.sha256"
echo "   المحتفظ:  ${D}/${KEEP_DAILY} يوميّ · ${W}/${KEEP_WEEKLY} أسبوعيّ"
echo "   الخطوة الناقصة — **تُشغَّل من جهاز العمل لا من هنا**: ops/pull-backups.sh"
echo "   حزمةٌ باقيةٌ على الخادم وحده ليست «خارج الخادم»."
