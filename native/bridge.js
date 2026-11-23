/* =========================================================================
 * قانون تاهيرو — جسر Capacitor لتطبيقي أندرويد وiPhone.
 * يُحمَّل بعد capacitor.js (الحزمة الجاهزة من @capacitor/core) وقبل شيفرة التطبيق،
 * وتضعهما tools/cap-web.mjs في www/ عند بناء تطبيق الهاتف فقط؛ الويب والملف المستقل لا يريانه.
 *
 * يكشف للتطبيق window.QT_CAP:
 *   App        ← عودة الدخول بـ Google عبر الرابط com.qanontahiro.app://auth-callback (appUrlOpen / getLaunchUrl)
 *   Browser    ← فتح صفحة Google في متصفح النظام (Custom Tabs في أندرويد، وSafari في iPhone)؛ Google يمنع الدخول داخل WebView
 *   FirebaseAnalytics ← الإحصاءات الأصلية في أندرويد (ملف google-services.json)، ولا تعمل إلا بعد موافقة المستخدم
 *   SystemBars ← لون أيقونات شريط الحالة يتبع سمة التطبيق (ليل/نهار)
 *   AdMob      ← الإعلانات في أندرويد (@capacitor-community/admob): الموافقة (UMP)، والشريط، والبينية، والمكافأة، وشاشة الفتح
 *   adsMode    ← 'test' (إعلانات Google التجريبية) أو 'live'؛ تضعه tools/cap-web.mjs من QT_ADS، والافتراضي تجريبي دائماً
 *
 * في iPhone لا تُضمَّن إضافتا AdMob وFirebaseAnalytics أصلاً (ios.includePlugins في capacitor.config.json):
 * فلا إعلانات ولا إحصاءات ولا تتبع في نسخة iPhone، ويكون AdMob وFirebaseAnalytics هنا null.
 * الإضافات تُسجَّل بأسمائها الأصلية دون حزمها في الويب: لا حاجة إلى مجمّع (bundler)، ولا تُسحب حزمة Firebase للويب.
 * التخزين يبقى في ذاكرة WebView الدائمة (localStorage) كما في الإصدارات السابقة، فلا ينتقل تقدم أحد ولا يضيع.
 * ========================================================================= */
(function () {
  'use strict';
  var X = window.capacitorExports, C = window.Capacitor;
  if (!X || !C || typeof X.registerPlugin !== 'function') return;
  if (!(C.isNativePlatform && C.isNativePlatform())) return;
  var reg = X.registerPlugin;
  var platform = C.getPlatform ? C.getPlatform() : 'android';
  // في iPhone: الإضافة غير المضمَّنة لا تُسجَّل (null)، فلا يحاول التطبيق استعمالها؛ وفي أندرويد كل الإضافات مضمَّنة كما كانت
  var opt = function (name) {
    if (platform !== 'ios') return reg(name);
    try { return C.isPluginAvailable && C.isPluginAvailable(name) ? reg(name) : null; } catch (e) { return null; }
  };
  window.QT_CAP = Object.freeze({
    platform: platform,
    App: reg('App'),
    Browser: reg('Browser'),
    FirebaseAnalytics: opt('FirebaseAnalytics'),
    SystemBars: X.SystemBars || reg('SystemBars'),
    AdMob: opt('AdMob'),
    adsMode: window.QT_ADS_MODE === 'live' ? 'live' : 'test'
  });
})();
