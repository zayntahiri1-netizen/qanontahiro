// =========================================================================
// قانون تاهيرو — خطاف capacitor:copy:after (يُشغّله Capacitor بعد كل cap add / copy / sync لأندرويد).
// مجلد android/ لا يُلتزم في المستودع: يولّده GitHub Actions من قالب Capacitor في كل بناء،
// وهذا الخطاف يعيد عليه كل ما يخص التطبيق، فيبقى البناء قابلاً للتكرار. كل خطوة لا تتكرر إن سبق تطبيقها.
//   1) google-services.json ← android/app (إحصاءات Firebase الأصلية)
//   2) الأيقونات وشاشة البدء والألوان ← android/app/src/main/res (من resources/android/res)
//   3) AndroidManifest.xml:
//        • رابط العودة من Google: com.qanontahiro.app://auth-callback (VIEW/BROWSABLE على MainActivity)
//        • الإحصاءات موقوفة افتراضياً حتى موافقة المستخدم، ولا تجمع Firebase Analytics معرّف الإعلانات
//        • AdMob: معرّف التطبيق (APPLICATION_ID) من config/cloud.json، وإذن AD_ID الذي تحتاجه الإعلانات
//        • الميكروفون (RECORD_AUDIO وMODIFY_AUDIO_SETTINGS) للجواب الشفوي بالصوت (v8): يُطلب الإذن حين يضغط المستخدم «أجب بصوتك» فقط.
//          ولا يُعلَن إذن الكاميرا: «التقط صورة» تفتح تطبيق الكاميرا في النظام، فلا يحتاج التطبيق إذناً بها
//   4) styles.xml: خلفية النافذة وشاشة البدء (أندرويد 12+) بلون التطبيق بدل الأبيض
//   5) app/build.gradle: رقم الإصدار والتوقيع من متغيرات البيئة (QT_VERSION_CODE…، QT_KEYSTORE…)
// أي خطوة إلزامية لا تنطبق على القالب تُوقف البناء برسالة صريحة، بدل تطبيق يُنشر ودخول Google فيه معطوب.
// =========================================================================
'use strict';
const fs = require('fs');
const path = require('path');

if ((process.env.CAPACITOR_PLATFORM_NAME || 'android') !== 'android') process.exit(0);

const ROOT = process.env.CAPACITOR_ROOT_DIR || process.cwd();
const APP = path.join(ROOT, 'android', 'app');
const MAIN = path.join(APP, 'src', 'main');
const SCHEME = 'com.qanontahiro.app', HOST = 'auth-callback';
const CLOUD = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'cloud.json'), 'utf8'));
const ADMOB_APP = ((CLOUD.admob || {}).app || '').trim();
const say = m => console.log('[qt-android-hook] ' + m);
const die = m => { console.error('[qt-android-hook] ✗ ' + m); process.exit(1); };

if (!fs.existsSync(MAIN)) { say('لا مشروع أندرويد بعد (android/app/src/main) — لا شيء يُعدَّل'); process.exit(0); }

// 1) google-services.json
const gsj = path.join(ROOT, 'google-services.json');
if (fs.existsSync(gsj)) {
  const pkg = JSON.parse(fs.readFileSync(gsj, 'utf8')).client.map(c => c.client_info.android_client_info.package_name);
  if (!pkg.includes(SCHEME)) die(`google-services.json لا يحوي الحزمة ${SCHEME} (فيه: ${pkg.join(', ')})`);
  fs.copyFileSync(gsj, path.join(APP, 'google-services.json'));
  say('✓ google-services.json');
} else say('⚠ google-services.json غير موجود في جذر المشروع: لا إحصاءات Firebase في هذا البناء');

// 2) الموارد
const RES = path.join(ROOT, 'resources', 'android', 'res');
if (fs.existsSync(RES)) {
  let n = 0;
  const walk = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name), d = path.join(dst, e.name);
      if (e.isDirectory()) walk(s, d); else { fs.copyFileSync(s, d); n++; }
    }
  };
  walk(RES, path.join(MAIN, 'res'));
  say(`✓ الأيقونات وشاشة البدء (${n} ملفاً)`);
}

