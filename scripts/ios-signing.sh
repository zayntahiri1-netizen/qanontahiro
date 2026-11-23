#!/usr/bin/env bash
# =========================================================================
# قانون تاهيرو — توقيع تطبيق iPhone من Termux دون Mac (مرة واحدة)، على خطوتين بينهما زيارة لموقع Apple Developer:
#
#   bash scripts/ios-signing.sh csr       ← (1) مفتاح خاص وطلب شهادة ‎.certSigningRequest في Download لرفعه إلى Apple
#   bash scripts/ios-signing.sh secrets   ← (2) بعد تنزيل الشهادة وملف التعريف ومفتاح API من Apple إلى Download:
#                                            يبني ملف ‎.p12 ويتحقق من كل شيء، ثم يضع الأسرار في GitHub
#   bash scripts/ios-signing.sh check     ← يعرض ما في Download وحالته دون أن يغيّر شيئاً
#
# المتوقع في /sdcard/Download بعد زيارة Apple (الأسماء كما ينزّلها الموقع):
#   distribution.cer              شهادة «Apple Distribution» (من Certificates ← +)
#   *.mobileprovision             ملف تعريف «App Store Connect» للمعرّف com.qanontahiro.app (من Profiles ← +)
#   AuthKey_XXXXXXXXXX.p8         مفتاح App Store Connect API (من Users and Access ← Integrations) — يُنزَّل مرة واحدة فقط
# الأسرار التي تُضبط: IOS_CERT_P12  IOS_CERT_PASSWORD  IOS_PROFILE  ASC_KEY_ID  ASC_ISSUER_ID  ASC_KEY_P8
# المفتاح الخاص يبقى في ~/.qanoun-tahiro-ios (احفظ نسخة منه ومن ملف ‎.p12 خارج الهاتف). لا شيء من هذا يُكتب في المشروع.
# يلزم: pkg install openssl-tool gh
# =========================================================================
set -euo pipefail
REPO="${GH_USER:-zayntahiri1-netizen}/${GH_REPO:-qanontahiro}"
DL="${QT_DOWNLOAD:-/sdcard/Download}"
W="${QT_IOS_DIR:-$HOME/.qanoun-tahiro-ios}"
BUNDLE=com.qanontahiro.app
say(){ printf '%s\n' "$*"; }
die(){ printf '✗ %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null || die "يلزم $1:  pkg install $2"; }
need openssl openssl-tool
mkdir -p "$W"; chmod 700 "$W"

latest(){ ls -t "$DL"/$1 2>/dev/null | head -1 || true; }
# ملف التعريف موقَّع (CMS): نستخرج منه القاموس ونقرأ القيم بـ Python أو بحث نصي
prof_plist(){ openssl smime -inform DER -verify -noverify -in "$1" 2>/dev/null || openssl cms -inform DER -verify -noverify -in "$1" 2>/dev/null; }
pval(){ python3 -c 'import plistlib,sys; d=plistlib.loads(sys.stdin.buffer.read()); v=d
for k in sys.argv[1].split("/"): v=v[int(k)] if isinstance(v,list) else v[k]
print(v.decode() if isinstance(v,bytes) else v)' "$1"; }

case "${1:-}" in
csr)
  if [ -s "$W/dist.key" ]; then
    say "· يوجد مفتاح خاص سابق في $W/dist.key — يُعاد استعماله (لا تُنشئ مفتاحاً جديداً إلا إن فقدت الشهادة)."
  else
    openssl genrsa -out "$W/dist.key" 2048 2>/dev/null
    chmod 600 "$W/dist.key"
    say "✓ مفتاح خاص جديد: $W/dist.key"
  fi
  openssl req -new -key "$W/dist.key" -out "$W/qanoun-tahiro.certSigningRequest" -subj "/CN=Qanoun Tahiro Distribution/O=Tahiro/C=MA"
  cp "$W/qanoun-tahiro.certSigningRequest" "$DL/qanoun-tahiro.certSigningRequest"
  say "✓ طلب الشهادة في: $DL/qanoun-tahiro.certSigningRequest"
  say "الآن في المتصفح: developer.apple.com/account ← Certificates ← + ← Apple Distribution ← Continue"
  say "← Choose File: اختر qanoun-tahiro.certSigningRequest من Download ← Continue ← Download (ينزل distribution.cer)."
  say "⚠ احفظ نسخة من المجلد $W خارج الهاتف: الشهادة لا تعمل دون هذا المفتاح."
  ;;

secrets|check)
  need python3 python
  CER=$(latest "distribution*.cer"); [ -n "$CER" ] || CER=$(latest "*.cer")
  PROF=$(latest "*.mobileprovision")
  P8=$(latest "AuthKey_*.p8")
  [ -s "$W/dist.key" ] || die "لا مفتاح خاص في $W/dist.key: ابدأ بـ  bash scripts/ios-signing.sh csr"
  [ -n "$CER" ] || die "لا شهادة ‎.cer في $DL (نزّلها من Certificates بعد رفع طلب الشهادة)"
  [ -n "$PROF" ] || die "لا ملف ‎.mobileprovision في $DL (Profiles ← + ← App Store Connect)"
  say "الشهادة: $CER"; say "ملف التعريف: $PROF"; say "مفتاح API: ${P8:-— (لا يوجد: سيُبنى IPA موقَّع دون رفع إلى TestFlight)}"
  # 1) الشهادة تخص المفتاح الخاص نفسه، وهي «Apple Distribution»
  openssl x509 -inform DER -in "$CER" -out "$W/dist.pem" 2>/dev/null || openssl x509 -in "$CER" -out "$W/dist.pem" 2>/dev/null || die "تعذّرت قراءة الشهادة $CER"
  SUBJ=$(openssl x509 -in "$W/dist.pem" -noout -subject); END=$(openssl x509 -in "$W/dist.pem" -noout -enddate | cut -d= -f2)
  say "  $SUBJ"; say "  صالحة حتى: $END"
  echo "$SUBJ" | grep -q "Distribution" || die "هذه ليست شهادة توزيع (Apple Distribution)"
  [ "$(openssl x509 -in "$W/dist.pem" -noout -pubkey | openssl md5)" = "$(openssl pkey -in "$W/dist.key" -pubout | openssl md5)" ] \
    || die "الشهادة لا تطابق المفتاح الخاص في $W/dist.key: ارفع طلب الشهادة الذي أنشأه هذا السكربت نفسه"
  # 2) ملف التعريف للمعرّف الصحيح، ونوعه App Store، ويحوي الشهادة نفسها
  prof_plist "$PROF" > "$W/profile.plist" || die "تعذّرت قراءة $PROF"
  NAME=$(pval Name < "$W/profile.plist"); TEAM=$(pval TeamIdentifier/0 < "$W/profile.plist")
  APPID=$(pval Entitlements/application-identifier < "$W/profile.plist"); EXP=$(pval ExpirationDate < "$W/profile.plist")
  say "  ملف التعريف: «$NAME» · الفريق $TEAM · $APPID · ينتهي $EXP"
  [ "$APPID" = "$TEAM.$BUNDLE" ] || die "ملف التعريف للمعرّف $APPID، والمطلوب $TEAM.$BUNDLE"
  if pval ProvisionedDevices < "$W/profile.plist" >/dev/null 2>&1; then die "ملف التعريف من نوع تطوير/Ad Hoc (فيه أجهزة): أنشئ ملفاً من نوع App Store Connect"; fi
  CERT_DER=$(openssl x509 -in "$W/dist.pem" -outform DER | openssl base64 -A)
  python3 - "$W/profile.plist" "$CERT_DER" <<'PY' || die "ملف التعريف لا يحوي هذه الشهادة: عند إنشائه اختر الشهادة الجديدة"
