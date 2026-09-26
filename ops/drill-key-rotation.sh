#!/bin/bash
# ════════════════════════════════════════════════════════════════
# تمرينُ الفشل (ز): **تدويرُ `MASTER_KEY` دورةً كاملة.**
#
# ★ لماذا لا يكفي اختبارٌ ساكن: `ops/rotate-master-key.ts` أداةٌ تفكّ وتُعيد
#   الختم على صفوفٍ حقيقيّة. وحارسٌ يقرأ نصَّها يُثبت أنّ قائمةَ الأعمدة
#   كاملةٌ وأنّ الشرطَ فيه `key_version` — ولا يُثبت أنّها **تُدوّر**.
#
# ★ وثلاثُ عمليّاتٍ منفصلة لا واحدة، وهذا جوهرُ التمرين: `packages/crypto`
#   يقرأ المفاتيحَ **مرّةً** عند أوّل استعمالٍ ويحفظها. فتبديلُ البيئة داخل
#   عمليّةٍ واحدةٍ لا يُبدّل شيئاً، وتمرينٌ كذلك يشهد على لا شيء.
#
# ★★ والإثباتُ الحقيقيُّ هو الطورُ الثالث: يفكّ الصفَّ و**المفتاحُ القديم غيرُ
#    مضبوطٍ إطلاقاً**. فإن نجح فقد تحرّرت القاعدةُ منه فعلاً، ويجوز حذفُه.
#    ولولا هذا الطور لكان «نجح التدوير» ادّعاءً: الفكُّ كان سيمرّ بالقديم.
#
# 🔴 لا يمسّ الإنتاج: يُنشئ قاعدةً باسمه ويحذفها في كلّ خروج.
# ⚠️ ولا يُطبع مفتاحٌ ولا سرٌّ — لا في المخرَج ولا في وسائط أمر.
#
# يُشغَّل على الخادم:  ops/drill-key-rotation.sh
# ════════════════════════════════════════════════════════════════
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
set -a; . ./.env; set +a

export PGHOST=127.0.0.1 PGPORT="${DB_PORT:-5432}" PGUSER="${DB_USER}" PGPASSWORD="${DB_PASSWORD}"
DB="rot_drill_$$"

cleanup() { psql -qAt -d postgres -c "DROP DATABASE IF EXISTS ${DB};" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -qAt -d postgres -c "CREATE DATABASE ${DB};" >/dev/null
export PGDATABASE="$DB"

echo "▶ المخطَّط"
for f in packages/db/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 --single-transaction -q -f "$f" > /dev/null 2>&1
done
psql -qAt -c "ALTER ROLE aibot_app LOGIN PASSWORD 'rotdrill';" >/dev/null
export DATABASE_URL="postgresql://aibot_app:rotdrill@127.0.0.1:${PGPORT}/${DB}"
echo "  ✔ قاعدةٌ مؤقّتة جاهزة"

# مفتاحان يُولَّدان هنا ولا يُطبعان ولا يُمرَّران في وسائط أمر
K1="$(openssl rand -base64 32)"
K2="$(openssl rand -base64 32)"

echo ""
echo "▶ ① بذرٌ بالمفتاح القديم (الإصدار 1)"
MASTER_KEY="$K1" MASTER_KEY_VERSION=1 node --import tsx ops/drill-rot-seed.ts

echo ""
echo "▶ ② التدوير إلى الإصدار 2 — والقديمُ ما زال مضبوطاً"
MASTER_KEY="$K2" MASTER_KEY_VERSION=2 MASTER_KEY_V1="$K1" APPLY=1 \
  node --import tsx ops/rotate-master-key.ts

echo ""
echo "▶ ③ التحقّق **بلا المفتاح القديم** — وهذا هو الإثبات"
MASTER_KEY="$K2" MASTER_KEY_VERSION=2 node --import tsx ops/drill-rot-verify.ts
