#!/usr/bin/env node
// =========================================================================
// قانون تاهيرو — يجهّز www/ لتطبيق أندرويد (Capacitor) من البناء المقسوم dist/app:
//   • ينسخ dist/app كما هو (القشرة + البنك + الأيقونات)
//   • يضع capacitor.js (الحزمة الجاهزة من @capacitor/core) وnative.js (الجسر من native/bridge.js)
//   • وضع الإعلانات من QT_ADS: live للنسخة الموقَّعة لـ Google Play، وغيره إعلانات تجريبية
//   • يحقنهما في <head> قبل شيفرة التطبيق، فيجد التطبيق window.QT_CAP عند إقلاعه
//   • يرفض المتابعة إن وجد في www/ أي سر خادم (الفحص نفسه الذي يجريه build.py على الموقع)
// يُشغَّل بعد python3 build.py وnpm install، وقبل npx cap add/sync android:
//   node tools/cap-web.mjs
// =========================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'dist', 'app');
const WWW = path.join(ROOT, 'www');
const CORE = path.join(ROOT, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js');
const BRIDGE = path.join(ROOT, 'native', 'bridge.js');
// مطابقة لـ SECRET_MARKERS في build.py
const SECRET_MARKERS = [/sb_secret_/, /service_role/, /bjCE2A\.7YUitA/, /-----BEGIN [A-Z ]*PRIVATE KEY/,
  /"type"\s*:\s*"service_account"/, /\bsbp_[0-9a-f]{20,}/];

const die = m => { console.error('✗ ' + m); process.exit(1); };
if (!fs.existsSync(path.join(SRC, 'index.html')) || !fs.existsSync(path.join(SRC, 'questions.json')))
  die('dist/app غير موجود: شغّل python3 build.py أولاً');
if (!fs.existsSync(CORE)) die('@capacitor/core غير مثبت: شغّل npm install أولاً');

fs.rmSync(WWW, { recursive: true, force: true });
fs.cpSync(SRC, WWW, { recursive: true });
fs.copyFileSync(CORE, path.join(WWW, 'capacitor.js'));
// وضع الإعلانات: 'live' للنسخ الموقَّعة الموجهة إلى Google Play فقط، وغير ذلك إعلانات Google التجريبية (حماية لحساب AdMob)
const ADS = process.env.QT_ADS === 'live' ? 'live' : 'test';
fs.writeFileSync(path.join(WWW, 'native.js'), `window.QT_ADS_MODE=${JSON.stringify(ADS)};\n` + fs.readFileSync(BRIDGE, 'utf8'));

const idx = path.join(WWW, 'index.html');
let html = fs.readFileSync(idx, 'utf8');
if (html.split('</head>').length !== 2) die('index.html: يُنتظر وسم </head> واحد بالضبط');
if (/\/\*__CLOUD__\*\/null/.test(html)) die('index.html بلا إعداد السحابة: config/cloud.json لم يُحقن');
html = html.replace('</head>', '<script src="capacitor.js"></script>\n<script src="native.js"></script>\n</head>');
fs.writeFileSync(idx, html);

const leaks = [];
for (const f of fs.readdirSync(WWW)) {
  if (!/\.(html|js|json|webmanifest|txt|xml)$/.test(f)) continue;
  const t = fs.readFileSync(path.join(WWW, f), 'utf8');
  for (const m of SECRET_MARKERS) if (m.test(t)) leaks.push(`${f} (${m.source})`);
}
if (leaks.length) die('سر خادم في ملفات التطبيق: ' + leaks.join('، '));

const kb = f => Math.round(fs.statSync(path.join(WWW, f)).size / 1024);
console.log(`✓ www/ جاهز لأندرويد: index.html ${kb('index.html')} ك.ب، questions.json ${kb('questions.json')} ك.ب، capacitor.js ${kb('capacitor.js')} ك.ب، native.js — الإعلانات: ${ADS === 'live' ? 'حقيقية' : 'تجريبية'}`);
