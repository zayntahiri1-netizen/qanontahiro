#!/usr/bin/env bash
# =========================================================================
# قانون تاهيرو — نشر الإصدار كاملاً بأمر واحد (Termux أو أي طرفية فيها Node 18+ وgit):
#   1) الخادم: Supabase — الهجرات، الدخول المجهول وGoogle، الأسرار، الدوال الثلاث (النبض وTAHIRO AI والتحقق من مكافآت AdMob)،
#      قاعدة المعرفة، ومكتبة القوانين (نصوص المواد التي يجيب منها TAHIRO AI أولاً)، وفحوص حية
#   2) الموقع ونسخة الويب من التطبيق: Firebase Hosting ← https://qanon-47831.web.app (ومعه app-ads.txt لـ AdMob)
#   3) المستودع: GitHub ← يبني Actions تطبيقي أندرويد (APK/AAB) وiPhone (TestFlight متى وُجدت أسراره) ويشغّل الاختبارات
# كل خطوة تتوقف عند أول خطأ وتقول سببه. ولتخطي خطوة: QT_SKIP=cloud أو hosting أو github (أو أكثر، بفواصل).
# =========================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
SKIP=",${QT_SKIP:-},"
command -v node >/dev/null || { echo "✗ يلزم Node.js:  pkg install nodejs"; exit 1; }
[ -f dist/site/index.html ] && [ -f dist/app/index.html ] || {
  command -v python3 >/dev/null && python3 build.py || { echo "✗ dist/ غير موجود: شغّل python3 build.py (pkg install python)"; exit 1; }; }

if [[ "$SKIP" != *",cloud,"* ]]; then
  echo "== 1/3 الخادم: Supabase =="
  node tools/deploy-cloud.mjs
fi

if [[ "$SKIP" != *",hosting,"* ]]; then
  echo
  echo "== 2/3 الموقع والتطبيق على الويب: Firebase Hosting =="
  FB="npx -y firebase-tools@latest"
  $FB login --no-localhost
  $FB deploy --only hosting --project qanon-47831 --non-interactive
fi

if [[ "$SKIP" != *",github,"* ]]; then
  echo
  echo "== 3/3 المستودع: GitHub (يبني تطبيق أندرويد) =="
  bash scripts/push-to-github.sh
fi

echo
echo "✓ انتهى. الموقع: https://qanon-47831.web.app  ·  التطبيق على الويب: https://qanon-47831.web.app/app/"
echo "  تطبيق أندرويد: https://github.com/${GH_USER:-zayntahiri1-netizen}/${GH_REPO:-qanontahiro}/actions ← آخر تشغيل ← Artifacts"
