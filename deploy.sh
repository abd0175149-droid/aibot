#!/bin/bash
# ════════════════════════════════════════════════════════════════
# AiBot — نصّ النشر
#
# العقد: نسخةٌ احتياطيّة قبل أيّ لمس · صورٌ موسومةٌ للتراجع · الترحيل يُظهر
# خطأه · **بوّابة صحّةٍ تُقرّر النجاح** · وتراجعٌ تلقائيّ عند الفشل.
#
# 🔴 الفخّ الذي أُعيدت كتابة البوّابة من أجله (مُتحقَّقٌ منه على الخادم 2026-09-21):
#    https://aibot.masaros.net/api/health يردّ **200 الآن** — من تطبيق MasarOS
#    عبر wildcard على *.masaros.net. فبوّابةٌ تنتظر «200» تنجح فوراً بينما
#    AiBot غير موصولٍ إطلاقاً، ويُعلن النشر نجاحه عن نظامٍ لا يعمل.
#    لذلك ثلاثة شروطٍ معاً لا واحد:
#      ① الفحص على 127.0.0.1 لا على النطاق العامّ.
#      ② مطابقة **جسم** الاستجابة: "service":"aibot".
#      ③ مطابقة GIT_REV — فلا تمرّ البوّابة على نسخةٍ قديمة ما زالت تعمل.
# ════════════════════════════════════════════════════════════════
# 🔴 إن رأيت: «set: pipefail: invalid option name» — فالملفّ بنهايات CRLF.
#    ليس عطلاً في bash: `` يلتصق بـ`pipefail` فيصير خياراً مجهولاً، والرسالة
#    تُضلّل تماماً. سببه نسخةٌ من ويندوز سبقت `.gitattributes`. الإصلاح:
#      rm deploy.sh && git checkout -- deploy.sh && chmod +x deploy.sh
#    (ضاع بسببه شهرٌ من النشر اليدويّ: السكربت لم يعمل قطّ فلم يُستعمل.)
set -Eeuo pipefail

API_PORT="${API_PORT:-4100}"
WEB_PORT="${WEB_PORT:-3070}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${HOME}/backups/aibot"
SERVICES="api worker web"
PUBLIC_URL="${PUBLIC_URL:-https://aibot.masaros.net}"

say()  { echo -e "\n▶ $1"; }
fail() { echo -e "\n❌ $1" >&2; }

rollback() {
  # 🔴 نزعُ المصيدتَين **أوّلَ شيء**. بعد تسليح EXIT صارتا اثنتين: فشلٌ حقيقيّ
  #    يُطلق ERR فتُنادى هذه، ثمّ تخرج بـ1 فتُطلق EXIT فتُنادى ثانيةً — ويصطدم
  #    `docker compose up` بنفسه («container name is already in use»، وهو
  #    العطلُ الموصوفُ أسفله). والنزعُ يحمي كذلك من فشل `docker tag` هنا.
  trap - ERR EXIT
  fail "فشل النشر — تراجع إلى وسوم rollback-${STAMP}"
  for s in $SERVICES; do
    if docker image inspect "aibot-${s}:rollback-${STAMP}" >/dev/null 2>&1; then
      docker tag "aibot-${s}:rollback-${STAMP}" "aibot-${s}:latest"
    fi
  done
  # 🔴 لا --force-recreate: آليّته تُعيد تسمية الحاوية إلى <id>_<name> كخطوةٍ
  #    وسيطة، فيتولّد الاسم نفسه في كلّ محاولةٍ ويصطدم ببقايا السابقة:
  #    «Conflict. The container name is already in use». أفشل ثلاث نشرات،
  #    وأفشل التراجعَ نفسه مرّةً فكادت الخدمة تبقى ساقطة.
  #    الحذف الصريح ثمّ الإنشاء لا يمرّ باسمٍ وسيط إطلاقاً.
  docker compose rm -sf $SERVICES 2>/dev/null || true
  docker compose up -d --no-build $SERVICES || true
  echo "النسخة الاحتياطيّة: ${BACKUP_DIR}/db-${STAMP}.sql.gz"
  exit 1
}
trap rollback ERR

