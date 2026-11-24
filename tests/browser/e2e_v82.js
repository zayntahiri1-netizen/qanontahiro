// v8.2 في متصفح حقيقي: «TAHIRO AI» بشيفرة دالته نفسها (qt-ai) في Node على Postgres حقيقي فيه البنك ومكتبة القوانين كاملين،
// وبديل Gemini API (generateContent وInteractions) من tests/browser/ai_mock.js:
// الفقاعة العائمة، والدردشة بأقسامها ومصادرها واقتراحات البحث، والسؤال بالصوت، والقراءة بالصوت، والأصوات التسعة، ورادار المستجدات،
// والخريطة الذهنية، ودفتر الأخطاء، وتحدي الدقيقة، وموعد امتحاني، وملاحظاتي، والاسم الجديد، ولا رصيد، ولا ذكر لاسم النموذج.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path'), os = require('os'), fs = require('fs');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.env.QT_SHOTS || path.join(os.tmpdir(), 'qt-shots'); fs.mkdirSync(OUT, { recursive: true });
const PG_HOST = process.env.QT_PG_HOST || '/var/lib/postgresql', PG_PORT = process.env.QT_PG_PORT || '5439';
const APP_URL = process.env.QT_APP_URL || 'http://localhost:8765/index.html';
const errs = [];
const ok = (c, m) => { if (!c) { errs.push('FAIL: ' + m); console.log('✗', m); } else console.log('✓', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- القاعدة: كل الهجرات + البنك في قاعدة المعرفة ---------- */
const PSQL = ['-h', PG_HOST, '-p', PG_PORT, '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'];
const psql = (args, input) => execFileSync('psql', PSQL.concat(args), { encoding: 'utf8', input });
psql(['-f', path.join(ROOT, 'tests', 'sql', 'shim.sql')]);
for (const f of fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => f.endsWith('.sql')).sort())
  psql(['-d', 'qt', '-f', path.join(ROOT, 'supabase', 'migrations', f)]);
execFileSync('python3', [path.join(ROOT, 'tests', 'fn', 'load-kb.py')], { stdio: 'ignore' });
execFileSync('python3', [path.join(ROOT, 'tests', 'fn', 'load-corpus.py')], { stdio: 'ignore' });
const sql = q => psql(['-d', 'qt', '-At'], q).trim();
const dq = s => { const tag = '$q' + crypto.randomBytes(4).toString('hex') + '$'; return tag + s + tag; };
const lit = v => v == null ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : typeof v === 'object' ? dq(JSON.stringify(v)) + '::jsonb' : dq(String(v));
const TABLE = new Set(['qt_board', 'qt_duel_board', 'qt_board_branch']), VOID = new Set(['qt_daily_answer', 'qt_duel_result', 'qt_report']);
function rpc(uid, fn, args) {
  const named = Object.entries(args || {}).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
  const who = uid ? `set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', false);`
                  : `set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);`;
  const body = TABLE.has(fn) ? `select coalesce(jsonb_agg(t), '[]'::jsonb) from public.${fn}(${named}) t;`
             : VOID.has(fn) ? `select public.${fn}(${named}); select 'null';` : `select to_jsonb(public.${fn}(${named}));`;
  try { const out = sql(who + body).split('\n').pop(); return { data: out === '' ? null : JSON.parse(out), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.stderr || e.message).split('\n').find(l => /ERROR/.test(l)) || 'sql error' } }; }
}
// أسبوع ISO وشهر بالصيغة نفسها في التطبيق
const z2 = n => String(n).padStart(2, '0');
function weekKey(d = new Date()) { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day); const y = x.getUTCFullYear(); return y + '-W' + z2(Math.ceil(((x - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7)); }
const monthKey = (d = new Date()) => d.getFullYear() + '-' + z2(d.getMonth() + 1);

/* ---------- «المساعد»: الدالة الحقيقية في Node ---------- */
let AIH = null, USERS = null; const GEM = [];
async function loadAI() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'qtai-'));
  fs.copyFileSync(path.join(ROOT, 'tests', 'fn', 'mock-sb-ai.mjs'), path.join(T, 'mock-sb-ai.mjs'));
  fs.writeFileSync(path.join(T, 'fn-ai.mts'), fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'qt-ai', 'index.ts'), 'utf8')
    .replace('import { createClient } from "npm:@supabase/supabase-js@2";', 'import { createClient } from "./mock-sb-ai.mjs";'));
  const ENV = { GEMINI_API_KEY: 'AQ.e2e-test-key-0123456789', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', QT_AI_PER_MIN: '1000', QT_AI_PER_HOUR: '5000', QT_AI_TTS_PER_MIN: '1000' , QT_AI_TIER: 'paid' };
  globalThis.__QT_ENV = ENV;    // لتبديل مستوى الخدمة أثناء الاختبار
  globalThis.Deno = { env: { get: k => ENV[k] }, serve: h => { AIH = h; } };
  const real = globalThis.fetch;
  require('./ai_mock.js').install(GEM, real);
  const mod = await import(pathToFileURL(path.join(T, 'mock-sb-ai.mjs')).href);
  USERS = mod.USERS;
  await import(pathToFileURL(path.join(T, 'fn-ai.mts')).href);
}

