#!/usr/bin/env node
// =========================================================================
// فحص TAHIRO AI الحي — يستدعي كل وظائف الدالة qt-ai على مشروعك الحقيقي، ويطبع لكل وظيفة ✓ أو ✗ مع الزمن والسبب.
//
//   node tools/ai-selftest.mjs            ← الفحص الكامل (22 فحصاً تقريباً، بصوت واحد)
//   node tools/ai-selftest.mjs --voices   ← ومعه عينة من كل صوت من الأصوات التسعة لتسمعها وتقارن
//   node tools/ai-selftest.mjs --quick    ← الدردشة والصوت ونسخ الصوت فقط
//   node tools/ai-selftest.mjs --voice=Kore   ← صوت الفحص (الافتراضي Charon)
//
// يقرأ من config/cloud.json عنوان Supabase ومفتاحه العام وحدهما (ويرفض أي مفتاح سري).
// سر المؤلف (QT_ADMIN_SECRET، في ~/.qanoun-tahiro-admin أو في متغير البيئة) اختياري: معه يعيد الخادم سبب كل خطأ
// ومسار الطلب (الواجهة والنموذج والرموز)، ولا تُطبَّق عليه نافذتا الإغراق؛ ودونه ينتظر الفحص 11 ثانية بين الطلبات.
// الجلسة: مستخدم مجهول واحد يُحفظ رمز تجديده في ~/.qanoun-tahiro-selftest (أذونات 600) فلا يُنشأ مستخدم جديد كل مرة.
// عينات الصوت تُحفظ في /sdcard/Download/tahiro-ai-test/ (أو ~/tahiro-ai-test/) لتسمعها.
// لا يطبع الفحص أي سر ولا رمز جلسة. وكل طلب فيه يُحتسب من صمامات اليوم كأي طلب عادي (نحو 20 طلباً و2-4 عمليات بحث).
// =========================================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const QUICK = ARGS.includes('--quick'), ALLV = ARGS.includes('--voices');
const VOICES = ['Charon', 'Sadaltager', 'Iapetus', 'Algieba', 'Puck', 'Kore', 'Sulafat', 'Vindemiatrix', 'Zephyr'];
const VNAME = { Charon: 'رصين', Sadaltager: 'خبير', Iapetus: 'صافٍ', Algieba: 'سلِس', Puck: 'حيوي', Kore: 'حازمة', Sulafat: 'دافئة', Vindemiatrix: 'لطيفة', Zephyr: 'مشرقة' };
const VOICE = (ARGS.find((a) => a.startsWith('--voice=')) || '').slice(8) || 'Charon';
const die = (m) => { console.error(`✗ ${m}`); process.exit(2); };
if (!VOICES.includes(VOICE)) die(`صوت غير معروف: ${VOICE} — المتاح: ${VOICES.join('، ')}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- الإعداد ----------
let CFG;
// QT_SELFTEST_CFG وQT_SELFTEST_GAP لاختبارات المستودع وحدها (خادم محلي يلف الدالة نفسها)
try { CFG = JSON.parse(fs.readFileSync(process.env.QT_SELFTEST_CFG || path.join(ROOT, 'config/cloud.json'), 'utf8')); }
catch { die('لم أجد config/cloud.json — شغّل الفحص من جذر المستودع بعد النشر'); }
const BASE = String(CFG?.supabase?.url || '').replace(/\/+$/, ''), KEY = String(CFG?.supabase?.key || '');
if (!/^(https:\/\/\S+|http:\/\/127\.0\.0\.1:\d+)$/.test(BASE) || !KEY) die('config/cloud.json: عنوان Supabase أو مفتاحه العام ناقص');
const GAP = Number(process.env.QT_SELFTEST_GAP || 11000);
const jwtRole = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).role || ''; } catch { return ''; } };
if (KEY.startsWith('sb_secret_') || jwtRole(KEY) === 'service_role') die('المفتاح في config/cloud.json سري! ضع المفتاح العام (publishable) وحده');
let ADM = String(process.env.QT_ADMIN_SECRET || '').trim();
const ADMF = path.join(os.homedir(), '.qanoun-tahiro-admin');
if (!ADM) { try { ADM = fs.readFileSync(ADMF, 'utf8').trim(); } catch { /* اختياري */ } }

let OUT = path.join(os.homedir(), 'tahiro-ai-test');
try { fs.accessSync('/sdcard/Download', fs.constants.W_OK); OUT = '/sdcard/Download/tahiro-ai-test'; } catch { /* ليس Termux أو دون إذن التخزين */ }
const saved = [];
function saveAudio(name, a) {
  const ext = /wav/.test(a.mime) ? 'wav' : /ogg/.test(a.mime) ? 'ogg' : 'mp3';
  try { fs.mkdirSync(OUT, { recursive: true }); const f = path.join(OUT, `${name}.${ext}`); fs.writeFileSync(f, a.audio); saved.push(f); return f; }
  catch (e) { return `(تعذر الحفظ: ${e.message})`; }
}

// ---------- الجلسة (مستخدم مجهول واحد يُعاد استعماله) ----------
const SESS = path.join(os.homedir(), '.qanoun-tahiro-selftest');
async function auth(p, body) {
  try {
    const r = await fetch(`${BASE}/auth/v1/${p}`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  } catch (e) { return { status: 0, j: { msg: String(e.message || e) } }; }
}
const keep = (rt) => { try { fs.writeFileSync(SESS, JSON.stringify({ refresh_token: rt, at: new Date().toISOString() }), { mode: 0o600 }); fs.chmodSync(SESS, 0o600); } catch { /* غير لازم */ } };
let TOK = '';
try {
  const rt = JSON.parse(fs.readFileSync(SESS, 'utf8')).refresh_token;
  if (rt) { const { status, j } = await auth('token?grant_type=refresh_token', { refresh_token: rt }); if (status === 200 && j.access_token) { TOK = j.access_token; keep(j.refresh_token); } }
} catch { /* أول مرة */ }
if (!TOK) {
  const { status, j } = await auth('signup', { data: {} });
  if (status !== 200 || !j.access_token) {
    const m = String(j.msg || j.error_description || j.message || j.error || '');
    die(`تعذر الدخول المجهول (HTTP ${status}${m ? ': ' + m.slice(0, 160) : ''})` +
        (/anonymous/i.test(m) ? '\n  ← فعّل Anonymous sign-ins في Supabase: Authentication ← Sign In / Providers' : ''));
  }
  TOK = j.access_token; keep(j.refresh_token);
}

// ---------- الطلب ----------
const safeJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
let lastAi = 0;
async function ai(body, { lane = 'ai', timeout = 150000 } = {}) {
  if (!ADM && lane === 'ai' && lastAi) { const w = GAP - (Date.now() - lastAi); if (w > 0) await sleep(w); }   // نافذة 6 في الدقيقة
  if (lane === 'ai') lastAi = Date.now();
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout), t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/functions/v1/qt-ai`, {
      method: 'POST', signal: ctl.signal, body: JSON.stringify({ lang: 'ar', ...body }),
      headers: { apikey: KEY, authorization: `Bearer ${TOK}`, 'content-type': 'application/json', ...(ADM ? { 'x-qt-admin': ADM } : {}) },
    });
    const ms = Date.now() - t0;
    if ((r.headers.get('content-type') || '').includes('application/octet-stream')) {
      return { ok: r.ok, ms, audio: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('x-qt-audio') || '', dbg: safeJson(r.headers.get('x-qt-debug')) };
    }
    const text = await r.text();
    const j = safeJson(text) ?? { ok: false, error: 'http', why: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    return { ms, ...j, status: r.status };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : 'net', why: String(e.message || e), ms: Date.now() - t0 };
  } finally { clearTimeout(t); }
}

