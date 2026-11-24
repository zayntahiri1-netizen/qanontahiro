#!/usr/bin/env node
// =========================================================================
// قانون تاهيرو — لقطات متجري Google Play وApp Store من التطبيق نفسه (dist/app) بمتصفح Playwright:
//   dist/store/iphone/01-….png   1290×2796  (iPhone 6.9 بوصة: المقاس الذي يطلبه App Store Connect)
//   dist/store/android/01-….png  1080×1920  (هاتف أندرويد، نسبة 16:9 التي يقبلها Google Play)
//   dist/store/play-feature-1024x500.png    (صورة العرض في Google Play)
// كل لقطة: عنوان قصير فوق شاشة حقيقية من التطبيق. أجوبة TAHIRO AI في اللقطات محضَّرة يدوياً من نص المادتين 13 و14
// و43 من مدونة الشغل كما في مكتبة التطبيق (لا اتصال بالخادم)، ونصوص المواد نفسها تُقرأ من data/corpus.
//   python3 build.py && node tools/store-shots.mjs
// =========================================================================
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'dist', 'app'), OUT = path.join(ROOT, 'dist', 'store');
// مستوى خدمة Google (v8.2.1): في المجاني لا بحث في الإنترنت، فلا تَعِد به لقطة الدردشة
let TIER = 'free';
try { TIER = String((JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'cloud.json'), 'utf8')).ai || {}).tier || 'free').toLowerCase() === 'paid' ? 'paid' : 'free'; } catch { /* المجاني */ }
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('✗ يلزم Playwright (npm i -g playwright)'); process.exit(1); }
if (!fs.existsSync(path.join(APP, 'index.html'))) { console.error('✗ شغّل python3 build.py أولاً'); process.exit(1); }

// ---------- خادم ثابت لـ dist/app ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => {
  const p = path.join(APP, decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(APP) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r);
});
await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
const URL0 = `http://127.0.0.1:${srv.address().port}/index.html`;