/* ---------- حزم بديلة ---------- */
const MOCK_SB = `window.supabase={createClient(url,key,o){
  const st=o.auth.storage, K=o.auth.storageKey;
  const sess=async()=>{ const raw=await st.getItem(K); return raw?JSON.parse(raw):null; };
  const uid=async()=>{ const s=await sess(); return s&&s.user&&s.user.id||null; };
  const save=async user=>{ const s={ access_token:'t-'+user.id, user }; await st.setItem(K, JSON.stringify(s)); return s; };
  return { auth:{ async getSession(){ return { data:{ session:await sess() }, error:null }; },
      async signInAnonymously(){ const id=await window.__sbSignIn(); const s=await save({ id, is_anonymous:true }); return { data:{ session:s, user:s.user }, error:null }; },
      async signInWithOAuth({options}){ return { data:{ url:location.origin+'/__oauth?mode=signin&to='+encodeURIComponent(options.redirectTo) }, error:null }; },
      async linkIdentity({options}){ const s=await sess(); if(!s) return { data:null, error:{ message:'no session' } };
        return { data:{ url:location.origin+'/__oauth?mode=link&uid='+s.user.id+'&to='+encodeURIComponent(options.redirectTo) }, error:null }; },
      async exchangeCodeForSession(code){ const r=await window.__sbExchange(code); if(r.error) return { data:{ session:null }, error:r.error };
        const s=await save(r.user); return { data:{ session:s, user:s.user }, error:null }; },
      async signOut(){ await st.removeItem(K); return { error:null }; } },
    rpc(fn,args){ return (async()=>window.__sbRpc(await uid(), fn, args||{}))(); },
    functions:{ invoke:async(name,o)=>{ const r=await window.__sbFn(await uid(), name, o&&o.body);
      if(r && r.error && r.error.json){ const j=r.error.json; return { data:null, error:{ context:{ json:async()=>j } } }; }
      if(r && r.data && r.data.__b64){ const bin=atob(r.data.__b64), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
        return { data:new Blob([u], { type:'application/octet-stream' }), error:null }; }
      return r; } } };
}};`;
const MOCK_PN = `(function(){ class PubNub{ constructor(c){ this.ls=[]; } addListener(l){ this.ls.push(l); }
  subscribe(){ setTimeout(()=>this.ls.forEach(l=>l.status&&l.status({category:'PNConnectedCategory'})),5); } unsubscribe(){} unsubscribeAll(){}
  publish(){ return Promise.resolve({}); } async hereNow(){ return { totalOccupancy:1 }; } destroy(){} } window.PubNub=PubNub; })();`;
const MOCK_AB = `window.Ably={ Realtime:class{ constructor(){ this.connection={ on(cb){ setTimeout(()=>cb({current:'connected'}),5); }, close(){}, connect(){} };
  this.channels={ get:()=>({ subscribe:async()=>{} }) }; } close(){} } };`;

/* ---------- Google البديل: رموز العودة وربط الهويات ---------- */
const GOOGLE = new Map(), CODES = new Map();
let NEXT = { email: 'layla@gmail.com', name: 'Layla Bennani' };
let FORCE_TAKEN = 0; const TAKEN_SEEN = [];
const PAGES = new Set();
async function setup(ctx) {
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase|unpkg\.com\/@supabase/, r => r.fulfill({ contentType: 'application/javascript', body: MOCK_SB }));
  await ctx.route(/pubnub@8\.10\.0/, r => r.fulfill({ contentType: 'application/javascript', body: MOCK_PN }));
  await ctx.route(/cdn\.ably\.com|npm\/ably@2/, r => r.fulfill({ contentType: 'application/javascript', body: MOCK_AB }));
  await ctx.route(/\/__oauth/, route => {
    const u = new URL(route.request().url()), mode = u.searchParams.get('mode'), to = u.searchParams.get('to');
    if (mode === 'link') {
      const owner = GOOGLE.get(NEXT.email), uid = u.searchParams.get('uid');
      if (owner && owner !== uid) return route.fulfill({ status: 302, headers: { location: to + '?error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user' } });
    }
    const code = 'c' + crypto.randomBytes(6).toString('hex');
    CODES.set(code, { mode, uid: u.searchParams.get('uid'), g: { ...NEXT } });
    route.fulfill({ status: 302, headers: { location: to + '?code=' + code } });
  });
  await ctx.exposeBinding('__sbSignIn', () => { const id = crypto.randomUUID(); sql(`insert into auth.users(id) values ('${id}')`); USERS.set('t-' + id, { id, is_anonymous: true }); return id; });
  await ctx.exposeBinding('__sbExchange', (src, code) => {
    const c = CODES.get(code); if (!c) return { error: { message: 'invalid code' } }; CODES.delete(code);
    let uid = c.mode === 'link' ? c.uid : GOOGLE.get(c.g.email);
    if (!uid) { uid = crypto.randomUUID(); sql(`insert into auth.users(id) values ('${uid}')`); }
    sql(`update auth.users set is_anonymous = false where id = '${uid}'`);   // كما في Supabase: الربط بـ Google يجعل الحساب دائماً
    GOOGLE.set(c.g.email, uid); USERS.set('t-' + uid, { id: uid, is_anonymous: false });
    return { user: { id: uid, is_anonymous: false, email: c.g.email, identities: [{ provider: 'google', identity_data: { email: c.g.email, full_name: c.g.name } }] } };
  });
  await ctx.exposeBinding('__sbRpc', (src, uid, fn, args) => {
    if (fn === 'qt_claim' && FORCE_TAKEN > 0 && /^طالب \d{4}$/.test(args.p_alias || '')) { FORCE_TAKEN--; TAKEN_SEEN.push(args.p_alias); return { data: { status: 'taken' }, error: null }; }
    return rpc(uid, fn, args);
  });
  await ctx.exposeBinding('__sbFn', async (src, uid, name, body) => {
    if (name === 'qt-pulse') return { data: { ok: true }, error: null };
    const r = await AIH(new Request('https://x/functions/v1/qt-ai', { method: 'POST', headers: { 'content-type': 'application/json', ...(uid ? { authorization: 'Bearer t-' + uid } : {}) }, body: JSON.stringify(body) }));
    if ((r.headers.get('content-type') || '').startsWith('application/octet-stream')) return { data: { __b64: Buffer.from(await r.arrayBuffer()).toString('base64') }, error: null };
    const j = await r.json();
    return r.status >= 400 ? { data: null, error: { json: j } } : { data: j, error: null };
  });
}
async function device(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-MA', serviceWorkers: 'block' });
  await setup(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::|ERR_/.test(m.text())) errs.push(name + ' console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  PAGES.add(page);
  return page;
}
const skipOnb = async page => { const b = await page.waitForSelector('#onbs', { timeout: 3000 }).catch(() => null); if (b) await b.click(); };
// البنود والشروط (v8.1): تظهر بعد التسجيل وقبل الردهة؛ يقبلها الاختبار حيث يُنتظر ظهورها
const acceptTerms = async (page, ms = 15000) => { const c = await page.waitForSelector('#tgate #tgC', { timeout: ms }).catch(() => null);
  if (!c) return false; await c.check(); await page.click('#tgY'); await page.waitForSelector('#tgate', { state: 'detached', timeout: 4000 }).catch(() => null); return true; };
const answerN = async (page, n) => { for (let i = 0; i < n; i++) { await page.click('#opts .opt[data-i="0"]'); await page.click('#go');
  if (await page.$('#verdict .vhead')) await page.click('#go'); } };

const noModelName = async page => !/gemini/i.test(await page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[aria-label],[title],[placeholder]')].map(e => (e.getAttribute('aria-label') || '') + (e.getAttribute('title') || '') + (e.getAttribute('placeholder') || '')).join(' ')));
const lastGem = () => GEM[GEM.length - 1];
// انتظار طلب بعينه إلى بديل Gemini (الطلبات تخرج غير متزامنة بعد النقر)
const waitGem = async (from, pred, ms = 8000) => { const t0 = Date.now(); for (;;) { const c = GEM.slice(from).find(pred); if (c || Date.now() - t0 > ms) return c || null; await sleep(60); } };
const isTts = c => c.url.endsWith('/interactions') && !!c.body.response_format;
const fabBox = async page => page.$eval('#tfab .tfo', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, b: innerHeight - r.bottom }; });

