#!/bin/bash
# ════════════════════════════════════════════════════════════════
# AiBot — تمرين الاستعادة (يُشغَّل **على الخادم**)
#
# ★ لماذا هذا السكربت هو الجزء الذي لا يُستغنى عنه:
#   «عندي نسخٌ احتياطيّة» جملةٌ تُقال عن ملفّاتٍ لم يفتحها أحد. والفشل النمطيّ
#   ليس غياب النسخة بل أنّها لا تُستعاد: عبارةُ مرورٍ مختلفة، أو dump ناقص،
#   أو دورٌ غائب، أو امتدادٌ غير مثبَّت. وكلّها تُكتشف يوم الكارثة **فقط** إن
#   لم تُجرَّب قبله. فهذا السكربت يحوّل «أظنّ أنّها تعمل» إلى رقمٍ منظور.
#
# ★ ولماذا المقارنة مع `MANIFEST.txt` لا مع القاعدة الحيّة:
#   القاعدةُ تتغيّر كلّ دقيقة. فمقارنةُ المستعادة بالحيّة تُظهر فرقاً **صحيحاً**
#   فيُقرأ فشلاً، أو تُظهر تطابقاً على قاعدةٍ ساكنةٍ فيُقرأ نجاحاً كاذباً.
#   البيان يحمل الأرقام **لحظةَ الـdump** — وهو المرجع الوحيد العادل.
#   والعمود الحيّ يبقى معروضاً، لكنّه سياقٌ لا حكم.
#
# الاستعمال:
#   ops/restore-drill.sh                       # أحدث حزمةٍ يوميّة
#   ops/restore-drill.sh ~/backups/…/x.gpg     # حزمةٌ بعينها
#   KEEP_DB=1 ops/restore-drill.sh             # لا تحذف قاعدة التمرين
# ════════════════════════════════════════════════════════════════
set -Eeuo pipefail
umask 077
shopt -s nullglob

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

OFFSITE="${BACKUP_OFFSITE_DIR:-${HOME}/backups/aibot-offsite}"
PASS_FILE="${BACKUP_PASSPHRASE_FILE:-${HOME}/.config/aibot/backup.env}"
TEST_DB="${RESTORE_TEST_DB:-aibot_restore_test}"

say()  { echo; echo "▶ $1"; }
ok()   { echo "  ✔ $1"; }
fail() { echo "❌ $1" >&2; }

