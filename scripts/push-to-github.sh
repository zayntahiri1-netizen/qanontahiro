#!/usr/bin/env bash
# =========================================================================
# قانون تاهيرو — دفع المشروع إلى GitHub؛ وكل دفع إلى main يبني فيه Actions تطبيقي أندرويد وiPhone ويشغّل الاختبارات.
#
#   GH_USER=zayntahiri1-netizen GH_REPO=qanontahiro GH_TOKEN=ghp_… ./scripts/push-to-github.sh ["رسالة الالتزام"]
#
# • الرمز يلزمه صلاحيتا repo وworkflow (الثانية لأن الحزمة فيها ملفات .github/workflows).
# • الرمز لا يُحفظ في أي ملف: يُمرَّر لـ git في الأمر نفسه فقط.
# • إن كان في المستودع البعيد تاريخ سابق يُبنى الالتزام الجديد فوقه، فلا يُرفض الدفع ولا يُمحى شيء من التاريخ،
#   ولو فُكّت الحزمة في مجلد جديد بلا ‎.git.
# • يرفض الدفع إن وجد بين الملفات سراً (مفتاح خادم، رمز إدارة، ملف توقيع…).
# =========================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
GH_USER=${GH_USER:-zayntahiri1-netizen}
GH_REPO=${GH_REPO:-qanontahiro}
BRANCH=${GH_BRANCH:-main}
URL=${GH_URL:-https://github.com/$GH_USER/$GH_REPO.git}
MSG=${1:-"قانون تاهيرو v8.1: مولّد التمارين من النصوص (أسئلة ومسائل ونوازل وألغاز)، والبنود والخصوصية وحذف البيانات بأربع لغات، والموافقة على البنود قبل الدخول"}

command -v git >/dev/null || { echo "✗ يلزم git:  pkg install git"; exit 1; }
if [ -z "${GH_TOKEN:-}" ] && [[ "$URL" == https://* ]]; then
  read -rsp "رمز GitHub (صلاحيتا repo وworkflow): " GH_TOKEN < /dev/tty; echo
fi
AUTH=()
if [ -n "${GH_TOKEN:-}" ]; then
  B64=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')
  AUTH=(-c "http.https://github.com/.extraheader=AUTHORIZATION: basic $B64")
fi
g(){ if [ ${#AUTH[@]} -gt 0 ]; then git "${AUTH[@]}" "$@"; else git "$@"; fi; }

if [ ! -d .git ]; then git init -q; git symbolic-ref HEAD "refs/heads/$BRANCH"; fi
git config user.name  >/dev/null 2>&1 || git config user.name  "$GH_USER"
git config user.email >/dev/null 2>&1 || git config user.email "$GH_USER@users.noreply.github.com"
git config core.quotepath false
if git remote get-url origin >/dev/null 2>&1; then git remote set-url origin "$URL"; else git remote add origin "$URL"; fi

echo "== الوصول إلى $GH_USER/$GH_REPO =="
if ! REMOTE=$(g ls-remote --heads origin 2>&1); then
  echo "$REMOTE" | sed 's/basic [A-Za-z0-9+/=]*/basic ***/g' | tail -3
  echo "✗ تعذّر الوصول إلى المستودع: تحقّق من الرمز (صلاحية repo) ومن اسمي المستخدم والمستودع."; exit 1
fi
if echo "$REMOTE" | grep -q "refs/heads/$BRANCH\$"; then
  g fetch -q origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  if ! git rev-parse -q --verify HEAD >/dev/null || ! git merge-base --is-ancestor "origin/$BRANCH" HEAD; then
    git reset -q --soft "origin/$BRANCH"        # تبقى الملفات كما هي؛ والالتزام القادم يحمل الفرق عن آخر نسخة على GitHub
    echo "· الالتزام يُبنى فوق آخر نسخة على GitHub ($(git rev-parse --short "origin/$BRANCH"))"
  fi
else
  echo "· المستودع فارغ: أول التزام"
fi

git add -A
# حارس أخير: لا سر في ما سيُدفع (المفاتيح العامة للعميل مسموحة؛ هذه أنماط أسرار الخادم وملفات التوقيع)
BAD=$(git diff --cached --name-only --diff-filter=AM | grep -E '\.(jks|keystore|p12|pem|p8|cer|mobileprovision|certSigningRequest)$|(^|/)\.env' || true)
LEAK=$(git grep --cached -l -E 'sb_secret_[A-Za-z0-9]|sbp_[0-9a-f]{20,}|bjCE2A\.7YUitA:|-----BEGIN [A-Z ]*PRIVATE KEY|"type" *: *"service_account"|sk-ant-(api|admin)[0-9]{2}-[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_-]{30,}' -- . ':!scripts/push-to-github.sh' ':!build.py' ':!tools/cap-web.mjs' ':!scripts/ios-signing.sh' || true)
if [ -n "$BAD$LEAK" ]; then
  echo "✗ أوقفتُ الدفع: ملفات تبدو أسراراً:"; echo "$BAD"; echo "$LEAK"; git reset -q; exit 1
fi

if git diff --cached --quiet; then
  echo "· لا تغييرات جديدة للالتزام"
else
  git commit -q -m "$MSG"
  echo "✓ التُزم: $(git log -1 --format='%h  %s')"
fi

echo "== الدفع =="
if ! OUT=$(g push origin "HEAD:refs/heads/$BRANCH" 2>&1); then
  echo "$OUT" | sed 's/basic [A-Za-z0-9+/=]*/basic ***/g' | tail -6
  if echo "$OUT" | grep -qi "workflow"; then
    echo "✗ الرمز بلا صلاحية workflow: أنشئ رمزاً كلاسيكياً بصلاحيتي repo وworkflow من github.com/settings/tokens ثم أعد الأمر."
  else
    echo "✗ فشل الدفع."
  fi
  exit 1
fi
echo "$OUT" | sed 's/basic [A-Za-z0-9+/=]*/basic ***/g' | grep -E '\->|Everything' || true
git update-ref "refs/remotes/origin/$BRANCH" HEAD
echo "✓ دُفع إلى https://github.com/$GH_USER/$GH_REPO — البناء: https://github.com/$GH_USER/$GH_REPO/actions"