// ---------- أجوبة TAHIRO AI المحضَّرة (من نصوص المواد كما هي في المكتبة، ومصدر رسمي حقيقي) ----------
const labour = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'corpus', 'labour.json'), 'utf8'));
const lawTitle = labour.title;
const art = n => { const a = labour.items.find(x => x.n === n); return { key: 'labour:' + n, slug: 'labour', n, label: a.label, title: lawTitle, path: a.path || '', text: a.text, notes: [], stale: [] }; };
const A13 = art('13'), A14 = art('14'), A43 = art('43');
const CANNED = {
  chat: { mode: 'chat', web: TIER === 'paid' ? 'on' : 'tier', searched: TIER === 'paid', guard: true, bank: [], suggest: '', queries: [], articles: [A14, A13],
          blocks: [{ k: 'lib', t: 'تحدد فترة الاختبار في العقد غير المحدد المدة بـ**ثلاثة أشهر للأطر وأشباههم**، وشهر ونصف للمستخدمين، وخمسة عشر يوماً للعمال، ويمكن تجديدها مرة واحدة [labour:14].' },
                   { k: 'ai', t: 'خلالها يجوز لكل طرف إنهاء العقد دون أجل إخطار ولا تعويض؛ غير أن الأجير إذا قضى أسبوعاً في الشغل على الأقل لا يُنهى اختباره إلا بعد أجل إخطار: يومان لمن يتقاضى أجره باليوم أو الأسبوع أو كل خمسة عشر يوماً، وثمانية أيام لمن يتقاضاه بالشهر، ما لم يرتكب خطأ جسيماً [labour:13].' },
                   ...(TIER === 'paid' ? [{ k: 'web', t: 'المرجع الرسمي: «ظهير شريف رقم 1.03.194 بتنفيذ القانون رقم 65.99 المتعلق بمدونة الشغل» منشور في بوابة عدالة لوزارة العدل، ومعه صيغة المدونة المحيَّنة.' }] : [])],
          next: ['هل يمكن تجديد فترة الاختبار؟', 'ما أجل الإخطار بعد انتهاء الاختبار؟'],
          sources: TIER === 'paid' ? [{ url: 'https://adala.justice.gov.ma/', title: 'بوابة عدالة — وزارة العدل', host: 'adala.justice.gov.ma' }] : [] },
  ask: { answer: 'تحدد فترة الاختبار في العقد غير المحدد المدة بـ**ثلاثة أشهر للأطر وأشباههم**، وشهر ونصف للمستخدمين، وخمسة عشر يوماً للعمال، ويمكن تجديدها مرة واحدة [labour:14].\nوخلالها يجوز لكل طرف إنهاء العقد دون أجل إخطار ولا تعويض؛ غير أنه إذا قضى الأجير أسبوعاً في الشغل على الأقل لزم منحه أجل إخطار: يومين أو ثمانية أيام بحسب طريقة أداء أجره، ما لم يرتكب خطأ جسيماً [labour:13].',
         covered: true, arts: ['labour:14', 'labour:13'], cites: [], followups: ['هل يمكن تجديد فترة الاختبار؟', 'ما أجل الإخطار بعد انتهاء الاختبار؟'], guard: true, sources: [], articles: [A14, A13] },
  explain: { key: 'labour:13', simple: 'فترة الاختبار مرحلة أولى من عقد الشغل يجرّب فيها كل طرف الآخر، ويجوز خلالها لأي منهما إنهاء العقد دون أجل إخطار ولا تعويض. لكن هذا الإطلاق يتقيد متى قضى الأجير أسبوع شغل على الأقل، فيلزم حينها منحه أجل إخطار ما لم يرتكب خطأ جسيماً.',
             elements: ['عقد شغل ما زال في فترة الاختبار', 'إنهاء بإرادة أحد الطرفين خلال هذه الفترة'],
             effects: ['الأصل: لا أجل إخطار ولا تعويض', 'بعد أسبوع شغل: يومان قبل الإنهاء لمن يتقاضى أجره باليوم أو الأسبوع أو كل خمسة عشر يوماً، وثمانية أيام لمن يتقاضاه بالشهر'],
             exceptions: ['الخطأ الجسيم من الأجير يُسقط وجوب أجل الإخطار', 'الفصل بعد انصرام فترة الاختبار دون خطأ جسيم يوجب أجل إخطار لا يقل عن ثمانية أيام'],
             example: { facts: 'شغّلت «شركة س» الأجيرة «أ» بأجر شهري، ثم أنهت عقدها في اليوم العاشر من فترة الاختبار دون إخطار.', solution: 'الإنهاء خلال الاختبار جائز دون تعويض، لكن «أ» قضت أكثر من أسبوع وتتقاضى أجرها بالشهر، فكان يلزم منحها ثمانية أيام قبل الإنهاء [labour:13].' },
             traps: ['الخلط بين فترة الاختبار وأجل الإخطار', 'نسيان أن حرية الإنهاء تتقيد بعد أسبوع شغل'], hook: 'الاختبار حر في أسبوعه الأول، ثم يلزمه الإخطار.',
             related: [{ key: 'labour:14', why: 'تحدد مدة فترة الاختبار بحسب فئة الأجير ونوع العقد.' }], guard: true, article: A13, articles: [A13, A14] },
  compare: { a: 'فترة الاختبار', b: 'أجل الإخطار', intro: 'فترة الاختبار مرحلة أولى من العقد يجوز خلالها إنهاؤه دون إخطار ولا تعويض [labour:13]، وأجل الإخطار مهلة يلزم احترامها قبل إنهاء العقد غير المحدد المدة بإرادة منفردة [labour:43].',
             rows: [{ aspect: 'متى يُطبَّق', a: 'في بداية العقد، بمدة محددة بحسب فئة الأجير [labour:14]', b: 'عند إنهاء العقد غير المحدد المدة بإرادة منفردة [labour:43]' },
                    { aspect: 'الأصل', a: 'الإنهاء دون أجل إخطار ولا تعويض [labour:13]', b: 'وجوب احترام الأجل ما لم يصدر خطأ جسيم [labour:43]' },
                    { aspect: 'الاستثناء', a: 'بعد أسبوع شغل يلزم أجل قصير: يومان أو ثمانية أيام [labour:13]', b: 'الإعفاء منه في حالة القوة القاهرة [labour:43]' },
                    { aspect: 'الحد الأدنى', a: 'تجوز مدد اختبار أقل بالعقد أو الاتفاقية الجماعية أو النظام الداخلي [labour:14]', b: 'باطل كل شرط يحدده في أقل من ثمانية أيام [labour:43]' }],
             same: ['كلاهما يتعلق بإنهاء عقد الشغل بإرادة أحد طرفيه', 'كلاهما يسقط وجوبه بالخطأ الجسيم'], summary: 'فترة الاختبار تجربة يُنهى خلالها العقد بحرية مقيدة، وأجل الإخطار ضمانة عند إنهاء عقد استقر.',
             trap: 'الظن أن الإنهاء خلال الاختبار لا يحتاج إخطاراً مطلقاً، مع أنه يلزم بعد أسبوع شغل [labour:13].', covered: true, arts: ['labour:13', 'labour:14', 'labour:43'], guard: true, articles: [A13, A14, A43] },
  drill: { id: '00000000-0000-4000-8000-000000000001', title: 'إطارة في فترة الاختبار', facts: 'اشتغلت «أ» إطارةً لدى «شركة س» بعقد غير محدد المدة وأجر شهري. وبعد عشرة أيام من بدء فترة الاختبار، أخبرتها الشركة شفوياً بإنهاء العقد فوراً، دون أن يصدر عنها أي خطأ.',
           questions: ['هل كان إنهاء العقد صحيحاً؟ وما الذي كان يلزم الشركة؟'], law: lawTitle, slug: 'labour', level: 'medium', guard: true },
  drillGrade: { id: '00000000-0000-4000-8000-000000000001', rule: 7, basis: 3, application: 5, score: 15, verdict: 'حل صحيح في جوهره: حددتِ القاعدة وطبقتِها، لكن السند ومدة الأجل ناقصان.',
                strengths: ['تحديد أن الإنهاء خلال الاختبار يتقيد بعد أسبوع شغل', 'تطبيق القاعدة على مدة العشرة أيام'], gaps: ['لم تذكري مدة الأجل: ثمانية أيام لمن يتقاضى أجره بالشهر [labour:13]', 'لم تسندي الحكم إلى نص المادة'],
                model: [{ answer: 'يجوز خلال فترة الاختبار إنهاء العقد دون أجل إخطار ولا تعويض، غير أن الأجير إذا قضى أسبوعاً في الشغل على الأقل لا يُنهى اختباره إلا بعد منحه أجل إخطار، وهو ثمانية أيام لمن يتقاضى أجره بالشهر، ما لم يرتكب خطأ جسيماً [labour:13]. و«أ» قضت عشرة أيام ولم يصدر عنها خطأ، فكان على الشركة أن تمنحها ثمانية أيام قبل الإنهاء؛ والإنهاء الفوري مخالف لذلك.', arts: ['labour:13'] }],
                guard: true, articles: [A13] },
  scan: { extracted: { type: 'mcq', text: 'ما المدة القصوى لفترة الاختبار بالنسبة للأطر وأشباههم في عقد الشغل غير المحدد المدة؟', options: ['ثلاثة أشهر', 'شهر ونصف', 'خمسة عشر يوماً', 'ستة أشهر'] },
          mode: 'mcq', verdicts: [{ letter: 'أ', ok: true, why: 'هي المدة المحددة للأطر وأشباههم [labour:14].' }, { letter: 'ب', ok: false, why: 'هي مدة المستخدمين لا الأطر [labour:14].' },
                                   { letter: 'ج', ok: false, why: 'هي مدة العمال [labour:14].' }, { letter: 'د', ok: false, why: 'لا ترد هذه المدة في النص؛ وإنما يجوز تجديد فترة الاختبار مرة واحدة [labour:14].' }],
          rule: '**فترة الاختبار في العقد غير المحدد المدة**: ثلاثة أشهر للأطر، وشهر ونصف للمستخدمين، وخمسة عشر يوماً للعمال، وتُجدَّد مرة واحدة [labour:14].', covered: true, arts: ['labour:14'], guard: true, articles: [A14], followups: [] },
};