(async () => {
  await loadAI();
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const P = await device(browser, 'P');
  if (process.env.QT_DEBUG) P.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
  await P.goto(APP_URL); await P.fill('#alias', 'سلمى'); await P.click('#enter');
  // البنود: نسخة جديدة (TAHIRO AI والبحث في الإنترنت والصوت)، بلا تنبيه «لا تُدخل معطيات حقيقية»
  await P.waitForSelector('#tgate #tgC', { timeout: 15000 });
  const terms = await P.textContent('#tgate');
  ok(/TAHIRO AI/.test(terms) && /الإنترنت/.test(terms) && !/أسماء حقيقية|معطيات شخصية|Gemini/.test(terms), 'البنود: TAHIRO AI والإنترنت، دون تنبيه «لا تُدخل معطيات حقيقية» ودون اسم النموذج');
  ok(await P.evaluate(() => TERMS_V) === '2026-11-24', 'نسخة البنود الجديدة تُعرض على الجميع للموافقة');
  await acceptTerms(P); await skipOnb(P);
  await P.waitForSelector('.sheet .code', { timeout: 12000 }).catch(() => null); if (await P.$('#rcx')) await P.click('#rcx');

  // ===== الردهة: الاسم الجديد «TAHIRO» بجانب «مراجعة اليوم»، وتحدي الدقيقة، والفقاعة العائمة =====
  const tiles = await P.$$eval('#tools .tool', x => x.map(b => b.dataset.k + ':' + b.textContent.trim()));
  ok(tiles[0].startsWith('due:') && tiles[1] === 'ai:TAHIRO' && tiles.some(x => x.startsWith('sprint:تحدي الدقيقة')), 'أداة «TAHIRO» بجانب «مراجعة اليوم»، و«تحدي الدقيقة» في الأدوات');
  await P.waitForSelector('#tfab:not(.hidden)', { timeout: 6000 }); await sleep(700);
  const fb = await fabBox(P);
  ok(fb.x < 40 && fb.b >= 12 && fb.b <= 40 && fb.w >= 56, 'الفقاعة أسفل اليسار (والشريط الإعلاني لا يظهر في الويب) ' + JSON.stringify(fb));
  ok(await P.$eval('#tfab .tfr', e => getComputedStyle(e).animationName) === 'tfSpin' && await P.$eval('#tfab .tfo', e => getComputedStyle(e).animationName) === 'tfPulse', 'الفقاعة متحركة: حلقة ضوء تدور ونبض');
  await P.waitForSelector('#tfab.lbl', { timeout: 4000 }).catch(() => null);
  ok(/اسأل TAHIRO AI/.test(await P.textContent('#tfab .tft')), 'تعريف قصير بالفقاعة في أول ظهور');
  await P.evaluate(() => openQuiz('labour'));
  ok(await P.isHidden('#tfab'), 'الفقاعة تختفي في جلسة الأسئلة');
  await P.click('#qx');
  await P.evaluate(() => openSettings());
  ok(await P.isHidden('#tfab'), 'وتحت النوافذ');
  await P.keyboard.press('Escape');
  await P.waitForSelector('#tfab:not(.hidden)', { timeout: 3000 });
  await P.evaluate(() => { S.cfg.motion = false; applyCfg(); });
  ok(await P.$eval('#tfab .tfr', e => getComputedStyle(e).animationName) === 'none', 'الحركة تتوقف حين يطفئها المستخدم');
  await P.evaluate(() => { S.cfg.motion = true; applyCfg(); });
  await sleep(300); await P.screenshot({ path: OUT + '/v82-lobby-fab.png' });
  ok(await noModelName(P), 'لا ذكر لاسم النموذج في الردهة');

  // ===== الدردشة: تأكيد السن، ثم الترحيب =====
  await P.click('#tfab');
  await P.waitForSelector('.sheet [data-y]', { timeout: 5000 });
  const age = await P.textContent('.sheet');
  ok(/TAHIRO AI/.test(age) && /18/.test(age) && !/Gemini|أسماء حقيقية|معطيات شخصية/.test(age), 'تأكيد السن: TAHIRO AI و18 سنة، دون اسم النموذج ودون تنبيه المعطيات');
  await P.click('.sheet [data-y]');
  await P.waitForSelector('.sheet.tai .twel', { timeout: 5000 });
  ok(/TAHIRO AI/.test(await P.textContent('.sheet.tai h2')) && await P.$$eval('.sheet.tai .tsugs .chip', x => x.length) === 5, 'نافذة الدردشة: الاسم، والترحيب، وأربعة أسئلة مقترحة، ورادار المستجدات');
  ok(await P.isHidden('#tfab') && await P.evaluate(() => document.body.classList.contains('tai-open')), 'الفقاعة تختفي والدردشة مفتوحة');
  const full = await P.$eval('.sheet.tai>div', e => { const r = e.getBoundingClientRect(); return r.height >= innerHeight - 2 && r.width >= innerWidth - 2; });
  ok(full, 'الدردشة تملأ شاشة الهاتف');
  await sleep(200); await P.screenshot({ path: OUT + '/v82-chat-welcome.png' });
  // سؤال مكتوب
  let g0 = GEM.length;
  await P.evaluate(() => { window.__stage = ''; new MutationObserver((m, o) => { const s = document.querySelector('.tm.think .tstage'); if (s) { window.__stage = s.textContent; o.disconnect(); } })
    .observe(document.querySelector('#taiList'), { childList: true, subtree: true }); });
  await P.fill('#taiQ', 'ما هي مدة فترة الاختبار بالنسبة للأطر في مدونة الشغل؟');
  await P.click('[data-tsend]');
  await P.waitForFunction(() => !!window.__stage, null, { timeout: 3000 }).catch(() => null);
  ok(/يبحث في مكتبة القوانين/.test(await P.evaluate(() => window.__stage)), 'مؤشر العمل: «يبحث في مكتبة القوانين…»');
  await P.waitForSelector('.tm.a[data-m] .tsec.lib', { timeout: 15000 });
  const secs = await P.$$eval('.tm.a[data-m] .tsec', x => x.map(e => e.className.replace('tsec ', '')));
  ok(secs.join() === 'lib,ai,web', 'الجواب في أقسام: «من مكتبة التطبيق» ثم «شرح وتوسّع» ثم «آخر المستجدات من الإنترنت»');
  const ixc = GEM.slice(g0).find(c => c.url.endsWith('/interactions'));
  ok(ixc && ixc.body.tools[0].type === 'google_search' && /<user>ما هي مدة فترة الاختبار/.test(JSON.stringify(ixc.body.input)), 'السؤال إلى الخادم ثم Interactions مع البحث في الإنترنت');
  ok(await P.$$eval('.tm.a[data-m] .tsec.lib .ak', x => x.length) >= 1, 'مفتاح المادة زر باسمها');
  await P.click('.tm.a[data-m] .tsec.lib .ak');
  ok(await P.$eval('.tm.a[data-m] details.art', d => d.open) && /فترة الاختبار/.test(await P.textContent('.tm.a[data-m] details.art .at')), 'الزر يفتح نص المادة من المكتبة تحت الجواب');
  ok(await P.$$eval('.tm.a[data-m] .tsrc a', x => x.length) === 1 && /sgg\.gov\.ma/.test(await P.textContent('.tm.a[data-m] .tsrc')), 'مصادر البحث تحت الجواب');
  const sug = await P.$eval('.tm.a[data-m] .tsug', h => h.shadowRoot ? { n: h.shadowRoot.querySelectorAll('a.chip').length, js: !!h.shadowRoot.querySelector('script'), on: !!h.shadowRoot.querySelector('[onerror]'), tgt: (h.shadowRoot.querySelector('a.chip') || {}).target } : null);
  ok(sug && sug.n === 1 && !sug.js && !sug.on && sug.tgt === '_blank' && await P.evaluate(() => !window.__xss), 'اقتراحات بحث Google معروضة كما هي في Shadow DOM، دون ما يُنفَّذ');
  ok(await P.$$eval('.tm.a[data-m] .tnext .chip', x => x.length) === 2, 'سؤالان مقترحان للمتابعة');
  ok(/من إعداد TAHIRO AI/.test(await P.textContent('.sheet.tai')) || /TAHIRO AI/.test(await P.textContent('.tm.a[data-m] .tnote')), 'التنبيهات باسم TAHIRO AI');
  await sleep(300); await P.screenshot({ path: OUT + '/v82-chat-answer.png', fullPage: false });
  // المتابعة بسؤال مقترح: سياق المحادثة يُرسل
  g0 = GEM.length;
  await P.click('.tm.a[data-m] .tnext .chip');
  await P.waitForFunction(() => document.querySelectorAll('.tm.a[data-m]').length === 2, null, { timeout: 15000 });
  const ix2 = GEM.slice(g0).find(c => c.url.endsWith('/interactions'));
  ok(ix2 && ix2.body.input.length === 3 && ix2.body.input[1].type === 'model_output', 'السؤال التابع يُرسل بسياق المحادثة (سؤال، جواب، السؤال الحالي)');
  // البحث في الإنترنت يُطفأ من المفتاح
  await P.click('[data-tweb]');
  ok(await P.evaluate(() => S.cfg.tweb === false) && /من مكتبة التطبيق ومعرفته فقط/.test(await P.textContent('#taiF')), 'مفتاح «الإنترنت» يطفئ البحث');
  g0 = GEM.length;
  await P.fill('#taiQ', 'وما هو أجل الإخطار؟'); await P.press('#taiQ', 'Enter');
  await P.waitForFunction(() => document.querySelectorAll('.tm.a[data-m]').length === 3, null, { timeout: 15000 });
  const ix3 = GEM.slice(g0).find(c => c.url.endsWith('/interactions'));
  ok(ix3 && !ix3.body.tools && !(await P.$('.tm.a[data-m="5"] .tsec.web')), 'دون بحث: لا أداة بحث ولا قسم مستجدات، وEnter يرسل');
  await P.click('[data-tweb]');
  // الاستماع لجواب
  g0 = GEM.length;
  await P.click('.tm.a[data-m="1"] [data-tl]');
  const tts = await waitGem(g0, isTts);
  ok(tts && tts.body.model === 'gemini-3.8-flash-lite-tts' && tts.body.generation_config.speech_config[0].voice === 'Charon' && !/\[labour:|\*\*|\[\[/.test(tts.body.input[0].content[0].text),
     'استمع: صوت «رصين» الافتراضي، والنص دون رموز ولا مفاتيح خام');
  await P.waitForFunction(() => VOX.el && !VOX.el.paused && VOX.el.currentTime > 0, null, { timeout: 8000 }).catch(() => null);
  ok(await P.evaluate(() => !!(VOX.el && VOX.el.src.startsWith('blob:'))), 'الصوت يُشغَّل من الخادم (WAV)');
  ok(/أوقف/.test(await P.textContent('.tm.a[data-m="1"] [data-tl]')), 'الزر يصير «أوقف» أثناء القراءة');
  await P.click('.tm.a[data-m="1"] [data-tl]');
  ok(await P.evaluate(() => !VOX.playing), 'وإيقاف القراءة');
  // اختيار الصوت: تسعة أصوات بعينة
  await P.click('[data-tvoice]');
  await P.waitForSelector('#vcv .vcard');
  const vs = await P.$$eval('#vcv .vcard', x => x.map(c => c.querySelector('b').textContent + '|' + c.querySelector('small').textContent));
  ok(vs.length === 9 && vs.filter(v => /رجالي/.test(v)).length === 5 && vs.filter(v => /نسائي/.test(v)).length === 4, 'تسعة أصوات: خمسة رجالية وأربعة نسائية، بأسماء وأوصاف عربية');
  g0 = GEM.length;
  await P.click('#vcv [data-v="Kore"]');
  const smp = await waitGem(g0, c => isTts(c) && c.body.generation_config.speech_config[0].voice === 'Kore');
  ok(await P.evaluate(() => S.cfg.voice === 'Kore') && smp && /TAHIRO AI/.test(smp.body.input[0].content[0].text), 'اختيار «حازمة» يُحفظ وتُسمع عينتها');
  await P.click('#vcv [data-r="1.15"]');
  ok(await P.evaluate(() => voxRate() === 1.15), 'سرعة القراءة');
  await sleep(200); await P.screenshot({ path: OUT + '/v82-voices.png' });
  await P.keyboard.press('Escape');
  // قراءة المحادثة كاملة: أسئلتك بصوت آخر
  g0 = GEM.length;
  await P.click('[data-tread]');
  await P.waitForFunction(() => VOX.owner === 'tai:all' && VOX.items.length === 6, null, { timeout: 5000 }).catch(() => null);
  ok(await P.evaluate(() => VOX.items.length === 6 && VOX.items[0].v === 'Charon' && VOX.items[1].v === 'Kore'), 'اقرأ المحادثة كاملة: أسئلتك بصوت، وأجوبة TAHIRO AI بالصوت المختار');
  await P.evaluate(() => voxStop());
  // السؤال بالصوت (ميكروفون الاختبار)
  g0 = GEM.length;
  await P.click('[data-tmic]');
  await P.waitForSelector('#taiF .taiin.rec canvas', { timeout: 5000 });
  ok(await P.isVisible('#taiF .dotrec'), 'التسجيل: نقطة حمراء ومؤقت وموجة حية');
  await sleep(1600);
  await P.click('#taiF [data-rs]');
  await P.waitForFunction(() => document.querySelectorAll('.tm.a[data-m]').length === 4, null, { timeout: 20000 }).catch(() => null);
  const stt = GEM.slice(g0).find(c => !c.url.endsWith('/interactions') && (c.body.systemInstruction || {}).parts && /ناسخ صوتي/.test(c.body.systemInstruction.parts[0].text));
  ok(stt && /audio\/webm/.test(stt.body.contents[0].parts[0].inlineData.mimeType), 'التسجيل يُنسخ نصاً بالنموذج السريع');
  ok(await P.$$eval('.tm.u .tvm', x => x.length) === 1 && /مدة فترة الاختبار بالنسبة للأطر/.test(await P.textContent('.tm.u:last-of-type').catch(() => '')) || /بالصوت/.test(await P.textContent('.sheet.tai')), 'سؤالك الصوتي يظهر نصاً موسوماً «بالصوت» ثم يُجاب');
  // المحادثة محفوظة على الجهاز وحده
  await P.click('[data-tclose]');
  await P.waitForSelector('#tfab:not(.hidden)', { timeout: 3000 });
  ok(await P.evaluate(async () => ((await Store.get('tai:سلمى')) || []).length) === 8, 'المحادثة محفوظة على الجهاز (أسئلة وأجوبة)');
  ok(!sql(`select coalesce(string_agg(payload::text, ''), '') from qt_ai_cache`).includes('sgg.gov.ma'), 'ولا شيء منها في الخادم');
  await P.click('#tfab');
  await P.waitForSelector('.sheet.tai .tm.a[data-m]', { timeout: 5000 });
  ok(await P.$$eval('.tm.a[data-m]', x => x.length) === 4 && await P.$$eval('.tm.a[data-m] .tsug', h => h.every(x => !!x.shadowRoot)), 'إعادة الفتح تعرض المحادثة السابقة واقتراحات البحث');
  await P.click('[data-tnew]');
  await P.waitForSelector('.sheet.tai .twel', { timeout: 3000 });
  ok(await P.evaluate(async () => ((await Store.get('tai:سلمى')) || []).length) === 0, 'محادثة جديدة تمسح السابقة من الجهاز');
  // رادار المستجدات من الترحيب
  g0 = GEM.length;
  await P.click('.tsugs [data-tnews]');
  await P.waitForSelector('.tm.a[data-m] .tsec.web', { timeout: 15000 });
  ok(/2026-10-01/.test(await P.textContent('.tm.a[data-m] .tsec.web')) && /رادار المستجدات/.test(JSON.stringify(GEM.slice(g0).find(c => c.url.endsWith('/interactions')).body.input)), 'رادار المستجدات: مستجدات مؤرخة من الإنترنت');
  ok(await noModelName(P), 'لا ذكر لاسم النموذج في الدردشة');
  // ===== v8.2.1: خدمة Google المجانية — دون بحث في الإنترنت: يختفي زر «الإنترنت» ويعود حين يصير البحث متاحاً =====
  globalThis.__QT_ENV.QT_AI_TIER = 'free';
  g0 = GEM.length;
  await P.fill('#taiQ', 'ما مدة فترة الاختبار للمستخدمين؟'); await P.click('[data-tsend]');
  await P.waitForFunction(() => !document.querySelector('#taiF [data-tweb]'), null, { timeout: 15000 }).catch(() => null);
  const fx = GEM.slice(g0).filter(c => c.url.endsWith('/interactions') || /:generateContent$/.test(c.url)).filter(c => /مدة فترة الاختبار للمستخدمين/.test(JSON.stringify(c.body)));
  ok(!(await P.$('#taiF [data-tweb]')) && /مكتبة التطبيق أولاً/.test(await P.textContent('#taiF .taihint')) && fx.length && fx.every(c => !JSON.stringify(c.body.tools || []).includes('google_search')),
    'المجاني: لا بحث في الإنترنت، فيختفي زر «الإنترنت» ويقول التلميح إنه يجيب من مكتبة التطبيق أولاً ثم من معرفته');
  ok(await P.evaluate(() => S.cfg.tnoweb === true), 'وتُحفظ الحالة فلا يظهر الزر في المرة القادمة');
  globalThis.__QT_ENV.QT_AI_TIER = 'paid';
  await P.fill('#taiQ', 'وللعمال؟'); await P.click('[data-tsend]');
  await P.waitForSelector('#taiF [data-tweb]', { timeout: 15000 }).catch(() => null);
  ok(!!(await P.$('#taiF [data-tweb]')) && await P.evaluate(() => S.cfg.tnoweb === false), 'المدفوع: يعود زر «الإنترنت» تلقائياً');
  await P.click('[data-tclose]');

  // ===== لوح TAHIRO AI: «اطلب» لا «ولّد»، ولا رصيد =====
  await P.click('#tools .tool[data-k="ai"]');
  await P.waitForSelector('#aitabs');
  const sh = await P.textContent('.sheet');
  ok(/TAHIRO AI/.test(sh) && !/رصيدك|رصيد اليوم|طلبات إضافية|المساعد|Gemini|ولّد|مولّد/.test(sh), 'اللوح: TAHIRO AI، دون رصيد ولا «المساعد» ولا «ولّد»');
  ok(/اطلب تمارين/.test(await P.textContent('#aitabs .aitool[data-k="gen"]')) && /اطلب التمارين/.test(await P.textContent('#gng')), '«اطلب تمارين» و«اطلب التمارين»');
  ok(['ask', 'news', 'map', 'weak'].every(async k => !!(await P.$(`#aitabs .aitool[data-k="${k}"]`))) && await P.$$eval('#aitabs .aitool', x => x.length) === 14, 'أدوات جديدة: اسأل TAHIRO AI، ورادار المستجدات، والخريطة الذهنية، ودفتر أخطائي');
  // الخريطة الذهنية لموضوع
  await P.click('#aitabs .aitool[data-k="map"]');
  await P.fill('#mpt', 'فترة الاختبار في مدونة الشغل'); await P.click('#mpg');
  await P.waitForSelector('#mpo .mmsvg', { timeout: 15000 });
  ok(await P.$$eval('#mpo .mmsvg .mmn', x => x.length) === 4 && await P.$$eval('#mpo .mbr', x => x.length) === 4 && await P.$$eval('#mpo .mbr .ak', x => x.length) >= 4, 'خريطة ذهنية: عقد شعاعية وفروع بعُقدها ومفاتيح موادها');
  await P.click('#mpo .mmn[data-mb="2"]');
  ok(await P.$eval('#mb2', e => e.classList.contains('hl')), 'النقر على فرع في الخريطة ينقل إلى تفصيله');
  await sleep(300); await P.screenshot({ path: OUT + '/v82-map.png' });
  // دفتر الأخطاء
  await P.evaluate(() => { const ids = VERIFIED.filter(q => q.branch === 'labour').slice(0, 6).map(q => q.id); ids.forEach(id => { S.p.wrong[id] = 1; }); save(); });
  await P.click('#aitabs .aitool[data-k="weak"]');
  ok(/: 6 /.test(await P.textContent('#aiv')), 'دفتر الأخطاء يعدّ أخطاءك');
  await P.click('#wkg');
  await P.waitForSelector('#wko .wk', { timeout: 15000 });
  ok(await P.$$eval('#wko .wk', x => x.length) === 2 && /الخلط بين الآجال/.test(await P.textContent('#wko')) && await P.$$eval('#wko .wk [data-wtrain]', x => x.length) === 2, 'محاور الخلل بدروسها، وزر التدريب على كل محور');
  await sleep(200); await P.screenshot({ path: OUT + '/v82-weak.png' });
  await P.click('#wko [data-wtrain="0"]');
  await P.waitForSelector('#quiz:not(.hidden)', { timeout: 5000 });
  ok(await P.$$eval('#sheets .sheet', x => x.length) === 0 && /الخلط بين الآجال/.test(await P.textContent('#quiz .qhead')), 'التدريب على المحور: جلسة بأسئلته');
  await P.click('#qx');

  // ===== المكتبة: الاستماع للمادة وللباب، والخريطة الذهنية للباب، ومستجدات القانون، وملاحظاتي =====
  await P.evaluate(() => openTexts('labour', '13'));
  await P.waitForSelector('#txv .ntbox', { timeout: 10000 });
  g0 = GEM.length;
  await P.click('#txv [data-x="listen"]');
  await P.waitForSelector('#vox:not(.hidden)', { timeout: 6000 }).catch(() => null);
  ok(await P.isVisible('#vox') && /المادة 13/.test(await P.textContent('#vox .vxl')), 'استمع للمادة: مشغّل عائم باسمها');
  ok(!!(await waitGem(g0, c => isTts(c) && c.body.generation_config.speech_config[0].voice === 'Kore')), 'بالصوت المختار');
  await P.click('#vox [data-vxx]');
  ok(await P.isHidden('#vox'), 'إغلاق المشغّل');
  // ملاحظتي وعلامتها
  await P.click('#txv .ntbox [data-nm="1"]');
  await P.click('#txv .ntbox [data-ne]'); await P.fill('#ntx', 'الاختبار للأطر أطول: تذكّر الفئات الثلاث.'); await P.click('#txv [data-ns]');
  await P.waitForSelector('#txv .ntv', { timeout: 3000 });
  ok(await P.evaluate(() => S.p.notes['labour|13'] && S.p.notes['labour|13'].c === 1 && /الفئات الثلاث/.test(S.p.notes['labour|13'].t)), 'ملاحظة وعلامة «مهمة» تُحفظان مع التقدم');
  await P.click('#txv [data-law="labour"]');
  await P.waitForSelector('#txv .txg', { timeout: 5000 });
  ok(!!(await P.$('#txv [data-xn]')), 'زر «مستجدات هذا القانون»');
  await P.click('#txv .txg[data-g="0"] > summary');
  await P.waitForSelector('#txv .txg[data-g="0"] [data-gm]', { timeout: 4000 });
  await P.click('#txv .txg[data-g="0"] [data-gl]');
  await P.waitForFunction(() => VOX.playing && VOX.items.length > 1, null, { timeout: 6000 }).catch(() => null);
  ok(await P.evaluate(() => VOX.items.length > 1 && /^المادة \d/.test(VOX.items[0].l)), 'استمع للباب: مواده تباعاً');
  ok(await P.isVisible('#vox [data-vxn]') && !(await P.$eval('#vox [data-vxn]', b => b.disabled)), 'مع «التالية» في المشغّل');
  await P.click('#vox [data-vxn]');
  ok(await P.evaluate(() => VOX.i === 1), 'الانتقال إلى المادة التالية');
  await P.evaluate(() => voxStop());
  g0 = GEM.length;
  await P.click('#txv .txg[data-g="0"] [data-gm]');
  await P.waitForSelector('.sheet .mmsvg', { timeout: 15000 });
  const mapReq = GEM.slice(g0).map(c => c.body.contents && c.body.contents[0].parts.map(p => p.text || '').join('')).find(t => /خريطة ذهنية/.test(t || ''));
  ok(!!mapReq && /\[labour:1\]/.test(mapReq), 'خريطة ذهنية للباب من مواده في المكتبة');
  await P.keyboard.press('Escape'); await P.keyboard.press('Escape');
  await P.evaluate(() => openTexts());
  await P.waitForSelector('#txv .ntlist', { timeout: 6000 });
  ok(/المادة 13/.test(await P.textContent('#txv .ntlist')) && /الفئات الثلاث/.test(await P.textContent('#txv .ntlist')), 'ملاحظاتي في رأس النصوص القانونية');
  await P.keyboard.press('Escape');

  // ===== تحدي الدقيقة =====
  await P.click('#tools .tool[data-k="sprint"]');
  await P.waitForSelector('#spg');
  await P.click('#spg');
  await P.waitForSelector('#spcard .spa', { timeout: 3000 });
  for (let i = 0; i < 6; i++) { await P.click('.spb.ok'); await sleep(450); }
  ok(await P.evaluate(() => +document.querySelector('#spp').textContent >= 0) && await P.isVisible('.sph .spt'), 'التحدي: عبارات متتالية، ومؤقت دائري، ونتيجة حية');
  const spMeta = await P.evaluate(() => { const a = []; for (let k = 0; k < 8; k++) a.push(...sprintPool(400)); return { n: a.length, bad: a.filter(it => /جميع الأجوبة خاطئة|جميع ما سبق|^\s*كلاهما\s*$|لا شيء مما ذكر/.test(it.q.options[it.i])).length, mixed: a.some(it => it.ok) && a.some(it => !it.ok) }; });
  ok(spMeta.n > 2000 && spMeta.bad === 0 && spMeta.mixed, `التحدي لا يعرض خياراً يحيل إلى غيره («جميع الأجوبة خاطئة»…) — ${spMeta.n} بطاقة، وفيها الصحيح والخطأ`);
  await sleep(200); await P.screenshot({ path: OUT + '/v82-sprint.png' });
  // إنهاء سريع: تقديم الساعة
  await P.evaluate(() => { const d = Date.now; Date.now = () => d() + 61000; setTimeout(() => { Date.now = d; }, 1500); });
  await P.waitForSelector('.spbig', { timeout: 4000 });
  ok(await P.evaluate(() => S.p.sprint && S.p.sprint.plays === 1), 'نهاية الدقيقة: النتيجة وأفضل نتيجة محفوظة');
  await P.click('#spx');

  // ===== موعد امتحاني =====
  ok(/حدّد موعد امتحانك/.test(await P.textContent('#examCard')), 'دعوة لتحديد موعد الامتحان في الردهة');
  await P.click('#examCard');
  const d30 = await P.evaluate(() => today(new Date(Date.now() + 30 * 864e5)));
  await P.fill('#exn', 'مباراة الملحقين القضائيين'); await P.fill('#exd', d30);
  ok(/هدف يومي مقترح: \d+ من الأسئلة/.test(await P.textContent('#exs')), 'هدف يومي مقترح بحسب ما بقي');
  await P.fill('#ext', '25'); await P.click('#exk');
  await P.waitForSelector('#examCard .exr', { timeout: 3000 });
  ok(/مباراة الملحقين القضائيين/.test(await P.textContent('#examCard')) && /30/.test(await P.textContent('#examCard .exd')) && /هدف اليوم \d+\/25/.test(await P.textContent('#examCard')), 'بطاقة الموعد: الاسم والأيام الباقية وهدف اليوم');
  ok(await P.evaluate(() => planStats().exam && planStats().exam.days === 30 && planStats().exam.target === 25), '«خطتي» تأخذ الموعد بعين الاعتبار');
  await sleep(200); await P.screenshot({ path: OUT + '/v82-exam.png' });

  // ===== قراءة السؤال بصوت TAHIRO AI =====
  await P.evaluate(() => openQuiz('labour'));
  g0 = GEM.length;
  await P.click('#qsp');
  await P.waitForFunction(() => VOX.owner.startsWith('q:'), null, { timeout: 5000 }).catch(() => null);
  ok(!!(await waitGem(g0, c => isTts(c) && /(^|\s)أ، /.test(c.body.input[0].content[0].text))), 'قراءة السؤال وخياراته بصوت TAHIRO AI');
  ok(await P.isHidden('#vox'), 'دون مشغّل عائم فوق السؤال');
  await P.click('#qx');
  ok(await P.evaluate(() => !VOX.playing), 'والخروج يوقف القراءة');

  // ===== v8.2.1: صوت الجهاز احتياطاً حين يتعذر صوت الخدمة (حصة اليوم) =====
  await P.evaluate(() => {
    window.__said = []; window.__ss = { gv: speechSynthesis.getVoices, sp: speechSynthesis.speak, ca: speechSynthesis.cancel }; window.__aiTts0 = window.aiTts;
    speechSynthesis.getVoices = () => [{ name: 'Arabic', lang: 'ar-SA', localService: true, default: false, voiceURI: 'ar-SA' }];
    speechSynthesis.speak = u => { window.__said.push([u.text, u.lang, u.rate]); setTimeout(() => u.onend && u.onend({}), 40); };
    speechSynthesis.cancel = () => {};
    window.aiTts = async () => { throw Object.assign(new Error('busy'), { code: 'busy' }); };
    VOX.devUntil = 0; VOX.cache.clear(); S.cfg.vrate = 1.15;
    voxSay([{ t: 'الجملة الأولى في فحص صوت الجهاز. والجملة الثانية في الفحص نفسه.', v: 'Kore' }], { owner: 'devtest', bar: false });
  });
  await P.waitForFunction(() => window.__said.length >= 1 && !VOX.playing, null, { timeout: 6000 }).catch(() => null);
  const dev = await P.evaluate(() => ({ said: window.__said, until: VOX.devUntil - Date.now(), toast: (document.querySelector('.toast') || {}).textContent || '' }));
  ok(dev.said.length >= 1 && /الجملة الأولى/.test(dev.said[0][0]) && dev.said[0][1] === 'ar-SA' && Math.abs(dev.said[0][2] - 1.15) < 0.001 && dev.until > 10 * 60e3 && /صوت جهازك/.test(dev.toast),
    'صوت الخدمة مشغول: يكمل صوت الجهاز القراءة بالسرعة المختارة، ويُعاد صوت الخدمة بعد ربع ساعة');
  await P.evaluate(() => { speechSynthesis.getVoices = window.__ss.gv; speechSynthesis.speak = window.__ss.sp; speechSynthesis.cancel = window.__ss.ca;
    window.aiTts = window.__aiTts0; VOX.devUntil = 0; S.cfg.vrate = 1; });

  // ===== لا رصيد ولا مكافآت إعلانية =====
  ok(!/رصيدك اليوم/.test(await P.evaluate(() => document.body.innerHTML)) && !(await P.evaluate(() => typeof adsRewardAI !== 'undefined')), 'لا «رصيدك اليوم» ولا إعلان مكافأة للذكاء الاصطناعي');
  const r = await P.evaluate(async () => (await aiCall('quota')).unlimited);
  ok(r === true, 'الخادم: لا رصيد للمستخدم');
  ok(await noModelName(P), 'لا ذكر لاسم النموذج في أي واجهة');

  // ===== الإنجليزية والفرنسية =====
  await P.evaluate(() => { S.lang = 'fr'; paintLobby(); });
  ok(/Demander à TAHIRO AI/.test(await P.textContent('#tfab .tft')) && /TAHIRO/.test(await P.textContent('#tools .tool[data-k="ai"]')), 'بالفرنسية: «Demander à TAHIRO AI»');
  await P.evaluate(() => { S.lang = 'en'; paintLobby(); });
  ok(/Ask TAHIRO AI/.test(await P.textContent('#tfab .tft')) && /Minute sprint/.test(await P.textContent('#tools')), 'بالإنجليزية: «Ask TAHIRO AI» و«Minute sprint»');
  await P.evaluate(() => { S.lang = 'ar'; paintLobby(); });

  await browser.close();
  console.log(errs.length ? errs.join('\n') : 'لا أخطاء');
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
