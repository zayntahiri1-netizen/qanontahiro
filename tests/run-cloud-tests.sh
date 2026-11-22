#!/usr/bin/env bash
# =========================================================================
# قانون تاهيرو — اختبارات التوليفة السحابية (اختيارية، تحتاج Postgres 16 و Playwright):
#   1) tests/sql/behave.sql   : 46 فحصاً لدوال Supabase وصلاحياتها على Postgres حقيقي بمحاكاة بيئة Supabase
#   2) tests/browser/e2e_cloud.js : ثلاثة أجهزة، الهوية والنقل والحذف والمزامنة واللوحة والنبض والتحدي والإعلان والإحصاءات
#   3) tests/browser/e2e_site.js  : الموقع متصلاً ودون اتصال، هاتفاً وسطح مكتب
#   4) tests/fn/run.mjs           : دالة النبض بشيفرتها نفسها
#   5) tests/fn/run-ai.mjs        : «المساعد» بشيفرته نفسها، وClaude بديل، والبنك كاملاً في قاعدة المعرفة ومكتبة القوانين كاملة
#   5ب) tests/fn/run-ads.mjs      : التحقق من مكافآت AdMob بتوقيعات ECDSA حقيقية (qt-ads)
#   6) tests/browser/e2e_v5.js    : الدخول بـ Google، والترتيب العالمي، و«المساعد» في متصفح حقيقي
#   7) tests/browser/e2e_native.js: نسخة أندرويد (www/) بـ capacitor.js الحقيقي وبيئة أصلية محاكاة
#   8) tests/browser/e2e_ads.js   : الإعلانات في نسخة أندرويد بمحاكٍ لـ AdMob: الموافقة، والشريط، والبيني، والمكافأة، وشاشة الفتح
#   (ومعها tests/sql/behave_v5.sql: الترتيب العالمي وأسماء Google وحصص المساعد، وbehave_v6.sql: مكافآت الإعلانات،
#    وbehave_v7.sql: مكتبة القوانين — التحميل والبحث بالجذور والمطابقة الدقيقة والصلاحيات)
# يُشغَّل بعد python3 build.py. المنافذ: Postgres 5439، التطبيق 8765، الموقع 8766.
# في GitHub Actions (bank.yml): Postgres خدمةً على localhost:5432 بـ PGPASSWORD، وQT_SKIP_BROWSER=1 يترك فحوص المتصفح.
# =========================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
PG=${QT_PG_BIN:-/usr/lib/postgresql/16/bin}; PGD=${QT_PGDATA:-/var/lib/postgresql/qtpg}; H=${QT_PG_HOST:-/var/lib/postgresql}
P="psql -h $H -p ${QT_PG_PORT:-5439} -U postgres -q -v ON_ERROR_STOP=1"
if ! $P -c 'select 1' >/dev/null 2>&1; then
  [ -d "$PGD" ] || su postgres -c "$PG/initdb -D $PGD -A trust -U postgres >/dev/null"
  su postgres -c "$PG/pg_ctl -D $PGD -o '-p ${QT_PG_PORT:-5439} -k $H' -l $PGD/log -w start" >/dev/null
fi
# قاعدة نظيفة بكل الهجرات بالترتيب، كما تطبقها أداة النشر
fresh(){ $P -f tests/sql/shim.sql >/dev/null 2>&1; for f in supabase/migrations/*.sql; do $P -d qt -f "$f" >/dev/null 2>&1 || { echo "✗ فشلت الهجرة $f"; exit 1; }; done; }
echo "== SQL =="
fresh
$P -d qt -t -f tests/sql/behave.sql 2>&1 | grep -E "PASSED|FAIL|ERROR" || { echo "✗ فشل اختبار SQL"; exit 1; }
$P -d qt -t -f tests/sql/behave_v5.sql 2>&1 | grep -E "PASSED|FAIL|ERROR" || { echo "✗ فشل اختبار SQL v5"; exit 1; }
$P -d qt -t -f tests/sql/behave_v6.sql 2>&1 | grep -E "PASSED|FAIL|ERROR" || { echo "✗ فشل اختبار SQL v6"; exit 1; }
$P -d qt -t -f tests/sql/behave_v7.sql 2>&1 | grep -E "PASSED|FAIL|ERROR" || { echo "✗ فشل اختبار SQL v7"; exit 1; }
echo "== دالة النبض =="
T=$(mktemp -d); cp tests/fn/*.mjs "$T"/
sed 's#import { createClient } from "npm:@supabase/supabase-js@2";#import { createClient } from "./mock-sb.mjs";#' supabase/functions/qt-pulse/index.ts > "$T/fn.mts"
sed 's#import { createClient } from "npm:@supabase/supabase-js@2";#import { createClient } from "./mock-sb-ai.mjs";#' supabase/functions/qt-ai/index.ts > "$T/fn-ai.mts"
sed 's#import { createClient } from "npm:@supabase/supabase-js@2";#import { createClient } from "./mock-sb-ai.mjs";#' supabase/functions/qt-ads/index.ts > "$T/fn-ads.mts"
fresh
( cd "$T" && node run.mjs 2>&1 | grep -E "^(✗|✓ دالة)" )
echo "== المساعد =="
fresh; python3 tests/fn/load-kb.py; python3 tests/fn/load-corpus.py
( cd "$T" && node run-ai.mjs 2>&1 | grep -E "^(✗|✓ المساعد)" )
echo "== مكافآت الإعلانات (qt-ads) =="
fresh
( cd "$T" && node run-ads.mjs 2>&1 | grep -E "^(✗|✓ مكافآت)" )
if [ "${QT_SKIP_BROWSER:-0}" = "1" ]; then echo "== المتصفح: متروك (QT_SKIP_BROWSER=1) =="; exit 0; fi
echo "== المتصفح =="
( cd dist/app && exec python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 ) & A=$!
( cd dist/site && exec python3 -m http.server 8766 --bind 127.0.0.1 >/dev/null 2>&1 ) & B=$!
trap 'kill $A $B 2>/dev/null' EXIT
until curl -s -o /dev/null http://127.0.0.1:8765/ && curl -s -o /dev/null http://127.0.0.1:8766/; do :; done
node tests/browser/e2e_cloud.js | grep -E "^(✓|✗)|لا أخطاء|FAIL"
node tests/browser/e2e_site.js | grep -E "^(✗)|لا أخطاء|FAIL"
node tests/browser/e2e_v5.js | grep -E "^(✗)|لا أخطاء|FAIL"
# نسخة أندرويد: تحتاج www/ من node tools/cap-web.mjs (بعد npm install)، وإلا تُترك
if [ -f www/native.js ]; then
  ( cd www && exec python3 -m http.server 8771 --bind 127.0.0.1 >/dev/null 2>&1 ) & N=$!
  trap 'kill $A $B $N 2>/dev/null' EXIT
  until curl -s -o /dev/null http://127.0.0.1:8771/; do :; done
  node tests/browser/e2e_native.js | grep -E "^(✗)|لا أخطاء|FAIL"
  node tests/browser/e2e_ads.js | grep -E "^(✗)|لا أخطاء|FAIL"
else echo "· e2e_native وe2e_ads متروكان: شغّل npm install && node tools/cap-web.mjs أولاً"; fi