# 🔴 **`exit 1` لا يُطلق `trap … ERR`** — دلالةُ bash لا علّةُ سكربت (مُجرَّبةٌ
#    على bash 5: `false` تُطلق المصيدة و`exit 1` لا تُطلقها، وكذلك
#    `if ! cmd; then exit 1; fi`). وكلُّ بوّابةٍ في هذا الملفّ تفشل بـ`exit 1`:
#    الترحيلُ، وصحّةُ الخلفيّة، ورمزُ الواجهة، ونسختُها. فكانت تخرج **بلا
#    تراجع**: حاوياتُ «الاستبدال» الجديدة تبقى تخدم الطلبات على قاعدةٍ نصفِ
#    مُرحَّلة، ولا يُطبع أمرُ التراجع لأنّ الملخّص لم يُبلَغ — فيبدو الأمرُ
#    نشرةً فاشلةً نظيفة وهو خادمٌ عالق.
#
#    ومصيدةٌ على EXIT تمسك الاثنين معاً — الفشلَ الحقيقيَّ و`exit` الصريح —
#    بلا مطاردة كلّ بوّابةٍ على حدة اليوم وغداً. و`exit "$rc"` آخرُ أمرٍ فيها
#    فيبقى الخروجُ الصفريُّ صفريّاً رغم أنّ `[ ]` قبله تعود 1.
arm_rollback() { trap 'rc=$?; [ "$rc" -ne 0 ] && rollback; exit "$rc"' EXIT; }

# ── 0. البيئة ────────────────────────────────────────────────────
[ -f .env ] || { fail ".env غائب — الأسرار تُكتب باليد على الخادم فقط"; exit 1; }
set -a; . ./.env; set +a
for v in JWT_SECRET MASTER_KEY PLATFORM_AI_KEY DB_PASSWORD APP_DB_PASSWORD; do
  [ -n "${!v:-}" ] || { fail "$v غائبٌ من .env — لا إقلاع بسرٍّ ناقص"; exit 1; }
done

# ── 1. نسخة احتياطيّة قبل أيّ لمس ────────────────────────────────
say "نسخة احتياطيّة"
mkdir -p "$BACKUP_DIR"
BK="${BACKUP_DIR}/db-${STAMP}.sql.gz"
# 🔴 `< /dev/null` على كلّ `docker compose exec -T` لا يحتاج إدخالاً: الراية `-T`
#    تمرّر stdin إلى الحاوية و**تستهلكه كلّه**. فهذا السطر بلاها يأكل بقيّة
#    السكربت لو شُغِّل بـ`bash -s < deploy.sh` أو من حلقةٍ تقرأ من stdin —
#    فيُنشر نصفُ السكربت ويُعلَن النجاح. (يحرسه apps/worker/test/ops-scripts.)
docker compose exec -T db pg_dump -U "${DB_USER}" "${DB_NAME:-aibot}" < /dev/null | gzip > "$BK"
# فشل pg_dump الصامت يُنتج ملفّاً ضئيلاً. بلا هذا الفحص تنشر فوق حالةٍ لا تُستعاد.
SZ=$(stat -c%s "$BK" 2>/dev/null || echo 0)
[ "$SZ" -gt 10000 ] || { fail "النسخة ${SZ} بايت فقط — pg_dump فشل صامتاً"; exit 1; }
echo "  ✔ ${BK} (${SZ} بايت)"
ls -t "${BACKUP_DIR}"/db-*.sql.gz | tail -n +15 | xargs -r rm -f

# ── 1ب. حزمةٌ مشفَّرة تُسحب خارج الخادم ─────────────────────────
# ★ اللقطة أعلاه تحمي من «ترحيلٌ أفسد جدولاً». وهي **لا تحمي من موت القرص**:
#   هي على نفس القرص، و`MASTER_KEY` في `.env` بجانبها. فلو مات القرص ضاعت
#   البيانات وضاع المفتاح، ولا تُفكّ نسخةٌ لو وُجدت. راجع 19-backup-and-restore.
#
# 🔴 ولا تُفشل النشر مهما حدث: النسخ الاحتياطيّ ليس بوّابة إصدار، وإسقاطُ
#    إصلاحٍ عاجلٍ لأنّ عبارة مرورٍ غير مضبوطة عقوبةٌ في المكان الخطأ. لكنّه
#    يصرخ — ويُعاد الصراخ في الملخّص الأخير، لأنّ تحذيراً في السطر ٣٠ من
#    مخرَجٍ طويل لا يراه أحد.
OFFSITE_NOTE="لم تُنشأ"
if [ -x ops/backup-offsite.sh ]; then
  say "حزمةٌ مشفَّرة خارج الخادم"
  # ★ عبارة المرور تعيش في ملفّ المؤقّت، والنشر لا يرثها.
  #
  #   بلا هذا السطر تُنشأ الحزم اليوميّة وحدها، **وتسقط بالضبط الحزمةُ الأثمن**:
  #   التي تسبق تغييراً خطراً بثوانٍ. وأوّل نشرةٍ بعد بناء النظام أثبتت ذلك —
  #   قالت «الحزمة: لم تُنشأ» وتابعت.
  [ -z "${BACKUP_PASSPHRASE:-}" ] && [ -r "${HOME}/.config/aibot/backup.env" ] \
    && . "${HOME}/.config/aibot/backup.env"
  export BACKUP_PASSPHRASE
  OFF_LOG="${BACKUP_DIR}/offsite-${STAMP}.log"
  if ops/backup-offsite.sh > "$OFF_LOG" 2>&1; then
    OFFSITE_NOTE="$(grep -o 'aibot-[0-9]\{8\}-[0-9]\{6\}\.tar\.gz\.gpg' "$OFF_LOG" | head -1)"
    echo "  ✔ ${OFFSITE_NOTE}"
    rm -f "$OFF_LOG"
  else
    OFFSITE_NOTE="فشلت — راجع ${OFF_LOG}"
    {
      echo "⚠ ⚠ ⚠  الحزمة المشفَّرة لم تُنشأ. النشر يتابع، والخطرُ يبقى:"
      echo "        نسخُك كلّها على هذا القرص وحده، والمفتاح معها."
      echo "        السبب في: ${OFF_LOG}"
      echo "        الأرجح: BACKUP_PASSPHRASE غير مضبوطة — ops/install-backup-timer.sh"
    } >&2
  fi
