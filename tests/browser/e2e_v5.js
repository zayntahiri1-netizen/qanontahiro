// v5 في متصفح حقيقي: الدخول بـ Google (ربط ثم دخول من جهاز جديد ثم هوية مرتبطة بحساب آخر)، والترتيب العالمي الكامل،
// و«TAHIRO AI» بشيفرة دالته نفسها (qt-ai) تعمل في Node على Postgres حقيقي فيه البنك ومكتبة القوانين كاملين، وبديل Gemini API يردّ بحسب الطلب (ai_mock.js)،
// وأدوات v8: النصوص القانونية، وتأكيد السن، والمحادثة المتصلة، وتصوير السؤال، والشرح، والمقارنة، والموضوع، والنازلة التدريبية، والبطاقات، والشفوي بالصوت.
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

/* ---------- «TAHIRO AI»: الدالة الحقيقية في Node ---------- */
let AIH = null, USERS = null; const GEM = [];
async function loadAI() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'qtai-'));
  fs.copyFileSync(path.join(ROOT, 'tests', 'fn', 'mock-sb-ai.mjs'), path.join(T, 'mock-sb-ai.mjs'));
  fs.writeFileSync(path.join(T, 'fn-ai.mts'), fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'qt-ai', 'index.ts'), 'utf8')
    .replace('import { createClient } from "npm:@supabase/supabase-js@2";', 'import { createClient } from "./mock-sb-ai.mjs";'));
  const ENV = { GEMINI_API_KEY: 'AQ.e2e-test-key-0123456789', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', QT_AI_PER_MIN: '1000', QT_AI_PER_HOUR: '5000', QT_AI_TTS_PER_MIN: '1000' , QT_AI_TIER: 'paid' };
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

(async () => {
  await loadAI();
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  // ===== الجهاز 1: «ليلى» باسم مستعار، ثم تربط Google =====
  const A = await device(browser, 'A');
  await A.goto(APP_URL); await A.fill('#alias', 'ليلى'); await A.click('#enter'); await acceptTerms(A); await skipOnb(A);
  ok(await A.isVisible('#gsign') === false, 'زر Google في شاشة الدخول وحدها');
  await A.waitForSelector('.sheet .code', { timeout: 12000 }); await A.click('#rcx');
  const uidA = sql(`select owner from qt_profiles where alias = 'ليلى'`);
  await A.evaluate(() => openQuiz('labour')); await answerN(A, 3); await A.click('#qx');
  ok(await A.evaluate(() => cloudPush()), 'التقدم مرفوع قبل الربط');
  await A.evaluate(() => openCloud()); await A.waitForSelector('#clg');
  ok(/ربط حساب Google/.test(await A.textContent('.sheet')), 'لوح الحساب يعرض ربط Google ومزيته');
  await A.click('#clg');
  await A.waitForFunction(() => window.CS && CS.google === true && !!S.user, null, { timeout: 15000 }).catch(() => null);
  ok(await A.evaluate(() => CS.google && CS.email === 'layla@gmail.com' && S.user.alias === 'ليلى'), 'بعد العودة من Google: الحساب نفسه مرتبط، والاسم المستعار باقٍ');
  ok(!/code=/.test(A.url()), 'رمز العودة يُمحى من شريط العنوان');
  ok(sql(`select owner from qt_profiles where alias = 'ليلى'`) === uidA, 'الربط يحفظ الهوية نفسها فلا ينتقل شيء');
  await A.evaluate(() => openCloud()); await A.waitForSelector('#clgo');
  ok(/layla@gmail\.com/.test(await A.textContent('.sheet')) && !(await A.$('#clr')), 'لوح الحساب: «مرتبط بـ Google» وبريده، ولا حاجة إلى رمز الاسترجاع');
  await sleep(500); await A.screenshot({ path: OUT + '/v5-google-linked.png' });
  await A.keyboard.press('Escape');

  // ===== الجهاز 2: هاتف جديد، «المتابعة بحساب Google» =====
  const B = await device(browser, 'B');
  await B.goto(APP_URL); await B.waitForSelector('#gsign:not(.hidden)');
  await B.screenshot({ path: OUT + '/v5-login.png' });
  await B.click('#gsign');
  ok(await acceptTerms(B), 'الدخول بـ Google على هاتف جديد: البنود والشروط قبل الردهة أيضاً');
  await B.waitForSelector('#lobby:not(.hidden)', { timeout: 15000 }).catch(() => null); await skipOnb(B);
  await B.waitForFunction(() => window.CS && CS.mine === true, null, { timeout: 12000 }).catch(() => null);
  ok(await B.evaluate(() => S.user && S.user.alias === 'ليلى' && CS.google), 'الدخول بـ Google على هاتف جديد يعيد الاسم المستعار دون رمز');
  ok(await B.evaluate(() => S.p.answered) === 3, 'وتقدمه كاملاً (3 أجوبة)');
  ok(!(await B.$('.sheet .code')), 'لا لوح رمز استرجاع لمن دخل بـ Google');

  // ===== الترتيب العالمي =====
  const lw = weekKey(new Date(Date.now() - 7 * 864e5));
  sql(`insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2');
       insert into qt_profiles(alias, owner, seed, secret_hash) values ('سامي', '00000000-0000-0000-0000-0000000000e1', 777, 'x'), ('هدى', '00000000-0000-0000-0000-0000000000e2', 888, 'x');
       insert into qt_progress(alias, data, points, answered, correct, week, week_points, month, month_points, best) values
         ('سامي', '{"byBranch":{"labour":{"a":40,"c":30}}}', 5000, 60, 45, '${weekKey()}', 300, '${monthKey()}', 900, 5),
         ('هدى',  '{"byBranch":{"labour":{"a":12,"c":10}}}', 1, 12, 10, '${weekKey()}', 1, '${monthKey()}', 1, 2);
       insert into qt_period_hist values ('week', '${lw}', 'سامي', 500), ('week', '${lw}', 'هدى', 200);`);
  await B.evaluate(() => cloudPush());
  await B.click('#openBoard');
  await B.waitForSelector('.sheet table', { timeout: 8000 });
  await B.waitForSelector('#bme .myrank', { timeout: 8000 }).catch(() => null);
  ok(/ترتيبك\s*2\s*من 3/.test((await B.textContent('#bme').catch(() => '')).replace(/\s+/g, ' ')), 'بطاقة «ترتيبك»: الثاني من ثلاثة');
  ok(/تتقدم على 50٪/.test(await B.textContent('#bme').catch(() => '')), 'نسبة من تتقدم عليهم');
  ok(await B.$$eval('.sheet .medal.m1', x => x.length) >= 1, 'أوسمة الثلاثة الأوائل');
  await B.waitForSelector('#hall:not(.hidden)', { timeout: 6000 }).catch(() => null);
  ok(/سامي/.test(await B.textContent('#hall').catch(() => '')), 'أبطال الأسبوع الماضي من السجل');
  await sleep(400); await B.screenshot({ path: OUT + '/v5-board.png' });
  await B.click('#bt .chip[data-v="mo"]');
  await B.waitForFunction(() => /900/.test(document.querySelector('#bb') && document.querySelector('#bb').textContent), null, { timeout: 6000 }).catch(() => null);
  ok(/900/.test(await B.textContent('#bb')), 'لوحة الشهر');
  await B.click('#bt .chip[data-v="br"]');
  await B.waitForSelector('#bbr [data-br="labour"]'); await B.click('#bbr [data-br="labour"]');
  await B.waitForFunction(() => document.querySelectorAll('#bb tbody tr').length === 2, null, { timeout: 6000 }).catch(() => null);
  const brRows = await B.$$eval('#bb tbody tr', r => r.map(x => x.textContent.replace(/\s+/g, ' ')));
  ok(brRows.length === 2 && /سامي/.test(brRows[0]) && /30/.test(brRows[0]), 'ترتيب فرع الشغل بالأجوبة الصحيحة (عشرة أجوبة على الأقل)');
  await B.keyboard.press('Escape');

  // ===== TAHIRO AI تحت السؤال =====
  await B.evaluate(() => openQuiz('labour'));
  for (const i of [0, 1, 2, 3]) await B.click(`#opts .opt[data-i="${i}"]`);
  await B.click('#go');
  await B.waitForSelector('#aiw');
  ok(/لماذا أخطأت/.test(await B.textContent('#aiw')), 'زر «لماذا أخطأت؟» بعد جواب خاطئ');
  await B.click('#aiw');
  // أول استعمال لـ TAHIRO AI: تأكيد السن (شروط مزوّد الخدمة: 18 سنة فأكثر)، مرة واحدة، دون اسم النموذج
  await B.waitForSelector('.sheet [data-y]', { timeout: 5000 }).catch(() => null);
  ok(/TAHIRO AI/.test(await B.textContent('.sheet').catch(() => '')) && /18/.test(await B.textContent('.sheet').catch(() => '')) && !/Gemini/.test(await B.textContent('.sheet').catch(() => '')), 'تأكيد السن قبل أول استعمال لـ TAHIRO AI (18 سنة)، دون اسم النموذج');
  await sleep(200); await B.screenshot({ path: OUT + '/v8-age.png' });
  await B.click('.sheet [data-y]');
  await B.waitForSelector('#aiOut .aiCard .box', { timeout: 10000 }).catch(() => null);
  ok(await B.evaluate(() => S.cfg.age18 === true), 'التأكيد محفوظ فلا يُسأل ثانية');
  ok(/فخ الأجل/.test(await B.textContent('#aiOut').catch(() => '')) && await B.$$eval('#aiOut .ol', x => x.length) === 4, 'شرح الفخ بأحكام الخيارات الأربعة والقاعدة');
  ok(!/رصيد/.test(await B.textContent('#aiOut')), 'لا رصيد يُعرض (دون حد يومي للمستخدم)');
  await sleep(300); await B.screenshot({ path: OUT + '/v5-ai-why.png' });
  // البلاغ عن جواب مولَّد من داخل التطبيق (سياسة Google Play للمحتوى المولَّد بالذكاء الاصطناعي)
  await B.click('#aiOut [data-aiflag]');
  await B.waitForSelector('.sheet #afs'); await B.click('.sheet [data-r="2"]'); await B.fill('#afn', 'اختبار');
  await B.click('.sheet #afs');
  await B.waitForFunction(() => !document.querySelector('.sheet #afs'), null, { timeout: 5000 }).catch(() => null);
  await sleep(400);
  const flag = sql(`select qid || ' | ' || why || ' | ' || left(note, 60) from qt_reports where qid like 'AI:%' order by id desc limit 1`);
  ok(/^AI:why:[A-Z]+-\d+ \| TAHIRO AI: محتوى مسيء/.test(flag) && /اختبار — /.test(flag), 'زر «أبلغ عن هذا الجواب» يرسل البلاغ مع نص الجواب إلى لوحة المؤلف');
  ok(await B.isVisible('#aiOut .aiCard'), 'والشرح باقٍ مكانه بعد البلاغ');
  await B.click('#ait');
  await B.waitForSelector('#aiOut .tq .opt', { timeout: 10000 }).catch(() => null);
  ok(await B.$$eval('#aiOut .tq .opt', x => x.length) === 4 && /ليس من البنك/.test(await B.textContent('#aiOut')), 'سؤال توأم تفاعلي موسوم بأنه ليس من البنك');
  await B.click('#aiOut .tq .opt[data-i="0"]'); await B.click('#aiOut [data-go]');
  ok(/صحيح/.test(await B.textContent('#aiOut [data-res]').catch(() => '')), 'التوأم يُصحَّح ويكشف تعليله');
  await B.click('#qx');

  // ===== TAHIRO AI: اسأل (الدردشة)، نازلة، الشفوي، خطتي =====
  await B.evaluate(() => openAI('ask'));
  await B.waitForSelector('.sheet.tai #taiQ');
  ok(/TAHIRO AI/.test(await B.textContent('.sheet.tai h2')) && !/رصيد/.test(await B.textContent('.sheet.tai')), '«اسأل» يفتح دردشة TAHIRO AI، ولا رصيد');
  await B.fill('#taiQ', 'ما هي مدة فترة الاختبار بالنسبة للأجراء في مدونة الشغل؟'); await B.click('[data-tsend]');
  await B.waitForSelector('.tm.a[data-m] .tsec.lib', { timeout: 15000 }).catch(() => null);
  ok(await B.$$eval('.tm.a[data-m] [data-cite]', x => x.length) >= 1, 'جواب بإحالات قابلة للنقر على أسئلة البنك');
  ok(await B.$$eval('.tm.a[data-m] details.art', x => x.length) >= 1 && /المادة 13/.test(await B.textContent('.tm.a[data-m] details.art')), 'ومعه بطاقة نص المادة من مكتبة القوانين');
  await B.click('.tm.a[data-m] .tsec.lib .ak');
  ok(await B.$eval('.tm.a[data-m] details.art', d => d.open) && /فترة الاختبار، هي الفترة/.test(await B.textContent('.tm.a[data-m] details.art .at')), 'الإحالة على المادة تفتح نصها تحت الجواب');
  ok(await B.$eval('.tm.a[data-m] details.art .at', e => getComputedStyle(e).textAlign) !== 'center', 'نص المادة بمحاذاة السطر لا في الوسط');
  await sleep(300); await B.screenshot({ path: OUT + '/v5-ai-ask.png' });
  await B.click('.tm.a[data-m] .tsec.lib [data-cite]');
  await B.waitForSelector('#quiz:not(.hidden)', { timeout: 6000 }).catch(() => null);
  ok(await B.isVisible('#quiz') && !(await B.$('#sheets .sheet')), 'الإحالة تفتح السؤال المرجعي للمذاكرة');
  await B.click('#qx');
  await B.evaluate(() => openAI('case'));
  await B.waitForSelector('#act');
  await B.fill('#act', 'قصير');
  await B.click('#acs');
  ok(!(await B.$('#aca .aiCard')), 'نازلة قصيرة جداً لا تُرسل');
  await B.fill('#act', 'أعمل منذ عشر سنوات في شركة بعقد غير محدد المدة، وطردني المشغل فجأة دون سبب ودون إخطار. ما حقوقي؟');
  await B.click('#acs');
  await B.waitForSelector('#aca .issue', { timeout: 10000 }).catch(() => null);
  const caseTxt = await B.textContent('#aca').catch(() => '');
  ok(/التكييف/.test(caseTxt) && /الخلاصة/.test(caseTxt) && /معطيات تنقص/.test(caseTxt) && await B.$$eval('#aca details.art', x => x.length) >= 1,
     'النازلة: تكييف ومسائل وخلاصة وما ينقص، وبطاقات المواد من المكتبة');
  ok(/ليس استشارة قانونية/.test(caseTxt) && /لا يُحفظ نص النازلة/.test(caseTxt), 'تنبيه: تحليل تعليمي لا استشارة، ونص النازلة لا يُحفظ');
  await sleep(300); await B.screenshot({ path: OUT + '/v7-ai-case.png' });
  await B.click('#aitabs .aitool[data-k="oral"]');
  await B.waitForSelector('#aoa');
  await B.fill('#aoa', 'العقد صحيح لأن أركانه متوفرة، والقاعدة أن الشرط الباطل يبطل وحده إذا لم يكن هو الدافع إلى التعاقد.');
  await B.click('#aog');
  await B.waitForSelector('#aor .ring', { timeout: 10000 }).catch(() => null);
  ok(/9\/10/.test(await B.textContent('#aor').catch(() => '')) && /الجواب النموذجي/.test(await B.textContent('#aor').catch(() => '')), 'الشفوي: نتيجة من 10 بثلاثة معايير وجواب نموذجي');
  await sleep(300); await B.screenshot({ path: OUT + '/v5-ai-oral.png' });
  await B.click('#aitabs .aitool[data-k="plan"]');
  await B.waitForSelector('#apg'); await B.click('#apg');
  await B.waitForSelector('.pday', { timeout: 10000 }).catch(() => null);
  ok(await B.$$eval('.pday', x => x.length) === 7, 'خطة سبعة أيام');
  await sleep(300); await B.screenshot({ path: OUT + '/v5-ai-plan.png' });
  await B.click('.pday [data-st]');
  await B.waitForSelector('#quiz:not(.hidden)', { timeout: 6000 }).catch(() => null);
  ok(await B.isVisible('#quiz') && await B.evaluate(() => !!(S.p.plan && S.p.plan.done && Object.keys(S.p.plan.done).length)), 'زر «ابدأ» يفتح الجلسة ويُعلَّم منجزاً');
  await B.click('#qx');
  ok(+sql(`select count(*) from qt_ai_log where uid = '${uidA}'`) >= 6, 'استدعاءات TAHIRO AI مسجلة بهوية الحساب');

  // ===== v8: النصوص القانونية داخل التطبيق =====
  await B.click('#tools .tool[data-k="texts"]');
  await B.waitForSelector('#txv .li[data-law]', { timeout: 10000 }).catch(() => null);
  ok(await B.$$eval('#txv .li[data-law]', x => x.length) === 27, 'النصوص القانونية: 27 قانوناً في التطبيق');
  await B.fill('#txq', 'سقوط الحضانة'); await B.press('#txq', 'Enter');
  await B.waitForSelector('#txr .hit', { timeout: 30000 }).catch(() => null);
  ok(await B.$$eval('#txr .hit', x => x.length) >= 1 && /مدونة الأسرة/.test(await B.textContent('#txr').catch(() => '')), 'البحث في كل النصوص يجد مواد الحضانة في مدونة الأسرة');
  ok(await B.$$eval('#txr mark', x => x.length) >= 1, 'الكلمات المطابقة مظلَّلة في المقتطف');
  await sleep(200); await B.screenshot({ path: OUT + '/v8-texts-search.png' });
  await B.click('#txv .li[data-law="labour"]');
  await B.waitForSelector('#tlq'); await B.fill('#tlq', '13'); await B.press('#tlq', 'Enter');
  await B.waitForSelector('#txv .txt', { timeout: 5000 }).catch(() => null);
  ok(/فترة الاختبار، هي الفترة/.test(await B.textContent('#txv .txt').catch(() => '')), 'رقم المادة في القانون يفتح نصها');
  await B.click('#txv [data-nav="14"]');
  ok(/المادة 14/.test(await B.textContent('#txv h2')), 'المادة التالية');
  await B.click('#txv [data-nav="13"]');
  await B.click('#txv [data-fav]');
  ok(await B.evaluate(() => !!S.p.txFav['labour|13']), 'حفظ المادة في «محفوظاتي»');
  ok(!!(await B.$('#txv [data-x="explain"]')) && !!(await B.$('#txv [data-x="cards"]')) && !!(await B.$('#txv [data-x="listen"]')), 'أزرار TAHIRO AI على المادة (ومعها «استمع»)');
  await sleep(200); await B.screenshot({ path: OUT + '/v8-texts-article.png' });
  await B.click('#txv [data-x="explain"]');
  await B.waitForSelector('#exo .aiCard', { timeout: 12000 }).catch(() => null);
  const exTxt = await B.textContent('#exo').catch(() => '');
  ok(/بعبارة بسيطة/.test(exTxt) && /الشروط والأركان/.test(exTxt) && /فخاخ الامتحان/.test(exTxt) && /مثال تطبيقي/.test(exTxt), 'اشرح المادة: شرح مبسط وشروط ومثال وفخاخ');
  ok(await B.$eval('#exl', e => e.value) === 'labour' && await B.$eval('#exn', e => e.value) === '13', 'أداة الشرح تُفتح بالقانون والمادة');
  await sleep(200); await B.screenshot({ path: OUT + '/v8-explain.png' });
  await B.click('#exo [data-xcards]');
  await B.waitForSelector('#cdo details.fc', { timeout: 12000 }).catch(() => null);
  ok(await B.evaluate(() => Object.keys(S.p.cards || {}).length) === 4, 'بطاقات المادة تُضاف إلى «بطاقاتي»');
  await B.waitForSelector('#dkr'); await B.click('#dkr');
  await B.waitForSelector('#cdo .fcard [data-fl]'); await B.click('#cdo [data-fl]');
  await sleep(150); await B.screenshot({ path: OUT + '/v8-cards.png' });
  await B.click('#cdo [data-k="1"]');
  ok(await B.evaluate(() => Object.values(S.p.cards).filter(c => c.x === 1 && c.d > dnum()).length === 1), 'مراجعة بطاقة معروفة تؤجلها (تكرار متباعد)');
  // قارن
  await B.click('#aitabs .aitool[data-k="compare"]');
  await B.fill('#cma', 'فترة الاختبار'); await B.fill('#cmb', 'أجل الإخطار'); await B.click('#cmg');
  await B.waitForSelector('#cmo .cmp', { timeout: 12000 }).catch(() => null);
  ok(await B.$$eval('#cmo .cmp .asp', x => x.length) === 3 && /أوجه التشابه/.test(await B.textContent('#cmo')), 'قارن: جدول فروق وأوجه تشابه');
  await sleep(200); await B.screenshot({ path: OUT + '/v8-compare.png' });
  // الموضوع: تصميم ثم تصحيح على 20
  await B.click('#aitabs .aitool[data-k="essay"]');
  await B.fill('#est', 'إنهاء عقد الشغل غير محدد المدة'); await B.click('#esp');
  await B.waitForSelector('#eso .issue', { timeout: 12000 }).catch(() => null);
  ok(await B.$$eval('#eso .issue', x => x.length) === 2 && /الإشكالية/.test(await B.textContent('#eso')), 'الموضوع: تصميم بقسمين وإشكالية');
  await sleep(200); await B.screenshot({ path: OUT + '/v8-essay-plan.png' });
  await B.click('#esg'); await B.fill('#esx', 'تقديم: يعد عقد الشغل من أهم العقود في الحياة الاقتصادية والاجتماعية. '.repeat(5));
  await B.click('#ess');
  await B.waitForSelector('#eso .ring', { timeout: 12000 }).catch(() => null);
  ok(/12\/20/.test(await B.textContent('#eso .ring').catch(() => '')) && /كيف ترفع نقطتك/.test(await B.textContent('#eso')), 'تصحيح التحرير على 20 بخمسة معايير');
  // نازلة تدريبية
  await B.click('#aitabs .aitool[data-k="drill"]');
  await B.waitForFunction(() => document.querySelectorAll('#drl option').length > 5);
  await B.selectOption('#drl', 'labour'); await B.click('#drv .chip[data-l="hard"]'); await B.click('#drg');
  await B.waitForSelector('#dro #dra', { timeout: 12000 }).catch(() => null);
  ok(/شركة س/.test(await B.textContent('#dro').catch(() => '')) && !/فالإنهاء دون مهلة مخالف/.test(await B.content()), 'النازلة التدريبية: وقائع وسؤال، والحل النموذجي لا يصل قبل الحل');
  await B.fill('#dra', 'الإنهاء غير صحيح لأن الأجير قضى أكثر من أسبوع، فكان يلزم منحه أجل الإخطار.'); await B.click('#drs');
  await B.waitForSelector('#drr .ring', { timeout: 12000 }).catch(() => null);
  ok(/14\/20/.test(await B.textContent('#drr .ring').catch(() => '')) && /فالإنهاء دون مهلة مخالف/.test(await B.textContent('#drr')), 'تصحيح الحل على 20، ثم الحل النموذجي');
  await sleep(200); await B.screenshot({ path: OUT + '/v8-drill.png' });
  // صوّر سؤالاً
  await B.click('#aitabs .aitool[data-k="scan"]');
  await B.setInputFiles('#sc2', path.join(ROOT, 'dist', 'app', 'icon-512.png'));
  await B.waitForSelector('#sco .ol', { timeout: 15000 }).catch(() => null);
  const scanReq = GEM.find(g => g.body.contents && g.body.contents[0].parts.some(p => p.inlineData && /^image\//.test(p.inlineData.mimeType)));
  ok(await B.$$eval('#sco .ol', x => x.length) === 4 && !!(await B.$('#sco img.thumb')) && /قرأتُ من الصورة/.test(await B.textContent('#sco')), 'صوّر سؤالاً: نص السؤال المقروء وحكم كل خيار');
  ok(scanReq && scanReq.body.contents[0].parts.find(p => p.inlineData).inlineData.mimeType === 'image/jpeg', 'الصورة تُصغَّر وتُرسل JPEG');
  await sleep(200); await B.screenshot({ path: OUT + '/v8-scan.png' });
  // المحادثة المتصلة: «اسأل» من لوح الأدوات يعيد فتح الدردشة بسياقها
  await B.click('#aitabs .aitool[data-k="ask"]');
  await B.waitForSelector('.sheet.tai #taiQ');
  const nMe = await B.$$eval('.sheet.tai .tm.u', x => x.length);
  await B.fill('#taiQ', 'وما مدتها بالنسبة للأطر وأشباههم؟'); await B.click('[data-tsend]');
  await B.waitForFunction(n => document.querySelectorAll('.sheet.tai .tm.a[data-m]').length === n + 1 && !document.querySelector('.tm.think'), nMe, { timeout: 15000 }).catch(() => null);
  const chatReq = GEM.filter(g => g.url.endsWith('/interactions') && !g.body.response_format).pop();
  ok(nMe >= 1 && chatReq && chatReq.body.input.length >= 3 && chatReq.body.input[0].type === 'user_input' && chatReq.body.input[1].type === 'model_output', 'المحادثة المتصلة: السؤال التابع يُرسل بسياق ما قبله');
  await sleep(200); await B.screenshot({ path: OUT + '/v8-chat.png' });
  await B.click('[data-tclose]');
  // الشفوي بالصوت (ميكروفون صوري في المتصفح)
  await B.click('#aitabs .aitool[data-k="oral"]');
  await B.waitForSelector('#arb'); await B.click('#arb');
  await B.waitForSelector('#ars', { timeout: 5000 }).catch(() => null); await sleep(1800); await B.click('#ars');
  await B.waitForSelector('#arsend', { timeout: 5000 }).catch(() => null); await B.click('#arsend');
  await B.waitForSelector('#aor .ring', { timeout: 12000 }).catch(() => null);
  const voiceReq = GEM.filter(g => g.body.contents && g.body.contents[0].parts.some(p => p.inlineData && /^audio\//.test(p.inlineData.mimeType))).pop();
  ok(/ما سمعته منك/.test(await B.textContent('#aor').catch(() => '')) && voiceReq && voiceReq.body.contents[0].parts.find(p => p.inlineData).inlineData.mimeType === 'audio/webm',
    'الشفوي بالصوت: تسجيل webm يُنسخ ويُقيَّم');
  await sleep(200); await B.screenshot({ path: OUT + '/v8-oral-voice.png' });
  ok(!sql(`select coalesce(string_agg(payload::text, ''), '') from qt_ai_cache`).includes('/9j/'), 'الصورة والتسجيل لا يُخزَّنان على الخادم');
  await B.evaluate(() => document.querySelectorAll('.sheet').forEach(x => x.remove()));
  // سؤال من البنك ← «نص المادة» يفتح المادة في النصوص
  await B.evaluate(() => { const q = BANK.questions.find(x => /مدونة الشغل/.test(x.source.law) && /^المادة 13$/.test(x.source.ref)) || BANK.questions.find(x => txFor(x)); studyList([q], 'x'); });
  await B.waitForSelector('#txb', { timeout: 5000 }).catch(() => null);
  if (await B.$('#txb')) { await B.click('#txb'); await B.waitForSelector('#txv .txt', { timeout: 6000 }).catch(() => null); }
  ok(!!(await B.$('#txv .txt')), 'تحت السؤال: «نص المادة» يفتح المادة في النصوص القانونية');
  await B.evaluate(() => { document.querySelectorAll('.sheet').forEach(x => x.remove()); closeQuiz(); });

  // ===== v8.1: «اطلب تمارين» — من مادة في النصوص، ثم جلسة في محرك الأسئلة لا تمس النقاط =====
  const st0 = await B.evaluate(() => JSON.stringify([S.p.points, S.p.answered, S.p.correct, Object.keys(S.p.wrong), Object.keys(S.p.seen).length, Object.keys(S.p.srs).length, S.p.byType]));
  await B.evaluate(() => openTexts('labour', '13'));
  await B.waitForSelector('#txv [data-x="gen"]', { timeout: 8000 }).catch(() => null);
  ok(/اطلب تمارين/.test(await B.textContent('#txv [data-x="gen"]').catch(() => '')), 'زر «اطلب تمارين» على المادة في النصوص');
  await B.click('#txv [data-x="gen"]');
  await B.waitForSelector('#gnk .chip'); await B.waitForFunction(() => document.querySelectorAll('#gnl option').length > 5);
  ok(await B.$eval('#gnl', e => e.value) === 'labour' && await B.$eval('#gnn', e => e.value) === '13' && await B.$eval('#aitabs .aitool:first-child', e => e.dataset.k === 'gen' && e.classList.contains('wide') && e.getAttribute('aria-pressed') === 'true'),
     'المولّد يُفتح بالقانون والمادة، وهو أول الأدوات زراً عريضاً');
  ok(await B.$$eval('#gnk .chip', x => x.map(c => c.textContent).join('|')) === 'أسئلة|مسائل|نوازل|ألغاز|مزيج', 'أنواع المولّد: أسئلة ومسائل ونوازل وألغاز ومزيج');
  await B.click('#gnk .chip[data-v="riddle"]'); await B.click('#gnc .chip[data-v="3"]'); await B.click('#gng');
  await B.waitForSelector('#gno [data-gstart]', { timeout: 15000 }).catch(() => null);
  const genReq = GEM.filter(g => JSON.stringify(g.body.generationConfig || {}).includes('"items"')).pop();
  ok(/3 تمارين جاهزة/.test(await B.textContent('#gno').catch(() => '')) && genReq && /^\[labour:13\]/m.test(genReq.body.contents[0].parts[0].text) && genReq.body.store === false,
     'المولّد: ثلاثة ألغاز من المادة 13 بنصها، دون حفظ لدى Google');
  await sleep(200); await B.screenshot({ path: OUT + '/v81-gen.png' });
  await B.click('#gno [data-gstart]');
  await B.waitForSelector('#quiz:not(.hidden) #opts .opt');
  ok(/لغز/.test(await B.textContent('#quiz .qtools')) && /TAHIRO AI/.test(await B.textContent('#quiz .qtools')) && !(await B.$('#qbm')) && !(await B.$('#qsh')) && !(await B.$('.sheet')),
     'جلسة الألغاز في محرك الأسئلة: وسما «لغز» و«TAHIRO AI»، دون حفظ ولا مشاركة');
  await B.click('#qhn');
  ok(/بداية عقد الشغل/.test(await B.textContent('#quiz .qhint').catch(() => '')) && !(await B.$('#qhn')), 'اللغز: التلميح يظهر عند طلبه');
  await B.click('#opts .opt[data-i="1"]'); await B.click('#go');
  await B.waitForSelector('#verdict .vhead');
  const gv = await B.textContent('#verdict');
  ok(await B.$$eval('#opts .why', x => x.length) === 4 && await B.$$eval('#opts .opt.ok', x => x.length) === 1 && /من TAHIRO AI/.test(gv) && !!(await B.$('#txb')) && !(await B.$('#aiw')) && !/\[labour:/.test(await B.textContent('#quiz')),
     'التصحيح: تعليل لكل خيار، ووسم «من TAHIRO AI»، و«نص المادة»، دون مفاتيح خام ودون أزرار TAHIRO AI');
  await sleep(200); await B.screenshot({ path: OUT + '/v81-gen-quiz.png' });
  await B.click('#go'); await B.waitForSelector('#opts .opt:not(.ok)');
  ok(await B.textContent('#go') === 'لا شيء منها صحيح', 'دون اختيار: «لا شيء منها صحيح» زرٌّ لا خيار، كما في البنك');
  await B.click('#opts .opt[data-i="0"]'); await B.click('#go'); await B.waitForSelector('#verdict .vhead');
  await B.click('#rep'); await B.waitForSelector('.sheet [data-r]', { timeout: 4000 }).catch(() => null);
  ok(/الإبلاغ عن جواب TAHIRO AI/.test(await B.textContent('.sheet').catch(() => '')), 'الإبلاغ عن تمرين من TAHIRO AI يمر ببلاغاته');
  await B.evaluate(() => document.querySelectorAll('.sheet').forEach(x => x.remove()));
  await B.click('#go'); await B.click('#opts .opt[data-i="1"]'); await B.click('#go'); await B.waitForSelector('#verdict .vhead'); await B.click('#go');
  await B.waitForFunction(() => !S.sess && document.getElementById('quiz').classList.contains('hidden'), null, { timeout: 5000 }).catch(() => null);
  ok(await B.evaluate(() => JSON.stringify([S.p.points, S.p.answered, S.p.correct, Object.keys(S.p.wrong), Object.keys(S.p.seen).length, Object.keys(S.p.srs).length, S.p.byType])) === st0,
     'التمارين المولَّدة لا تمس النقاط ولا الإحصاءات ولا الأخطاء ولا المراجعة المتباعدة');
  // من القانون كله: زر في صفحة القانون، ومزيج من المكتبة
  await B.evaluate(() => openTexts('labour'));
  await B.waitForSelector('#txv [data-xg]', { timeout: 8000 }).catch(() => null); await B.click('#txv [data-xg]');
  await B.waitForSelector('#gnk .chip'); await B.waitForFunction(() => document.querySelectorAll('#gnl option').length > 5);
  ok(await B.$eval('#gnl', e => e.value) === 'labour' && await B.$eval('#gnn', e => e.value) === '', 'زر «اطلب تمارين من هذا القانون» يفتح الأداة بالقانون دون مادة');
  await B.click('#gnk .chip[data-v="mix"]'); await B.click('#gnc .chip[data-v="5"]'); await B.click('#gng');
  await B.waitForSelector('#gno [data-gstart]', { timeout: 15000 }).catch(() => null);
  ok(/5 تمارين جاهزة/.test(await B.textContent('#gno').catch(() => '')), 'مزيج من القانون: خمسة تمارين');
  await B.evaluate(() => document.querySelectorAll('.sheet').forEach(x => x.remove()));
  // الإعدادات: الصفحات الثلاث وتاريخ الموافقة على البنود
  await B.evaluate(() => openSettings());
  await B.waitForSelector('.sheet .legal a');
  ok(await B.$$eval('.sheet .legal a', x => x.length) === 3 && /وافقت على البنود والشروط/.test(await B.textContent('.sheet')), 'الإعدادات: الصفحات الثلاث وتاريخ الموافقة على البنود');
  await B.evaluate(() => document.querySelectorAll('.sheet').forEach(x => x.remove()));

  // ===== الجهاز 3: حساب مجهول يحاول ربط Google مرتبط بحساب آخر =====
  const C = await device(browser, 'C');
  await C.goto(APP_URL); await C.fill('#alias', 'نور'); await C.click('#enter'); await acceptTerms(C); await skipOnb(C);
  await C.waitForSelector('.sheet .code', { timeout: 12000 }); await C.click('#rcx');
  await C.evaluate(() => openCloud()); await C.waitForSelector('#clg'); await C.click('#clg');
  await acceptTerms(C, 20000);
  await C.waitForFunction(() => window.S && S.user && S.user.alias === 'ليلى', null, { timeout: 20000 }).catch(() => null);
  ok(await C.evaluate(() => S.user && S.user.alias === 'ليلى' && CS.google), 'هوية Google مرتبطة بحساب آخر: تأكيد ثم دخول بذلك الحساب');

  // ===== حذف البيانات بحساب Google: الحساب نفسه يُحذف من المصادقة وتُمسح جلسته من الجهاز =====
  const uidL = sql(`select owner from qt_profiles where alias = 'ليلى'`);
  let delMsg = ''; C.once('dialog', d => { delMsg = d.message(); });
  await C.evaluate(() => openCloud()); await C.waitForSelector('#cld'); await C.click('#cld');
  await C.waitForFunction(() => window.CS && CS.google === false, null, { timeout: 8000 }).catch(() => null);
  ok(/Google/.test(delMsg), 'تأكيد الحذف يذكر حساب Google المرتبط');
  ok(sql(`select count(*) from auth.users where id = '${uidL}'`) === '0' && sql(`select count(*) from qt_profiles where alias = 'ليلى'`) === '0',
    'حذف بيانات حساب Google يحذف الحساب نفسه (البريد والاسم) لا الاسم المستعار وحده');
  ok(await C.evaluate(async () => !(await Store.get('sb:qt-auth')) && !CS.google && S.p.answered === 3), 'وتُمسح جلسته من الجهاز ويبقى التقدم محلياً');
  await C.keyboard.press('Escape');

  // ===== الجهاز 4: مستخدم جديد يختار Google وحده — لا يُطلب منه اسم مستعار =====
  NEXT = { email: 'karim@gmail.com', name: 'Karim Alaoui' };
  FORCE_TAKEN = 1;                                   // أول اسم مولَّد «مأخوذ» عند غيره: يُجرَّب غيره آلياً دون أي سؤال
  const D = await device(browser, 'D');
  await D.goto(APP_URL); await D.waitForSelector('#gsign:not(.hidden)');
  await D.click('#gsign');
  ok(await acceptTerms(D), 'مستخدم Google جديد: البنود والشروط بعد التسجيل وقبل الدخول');
  await D.waitForSelector('#lobby:not(.hidden)', { timeout: 15000 }).catch(() => null);
  const kAlias = await D.evaluate(() => S.user && S.user.alias);
  ok(/^طالب \d{4}$/.test(kAlias || '') && await D.isHidden('#login'), `Google وحده يكفي: دخول مباشر دون اسم مستعار («${kAlias}»)`);
  await skipOnb(D);
  await D.waitForFunction(() => window.CS && CS.mine === true && CS.google === true, null, { timeout: 12000 }).catch(() => null);
  ok(TAKEN_SEEN.length === 1 && TAKEN_SEEN[0] !== kAlias && !(await D.$('#rci')), 'الاسم المولَّد المأخوذ يُستبدل بغيره آلياً، ولا لوح «الاسم محجوز»');
  const kUid = sql(`select owner from qt_profiles where alias = '${kAlias}'`);
  ok(kUid && sql(`select is_anonymous from auth.users where id = '${kUid}'`) === 'f' && kUid === GOOGLE.get('karim@gmail.com'), 'الاسم الظاهر محجوز بحساب Google نفسه');
  ok(!(await D.$('.sheet .code')), 'لا رمز استرجاع لمن دخل بـ Google');
  ok(!/Karim|Alaoui|karim@/.test(await D.textContent('#lobby')), 'اسمه في Google وبريده لا يظهران في الردهة');
  await sleep(300); await D.screenshot({ path: OUT + '/v6-google-only.png' });
  // جهاز آخر بالحساب نفسه: يعود الاسم نفسه دون سؤال
  const E = await device(browser, 'E');
  await E.goto(APP_URL); await E.waitForSelector('#gsign:not(.hidden)'); await E.click('#gsign');
  await acceptTerms(E);                                // جهاز جديد: البنود قبل الدخول، ثم الاسم نفسه دون أي سؤال عنه
  await E.waitForFunction(a => window.S && S.user && S.user.alias === a, kAlias, { timeout: 15000 }).catch(() => null);
  ok(await E.evaluate(a => !!S.user && S.user.alias === a, kAlias) && sql(`select count(*) from qt_profiles where owner = '${kUid}'`) === '1',
    'هاتف آخر بالحساب نفسه: الاسم نفسه دون سؤال، ولا اسم ثانٍ');

  const html = await B.content();
  ok(!/sk-ant|ANTHROPIC|AQ\.e2e|GEMINI_API_KEY|7YUitA|sb_secret_/.test(html), 'لا مفتاح Gemini ولا سر خادم في الصفحة');
  ok(GEM.length > 10 && GEM.every(g => g.body.store === false && !('temperature' in (g.body.generationConfig || g.body.generation_config || {}))), 'كل الطلبات إلى Google دون حفظ لديها (store: false)');
  console.log('\n' + (errs.length ? errs.join('\n') : 'لا أخطاء في الصفحات ولا في وحدة التحكم'));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