const SHOTS = [
  ['01-home', '7408 أسئلة في 13 فرعاً من القانون المغربي'],
  ['02-question', 'كل خيار بشرحه ومرجعه في القانون'],
  ['03-texts', '27 قانوناً بنصوصها داخل التطبيق، حتى دون اتصال'],
  ['04-tahiro', TIER === 'paid' ? 'اسأل TAHIRO AI: من نصوص القوانين أولاً، ثم آخر المستجدات' : 'اسأل TAHIRO AI: من نصوص القوانين أولاً، ثم الشرح والتوسّع'],
  ['05-explain', 'اشرح أي مادة: شروطها وآثارها وفخاخ الامتحان'],
  ['06-compare', 'قارن بين مفهومين يختلط أمرهما'],
  ['07-drill', 'نوازل تدريبية تُصحَّح على 20'],
  ['08-scan', 'صوّر سؤالاً… فيُحلّ لك من النصوص'],
];
const PLATFORMS = [
  { id: 'iphone', W: 430, H: 932, dpr: 3 },    // 1290×2796
  { id: 'android', W: 432, H: 768, dpr: 2.5 },  // 1080×1920
];
const CAP = 150, PAD = 20;

// خطا التطبيق (Reem Kufi وMarkazi Text، رخصة OFL) من مجلد محلي إن وُجد، بدل Google Fonts: QT_FONTS_DIR=…
const FONTS = process.env.QT_FONTS_DIR || path.join(ROOT, 'resources', 'fonts');
const fontFile = re => { try { const f = fs.readdirSync(FONTS).find(x => re.test(x)); return f ? fs.readFileSync(path.join(FONTS, f)) : null; } catch { return null; } };
const REEM = fontFile(/^ReemKufi.*\.ttf$/i), MARKAZI = fontFile(/^MarkaziText.*\.ttf$/i);
const FACE = (REEM ? `@font-face{font-family:'Reem Kufi';src:url(data:font/ttf;base64,${REEM.toString('base64')}) format('truetype');font-weight:400 700}` : '') +
             (MARKAZI ? `@font-face{font-family:'Markazi Text';src:url(data:font/ttf;base64,${MARKAZI.toString('base64')}) format('truetype');font-weight:400 700}` : '');