fi

# ── 2. الشيفرة — pull فقط ────────────────────────────────────────
# 🔴 git reset --hard ممنوع: يحذف docker-compose.override.yml فتُنشئ Docker
#    volumes جديدةً فارغة بدل ربط الأصلية = فقدانٌ كامل للبيانات.
say "سحب الشيفرة (master)"
BEFORE="$(git rev-parse HEAD)"
git pull origin master
AFTER="$(git rev-parse HEAD)"
export GIT_REV="$AFTER"

# ── 2ب. السكربت يُحدّث نفسه فيجب أن يُعيد قراءتها ────────────────
# 🔴 علّةٌ صامتة كلّفت ترحيلَين: bash يقرأ السكربت على دفعات، فحين يسحب
#    git pull نسخةً جديدة تكون كتلةُ الترحيل (أسفل) قد قُرئت من النسخة
#    القديمة. فيُنفَّذ ترحيلُ الأمس ويُعلَن «تمّ» بصدق — عن ترحيلٍ ليس فيه
#    ما أُضيف. لا خطأ ولا تحذير ولا أثر.
if [ "$BEFORE" != "$AFTER" ] && [ "${AIBOT_REEXEC:-0}" != "1" ]; then
  if ! git diff --quiet "$BEFORE" "$AFTER" -- deploy.sh; then
    say "deploy.sh تغيّر — إعادة تنفيذ نفسه مرّةً واحدة"
    # و`EXIT` معها احتياطاً: `exec` يستبدل الصورة فلا تعمل المصائد، والنزعُ
    # الصريحُ يبقى صحيحاً لو صار الاستبدالُ يوماً استدعاءً عاديّاً.
    trap - ERR EXIT
    AIBOT_REEXEC=1 exec bash "$0" "$@"
  fi
fi

# ── 3. وسم الصور العاملة قبل البناء ─────────────────────────────
say "وسم الصور الحاليّة للتراجع"
for s in $SERVICES; do
  docker image inspect "aibot-${s}:latest" >/dev/null 2>&1 \
    && docker tag "aibot-${s}:latest" "aibot-${s}:rollback-${STAMP}" || true
done

# ★ التسليحُ **هنا** لا في الأعلى: قبل هذا السطر لا وسومَ `rollback-${STAMP}`
#   فلا شيءَ يُتراجَع إليه، وتسليحٌ مبكّرٌ يجعل فشلَ «.env غائب» أو «pg_dump فشل
#   صامتاً» يهدم حاوياتٍ سليمةً ويُعيد إنشاءها بلا سبب.
arm_rollback

say "البناء"
docker compose build --build-arg GIT_REV="$GIT_REV" $SERVICES

# ── 4. الاستبدال — التطبيق وحده، لا db ولا redis ────────────────
# إعادة إنشاء القاعدة وريدِس في كلّ نشرٍ خطرٌ مجّانيّ على حالة الإنتاج.
say "الاستبدال"
docker compose rm -sf $SERVICES 2>/dev/null || true
docker compose up -d $SERVICES