if [ -z "${BACKUP_PASSPHRASE:-}" ] && [ -r "$PASS_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$PASS_FILE"; set +a
fi
[ -n "${BACKUP_PASSPHRASE:-}" ] || { fail "BACKUP_PASSPHRASE غائبة — لا فكَّ للحزمة"; exit 1; }

[ -f .env ] || { fail ".env غائب"; exit 1; }
set -a; . ./.env; set +a
: "${DB_USER:?DB_USER غائبٌ من .env}"
LIVE_DB="${DB_NAME:-aibot}"
export GNUPGHOME="${GNUPGHOME:-${HOME}/.gnupg}"

# ── 0. اختيار الحزمة ────────────────────────────────────────────
BUNDLE="${1:-}"
if [ -z "$BUNDLE" ]; then
  # الأحدث = آخر الأسماء مرتَّبةً معجميّاً (الطابع الزمنيّ في الاسم)، لا آخرَها
  # بـmtime: تمرينٌ يجرّب الحزمة التي لُمست آخراً لا التي كُتبت آخراً تمرينٌ مضلِّل.
  ALL=("${OFFSITE}/daily"/aibot-*.tar.gz.gpg)
  [ "${#ALL[@]}" -gt 0 ] && BUNDLE="${ALL[-1]}"
fi
[ -n "$BUNDLE" ] && [ -f "$BUNDLE" ] || { fail "لا حزمة — شغّل ops/backup-offsite.sh أوّلاً"; exit 1; }
echo "الحزمة: ${BUNDLE}"
echo "الحجم:  $(stat -c%s "$BUNDLE") بايت"

# 🔴 `< /dev/null` ليس زينة — بلاه يُفشل هذا السكربتُ مهمّته بصمت:
#    `docker compose exec -T` يمرّر stdin إلى الحاوية، و**يستهلكه كلّه**. فحين
#    تُنادى هذه الدوالّ داخل حلقة `while read` تسرق قراءةَ الحلقة من stdin،
#    فتنتهي الحلقة بعد **صفٍّ واحد**. والنتيجة: جدولُ مقارنةٍ فيه سطرٌ واحدٌ
#    كلّه ✔ و«✅ كلّ الأعداد تطابق» — تمرينُ استعادةٍ يُعلن نجاحه بعد أن فحص
#    جدولاً من تسعة. (حدث فعلاً في أوّل تشغيل، وكُشف بمقارنة عدد الأسطر أدناه.)
psql_live() { docker compose exec -T db psql -U "$DB_USER" -d "$LIVE_DB" -At "$@" < /dev/null; }
psql_test() { docker compose exec -T db psql -U "$DB_USER" -d "$TEST_DB" -At "$@" < /dev/null; }
psql_adm()  { docker compose exec -T db psql -U "$DB_USER" -d postgres -At "$@" < /dev/null; }

# ── 1. البصمة ───────────────────────────────────────────────────
say "١/٦ البصمة"
if [ -f "${BUNDLE}.sha256" ]; then
  ( cd "$(dirname "$BUNDLE")" && sha256sum -c --quiet "$(basename "$BUNDLE").sha256" ) \
    && ok "sha256 مطابقة" || { fail "البصمة لا تطابق — الحزمة تالفة"; exit 1; }
else
  echo "  ⚠ لا ملفّ بصمة بجانب الحزمة"
fi

# ── 2. الفكّ ────────────────────────────────────────────────────
say "٢/٦ الفكّ"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/aibot-drill-XXXXXX")"
DROPPED=0
cleanup() {
  rm -rf "$TMP"
  if [ "$DROPPED" = 0 ] && [ "${KEEP_DB:-0}" != "1" ]; then
    psql_adm -c "DROP DATABASE IF EXISTS ${TEST_DB}" >/dev/null 2>&1 || true
  fi
}
# المرحلة الوسيطة تحمل .env وMASTER_KEY نصّاً — تُمحى في كلّ خروج بلا استثناء.
trap cleanup EXIT INT TERM

printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --quiet --decrypt \
  --pinentry-mode loopback --passphrase-fd 0 --no-symkey-cache "$BUNDLE" \
  | tar -xzf - -C "$TMP"
STAGE="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -n "$STAGE" ] || { fail "الحزمة فُكّت لكن لا مجلّد فيها"; exit 1; }
for need in db.sql.gz env master-key.txt MANIFEST.txt; do
  [ -f "${STAGE}/${need}" ] || { fail "${need} ليس في الحزمة"; exit 1; }
done
ok "فُكّت: $(basename "$STAGE")"
# لا تُطبع قيمة المفتاح — يُطبع أنّه موجودٌ وطوله معقول. سجلّ التمرين قد يُنسخ.
MK="$(sed -n 's/^MASTER_KEY=//p' "${STAGE}/master-key.txt")"
MK_BYTES="$(printf '%s' "$MK" | base64 -d 2>/dev/null | wc -c || echo 0)"
[ "$MK_BYTES" = 32 ] && ok "MASTER_KEY في الحزمة: ٣٢ بايت (لا تُطبع قيمته)" \
  || { fail "MASTER_KEY في الحزمة ${MK_BYTES} بايت — لا يُفكّ به شيء"; exit 1; }

# ── 3. قاعدةٌ جديدة ─────────────────────────────────────────────
say "٣/٦ قاعدةٌ نظيفة: ${TEST_DB}"
psql_adm -c "DROP DATABASE IF EXISTS ${TEST_DB}" >/dev/null
psql_adm -c "CREATE DATABASE ${TEST_DB}" >/dev/null
ok "أُنشئت"

# ── 4. الاستعادة ────────────────────────────────────────────────
say "٤/٦ psql < db.sql.gz"
# ON_ERROR_STOP=1 مقصود: استعادةٌ «نجحت مع ٤٠ خطأً» ليست استعادة. والسجلّ
# يُحفظ كاملاً فإن سقطت رأيتَ سطر القاعدة نفسه لا تخميناً.
RESTORE_LOG="${TMP}/restore.log"
if ! gunzip -c "${STAGE}/db.sql.gz" \
     | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$TEST_DB" \
       > "$RESTORE_LOG" 2>&1; then
  fail "فشلت الاستعادة — آخر ٢٠ سطراً:"
  tail -20 "$RESTORE_LOG" >&2
  exit 1
fi
ERRS=$(grep -c '^ERROR:' "$RESTORE_LOG" || true)
ok "استُعيدت بلا خطأ (ERROR: ${ERRS})"

# ── 5. المقارنة ─────────────────────────────────────────────────
say "٥/٦ مقارنة الصفوف — البيان هو المرجع"
echo
echo "  الجدول              |  الحزمة | المستعادة |    الحيّ | الحكم"
echo "  --------------------+---------+-----------+---------+------"
MISMATCH=0
COMPARED=0
EXPECTED=$(grep -c '^rows\.' "${STAGE}/MANIFEST.txt")
while IFS='=' read -r key want; do
  t="${key#rows.}"
  [ -n "$t" ] || continue
  got="$(psql_test -c "select count(*) from ${t}" | tr -d '\r')"
  now="$(psql_live -c "select count(*) from ${t}" | tr -d '\r')"
  if [ "$got" = "$want" ]; then verdict="✔"; else verdict="✘"; MISMATCH=$((MISMATCH + 1)); fi
  printf '  %-19s | %7s | %9s | %7s | %s\n' "$t" "$want" "$got" "$now" "$verdict"
  COMPARED=$((COMPARED + 1))
done < <(grep '^rows\.' "${STAGE}/MANIFEST.txt")

# ★ الحارس على الحارس: تمرينٌ فحص جدولين من تسعة يطبع ✔✔ ويُعلن النجاح، وهذا
#   أسوأ من فشلٍ صريح. عدد الصفوف المقروءة يجب أن يساوي عدد أسطر البيان.
if [ "$COMPARED" != "$EXPECTED" ]; then
  fail "قُورن ${COMPARED} جدولاً من ${EXPECTED} في البيان — الحلقة انقطعت، والحكم لاغٍ."
  MISMATCH=$((MISMATCH + 1))
fi

# ★ سياسات RLS: البوّابة الثانية للعزل. استعادةٌ تُرجع الصفوف وتُسقط السياسات
#   تُنتج قاعدةً «كاملةً» يقرأ فيها كلّ مستأجرٍ بيانات الآخر. لا تُحتسب نجاحاً.
POL_TEST="$(psql_test -c "select count(*) from pg_policies where schemaname='public'" | tr -d '\r')"
POL_LIVE="$(psql_live -c "select count(*) from pg_policies where schemaname='public'" | tr -d '\r')"
RLS_TEST="$(psql_test -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity" | tr -d '\r')"
EXT_TEST="$(psql_test -c "select count(*) from pg_extension where extname='vector'" | tr -d '\r')"
echo
printf '  %-19s | %7s | %9s | %7s | %s\n' "pg_policies" "$POL_LIVE" "$POL_TEST" "$POL_LIVE" \
  "$([ "$POL_TEST" = "$POL_LIVE" ] && echo ✔ || echo ✘)"