async function fonts(ctx) {
  if (!FACE) return;
  await ctx.route(/fonts\.googleapis\.com\/css/, r => r.fulfill({ contentType: 'text/css', body: FACE }));
}
const browser = await chromium.launch();
async function rawShots(pf) {
  const vw = pf.W - 2 * PAD, vh = pf.H - CAP - PAD;
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: pf.dpr, locale: 'ar-MA', serviceWorkers: 'block', hasTouch: true, isMobile: true });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!fonts\.googleapis\.com)/, r => r.abort());
  await fonts(ctx);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL0); await p.fill('#alias', 'سلمى'); await p.click('#enter');
  // البنود والشروط (v8.1) بعد التسجيل وقبل الردهة
  const tc = await p.waitForSelector('#tgate #tgC', { timeout: 6000 }).catch(() => null); if (tc) { await tc.check(); await p.click('#tgY'); }
  const ob = await p.waitForSelector('#onbs', { timeout: 4000 }).catch(() => null); if (ob) await ob.click();
  await p.waitForTimeout(600);
  await p.evaluate(canned => {
    S.cfg.age18 = true; S.cfg.ana = false; S.cfg.onb = 1;
    Object.assign(S.p, { answered: 1240, correct: 1003, points: 8640, streak: 12, best: 19 });
    const d0 = new Date(); for (let i = 0; i < 40; i++) { const d = new Date(d0 - i * 864e5); S.p.days[today(d)] = 25 + (i * 7) % 30; }
    BANK.branches.forEach((b, i) => { S.p.byBranch[b.id] = { a: 60 + i * 9, c: 45 + i * 7 }; });
    AI.google = true;
    window.aiCall = async (kind, payload) => {
      await new Promise(r => setTimeout(r, 30));
      const data = kind === 'drill' ? (payload && payload.answer ? canned.drillGrade : canned.drill) : canned[kind];
      return { ok: true, kind, data, google: true };
    };
    document.querySelectorAll('.sheet').forEach(x => x.remove()); paintLobby(); buildRail();
  }, CANNED);
  const out = {}, snap = async name => { await p.waitForTimeout(250); out[name] = await p.screenshot(); };
  const closeAll = () => p.evaluate(() => { document.querySelectorAll('.sheet').forEach(x => x.remove()); try { closeQuiz(); } catch (e) {} });
  await snap('01-home');
  // سؤال بشرح خياراته
  await p.evaluate(() => { const clean = x => x.conf !== 'r' && x.options.length === 4 && !x.options.some(o => /جميع|كلاهما|لا شيء|معاً/.test(o));
    const q = BANK.questions.find(x => clean(x) && /مدونة الشغل/.test(x.source.law) && /^المادة 1[34]$/.test(x.source.ref) && x.correct.length === 1)
      || BANK.questions.find(x => clean(x) && x.branch === 'labour') || VERIFIED[0];
    studyList([q], 'مدونة الشغل'); });
  await p.waitForSelector('#verdict .verdict'); await p.evaluate(() => { const o = document.querySelector('#opts'); if (o) o.scrollIntoView(); });
  await snap('02-question'); await closeAll();
  // النصوص القانونية: المادة 14 من مدونة الشغل
  await p.evaluate(() => openTexts('labour', '14')); await p.waitForSelector('#txv .txt'); await snap('03-texts'); await closeAll();
  // TAHIRO AI: الدردشة بأقسامها (المكتبة أولاً، ثم التوسع، ثم المصدر الرسمي من الإنترنت)
  await p.evaluate(() => openAI('chat')); await p.waitForSelector('.sheet.tai #taiQ');
  await p.fill('#taiQ', 'ما مدة فترة الاختبار للأطر في العقد غير المحدد المدة؟'); await p.click('[data-tsend]');
  await p.waitForSelector('.tm.a[data-m] .tsec.lib', { timeout: 8000 });
  await p.waitForTimeout(700);
  await p.evaluate(() => { const u = document.querySelector('.sheet.tai .tm.u'); if (u) u.scrollIntoView({ block: 'start' }); });
  await snap('04-tahiro'); await closeAll();
  // اشرح المادة
  await p.evaluate(() => openAI('explain', { slug: 'labour', n: '13' })); await p.waitForSelector('#exo .aiCard');
  await p.evaluate(() => document.querySelector('#exo .aiCard').scrollIntoView({ block: 'start' })); await snap('05-explain'); await closeAll();
  // قارن
  await p.evaluate(() => openAI('compare')); await p.waitForSelector('#cma');
  await p.fill('#cma', 'فترة الاختبار'); await p.fill('#cmb', 'أجل الإخطار'); await p.click('#cmg');
  await p.waitForSelector('#cmo .cmp'); await p.evaluate(() => document.querySelector('#cmo .aiCard').scrollIntoView({ block: 'start' })); await snap('06-compare'); await closeAll();
  // نازلة تدريبية مصحَّحة
  await p.evaluate(() => openAI('drill')); await p.waitForFunction(() => document.querySelectorAll('#drl option').length > 5);
  await p.selectOption('#drl', 'labour'); await p.click('#drg'); await p.waitForSelector('#dra');
  await p.fill('#dra', 'الإنهاء غير صحيح، لأن «أ» قضت أكثر من أسبوع في الشغل، فكان على الشركة أن تمنحها أجل إخطار قبل إنهاء الاختبار.');
  await p.click('#drs'); await p.waitForSelector('#drr .ring'); await p.evaluate(() => document.querySelector('#dro .aiCard').scrollIntoView({ block: 'start' }));
  await snap('07-drill'); await closeAll();
  // صوّر سؤالاً: صورة ورقة امتحان تُرسم هنا ثم تُرفع كما يرفعها الطالب
  const paper = await ctx.newPage(); await paper.setViewportSize({ width: 560, height: 300 });
  await paper.setContent(`<body style="margin:0;background:#f4efe4;font-family:serif;direction:rtl;padding:22px 26px;color:#222;font-size:19px;line-height:1.9">
    <b>السؤال 3:</b> ما المدة القصوى لفترة الاختبار بالنسبة للأطر وأشباههم في عقد الشغل غير المحدد المدة؟<br>أ) ثلاثة أشهر<br>ب) شهر ونصف<br>ج) خمسة عشر يوماً<br>د) ستة أشهر</body>`);
  const img = path.join(OUT, '.paper.png'); fs.mkdirSync(OUT, { recursive: true }); await paper.screenshot({ path: img }); await paper.close();
  await p.evaluate(() => openAI('scan')); await p.waitForSelector('#sc2', { state: 'attached' }); await p.setInputFiles('#sc2', img);
  await p.waitForSelector('#sco .ol'); await p.evaluate(() => document.querySelector('#sco img.thumb').scrollIntoView({ block: 'start' }));
  await snap('08-scan'); await closeAll(); fs.rmSync(img, { force: true });
  if (errs.length) throw new Error(pf.id + ': ' + errs.join(' | '));
  await ctx.close();
  return out;
}