// 3) AndroidManifest.xml
const manPath = path.join(MAIN, 'AndroidManifest.xml');
let man = fs.readFileSync(manPath, 'utf8');
const man0 = man;
if (!/xmlns:tools=/.test(man)) {
  man = man.replace(/<manifest\b/, '<manifest xmlns:tools="http://schemas.android.com/tools"');
  if (!/xmlns:tools=/.test(man)) die('تعذّر إضافة xmlns:tools إلى <manifest>');
}
// تطبيق إضافة AdMob دون معرّف التطبيق ينهار عند الإقلاع: نوقف البناء بدل ذلك
if (!/^ca-app-pub-\d{16}~\d{10}$/.test(ADMOB_APP)) die('معرّف تطبيق AdMob مفقود أو غير صالح في config/cloud.json (admob.app = ca-app-pub-…~…)');
const META = [['firebase_analytics_collection_enabled', 'false'], ['google_analytics_adid_collection_enabled', 'false'],
              ['com.google.android.gms.ads.APPLICATION_ID', ADMOB_APP]];
for (const [k, v] of META) {
  if (man.includes(`android:name="${k}"`)) {
    man = man.replace(new RegExp(`(android:name="${k.replace(/\./g, '\\.')}"\\s+android:value=")[^"]*(")`), `$1${v}$2`);
    continue;
  }
  const before = man;
  man = man.replace(/<application\b[^>]*>/, m => `${m}\n        <meta-data android:name="${k}" android:value="${v}" />`);
  if (man === before) die('لم أجد <application> في AndroidManifest.xml');
}
// إذن معرّف الإعلانات تحتاجه AdMob (أندرويد 13+)؛ ويُزال أي سطر حذفٍ قديم له من إصدار سابق للخطاف
man = man.replace(/\s*<uses-permission android:name="com\.google\.android\.gms\.permission\.AD_ID" tools:node="remove" \/>/, '');
if (!man.includes('com.google.android.gms.permission.AD_ID')) {
  const before = man;
  man = man.replace(/<\/manifest>\s*$/, '    <uses-permission android:name="com.google.android.gms.permission.AD_ID" />\n</manifest>\n');
  if (man === before) die('لم أجد </manifest> في AndroidManifest.xml');
}
// الميكروفون للشفوي بالصوت: Capacitor يطلب الإذن عند أول getUserMedia إن كان معلَناً هنا
for (const perm of ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']) {
  if (man.includes(`android:name="${perm}"`)) continue;
  const before = man;
  man = man.replace(/<\/manifest>\s*$/, `    <uses-permission android:name="${perm}" />\n</manifest>\n`);
  if (man === before) die('لم أجد </manifest> في AndroidManifest.xml');
}
if (!man.includes(`android:host="${HOST}"`)) {
  const re = /(<activity\b[^>]*android:name="\.MainActivity"[^>]*>)([\s\S]*?)(\n\s*<\/activity>)/;
  if (!re.test(man)) die('لم أجد نشاط MainActivity في AndroidManifest.xml: رابط العودة من Google لن يعمل');
  man = man.replace(re, (all, open, body, close) => open + body +
    '\n\n            <!-- قانون تاهيرو: العودة من الدخول بـ Google (Supabase PKCE) -->' +
    '\n            <intent-filter>' +
    '\n                <action android:name="android.intent.action.VIEW" />' +
    '\n                <category android:name="android.intent.category.DEFAULT" />' +
    '\n                <category android:name="android.intent.category.BROWSABLE" />' +
    `\n                <data android:scheme="${SCHEME}" android:host="${HOST}" />` +
    '\n            </intent-filter>' + close);
}
// فحص نهائي: كل ما سبق موجود، والملف ما زال XML متوازن الوسوم الأساسية
for (const must of [`android:host="${HOST}"`, `android:scheme="${SCHEME}"`, 'firebase_analytics_collection_enabled', 'google_analytics_adid_collection_enabled',
                    `android:value="${ADMOB_APP}"`, '<uses-permission android:name="com.google.android.gms.permission.AD_ID" />',
                    '<uses-permission android:name="android.permission.RECORD_AUDIO" />'])
  if (!man.includes(must)) die('فحص AndroidManifest.xml فشل: ' + must);