# ── 5. الترحيل — الخطأ يُظهَر لا يُبتلع ─────────────────────────
say "الترحيل"
for f in packages/db/migrations/*.sql; do
  echo "  → $(basename "$f")"
  if ! docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "${DB_USER}" \
        -d "${DB_NAME:-aibot}" -f - < "$f"; then
    fail "فشل الترحيل $(basename "$f") — ما قالته القاعدة أعلاه"
    exit 1
  fi
done

# ── 5ب. كلمة سرّ دور التطبيق ──
# تُضبط بعد الترحيل لأنّ الدور يُنشأ فيه. ومتَماثِلة: تكرارها لا يضرّ.
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "${DB_USER}" \
  -d "${DB_NAME:-aibot}" -c "ALTER ROLE aibot_app LOGIN PASSWORD '${APP_DB_PASSWORD}';" \
  < /dev/null > /dev/null
echo "  ✔ دور التطبيق مضبوط (غير سوبريوزر — سياسات RLS تسري عليه)"

# ── 6. بوّابة الصحّة — هي التي تقرّر النجاح، لا نهاية السكربت ───
say "بوّابة الصحّة"
OK=0
for i in $(seq 1 30); do
  BODY="$(curl -fsS -m 5 "http://127.0.0.1:${API_PORT}/api/health" 2>/dev/null || true)"
  if echo "$BODY" | grep -q '"service":"aibot"' \
     && echo "$BODY" | grep -q "\"rev\":\"${GIT_REV}\""; then
    OK=1; echo "  ✔ الخلفيّة حيّة على النسخة ${GIT_REV:0:8}"; break
  fi
  sleep 1
done
[ "$OK" = 1 ] || { fail "الخلفيّة لم تُثبت أنّها هي ولا أنّها النسخة الجديدة"; exit 1; }

# «الخلفيّة حيّة» ≠ «الموقع يفتح»
CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 8 "http://127.0.0.1:${WEB_PORT}/" || echo 000)"
case "$CODE" in 200|307|308) echo "  ✔ الواجهة تردّ ${CODE}";; *) fail "الواجهة ردّت ${CODE}"; exit 1;; esac

# ★ ونسخةُ الواجهة تُطابَق — لا «تردّ 200» وحدها.
#   🔴 وقع هذا فعلاً ثلاثَ نشراتٍ متتالية: بناءُ الواجهة يفشل، فيتراجع
#      السكربت ويُبقي صورةً قديمة، بينما ينجح بناءُ الـAPI والعامل. والبوّابةُ
#      تفحص نسخةَ الـAPI وحدها ثمّ تسأل الواجهةَ «هل تردّين؟» — وهي تردّ وهي
#      متأخّرةٌ بثلاث نشرات. خادمٌ بنصف نسخةٍ جديدة، وشاشاتٌ تنادي مساراتٍ
#      تغيّر عقدُها، ولا شيء في المخرجات يقول ذلك.
WREV="$(curl -fsS -m 8 "http://127.0.0.1:${WEB_PORT}/rev" 2>/dev/null || true)"
if echo "$WREV" | grep -q "\"rev\":\"${GIT_REV}\""; then
  echo "  ✔ الواجهة على النسخة ${GIT_REV:0:8}"
else
  fail "الواجهة ليست على ${GIT_REV:0:8} — الأرجح أنّ بناءها فشل وبقيت صورةٌ قديمة."
  echo "    ما ردّته: ${WREV:-لا شيء}" >&2
  exit 1
fi

# ── 7. فحصٌ عامّ: هل يصل النطاق إلى حاويتك أصلاً؟ ───────────────
# لا يُفشل النشر — النفق خارج سيطرة هذا السكربت — لكنّه يقول الحقيقة بصوتٍ عالٍ.
PUB="$(curl -fsS -m 8 "${PUBLIC_URL}/api/health" 2>/dev/null || true)"
if echo "$PUB" | grep -q '"service":"aibot"'; then
  echo "  ✔ ${PUBLIC_URL} يصل إلى AiBot"
else
  echo "  ⚠ ${PUBLIC_URL}/api/health لا يُرجع AiBot."
  echo "    الأرجح: سجلّ DNS لـaibot غير منشأ، أو إدخالات النفق ناقصة."
  echo "    ما يردّ الآن هو تطبيق wildcard على *.masaros.net — وهذا ليس عطلاً في النشر."
fi

# ── 8. التنظيف ──────────────────────────────────────────────────
for s in $SERVICES; do
  docker images --format '{{.Repository}}:{{.Tag}}' "aibot-${s}" \
    | grep 'rollback-' | sort -r | tail -n +4 | xargs -r docker rmi -f 2>/dev/null || true
done
docker image prune -f >/dev/null 2>&1 || true

# النجاحُ أُعلن: تُنزع المصيدتان. وبلا نزع EXIT يتراجع نشرٌ **ناجح** لو أخفق
# أيُّ أمرٍ في طبع الملخّص أدناه.
trap - ERR EXIT
cat <<EOF

✅ نُشرت النسخة ${GIT_REV:0:8}
   الرابط:        ${PUBLIC_URL}
   النسخة:        ${BK}
   الحزمة:        ${OFFSITE_NOTE}  ← اسحبها من جهاز العمل: ops/pull-backups.sh
   أمر التراجع:   for s in ${SERVICES}; do docker tag aibot-\$s:rollback-${STAMP} aibot-\$s:latest; done \\
                  && docker compose rm -sf ${SERVICES} && docker compose up -d --no-build ${SERVICES}
EOF
