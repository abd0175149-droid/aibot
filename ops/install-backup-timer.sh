#!/bin/bash
# ════════════════════════════════════════════════════════════════
# AiBot — تثبيت المؤقّت اليوميّ (يُشغَّل **على الخادم**، مرّةً واحدة)
#
# ★ لماذا مؤقّت systemd للمستخدم لا cron:
#   ① لا sudo: `sudo -n true` يفشل على هذا الخادم، فوحدةُ نظامٍ تحتاج كلمةَ
#      مرورٍ لا نملكها في سكربت. ووحدةُ المستخدم تُثبَّت بلا أيّ رفعٍ للصلاحيّة —
#      و`Linger=yes` مضبوطٌ أصلاً لهذا المستخدم، فهي تعمل والجلسةُ مغلقة.
#   ② `Persistent=true`: الخادم **لابتوب**. cron يفوّت موعده بصمتٍ إن كان
#      نائماً في 02:40، ولا يعرف أحدٌ أنّ النسخ توقّف منذ أسبوعين. المؤقّت
#      يعرف أنّه فوّت وينفّذ فور الصحو.
#   ③ `journalctl --user -u aibot-backup` يعطيك سبب الفشل. cron يرسل بريداً
#      إلى صندوقٍ لا يقرأه أحدٌ على هذا الجهاز — أي لا يعطيك شيئاً.
#
#   والبديل إن تعذّر systemd (نظامٌ بلا linger مثلاً) مكتوبٌ في آخر هذا الملفّ.
# ════════════════════════════════════════════════════════════════
set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNITS="${HOME}/.config/systemd/user"
PASS_FILE="${HOME}/.config/aibot/backup.env"

say() { echo; echo "▶ $1"; }
ok()  { echo "  ✔ $1"; }

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# ── 1. عبارة المرور ─────────────────────────────────────────────
say "١/٤ عبارة المرور"
if [ -s "$PASS_FILE" ]; then
  ok "موجودة: ${PASS_FILE}"
else
  mkdir -p "$(dirname "$PASS_FILE")"
  install -m 600 /dev/null "$PASS_FILE"
  printf 'BACKUP_PASSPHRASE=%s\n' "$(openssl rand -base64 33)" > "$PASS_FILE"
  chmod 600 "$PASS_FILE"
  ok "وُلِّدت عبارةٌ عشوائيّة (٣٣ بايت) في ${PASS_FILE}"
  # 🔴 لا تُطبع هنا: مخرَج هذا السكربت قد يذهب إلى سجلٍّ أو إلى نافذةٍ مشتركة.
  #    تُقرأ بأمرٍ واعٍ منفصل، ثمّ تُنسخ إلى مدير كلمات المرور وتُغلق الشاشة.
  echo "  ⚠ اقرأها **الآن** وانسخها إلى مدير كلمات المرور:"
  echo "      cat ${PASS_FILE}"
  echo "    بلا هذه العبارة لا تُفكّ أيّ حزمةٍ سُحبت خارج الخادم — ولو كانت سليمة."
fi

# ── 2. الوحدات ──────────────────────────────────────────────────
say "٢/٤ نسخ الوحدات"
mkdir -p "$UNITS"
install -m 644 "${REPO}/ops/systemd/aibot-backup.service" "${UNITS}/aibot-backup.service"
install -m 644 "${REPO}/ops/systemd/aibot-backup.timer"   "${UNITS}/aibot-backup.timer"
ok "${UNITS}/aibot-backup.{service,timer}"

# ── 3. التسجيل ──────────────────────────────────────────────────
say "٣/٤ التسجيل والتشغيل"
systemctl --user daemon-reload
systemctl --user enable --now aibot-backup.timer
ok "مسجَّلٌ ومفعَّل"

# ── 4. الإثبات ──────────────────────────────────────────────────
# «فعّلتُ المؤقّت» ليس إثباتاً. الإثبات أن يظهر في القائمة بموعدٍ قادم.
say "٤/٤ الإثبات — systemctl list-timers"
systemctl --user list-timers --all aibot-backup.timer --no-pager

cat <<'MSG'

✅ المؤقّت مسجَّل. وللتحقّق لاحقاً:
     systemctl --user list-timers aibot-backup.timer
     systemctl --user start aibot-backup.service   # تشغيلٌ فوريّ الآن
     journalctl --user -u aibot-backup -n 40 --no-pager

── لو تعذّر systemd على مضيفٍ آخر (بلا linger مثلاً) ──
   ( crontab -l 2>/dev/null; \
     echo '40 2 * * * cd $HOME/aibot && ops/backup-offsite.sh >> $HOME/logs/aibot-backup.log 2>&1 # aibot-backup' \
   ) | crontab -
   وتقبل بأنّ الموعد الفائت لا يُستدرك — فراجع السجلّ أسبوعيّاً بعينك.
MSG