if ((man.match(/<activity\b/g) || []).length !== (man.match(/<\/activity>/g) || []).length) die('AndroidManifest.xml: وسوم activity غير متوازنة');
if (/permission\.AD_ID" tools:node="remove"/.test(man)) die('AndroidManifest.xml ما زال يحذف إذن AD_ID');
if (man !== man0) { fs.writeFileSync(manPath, man); say('✓ AndroidManifest.xml: رابط Google، الإحصاءات بموافقة، معرّف AdMob وإذن AD_ID، والميكروفون للشفوي'); }
else say('· AndroidManifest.xml مُعدّ سابقاً');

// 4) styles.xml
const stPath = path.join(MAIN, 'res', 'values', 'styles.xml');
if (fs.existsSync(stPath)) {
  let st = fs.readFileSync(stPath, 'utf8');
  const st0 = st;
  const addItem = (styleName, item, value) => {
    const re = new RegExp(`(<style\\s+name="${styleName.replace(/\./g, '\\.')}"[^>]*>)([\\s\\S]*?)(</style>)`);
    const m = st.match(re);
    if (!m) { say(`⚠ لا نمط ${styleName} في styles.xml`); return; }
    if (m[2].includes(`name="${item}"`)) return;
    st = st.replace(re, (all, open, body, close) => `${open}${body.replace(/\s*$/, '')}\n        <item name="${item}">${value}</item>\n    ${close}`);
  };
  addItem('AppTheme.NoActionBar', 'android:windowBackground', '@color/qt_ink');
  addItem('AppTheme.NoActionBarLaunch', 'windowSplashScreenBackground', '@color/qt_ink');
  if (st !== st0) { fs.writeFileSync(stPath, st); say('✓ styles.xml: خلفية النافذة وشاشة البدء بلون التطبيق'); }
}

// 5) app/build.gradle
const gPath = path.join(APP, 'build.gradle');
if (fs.existsSync(gPath)) {
  let g = fs.readFileSync(gPath, 'utf8');
  if (!g.includes('// QT-ANDROID-HOOK')) {
    g = g.replace(/\s*$/, '\n') + `
// QT-ANDROID-HOOK — قانون تاهيرو (scripts/qt-android-hook.cjs)
// رقم الإصدار والتوقيع من متغيرات البيئة في GitHub Actions؛ وفي غيابها يبقى البناء كما في القالب.
def qtEnv = { String k -> def v = System.getenv(k); (v != null && !v.trim().isEmpty()) ? v.trim() : null }
if (qtEnv('QT_VERSION_CODE')) { android.defaultConfig.versionCode = qtEnv('QT_VERSION_CODE').toInteger() }
if (qtEnv('QT_VERSION_NAME')) { android.defaultConfig.versionName = qtEnv('QT_VERSION_NAME') }
if (qtEnv('QT_KEYSTORE') && file(qtEnv('QT_KEYSTORE')).exists()) {
    android.signingConfigs.create('qtRelease') {
        storeFile file(qtEnv('QT_KEYSTORE'))
        storePassword qtEnv('QT_KEYSTORE_PASSWORD')
        keyAlias qtEnv('QT_KEY_ALIAS')
        keyPassword(qtEnv('QT_KEY_PASSWORD') ?: qtEnv('QT_KEYSTORE_PASSWORD'))
    }
    android.buildTypes.getByName('release').signingConfig = android.signingConfigs.getByName('qtRelease')
}
`;
    fs.writeFileSync(gPath, g);
    say('✓ app/build.gradle: الإصدار والتوقيع من البيئة');
  }
}
say('انتهى');