const HINT = {
  config: 'مفتاح الذكاء الاصطناعي غير مضبوط في أسرار الدالة: أعد النشر وأدخل GEMINI_API_KEY حين يُطلب.',
  key: 'رفضت Google المفتاح: أنشئ مفتاحاً جديداً في aistudio.google.com/apikey ثم أعد النشر بإدخاله.',
  credits: 'رصيد الفوترة في Google AI Studio نفد أو لم تُفعَّل الفوترة: aistudio.google.com ← Billing.',
  model: 'اسم النموذج غير متاح لمفتاحك: اضبط QT_AI_SMART وQT_AI_FAST وQT_AI_TTS بأسماء متاحة ثم أعد النشر.',
  busy: 'ضغط مؤقت عند Google: أعد الفحص بعد دقائق.',
  blocked: 'رفضت فلاتر الأمان هذا الطلب بعينه (لا خلل في الإعداد).',
  budget: 'بلغ الصمام اليومي لهذا المسار حده: ارفعه (QT_AI_DAILY_BUDGET أو QT_AI_TTS_DAILY) في أسرار الدالة، أو انتظر الغد.',
  rate: 'نافذة الإغراق: ضع سر المؤلف في ~/.qanoun-tahiro-admin ليتجاوزها الفحص، أو أعد بعد دقيقة.',
  auth: 'الجلسة غير صالحة: احذف ~/.qanoun-tahiro-selftest وأعد الفحص.',
  timeout: 'لم يصل الجواب خلال دقيقتين ونصف: تحقق من الاتصال ثم أعد.',
  net: 'تعذر الاتصال بـ Supabase: تحقق من الإنترنت.',
  http: 'ردّ غير متوقع: هل نُشرت الدالة qt-ai؟ (node tools/deploy-cloud.mjs)',
  notfound: 'السؤال غير موجود في بنك السحابة: أعد النشر ليُرفع البنك (الخطوة 5).',
};
const hintOf = (r) => { const code = String(r.why || '').split(':')[0]; return HINT[code] || HINT[r.error] || ''; };