import plistlib, sys, base64
d = plistlib.load(open(sys.argv[1], 'rb')); c = base64.b64decode(sys.argv[2])
sys.exit(0 if any(bytes(x) == c for x in d.get('DeveloperCertificates', [])) else 1)
PY
  say "  ✓ الشهادة والمفتاح وملف التعريف متطابقة"
  KID=""
  if [ -n "$P8" ]; then
    KID=$(basename "$P8" | sed -E 's/^AuthKey_([A-Z0-9]+)\.p8$/\1/')
    grep -q "BEGIN PRIVATE KEY" "$P8" || die "$P8 ليس مفتاح API صالحاً"
    say "  مفتاح API: $KID"
  fi
  [ "$1" = "check" ] && { say "✓ الفحص انتهى (لم يُغيَّر شيء)."; exit 0; }
  need gh gh
  # 3) ملف ‎.p12 بتشفير يقبله macOS (3DES/SHA1) وكلمة سر عشوائية
  PW=$(openssl rand -hex 18)
  openssl pkcs12 -export -inkey "$W/dist.key" -in "$W/dist.pem" -name "Qanoun Tahiro Distribution" -out "$W/qanoun-tahiro-dist.p12" \
    -passout "pass:$PW" -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1
  chmod 600 "$W/qanoun-tahiro-dist.p12"
  openssl pkcs12 -in "$W/qanoun-tahiro-dist.p12" -passin "pass:$PW" -noout 2>/dev/null || die "تعذّر التحقق من ملف ‎.p12"
  say "✓ $W/qanoun-tahiro-dist.p12"
  ISS="${ASC_ISSUER_ID:-}"
  if [ -n "$P8" ] && [ -z "$ISS" ]; then
    read -rp "Issuer ID (من صفحة Integrations في App Store Connect، بصيغة xxxxxxxx-xxxx-…): " ISS < /dev/tty
  fi
  [ -z "$ISS" ] || [[ "$ISS" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || die "Issuer ID بصيغة UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)"
  [ -n "${GH_TOKEN:-}" ] || { read -rsp "رمز GitHub (صلاحية repo): " GH_TOKEN < /dev/tty; echo; export GH_TOKEN; }
  base64 -w0 "$W/qanoun-tahiro-dist.p12" | gh secret set IOS_CERT_P12 --repo "$REPO"
  printf '%s' "$PW" | gh secret set IOS_CERT_PASSWORD --repo "$REPO"
  base64 -w0 "$PROF" | gh secret set IOS_PROFILE --repo "$REPO"
  if [ -n "$P8" ]; then
    printf '%s' "$KID" | gh secret set ASC_KEY_ID --repo "$REPO"
    printf '%s' "$ISS" | gh secret set ASC_ISSUER_ID --repo "$REPO"
    gh secret set ASC_KEY_P8 --repo "$REPO" < "$P8"
  fi
  printf '%s\n' "$PW" > "$W/p12-password.txt"; chmod 600 "$W/p12-password.txt"
  say "✓ أسرار iPhone مضبوطة في $REPO: IOS_CERT_P12 IOS_CERT_PASSWORD IOS_PROFILE${P8:+ ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_P8}"
  say "الآن: GitHub ← Actions ← iOS ← Run workflow (والبناء يظهر في TestFlight بعد معالجة Apple)."
  say "⚠ احفظ المجلد $W (المفتاح وملف ‎.p12 وكلمة سره) خارج الهاتف؛ واحذف AuthKey_*.p8 من Download بعد التأكد."
  ;;

*)
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac
