// =========================================================================
// قانون تاهيرو — خطاف capacitor:copy:after لتطبيق iPhone (يُشغّله Capacitor بعد كل cap add / copy / sync لـ iOS).
// مجلد ios/ لا يُلتزم في المستودع: يولّده GitHub Actions (macOS) من قالب Capacitor 8 في كل بناء،
// وهذا الخطاف يعيد عليه كل ما يخص التطبيق، فيبقى البناء قابلاً للتكرار. كل خطوة لا تتكرر إن سبق تطبيقها.
//   1) Info.plist:
//        • رابط العودة من Google: المخطط com.qanontahiro.app (CFBundleURLTypes) — الرابط نفسه في أندرويد
//        • نصوص أذونات الميكروفون (الشفوي بالصوت) والكاميرا والصور (صوّر سؤالاً): تُعرض للمستخدم قبل الإذن
//        • ITSAppUsesNonExemptEncryption = false (اتصالات HTTPS عادية): لا سؤال عن التشفير في كل رفع إلى TestFlight
//        • الاسم الظاهر، واللغات (العربية ثم الفرنسية والإنجليزية)
//   2) الأيقونة (1024×1024 بلا شفافية) وشاشة البدء ← Assets.xcassets (من resources/ios)
//   3) PrivacyInfo.xcprivacy: لا تتبع، ولا نطاقات تتبع، والمعطيات المجموعة كما في سياسة الخصوصية
//      (يُضاف إلى مشروع Xcode في GitHub Actions بـ scripts/qt-ios-project.rb)
// أي خطوة إلزامية لا تنطبق على القالب تُوقف البناء برسالة صريحة.
// =========================================================================
'use strict';
const fs = require('fs');
const path = require('path');

// يعمل مع cap add/copy/sync لـ iOS، أو يدوياً دون المتغير؛ ويتجاهل منصة أخرى صراحة (أندرويد)
const PLAT = process.env.CAPACITOR_PLATFORM_NAME || '';
if (PLAT && PLAT !== 'ios') process.exit(0);

const ROOT = process.env.CAPACITOR_ROOT_DIR || process.cwd();
const APP = path.join(ROOT, 'ios', 'App', 'App');
const SCHEME = 'com.qanontahiro.app';
const say = m => console.log('[qt-ios-hook] ' + m);
const die = m => { console.error('[qt-ios-hook] ✗ ' + m); process.exit(1); };
if (!fs.existsSync(path.join(APP, 'Info.plist'))) { say('لا مشروع iOS بعد (ios/App/App/Info.plist) — لا شيء يُعدَّل'); process.exit(0); }

// ---------- 1) Info.plist (XML) ----------
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plistPath = path.join(APP, 'Info.plist');
let pl = fs.readFileSync(plistPath, 'utf8');
const pl0 = pl;
if (!/<plist[^>]*>\s*<dict>/.test(pl) || !/<\/dict>\s*<\/plist>\s*$/.test(pl)) die('Info.plist ليس بالصيغة المتوقعة (<plist><dict>…</dict></plist>)');
// يضع المفتاح في القاموس الأعلى، أو يستبدل قيمته إن وُجد (القيم المركبة <array>/<dict> تُقرأ بموازنة الوسوم المتداخلة)
function valueEnd(from) {
  const m = /^\s*<(string|array|dict|true|false|integer|real|date|data)(\/?)>/.exec(pl.slice(from));
  if (!m) die('قيمة غير مفهومة في Info.plist بعد الموضع ' + from);
  const start = from + m[0].length - m[0].trimStart().length, tag = m[1];
  if (m[2] === '/') return [start, from + m[0].length];
  let depth = 0, re = new RegExp(`<(/?)${tag}(/?)>`, 'g'); re.lastIndex = start;
  for (let x; (x = re.exec(pl));) {
    if (x[2] === '/') continue;
    depth += x[1] ? -1 : 1;
    if (!depth) return [start, x.index + x[0].length];
  }
  die('Info.plist: وسم ' + tag + ' غير مغلق');
}
function setKey(key, valueXml) {
  const k = pl.indexOf(`<key>${key}</key>`);
  if (k >= 0) {
    const [a, b] = valueEnd(k + `<key>${key}</key>`.length);
    if (pl.slice(a, b) !== valueXml) pl = pl.slice(0, a) + valueXml + pl.slice(b);
    return;
  }
  pl = pl.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${key}</key>\n\t${valueXml}\n</dict>\n</plist>\n`);
}
const str = s => `<string>${xmlEsc(s)}</string>`;
setKey('CFBundleDisplayName', str('قانون تاهيرو'));
setKey('CFBundleDevelopmentRegion', str('ar'));
setKey('CFBundleLocalizations', `<array>\n\t\t<string>ar</string>\n\t\t<string>fr</string>\n\t\t<string>en</string>\n\t</array>`);
setKey('CFBundleAllowMixedLocalizations', '<true/>');
setKey('CFBundleURLTypes', `<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>${SCHEME}</string>\n` +
  `\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${SCHEME}</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>`);
setKey('NSMicrophoneUsageDescription', str('يستعمل «قانون تاهيرو» الميكروفون فقط حين تضغط «أجب بصوتك» في الامتحان الشفوي، ليقيّم المساعد جوابك ثم يُنسى التسجيل. (Microphone: only when you tap “Answer by voice”.)'));
setKey('NSCameraUsageDescription', str('تُستعمل الكاميرا فقط حين تضغط «التقط صورة» لتصوير سؤال قانوني يحله المساعد؛ ولا تُحفظ الصورة. (Camera: only to photograph a question you want solved.)'));
setKey('NSPhotoLibraryUsageDescription', str('لاختيار صورة سؤال من معرضك ليحله المساعد؛ ولا تُحفظ الصورة. (Photos: only to pick a question image you choose.)'));
setKey('ITSAppUsesNonExemptEncryption', '<false/>');
for (const must of [`<string>${SCHEME}</string>`, 'NSMicrophoneUsageDescription', 'NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'ITSAppUsesNonExemptEncryption'])
  if (!pl.includes(must)) die('فحص Info.plist فشل: ' + must);
if ((pl.match(/<dict>/g) || []).length !== (pl.match(/<\/dict>/g) || []).length) die('Info.plist: وسوم dict غير متوازنة');
if (pl !== pl0) { fs.writeFileSync(plistPath, pl); say('✓ Info.plist: رابط Google، وأذونات الميكروفون والكاميرا والصور، والتشفير المعفى، والاسم واللغات'); }
else say('· Info.plist مُعدّ سابقاً');

// ---------- 2) الأيقونة وشاشة البدء ----------
const XC = path.join(APP, 'Assets.xcassets');
const RES = path.join(ROOT, 'resources', 'ios');
const icon = path.join(RES, 'AppIcon-1024.png'), splash = path.join(RES, 'splash-2732.png');
if (!fs.existsSync(icon) || !fs.existsSync(splash)) die('resources/ios ناقص: شغّل python3 tools/make-ios-res.py');
const setSet = (dir, files, contents) => {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/\.png$/i.test(f)) fs.rmSync(path.join(dir, f));
  for (const [name, from] of files) fs.copyFileSync(from, path.join(dir, name));
  fs.writeFileSync(path.join(dir, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
};
setSet(path.join(XC, 'AppIcon.appiconset'), [['AppIcon-1024.png', icon]],
  { images: [{ filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } });
setSet(path.join(XC, 'Splash.imageset'), [['splash-2732.png', splash]],
  { images: [{ filename: 'splash-2732.png', idiom: 'universal', scale: '1x' }, { idiom: 'universal', scale: '2x' }, { idiom: 'universal', scale: '3x' }],
    info: { author: 'xcode', version: 1 } });
say('✓ الأيقونة (1024×1024) وشاشة البدء');

// ---------- 3) PrivacyInfo.xcprivacy ----------
// «جمع» بتعريف Apple: معطى يغادر الجهاز ويُحفظ أطول مما يلزم لخدمة الطلب. الصور والتسجيلات ونصوص المساعد تُعالَج لحظياً ولا تُحفظ،
// فلا تُعدّ جمعاً. والمجموع فعلاً: معرّف الحساب، والبريد والاسم لمن دخل بـ Google، والتقدم (عند المزامنة)، والبلاغات.
const dt = (type, linked = true) => `\t\t<dict>\n\t\t\t<key>NSPrivacyCollectedDataType</key>\n\t\t\t<string>${type}</string>\n` +
  `\t\t\t<key>NSPrivacyCollectedDataTypeLinked</key>\n\t\t\t<${linked}/>\n\t\t\t<key>NSPrivacyCollectedDataTypeTracking</key>\n\t\t\t<false/>\n` +
  `\t\t\t<key>NSPrivacyCollectedDataTypePurposes</key>\n\t\t\t<array>\n\t\t\t\t<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>\n\t\t\t</array>\n\t\t</dict>\n`;
const privacy = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>NSPrivacyTracking</key>
\t<false/>
\t<key>NSPrivacyTrackingDomains</key>
\t<array/>
\t<key>NSPrivacyCollectedDataTypes</key>
\t<array>
${dt('NSPrivacyCollectedDataTypeUserID')}${dt('NSPrivacyCollectedDataTypeEmailAddress')}${dt('NSPrivacyCollectedDataTypeName')}${dt('NSPrivacyCollectedDataTypeOtherUserContent')}${dt('NSPrivacyCollectedDataTypeOtherDataTypes')}\t</array>
\t<key>NSPrivacyAccessedAPITypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>NSPrivacyAccessedAPIType</key>
\t\t\t<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
\t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>
\t\t\t<array>
\t\t\t\t<string>CA92.1</string>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>
`;
fs.writeFileSync(path.join(APP, 'PrivacyInfo.xcprivacy'), privacy);
say('✓ PrivacyInfo.xcprivacy: لا تتبع، والمعطيات المجموعة كما في سياسة الخصوصية');
say('انتهى');