// ---------- العرض ----------
const results = [];
const sec = (ms) => `${(ms / 1000).toFixed(1)}ث`;
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, Math.max(n, s.length));
function line(name, r, check) {
  const fail = !r.ok ? (r.error || 'ai') : '';
  let v = { pass: false, warn: '', note: '' };
  if (!fail) { try { v = { warn: '', note: '', ...check(r) }; } catch (e) { v = { pass: false, note: `شكل غير متوقع: ${e.message}` }; } }
  const route = r.dbg ? ` · ${r.cached ? 'من الذاكرة' : `${r.dbg.via}${r.dbg.model ? ' ' + r.dbg.model : ''}`}${r.dbg.web ? ` · بحث ×${r.dbg.web}` : ''}` : (r.cached ? ' · من الذاكرة' : '');
  const mark = fail || !v.pass ? '✗' : v.warn ? '⚠' : '✓';
  console.log(`${mark} ${pad(name, 22)} ${pad(sec(r.ms || 0), 7)}${route}${v.note ? ' · ' + v.note : ''}`);
  if (fail) {
    console.log(`    الرمز: ${fail}${r.why && r.why !== fail ? ` — ${String(r.why).slice(0, 240)}` : ''}`);
    const h = hintOf(r); if (h) console.log(`    ← ${h}`);
  } else if (!v.pass) console.log('    ← الجواب وصل لكن شكله ناقص (انظر الملاحظة أعلاه).');
  if (v.warn && !fail && v.pass) console.log(`    تنبيه: ${v.warn}`);
  results.push({ name, mark });
  return !fail && v.pass;
}
const has = (x) => x !== undefined && x !== null && x !== '' && !(Array.isArray(x) && !x.length);
const arn = (s) => String(s || '').replace(/[ً-ْٰ]/g, '').replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^ء-ي0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);

