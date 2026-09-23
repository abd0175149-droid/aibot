#!/bin/bash
# ════════════════════════════════════════════════════════════════
# AiBot — سحب الحزم المشفَّرة **إلى خارج الخادم**
#
# 🔴 يُشغَّل من **جهاز العمل**، لا من الخادم. وهذا كلّ المعنى: `backup-offsite.sh`
#    ينتج حزمةً على نفس القرص الذي نخاف موته. هذا السكربت هو الخطوة التي
#    تُخرجها منه. بلا هذه الخطوة ما سبق تنظيمٌ للملفّات لا نسخٌ احتياطيّ.
#
# ★ ما لا يفعله — وعمداً: **لا يحذف محلّيّاً ما حُذف على الخادم.**
#   الخادم يحتفظ بسبعةٍ يوميّاً وأربعٍ أسبوعيّاً. لو كان السحب مزامنةً بمرآة
#   (`rsync --delete`) لصار تنظيفُ الخادم — أو مسحُه عن قصد — يمحو نسختك
#   الخارجيّة في السحبة التالية. نسخةٌ احتياطيّةٌ تتبع الأصلَ في الحذف ليست
#   نسخةً احتياطيّة. فالجهاز هنا **يكدّس**، والاحتفاظ الطويل قرارُك أنت.
#
# ★ ولا يفكّ التشفير. عبارة المرور ليست على هذا الجهاز ولا يجب أن تكون:
#   الحزمةُ سرٌّ ساكن، والفكّ حدثٌ نادرٌ واعٍ يجري في تمرين الاستعادة.
#
# ── الترقية إلى تخزينٍ سحابيّ لاحقاً (سطرٌ واحدٌ يُستبدل) ──────────
#   المتاح على الخادم اليوم: rclone مثبَّتٌ **بلا أيّ بيانات اعتماد**. فلا
#   يُبنى على ما لا يوجد. وحين تتوفّر (Backblaze B2 أو S3 أو Drive):
#     ① على الخادم:  rclone config            → أنشئ وجهةً اسمها `offsite`
#     ② في `ops/systemd/aibot-backup.service` أضف سطراً بعد النسخ:
#          ExecStartPost=/usr/bin/rclone copy %h/backups/aibot-offsite offsite:aibot --immutable
#   ولا يُلغى هذا السكربت حتّى بعدها: نسختان في مكانين أفضل من واحدةٍ في
#   سحابةٍ قد يُقفل حسابها. والحزمة مشفَّرةٌ أصلاً، فالمزوّد لا يرى شيئاً.
#
# الاستعمال:
#   ops/pull-backups.sh                 # إلى ~/aibot-offsite
#   AIBOT_BACKUP_DEST=/d/backups/aibot ops/pull-backups.sh
# ════════════════════════════════════════════════════════════════
set -Eeuo pipefail
# 🔴 nullglob + دوالّ العدّ أدناه بدل `ls … | wc -l`: مع `pipefail` يفشل
#    `ls` على مجلّدٍ فارغ برمز 2، فيُسقط الأنبوب، فيُسقط `set -e` السكربتَ
#    **بعد** أن نجح السحب كلّه. مجلّدٌ فارغ حالةٌ مشروعة لا خطأ.
shopt -s nullglob

HOST="${AIBOT_SSH_HOST:-mafia-prod}"
REMOTE_DIR="${AIBOT_REMOTE_BACKUP_DIR:-backups/aibot-offsite}"
DEST="${AIBOT_BACKUP_DEST:-${HOME}/aibot-offsite}"

say()  { echo "▶ $1"; }
ok()   { echo "  ✔ $1"; }
warn() { echo "  ⚠ $1" >&2; }
fail() { echo "❌ $1" >&2; }

command -v ssh >/dev/null || { fail "ssh غير موجود على هذا الجهاز"; exit 1; }
command -v sha256sum >/dev/null || { fail "sha256sum غير موجود — لا سحبَ بلا تحقّق"; exit 1; }

mkdir -p "${DEST}/daily" "${DEST}/weekly"

say "الاتّصال بـ${HOST}"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "test -d \"\$HOME/${REMOTE_DIR}/daily\"" \
  || { fail "لا مجلّد ${REMOTE_DIR}/daily على ${HOST} — شغّل ops/backup-offsite.sh هناك أوّلاً"; exit 1; }
ok "المجلّد موجود"

# ── المسار المفضَّل: rsync ───────────────────────────────────────
# غير موجودٍ في Git Bash على ويندوز، ولهذا البديل أدناه. وليس البديل أدنى
# بل هو نفس العقد بأدواتٍ أقلّ: انقل ما ليس عندك، وتحقّق من كلّ ما نقلت.
if command -v rsync >/dev/null; then
  say "rsync (بلا --delete — اقرأ الرأس)"
  rsync -az --partial --human-readable --itemize-changes \
    -e "ssh -o BatchMode=yes" \
    "${HOST}:${REMOTE_DIR}/" "${DEST}/"
  TRANSPORT="rsync"
