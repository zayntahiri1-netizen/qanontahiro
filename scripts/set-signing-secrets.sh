#!/usr/bin/env bash
# =========================================================================
# قانون تاهيرو — ضبط أسرار توقيع أندرويد في GitHub من Termux (مرة واحدة؛ ويمكن ضبطها يدوياً من الموقع بدلاً منه).
# بها يبني Actions نسخة موقّعة: APK للتثبيت المباشر وAAB لـ Google Play، وتتحدث فوق النسخة السابقة دون حذفها.
#
#   GH_TOKEN=ghp_… ./scripts/set-signing-secrets.sh  [مسار ملف المفتاح ‎.jks]
#
# • إن كان التطبيق منشوراً على Play من قبل: استعمل ملف مفتاح الرفع (upload key) نفسه، لا مفتاحاً جديداً.
# • إن لم يُعطَ مسار ولم يوجد ~/qanoun-tahiro-upload.jks: يُنشأ مفتاح جديد (يلزم keytool: pkg install openjdk-21).
# • يلزم gh:  pkg install gh   والرمز بصلاحية repo (أو Secrets: write في الرموز الدقيقة).
# • الملف وكلمات السر لا تُكتب في المشروع ولا تُرسل إلا إلى أسرار المستودع المشفّرة في GitHub.
# =========================================================================
set -euo pipefail
REPO="${GH_USER:-zayntahiri1-netizen}/${GH_REPO:-qanontahiro}"
KS="${1:-$HOME/qanoun-tahiro-upload.jks}"
command -v gh >/dev/null || { echo "✗ يلزم gh:  pkg install gh"; exit 1; }
[ -n "${GH_TOKEN:-}" ] || { read -rsp "رمز GitHub (صلاحية repo): " GH_TOKEN < /dev/tty; echo; export GH_TOKEN; }

if [ ! -f "$KS" ]; then
  command -v keytool >/dev/null || { echo "✗ لا ملف مفتاح في $KS، ولإنشائه يلزم keytool:  pkg install openjdk-21"; exit 1; }
  echo "== إنشاء مفتاح رفع جديد: $KS =="
  read -rsp "كلمة سر جديدة للمفتاح (8 أحرف على الأقل): " P1 < /dev/tty; echo
  [ ${#P1} -ge 8 ] || { echo "✗ كلمة السر قصيرة"; exit 1; }
  keytool -genkeypair -keystore "$KS" -storetype PKCS12 -alias qanoun -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$P1" -keypass "$P1" -dname "CN=Ahmed Bakkali Tahiri, O=Tahiro, C=MA" >/dev/null
  chmod 600 "$KS"
  AL=qanoun; P2=$P1
  echo "✓ أُنشئ. ⚠ احفظ نسخة من $KS وكلمة سره خارج الهاتف: ضياعهما يمنع تحديث التطبيق على Google Play."
else
  echo "== ملف المفتاح: $KS =="
  read -rsp "كلمة سر الملف: " P1 < /dev/tty; echo
  read -rp  "اسم المفتاح داخله (alias): " AL < /dev/tty
  read -rsp "كلمة سر المفتاح (Enter = كلمة سر الملف نفسها): " P2 < /dev/tty; echo
  P2=${P2:-$P1}
  if command -v keytool >/dev/null; then
    keytool -list -keystore "$KS" -storepass "$P1" -alias "$AL" >/dev/null 2>&1 || { echo "✗ كلمة السر أو اسم المفتاح غير صحيح"; exit 1; }
  fi
fi

base64 -w0 "$KS" | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$REPO"
printf '%s' "$P1" | gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$REPO"
printf '%s' "$AL" | gh secret set ANDROID_KEY_ALIAS --repo "$REPO"
printf '%s' "$P2" | gh secret set ANDROID_KEY_PASSWORD --repo "$REPO"
echo "✓ أسرار التوقيع مضبوطة في $REPO. أعد تشغيل بناء Android من تبويب Actions أو ادفع تغييراً جديداً."
if command -v keytool >/dev/null; then
  echo "بصمة الشهادة (لـ Play Console وFirebase عند الحاجة):"
  keytool -list -v -keystore "$KS" -storepass "$P1" -alias "$AL" 2>/dev/null | grep -E "SHA1:|SHA256:" || true
fi