// ---------- مادة الفحص من التطبيق نفسه ----------
function bank() {
  for (const p of ['dist/app/questions.json', 'dist/site/app/questions.json']) {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')).questions || []; } catch { /* التالي */ }
  }
  return [];
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const QS = bank().filter((q) => q.branch === 'labour' && q.conf !== 'r');
const clean = QS.filter((q) => q.type === 'knowledge' && q.correct?.length === 1 && q.options?.length === 4 && !q.options.some((o) => /جميع الأجوبة خاطئة/.test(o)));
const Q1 = clean.length ? pick(clean) : null;
const QC = pick(QS.filter((q) => q.type === 'case')) || null;
const WEAK = QS.length >= 4 ? [...QS].sort(() => Math.random() - 0.5).slice(0, 5).map((q) => q.id) : [];
let ART = { n: '14' };
try {
  const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/corpus/labour.json'), 'utf8')).items || [];
  const ok = items.filter((a) => /^\d+$/.test(String(a.n)) && (a.text || '').length > 250 && (a.text || '').length < 1600);
  if (ok.length) ART = pick(ok);
} catch { /* المادة 14 افتراضياً */ }
let SCAN = '';
try { SCAN = fs.readFileSync(path.join(ROOT, 'tools/ai-selftest-scan.jpg')).toString('base64'); } catch { /* يُتخطى فحص الصورة */ }

// ========================================================================
console.log(`\nفحص TAHIRO AI على ${BASE.replace(/^https?:\/\//, '')} — ${new Date().toLocaleString('fr-MA')}`);
console.log(ADM ? 'وضع المؤلف: الأسباب والمسارات ظاهرة، ودون نافذتي الإغراق.' : 'دون سر المؤلف: ستظهر رموز الأخطاء وحدها، وينتظر الفحص 11 ثانية بين الطلبات.');
console.log('—'.repeat(60));

const q0 = await ai({ kind: 'quota' }, { lane: 'none' });
if (q0.error === 'auth' || q0.status === 401) {
  try { fs.unlinkSync(SESS); } catch { /* */ }
  die('الجلسة مرفوضة؛ حذفتها — أعد تشغيل الفحص.');
}
line('حالة الخدمة', q0, (r) => ({
  pass: r.ready === true && Array.isArray(r.kinds) && r.unlimited === true,
  note: r.ready ? `${r.kinds?.length} وظيفة · ${r.voices?.length} أصوات · دون رصيد يومي للمستخدم` : 'المفتاح غير مضبوط (ready=false)',
}));
if (q0.cfg) {
  const d = q0.cfg;
  console.log(`    النماذج بالترتيب: ${d.smart} ← ${d.fast} ← ${d.lite2 || '-'} · الصوت: ${d.tts} ← ${d.tts2 || '-'} · مراجعة ${d.rev}`);
  if (d.spent && d.spent.length) console.log(`    مستنفد الآن (حتى تتجدد حصته): ${d.spent.map((x) => `${x.m} (${x.min} د)`).join('، ')}`);
  console.log(`    الصمامات اليومية: أجوبة ${d.budget || '∞'} · بحث ${d.web || '∞'} · صوت ${d.ttsDaily || '∞'} — النافذتان: ${d.rate?.join('/')} (صوت ${d.rateTts?.join('/')})`);
  const on = Object.entries(d.flags || {}).filter(([k, v]) => v && !['TTS_IX', 'TTS_MP3', 'TTS_STYLE_ON'].includes(k)).map(([k]) => k);
  if (on.length) console.log(`    أعلام الرجوع المفعّلة في هذه النسخة: ${on.join('، ')}`);
}
const FREE = q0.tier !== 'paid';
if (q0.ok) console.log(FREE
  ? '    المستوى: مجاني (مفتاح دون فوترة) — لا كلفة، لكن لكل نموذج حصة يومية صغيرة، ولا بحث في الإنترنت في هذا المستوى.\n'
    + `    هذا الفحص يستهلك نحو 25 طلباً من حصة اليوم${ALLV ? ' و10 مقاطع صوتية' : ''}؛ فشغّله مرة واحدة لا أكثر في اليوم.`
  : '    المستوى: مدفوع — البحث في الإنترنت مفعّل.');
if (!q0.ok || !q0.ready) {
  console.log('\nلا فائدة من بقية الفحوص قبل إصلاح ما سبق.');
  process.exit(1);
}

// ---------- 1) الدردشة ----------
const CHQ = 'ما مدة فترة الاختبار بالنسبة للأطر في عقد الشغل غير المحدد المدة؟';
const c1 = await ai({ kind: 'chat', q: CHQ });
line(FREE ? 'دردشة' : 'دردشة + بحث', c1, (r) => {
  const d = r.data, ks = (d.blocks || []).map((b) => b.k);
  const s = JSON.stringify(d), cites14 = /labour:14\b|المادة 14\b/.test(s);
  return {
    pass: has(d.blocks),
    note: `أقسام: ${ks.join('+') || '—'} · مواد: ${d.articles?.length || 0} · مصادر: ${d.sources?.length || 0} · بحث: ${d.searched ? 'نعم' : d.web === 'budget' ? 'الصمام' : d.web === 'tier' ? 'غير متاح في المجاني' : 'لا'}`,
    warn: !ks.includes('lib') ? 'لا قسم «من مكتبة التطبيق» في الجواب' : !cites14 ? 'لم يذكر المادة 14 من مدونة الشغل (مرجع الجواب الصحيح)' : '',
  };
});
const c1t = (c1.data?.blocks || []).map((b) => b.t).join('\n').slice(0, 1400);
const c2 = await ai({ kind: 'chat', q: 'وهل يمكن تجديدها؟', web: false, hist: [{ r: 'u', t: CHQ }, { r: 'a', t: c1t || 'ثلاثة أشهر.' }] });
line('متابعة دون بحث', c2, (r) => ({
  pass: has(r.data.blocks) && !r.data.searched,
  note: `أقسام: ${(r.data.blocks || []).map((b) => b.k).join('+')}`,
  warn: /مرة واحدة/.test(JSON.stringify(r.data.blocks)) ? '' : 'لم يذكر أن التجديد مرة واحدة (المادة 14)',
}));
if (!QUICK) {
  const nw = await ai({ kind: 'chat', mode: 'news', slug: 'labour' });
  line('رادار المستجدات', nw, (r) => ({
    pass: r.data.mode === 'news' && has(r.data.blocks),
    note: `أقسام: ${(r.data.blocks || []).map((b) => b.k).join('+')} · مصادر: ${r.data.sources?.length || 0}${r.data.sources?.length ? ` (${[...new Set(r.data.sources.map((s) => s.host))].slice(0, 3).join('، ')})` : ''}`,
    warn: r.data.searched || FREE ? '' : 'لم يُجرِ بحثاً في الإنترنت (الصمام أو الشبكة)',
  }));
}

// ---------- 2) الصوت ----------
const SENT = 'تحدد فترة الاختبار في العقود غير المحددة المدة بثلاثة أشهر بالنسبة للأطر وأشباههم.';
const t1 = await ai({ kind: 'tts', text: SENT, voice: VOICE }, { lane: 'tts' });
let ttsOk = false;
line(`قراءة بصوت ${VNAME[VOICE]}`, t1.audio ? { ...t1, ok: true } : t1, (r) => {
  const b = r.audio, magic = b.subarray(0, 4).toString('latin1');
  const kind = magic === 'RIFF' ? 'WAV' : magic.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ? 'MP3' : magic === 'OggS' ? 'OGG' : '';
  ttsOk = b.length > 2000 && !!kind;
  const f = ttsOk ? saveAudio(`voice-${VOICE}`, r) : '';
  return { pass: ttsOk, note: `${kind || 'نوع مجهول'} ${Math.round(b.length / 1024)} ك.ب${f ? ` ← ${f}` : ''}` };
});
if (ttsOk) {
  const s1 = await ai({ kind: 'stt', audio: t1.audio.toString('base64'), mime: /wav/.test(t1.mime) ? 'audio/wav' : 'audio/mpeg' });
  line('نسخ الصوت (ذهاب وإياب)', s1, (r) => {
    const want = arn(SENT), got = new Set(arn(r.data.text)), hit = want.filter((w) => got.has(w)).length;
    return { pass: has(r.data.text), note: `«${String(r.data.text).slice(0, 70)}» · تطابق ${Math.round((hit / want.length) * 100)}%`, warn: hit / want.length < 0.6 ? 'النسخ بعيد عن النص المقروء' : '' };
  });
} else results.push({ name: 'نسخ الصوت', mark: '–' });

if (ALLV) {
  console.log('—'.repeat(60) + '\nعينات الأصوات التسعة:');
  for (const v of VOICES) {
    const r = await ai({ kind: 'tts', text: `مرحباً، أنا TAHIRO AI بصوت ${VNAME[v]}. أقرأ لك المواد والأجوبة بوضوح.`, voice: v }, { lane: 'tts' });
    line(`صوت ${VNAME[v]} (${v})`, r.audio ? { ...r, ok: true } : r, (x) => {
      const okA = x.audio.length > 2000; const f = okA ? saveAudio(`voice-${String(VOICES.indexOf(v) + 1)}-${v}`, x) : '';
      return { pass: okA, note: `${Math.round(x.audio.length / 1024)} ك.ب${f ? ` ← ${f}` : ''}` };
    });
  }
}

if (!QUICK) {
  console.log('—'.repeat(60));
  // ---------- 3) أدوات TAHIRO AI ----------
  line('سؤال حر (الإصدارات السابقة)', await ai({ kind: 'ask', q: 'ما هي حالات انتهاء عقد الشغل المحدد المدة؟' }), (r) => ({
    pass: typeof r.data.answer === 'string', note: r.data.covered === false ? 'خارج النصوص المضمّنة' : `مواد: ${r.data.articles?.length || 0}`,
  }));
  if (Q1) {
    const wrong = [0, 1, 2, 3].find((i) => !Q1.correct.includes(i));
    line(`لماذا أخطأت؟ (${Q1.id})`, await ai({ kind: 'why', id: Q1.id, sel: [wrong] }), (r) => ({ pass: Object.keys(r.data).length > 3, note: `مواد: ${r.data.articles?.length || 0}` }));
    line(`سؤال توأم (${Q1.id})`, await ai({ kind: 'twin', id: Q1.id }), (r) => ({
      pass: r.data.options?.length === 4 && Array.isArray(r.data.correct),
      note: `${r.data.correct?.length || 0} صحيح من 4`,
      warn: r.data.options?.some((o) => /جميع ما سبق|لا شيء مما ذكر|جميع الأجوبة خاطئة|كلاهما|^\s*لا شيء/.test(o)) ? 'خيار بصيغة ممنوعة' : '',
    }));
  } else {
    results.push({ name: 'لماذا/توأم', mark: '–' });
    console.log('–  لماذا/توأم: لم أجد البنك (dist/app/questions.json) — شغّل python3 build.py');
  }
  line(`شرح المادة ${ART.n} (الشغل)`, await ai({ kind: 'explain', slug: 'labour', n: String(ART.n) }), (r) => ({ pass: !r.data.empty, note: r.data.empty ? 'المادة فارغة في المكتبة' : '' }));
  line('مقارنة', await ai({ kind: 'compare', a: 'فترة الاختبار', b: 'أجل الإخطار' }), (r) => ({ pass: r.data.covered === false || has(r.data.rows), note: `${r.data.rows?.length || 0} صفوف` }));
  line('تحليل نازلة', await ai({ kind: 'case', q: 'أجير يعمل إطاراً في شركة منذ شهرين بعقد غير محدد المدة، أنهى المشغل عقده فجأة دون إخطار بحجة أنه ما زال في فترة الاختبار، فهل الإنهاء مشروع؟' }), (r) => ({
    pass: r.data.covered === false || has(r.data.issues) || has(r.data.conclusion), note: `${r.data.issues?.length || 0} إشكالات`,
  }));
  if (SCAN) {
    line('صوّر سؤالاً', await ai({ kind: 'scan', img: SCAN, mime: 'image/jpeg' }), (r) => {
      const v = r.data.verdicts || [], okL = v.filter((x) => x.ok).map((x) => x.letter).join('، ');
      return { pass: r.data.mode === 'mcq' && v.length === 4, note: `${r.data.mode} · الصحيح عنده: ${okL || 'لا شيء'}`, warn: okL === 'أ' ? '' : 'الجواب الصحيح في الصورة «أ) ثلاثة أشهر» (المادة 14)' };
    });
  }
  line('تصميم موضوع إنشائي', await ai({ kind: 'essay', topic: 'فترة الاختبار في عقد الشغل' }), (r) => ({ pass: r.data.covered === false || has(r.data.parts), note: `${r.data.parts?.length || 0} أقسام` }));
  const dr = await ai({ kind: 'drill', slug: 'labour', level: 'medium' });
  if (line('اطلب نازلة', dr, (r) => ({ pass: has(r.data.id) && has(r.data.facts), note: `«${String(r.data.title || '').slice(0, 50)}»` }))) {
    line('تصحيح حل النازلة', await ai({ kind: 'drill', id: dr.data.id, answer: 'الإشكال هو مدى مشروعية إنهاء العقد، والقاعدة في مدونة الشغل أن الإنهاء يخضع لشروط وآجال محددة، وبتطبيقها على الوقائع يتبين الحكم.' }), (r) => ({
      pass: Number.isFinite(r.data.score), note: `النقطة ${r.data.score}`,
    }));
  }
  line(`بطاقات المادة ${ART.n}`, await ai({ kind: 'cards', slug: 'labour', n: String(ART.n) }), (r) => ({ pass: r.data.covered === false || has(r.data.cards), note: `${r.data.cards?.length || 0} بطاقات` }));
  if (QC) {
    line(`امتحان شفوي (${QC.id})`, await ai({ kind: 'oral', id: QC.id, answer: 'أرى أن الحل يقوم على تحديد القاعدة القانونية الواجبة التطبيق من مدونة الشغل ثم إنزالها على الوقائع المعروضة للوصول إلى النتيجة.' }), (r) => ({
      pass: Number.isFinite(r.data.score), note: `النقطة ${r.data.score}`,
    }));
  }
  line('خطة اليوم + الامتحان', await ai({ kind: 'plan', fresh: true, stats: { answered: 120, acc: 64, branches: [{ id: 'labour', title: 'الشغل', a: 40, c: 24, n: 728 }], exam: { name: 'امتحان الفصل', days: 21, target: 40 } } }), (r) => ({
    pass: has(r.data.days) || has(r.data.headline), note: String(r.data.headline || '').slice(0, 60),
  }));
  line('اطلب تمارين', await ai({ kind: 'gen', slug: 'labour', type: 'mix', level: 'medium', count: 3 }), (r) => {
    const it = r.data.items || [];
    const bad = it.filter((x) => x.options?.length !== 4 || x.options.some((o) => /جميع ما سبق|لا شيء مما ذكر|جميع الأجوبة خاطئة|كلاهما|أ و ?ب معا|^\s*لا شيء/.test(o)));
    return { pass: it.length >= 2, note: `${it.length} تمارين (${[...new Set(it.map((x) => x.type))].join('، ')})`, warn: bad.length ? `${bad.length} تمرين بخيار مخالف للقواعد` : '' };
  });
  line('الخريطة الذهنية', await ai({ kind: 'map', slug: 'labour', ns: ['13', '14', '15', '16', '17', '18', '19'], title: 'فترة الاختبار' }), (r) => ({
    pass: r.data.covered === false || (r.data.branches?.length >= 2), note: `«${r.data.root || ''}» · ${r.data.branches?.length || 0} فروع`,
  }));
  if (WEAK.length >= 3) {
    line('دفتر الأخطاء الذكي', await ai({ kind: 'weak', ids: WEAK }), (r) => ({ pass: has(r.data.groups), note: `${r.data.groups?.length || 0} مجموعات من ${r.data.n} أسئلة` }));
  }
  const tested = new Set(['chat', 'tts', 'stt', 'ask', 'why', 'twin', 'explain', 'compare', 'case', 'scan', 'essay', 'drill', 'cards', 'oral', 'plan', 'gen', 'map', 'weak']);
  const left = (q0.kinds || []).filter((k) => !tested.has(k));
  if (left.length) console.log(`ملاحظة: وظائف في الخادم لم يشملها الفحص: ${left.join('، ')}`);
}

// ---------- الخلاصة ----------
const pass = results.filter((r) => r.mark === '✓').length, warn = results.filter((r) => r.mark === '⚠').length;
const fail = results.filter((r) => r.mark === '✗').length;
console.log('—'.repeat(60));
console.log(`النتيجة: ${pass + warn}/${results.filter((r) => r.mark !== '–').length} نجحت${warn ? ` (منها ${warn} بتنبيه)` : ''}${fail ? ` · ${fail} فشلت` : ''}`);
if (saved.length) console.log(`عينات الصوت (افتحها لتسمعها):\n  ${saved.join('\n  ')}`);
if (fail) console.log('اتبع الإرشاد تحت كل ✗، ثم أعد: node tools/ai-selftest.mjs');
process.exit(fail ? 1 : 0);
