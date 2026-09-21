#!/bin/bash
# ════════════════════════════════════════════════════════════════
# تفعيل aibot.masaros.net على نفق Cloudflare.
#
# يُشغَّل **مرّةً واحدة** وبـsudo:   sudo bash ~/aibot/ops/enable-domain.sh
#
# ⚠️ قبله: أنشئ سجلّ DNS من لوحة Cloudflare (الخطوة الوحيدة التي لا تجري هنا).
#    راجع نهاية الملفّ.
#
# ⚠️ وهذا السكربت يُعيد تشغيل cloudflared، فينقطع **كلّ** ما على النفق
#    (25 مضيفاً: مافيا، شلمونة، howplatform، BTEC، لوحة CloudPanel…)
#    لقرابة 60 ثانية. نافذة صيانةٍ متّفقٌ عليها، لا أمرٌ عابر.
# ════════════════════════════════════════════════════════════════
set -Eeuo pipefail

CFG=/etc/cloudflared/config.yml
HOST=aibot.masaros.net
API_PORT="${API_PORT:-4100}"
WEB_PORT="${WEB_PORT:-3070}"

[ "$(id -u)" = 0 ] || { echo "❌ شغّله بـsudo"; exit 1; }
[ -f "$CFG" ] || { echo "❌ $CFG غير موجود — هل النفق مُدارٌ عن بُعد؟"; exit 1; }

# ── 0. تحقّق أنّ الخدمة تعمل محلّيّاً قبل أن نوجّه إليها ──
# توجيهُ نطاقٍ إلى منفذٍ ميّت يُنتج 502 للزوّار ويبدو عطلاً في النفق لا في التطبيق.
for p in "$API_PORT" "$WEB_PORT"; do
  curl -fsS -m 5 -o /dev/null "http://127.0.0.1:${p}/" 2>/dev/null \
    || curl -fsS -m 5 -o /dev/null "http://127.0.0.1:${p}/login" 2>/dev/null \
    || { echo "❌ المنفذ ${p} لا يستجيب — شغّل الحاويات أوّلاً"; exit 1; }
done
curl -fsS -m 5 "http://127.0.0.1:${API_PORT}/api/health" | grep -q '"service":"aibot"' \
  || { echo "❌ /api/health لا يُرجع AiBot على ${API_PORT}"; exit 1; }
echo "✔ الخدمتان تعملان محلّيّاً"

# ── 1. الإدخالات ──
if grep -q "$HOST" "$CFG"; then
  echo "ℹ️  $HOST موجودٌ في النفق مسبقاً — لا تغيير في الملفّ."
else
  cp "$CFG" "${CFG}.bak.aibot.$(date +%Y%m%d-%H%M%S)"
  echo "✔ نسخةٌ احتياطيّة من الإعداد"

  python3 - "$CFG" "$HOST" "$API_PORT" "$WEB_PORT" <<'PY'
import sys
cfg, host, api, web = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
s = open(cfg, encoding='utf-8').read()

# الترتيب حاسم: مسارا الـAPI والسوكِت **قبل** القاعدة العامّة للمضيف،
# وكلّها **قبل** القاعدة الجامعة 404 وإلّا ابتلعتها.
block = f"""  - hostname: {host}
    path: /api/.*
    service: http://127.0.0.1:{api}

  - hostname: {host}
    path: /socket\\.io/.*
    service: http://127.0.0.1:{api}

  - hostname: {host}
    service: http://127.0.0.1:{web}

"""
marker = '  - service: http_status:404'
assert marker in s, 'القاعدة الجامعة 404 غير موجودة — راجع الملفّ يدويّاً'
open(cfg, 'w', encoding='utf-8').write(s.replace(marker, block + marker, 1))
print('✔ أُضيفت ثلاثة إدخالات قبل القاعدة الجامعة')
PY
fi

# ── 2. التحقّق **قبل** إعادة التشغيل — هذا ما يجعل الإجراء آمناً على 25 مضيفاً ──
echo
echo "▶ التحقّق من صحّة الإعداد:"
cloudflared tunnel --config "$CFG" ingress validate

echo
echo "▶ إلى أين يذهب كلّ مسار:"
cloudflared tunnel --config "$CFG" ingress rule "https://${HOST}/api/health"
cloudflared tunnel --config "$CFG" ingress rule "https://${HOST}/"

# ── 3. إعادة التشغيل ──
echo
read -r -p "إعادة تشغيل cloudflared الآن؟ ينقطع 25 مضيفاً ~60 ثانية [y/N] " ans
[ "$ans" = "y" ] || { echo "أُلغي. الإعداد محفوظ — أعِد التشغيل متى شئت:"; echo "  sudo systemctl restart cloudflared"; exit 0; }

systemctl restart cloudflared
sleep 6
systemctl is-active cloudflared

# ── 4. الفحص العامّ: بالجسم لا بكود الحالة ──
# كود 200 وحده لا يُثبت شيئاً: الـwildcard على *.masaros.net يردّ 200 من
# تطبيقٍ آخر. الجسم هو ما يُثبت أنّك تكلّم AiBot.
echo
echo "▶ الفحص العامّ (حتّى 30 ثانية):"
for i in $(seq 1 30); do
  if curl -fsS -m 5 "https://${HOST}/api/health" 2>/dev/null | grep -q '"service":"aibot"'; then
    echo "✅ ${HOST} يصل إلى AiBot"
    curl -s -m 5 "https://${HOST}/api/health"; echo
    exit 0
  fi
  sleep 1
done

cat <<MSG

⚠️ النفق أُعيد تشغيله لكنّ ${HOST} ما زال لا يُرجع AiBot.

السبب الأرجح: **سجلّ DNS غير منشأ.** النطاق يُحلّ الآن عبر الـwildcard
على *.masaros.net إلى أصلٍ آخر، فلا يمرّ بهذا النفق إطلاقاً.

أنشئ من لوحة Cloudflare → DNS → masaros.net:

    Type:    CNAME
    Name:    aibot
    Target:  b8f315ec-a311-4b7a-8891-7b9e37a43f73.cfargotunnel.com
    Proxy:   Proxied ✅

⛔ ولا تستعمل:  cloudflared tunnel route dns cloudpanel-tunnel ${HOST}
   فـcert.pem على هذا الخادم مُصدَرٌ لـgrade.sbs وحده، والأمر يُنشئ سجلّاً
   فاسداً باسم ${HOST}.grade.sbs — حدث هذا فعلاً مع btec.

ثمّ تحقّق:
    curl -s https://${HOST}/api/health | grep '"service":"aibot"'
MSG
exit 1
