/* =========================================================================
 * قانون تاهيرو — جسر Capacitor لنسخة أندرويد وحدها.
 * يُحمَّل بعد capacitor.js (الحزمة الجاهزة من @capacitor/core) وقبل شيفرة التطبيق،
 * وتضعهما tools/cap-web.mjs في www/ عند بناء أندرويد فقط؛ الويب والملف المستقل لا يريانه.
 *
 * يكشف للتطبيق window.QT_CAP:
 *   App        ← عودة الدخول بـ Google عبر الرابط com.qanontahiro.app://auth-callback (appUrlOpen / getLaunchUrl)
 *   Browser    ← فتح صفحة Google في متصفح النظام (Custom Tabs)؛ Google يمنع الدخول داخل WebView
 *   FirebaseAnalytics ← الإحصاءات الأصلية بملف google-services.json، ولا تعمل إلا بعد موافقة المستخدم
 *   SystemBars ← لون أيقونات شريط الحالة يتبع سمة التطبيق (ليل/نهار)
 *   AdMob      ← الإعلانات (@capacitor-community/admob): الموافقة (UMP)، والشريط، والبينية، والمكافأة، وشاشة الفتح
 *   adsMode    ← 'test' (إعلانات Google التجريبية) أو 'live'؛ تضعه tools/cap-web.mjs من QT_ADS، والافتراضي تجريبي دائماً
 *
 * الإضافات تُسجَّل بأسمائها الأصلية دون حزمها في الويب: لا حاجة إلى مجمّع (bundler)، ولا تُسحب حزمة Firebase للويب.
 * التخزين يبقى في ذاكرة WebView الدائمة (localStorage) كما في الإصدارات السابقة، فلا ينتقل تقدم أحد ولا يضيع.
 * ========================================================================= */
(function () {
  'use strict';
  var X = window.capacitorExports, C = window.Capacitor;
  if (!X || !C || typeof X.registerPlugin !== 'function') return;
  if (!(C.isNativePlatform && C.isNativePlatform())) return;
  var reg = X.registerPlugin;
  window.QT_CAP = Object.freeze({
    platform: C.getPlatform ? C.getPlatform() : 'android',
    App: reg('App'),
    Browser: reg('Browser'),
    FirebaseAnalytics: reg('FirebaseAnalytics'),
    SystemBars: X.SystemBars || reg('SystemBars'),
    AdMob: reg('AdMob'),
    adsMode: window.QT_ADS_MODE === 'live' ? 'live' : 'test'
  });
})();