printf '  %-19s | %7s | %9s | %7s | %s\n' "rowsecurity tables" "-" "$RLS_TEST" "-" "$([ "$RLS_TEST" -gt 0 ] && echo ✔ || echo ✘)"
printf '  %-19s | %7s | %9s | %7s | %s\n' "extension vector" "-" "$EXT_TEST" "-" "$([ "$EXT_TEST" = 1 ] && echo ✔ || echo ✘)"
[ "$POL_TEST" = "$POL_LIVE" ] || MISMATCH=$((MISMATCH + 1))
[ "$EXT_TEST" = 1 ] || MISMATCH=$((MISMATCH + 1))
[ "$RLS_TEST" -gt 0 ] || MISMATCH=$((MISMATCH + 1))

# ── 6. الحذف ────────────────────────────────────────────────────
say "٦/٦ حذف قاعدة التمرين"
if [ "${KEEP_DB:-0}" = "1" ]; then
  echo "  ⏸ أُبقيت بطلبك: psql -U ${DB_USER} -d ${TEST_DB}"
else
  psql_adm -c "DROP DATABASE IF EXISTS ${TEST_DB}" >/dev/null
  DROPPED=1
  ok "حُذفت ${TEST_DB}"
fi

echo
if [ "$MISMATCH" = 0 ]; then
  echo "✅ الاستعادة مجرَّبةٌ فعلاً: كلّ الأعداد تطابق البيان، والسياسات والامتداد سليمة."
  echo "   البيان: $(sed -n 's/^created=//p' "${STAGE}/MANIFEST.txt")"
  exit 0
fi
fail "${MISMATCH} فرقاً — الحزمة لا تُعاد إلى الحالة التي تدّعيها. لا تعتمد عليها."
exit 1