else
  warn "rsync غير موجود — البديل: ssh + cat لكلّ ملفٍّ ناقص"
  TRANSPORT="ssh+cat"

  # البصمات أوّلاً (بضع مئات من البايتات): بها نعرف ما عندنا صحيحٌ فنتخطّاه،
  # وما عندنا تالفٌ فنُعيد سحبه. الحجم وحده يكذب — ملفٌّ ناقصٌ قد يطابق حجماً.
  say "جلب البصمات"
  ssh -o BatchMode=yes "$HOST" "cd \"\$HOME/${REMOTE_DIR}\" && tar -cf - daily/*.sha256 weekly/*.sha256 2>/dev/null" \
    | tar -xf - -C "$DEST" || warn "لا بصمات بعد"

  say "جلب الحزم الناقصة"
  MANIFEST="$(ssh -o BatchMode=yes "$HOST" "cd \"\$HOME/${REMOTE_DIR}\" && ls -1 daily/aibot-*.tar.gz.gpg weekly/aibot-*.tar.gz.gpg 2>/dev/null")"
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    # `--status` لا `--quiet`: الفشل هنا **متوقَّع** (ملفٌّ ناقصٌ يُعاد سحبه)،
    # و`--quiet` يطبع سطر FAILED على stdout فيبدو عطلاً وسط مخرَجٍ طبيعيّ.
    if [ -f "${DEST}/${rel}" ] && [ -f "${DEST}/${rel}.sha256" ] \
       && ( cd "${DEST}/$(dirname "$rel")" && sha256sum -c --status "$(basename "$rel").sha256" 2>/dev/null ); then
      echo "  = $(basename "$rel") موجودٌ وسليم"
      continue
    fi
    echo "  ↓ $(basename "$rel")"
    # 🔴 `-n` إلزاميّ: ssh يقرأ stdin ويمرّره إلى الطرف الآخر، و**يستهلكه كلّه**.
    #    بلاه يسرق من `while read` بقيّةَ قائمة الملفّات، فتنتهي الحلقة بعد ملفٍّ
    #    واحد ويُعلن السحبُ نجاحه وقد جلب واحدةً من ثلاث. (حدث فعلاً.)
    # والكتابة إلى .part ثمّ النقل: انقطاعُ الشبكة لا يترك ملفّاً نصفيّاً يبدو تامّاً.
    ssh -n -o BatchMode=yes "$HOST" "cat \"\$HOME/${REMOTE_DIR}/${rel}\"" > "${DEST}/${rel}.part"
    mv "${DEST}/${rel}.part" "${DEST}/${rel}"
  done <<< "$MANIFEST"
fi

# ── التحقّق المحلّيّ — هذه هي النقطة ────────────────────────────
# 🔴 «نُقل الملفّ» ≠ «الملفّ سليم». الشبكة تقطع، والقرص يكتب نصفاً، وrsync
#    نفسه قد يُبقي `--partial`. البصمة تُقارن **هنا على هذا الجهاز**، لأنّ
#    النسخة التي تعنينا هي هذه لا تلك.
say "تحقّق البصمات محلّيّاً"
BAD=0; GOOD=0
for dir in daily weekly; do
  for f in "${DEST}/${dir}"/aibot-*.tar.gz.gpg; do
    if [ ! -f "${f}.sha256" ]; then
      warn "$(basename "$f") بلا بصمة — لا يُحتسب سليماً"
      BAD=$((BAD + 1)); continue
    fi
    if ( cd "$(dirname "$f")" && sha256sum -c --quiet "$(basename "$f").sha256" ); then
      GOOD=$((GOOD + 1))
    else
      warn "$(basename "$f") بصمته لا تطابق — احذفه وأعِد السحب"
      BAD=$((BAD + 1))
    fi
  done
done

count() { local a=("$@"); echo "${#a[@]}"; }
D=$(count "${DEST}/daily"/aibot-*.tar.gz.gpg)
W=$(count "${DEST}/weekly"/aibot-*.tar.gz.gpg)

echo
echo "الوجهة:   ${DEST}  (${TRANSPORT})"
echo "الحزم:    ${D} يوميّ · ${W} أسبوعيّ — سليمةٌ ${GOOD}، مشكوكةٌ ${BAD}"
if [ "$BAD" -gt 0 ]; then
  fail "${BAD} حزمةً لم تُثبت سلامتها"
  exit 1
fi
cat <<'MSG'

✅ الحزم خارج الخادم وبصماتها مطابقة.

   وتبقى حقيقةٌ لا يحلّها سكربت: هذه الحزم **لا تُفكّ** بلا BACKUP_PASSPHRASE،
   ولا يُستعمل ما فيها بلا MASTER_KEY (وهو داخلها). فإن كان كلاهما على الخادم
   وحده فما سحبتَه أرشيفٌ لا يُقرأ.
   الشرط الثاني، ويُنفَّذ مرّةً واحدة:
     ① BACKUP_PASSPHRASE  →  مدير كلمات المرور
     ② MASTER_KEY         →  مدير كلمات المرور  (ops/show-master-key.ts)
MSG