async function frame(pf, png, caption, file) {
  const ctx = await browser.newContext({ viewport: { width: pf.W, height: pf.H }, deviceScaleFactor: pf.dpr });
  const p = await ctx.newPage();
  await p.setContent(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>${FACE}</style><body style="margin:0;width:${pf.W}px;height:${pf.H}px;overflow:hidden;
    background:radial-gradient(120% 70% at 50% 0%,#24313d 0%,#12181F 62%);font-family:'Reem Kufi','Noto Naskh Arabic','DejaVu Sans',sans-serif">
    <div style="height:${CAP}px;display:flex;align-items:center;justify-content:center;padding:0 ${PAD + 6}px;box-sizing:border-box;text-align:center;
      color:#F0E2C3;font-size:${pf.W > 431 ? 29 : 28}px;font-weight:600;line-height:1.45">${caption}</div>
    <div style="position:absolute;top:${CAP}px;left:${PAD}px;right:${PAD}px;bottom:${PAD}px;border-radius:22px;overflow:hidden;
      box-shadow:0 0 0 2px #C89A3C55,0 18px 40px #0008"><img style="display:block;width:100%" src="data:image/png;base64,${png.toString('base64')}"></div></body></html>`);
  await p.waitForTimeout(150);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await p.screenshot({ path: file });
  await ctx.close();
}

for (const pf of PLATFORMS) {
  const raw = await rawShots(pf);
  for (const [name, caption] of SHOTS) await frame(pf, raw[name], caption, path.join(OUT, pf.id, name + '.png'));
  console.log(`✓ ${pf.id}: ${SHOTS.length} لقطات ${pf.W * pf.dpr}×${pf.H * pf.dpr} في dist/store/${pf.id}/`);
}
// صورة العرض في Google Play (1024×500)
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const icon = fs.readFileSync(path.join(ROOT, 'resources', 'ios', 'AppIcon-1024.png')).toString('base64');
  await p.setContent(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>${FACE}</style><body style="margin:0;width:1024px;height:500px;overflow:hidden;display:flex;align-items:center;gap:48px;padding:0 70px;box-sizing:border-box;
    background:radial-gradient(90% 120% at 85% 50%,#2a3846 0%,#12181F 60%);font-family:'Reem Kufi','Noto Naskh Arabic',sans-serif;color:#F0E2C3">
    <img src="data:image/png;base64,${icon}" style="width:250px;height:250px;border-radius:56px;box-shadow:0 0 0 3px #C89A3C66,0 20px 50px #0009">
    <div><div style="font-size:74px;font-weight:700;line-height:1.2">قانون تاهيرو</div>
    <div style="font-size:31px;line-height:1.6;margin-top:10px;color:#d9c9a6;font-family:'Markazi Text',serif">القانون المغربي: أسئلة، ونصوص، ومساعد ذكي</div>
    <div style="font-size:24px;line-height:1.6;margin-top:14px;color:#9fb0bf;font-family:'Markazi Text',serif">7408 أسئلة · 27 قانوناً · نوازل تدريبية</div></div></body></html>`);
  await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(OUT, 'play-feature-1024x500.png') });
  await ctx.close();
  fs.copyFileSync(path.join(ROOT, 'resources', 'store', 'play-icon-512.png'), path.join(OUT, 'play-icon-512.png'));
  console.log('✓ play-feature-1024x500.png و play-icon-512.png في dist/store/');
}
await browser.close(); srv.close();
