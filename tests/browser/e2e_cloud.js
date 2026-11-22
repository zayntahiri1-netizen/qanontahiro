// اختبار «التوليفة» في متصفح حقيقي: ثلاثة أجهزة، وقاعدة Postgres حقيقية بالهجرة نفسها،
// وبدائل لحزم Supabase وPubNub وAbly وFirebase تمر عبر «خادم» في Node (الشبكة الخارجية محجوبة في بيئة البناء).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path'), os = require('os'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.env.QT_SHOTS || path.join(os.tmpdir(), 'qt-shots'); fs.mkdirSync(OUT, { recursive: true });
const PG_HOST = process.env.QT_PG_HOST || '/var/lib/postgresql', PG_PORT = process.env.QT_PG_PORT || '5439';
const APP_URL = process.env.QT_APP_URL || 'http://localhost:8765/index.html';
const errs = [];
const ok = (c, m) => { if (!c) { errs.push('FAIL: ' + m); console.log('✗', m); } else console.log('✓', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- قاعدة البيانات: Postgres 16 بمحاكاة بيئة Supabase ---------- */
const PSQL = ['-h', PG_HOST, '-p', PG_PORT, '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'];
const psql = (args) => execFileSync('psql', PSQL.concat(args), { encoding: 'utf8' });
psql(['-f', path.join(ROOT, 'tests', 'sql', 'shim.sql')]);
for (const f of fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => f.endsWith('.sql')).sort())
  psql(['-d', 'qt', '-f', path.join(ROOT, 'supabase', 'migrations', f)]);
const sql = q => psql(['-d', 'qt', '-At', '-c', q]).trim();
const dq = s => { const tag = '$q' + crypto.randomBytes(4).toString('hex') + '$'; return tag + s + tag; };
const lit = v => v == null ? 'null' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v)
  : typeof v === 'object' ? dq(JSON.stringify(v)) + '::jsonb' : dq(String(v));
const TABLE = new Set(['qt_board', 'qt_duel_board', 'qt_board_branch']), VOID = new Set(['qt_daily_answer', 'qt_duel_result', 'qt_report']);
const CALLS = [];
function rpc(uid, fn, args) {
  CALLS.push(fn);
  const named = Object.entries(args || {}).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
  const who = uid ? `set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', false);`
                  : `set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);`;
  const body = TABLE.has(fn) ? `select coalesce(jsonb_agg(t), '[]'::jsonb) from public.${fn}(${named}) t;`
             : VOID.has(fn) ? `select public.${fn}(${named}); select 'null';` : `select to_jsonb(public.${fn}(${named}));`;
  try {
    const out = sql(who + body).split('\n').pop();
    return { data: out === '' ? null : JSON.parse(out), error: null };
  } catch (e) { return { data: null, error: { message: String(e.stderr || e.message).split('\n').find(l => /ERROR/.test(l)) || 'sql error' } }; }
}

/* ---------- حزم بديلة تُقدَّم مكان الحزم الحقيقية ---------- */
const MOCK_SB = `window.supabase={createClient(url,key,o){
  const st=o.auth.storage, K=o.auth.storageKey;
  const sess=async()=>{ const raw=await st.getItem(K); return raw?JSON.parse(raw):null; };
  const uid=async()=>{ const s=await sess(); return s&&s.user&&s.user.id||null; };
  return { auth:{ async getSession(){ return { data:{ session:await sess() }, error:null }; },
                  async signInAnonymously(){ const id=await window.__sbSignIn(); const s={ access_token:'t-'+id, user:{ id, is_anonymous:true } };
                    await st.setItem(K, JSON.stringify(s)); return { data:{ session:s, user:s.user }, error:null }; } },
           rpc(fn,args){ return (async()=>window.__sbRpc(await uid(), fn, args||{}))(); },
           functions:{ invoke:async(name,o)=>window.__sbFn(await uid(), name, o&&o.body) } };
}};`;
const MOCK_PN = `(function(){ class PubNub{
  constructor(c){ this.uuid=c.userId; this.ls=[]; this.subs=new Set(); window.__pnInst=this; }
  addListener(l){ this.ls.push(l); }
  subscribe({channels,withPresence}){ const add=channels.filter(c=>!this.subs.has(c)); channels.forEach(c=>this.subs.add(c));
    window.__pnBus('sub', this.uuid, add, null); setTimeout(()=>this.emit('status',{category:'PNConnectedCategory'}),5); }
  unsubscribe({channels}){ channels.forEach(c=>this.subs.delete(c)); window.__pnBus('unsub', this.uuid, channels, null); }
  unsubscribeAll(){ const ch=[...this.subs]; this.subs.clear(); window.__pnBus('unsub', this.uuid, ch, null); }
  publish({channel,message}){ return window.__pnBus('pub', this.uuid, [channel], message); }
  async hereNow({channels}){ const n=await window.__pnBus('here', this.uuid, channels, null); return { totalOccupancy:n, totalChannels:1, channels:{} }; }
  destroy(){ this.unsubscribeAll(); }
  emit(k,e){ this.ls.forEach(l=>l[k]&&l[k](e)); } }
  window.PubNub=PubNub;
  window.__pnDeliver=(k,e)=>{ const p=window.__pnInst; if(p && p.subs.has(e.channel)) p.emit(k,e); };
})();`;
const MOCK_AB = `window.Ably={ Realtime:class{ constructor(o){ this.key=o.key; this.cbs=[]; const s=this; window.__abInst=this;
  this.connection={ on(cb){ setTimeout(()=>cb({current:'connected'}),5); }, close(){}, connect(){} };
  this.channels={ get:(n)=>({ subscribe:async(cb)=>{ s.chan=n; s.cbs.push(cb); } }) }; } close(){} } };
window.__ablyPush=(name,data)=>{ const a=window.__abInst; if(a) a.cbs.forEach(cb=>cb({ name, data })); };`;
const MOCK_FB_APP = `export function initializeApp(c){ const f=(window.__fa=window.__fa||{events:[]}); f.cfg=c; f.app={c}; return f.app; }
export function getApps(){ return window.__fa&&window.__fa.app?[window.__fa.app]:[]; }
export function getApp(){ return window.__fa.app; }`;
const MOCK_FB_AN = `export async function isSupported(){ return true; }
export function getAnalytics(app){ return { app }; }
export function logEvent(a,n,p){ (window.__fa=window.__fa||{events:[]}).events.push([n,p||{}]); }
export function setAnalyticsCollectionEnabled(a,on){ (window.__fa=window.__fa||{events:[]}).enabled=on; }`;

/* ---------- «الخادم»: ناقل PubNub وAbly ودالة qt-pulse ---------- */
const PAGES = new Set(), PN_SUBS = new Map(), PN_PAGE = new Map(), KEYS = { ably: new Set(), pubnub: new Set() };
const occ = ch => (PN_SUBS.get(ch) || new Set()).size;
async function deliver(kind, ev) { for (const p of PAGES) { try { await p.evaluate(([k, e]) => window.__pnDeliver && window.__pnDeliver(k, e), [kind, ev]); } catch (e) {} } }
async function ablyAll(name, data) { for (const p of PAGES) { try { await p.evaluate(([n, d]) => window.__ablyPush && window.__ablyPush(n, d), [name, data]); } catch (e) {} } }
async function setup(ctx) {
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase|unpkg\.com\/@supabase/, r => r.fulfill({ contentType: 'application/javascript', body: MOCK_SB }));
  await ctx.route(/pubnub@8\.10\.0/, r => r.fulfill({ contentType: 'application/javascript', body: MOCK_PN }));
  await ctx.route(/cdn\.ably\.com|npm\/ably@2/, r => r.fulfill({ contentType: 'application/javascript', body: MOCK_AB }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*\/firebase-app\.js/, r => r.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: MOCK_FB_APP }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*\/firebase-analytics\.js/, r => r.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: MOCK_FB_AN }));
  await ctx.exposeBinding('__sbSignIn', () => { const id = crypto.randomUUID(); sql(`insert into auth.users(id) values ('${id}')`); return id; });
  await ctx.exposeBinding('__sbRpc', (src, uid, fn, args) => rpc(uid, fn, args));
  await ctx.exposeBinding('__sbFn', async (src, uid, name, body) => {
    if (name !== 'qt-pulse' || !body || body.type !== 'daily') return { data: null, error: { message: 'bad fn' } };
    const r = rpc(null, 'qt_daily_stats', { p_day: body.day });
    await ablyAll('daily', { day: body.day, n: r.data.n, ok: r.data.ok });
    return { data: { ok: true }, error: null };
  });
  await ctx.exposeBinding('__pnBus', async (src, kind, uuid, channels, msg) => {
    PN_PAGE.set(uuid, src.page);
    if (kind === 'here') return channels.reduce((s, c) => s + occ(c), 0);
    for (const ch of channels) {
      if (kind === 'sub') { if (!PN_SUBS.has(ch)) PN_SUBS.set(ch, new Set()); PN_SUBS.get(ch).add(uuid);
        await deliver('presence', { channel: ch, action: 'join', uuid, occupancy: occ(ch) }); }
      if (kind === 'unsub') { (PN_SUBS.get(ch) || new Set()).delete(uuid);
        await deliver('presence', { channel: ch, action: 'leave', uuid, occupancy: occ(ch) }); }
      if (kind === 'pub') { await deliver('message', { channel: ch, message: msg, publisher: uuid }); return { timetoken: Date.now() }; }
    }
    return null;
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
async function enter(page, alias) {
  await page.goto(APP_URL);
  await page.waitForSelector('#alias');
  await page.fill('#alias', alias);
  await page.click('#enter');
  await page.waitForSelector('#lobby:not(.hidden)');
  await page.waitForSelector('#onbs', { timeout: 4000 });
  await page.click('#onbs');
}
const answerN = async (page, n) => { for (let i = 0; i < n; i++) { await page.click('#opts .opt[data-i="0"]'); await page.click('#go');
  if (await page.$('#verdict .vhead')) { await page.click('#go'); } } };
const toastText = page => page.waitForSelector('.toast', { timeout: 6000 }).then(e => e.textContent()).catch(() => '');

(async () => {
  const browser = await chromium.launch();

  // ===== الجهاز 1: «سلمى» تحجز اسمها =====
  const A = await device(browser, 'A');
  await enter(A, 'سلمى');
  await A.waitForSelector('.sheet .code', { timeout: 12000 });
  const code = (await A.textContent('.sheet .code')).trim();
  ok(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(code), `رمز الاسترجاع يظهر مرة واحدة بصيغة مقروءة (${code})`);
  await sleep(600); await A.screenshot({ path: OUT + '/cloud-recovery.png' });
  await A.click('#rcx');
  const stA = await A.evaluate(() => ({ sb: CS.sb.st, pn: CS.pn.st, ab: CS.ab.st, fb: CS.fb.st, mine: CS.mine }));
  ok(stA.sb === 'ok' && stA.pn === 'ok' && stA.ab === 'ok' && stA.mine, `Supabase وPubNub وAbly تعمل والاسم ملك هذا الجهاز (${JSON.stringify(stA)})`);
  ok(sql(`select count(*) from qt_profiles where alias='سلمى'`) === '1', 'الاسم المستعار محجوز في القاعدة');
  ok(sql(`select secret_hash like '$2%' from qt_profiles where alias='سلمى'`) === 't', 'رمز الاسترجاع مخزن مُعمّى (bcrypt) لا نصاً');

  await A.evaluate(() => openQuiz('labour'));
  await answerN(A, 3);
  await A.click('#qx');
  ok(await A.evaluate(() => cloudPush()), 'المزامنة ترفع التقدم');
  ok(sql(`select answered from qt_progress where alias='سلمى'`) === '3', 'التقدم في القاعدة = 3 أجوبة');

  // ===== الجهاز 2: «يوسف» =====
  const C = await device(browser, 'C');
  await enter(C, 'يوسف');
  await C.waitForSelector('.sheet .code', { timeout: 12000 }); await C.click('#rcx');
  await A.waitForSelector('#hRank .onl', { timeout: 6000 }).catch(() => null);
  ok(/2/.test(await A.textContent('#hRank').catch(() => '')), 'شارة «يتدربون الآن» = 2 عبر حضور PubNub');

  // سؤال اليوم من سلمى ← دالة النبض ← Ably ← يظهر عند يوسف دون أي طلب منه
  const before = await C.evaluate(() => LIVE.daily && LIVE.daily.n || 0);
  await A.evaluate(() => openDaily());
  await A.click('#opts .opt[data-i="0"]'); await A.click('#go');
  await sleep(800);
  await C.waitForFunction(b => LIVE.daily && LIVE.daily.n === b + 1, before, { timeout: 6000 }).catch(() => null);
  const dstC = await C.textContent('#dailyCard .dst').catch(() => '');
  ok(/أجاب 1 اليوم/.test(dstC), `نبض سؤال اليوم يصل حياً إلى جهاز آخر عبر Ably («${dstC}»)`);
  await A.click('#go').catch(() => {}); await A.click('#qx').catch(() => {});
  await C.screenshot({ path: OUT + '/cloud-daily-pulse.png' });

  // ===== تحدٍّ مباشر بين الجهازين =====
  const duel = await A.evaluate(() => makeCode('X', 10));
  await A.evaluate(c => playCode(c), duel);
  await C.evaluate(c => playCode(c), duel);
  await A.waitForSelector('#rivals:not(.hidden) .rv', { timeout: 6000 }).catch(() => null);
  ok(/يوسف/.test(await A.textContent('#rivals').catch(() => '')), 'غرفة التحدي: سلمى ترى يوسف حياً');
  await answerN(C, 3);
  await sleep(500);
  ok(/3\/10/.test(await A.textContent('#rivals').catch(() => '')), 'تقدم المنافس يتحدث سؤالاً بسؤال (3/10)');
  await A.screenshot({ path: OUT + '/cloud-duel-room.png' });
  await answerN(A, 10);
  await A.waitForSelector('.score', { timeout: 6000 });
  await answerN(C, 7);
  await C.waitForSelector('.score', { timeout: 6000 });
  await A.waitForFunction(() => document.querySelectorAll('#dboard tr').length === 2, null, { timeout: 8000 }).catch(() => null);
  ok(await A.$$eval('#dboard tr', r => r.length) === 2, 'ترتيب التحدي يجمع اللاعبين ويتحدث حين ينهي الآخر');
  ok(sql(`select count(*) from qt_duels where code='${duel}'`) === '2', 'نتيجتا التحدي في القاعدة');
  await A.screenshot({ path: OUT + '/cloud-duel-board.png' });
  await A.click('#qx3'); await C.click('#qx3');

  // ===== اللوحة العالمية =====
  await A.evaluate(() => cloudPush()); await C.evaluate(() => cloudPush());
  await A.click('#openBoard');
  await A.waitForSelector('.sheet table', { timeout: 6000 });
  const rows = await A.$$eval('.sheet tbody tr', r => r.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  const pts = rows.map(r => +(r.match(/(\d+)\s*$/) || [0, 0])[1]);
  ok(rows.length === 2 && rows.some(r => /سلمى/.test(r)) && rows.some(r => /يوسف/.test(r)), 'اللوحة العالمية تجمع المستخدمين من القاعدة');
  ok(pts[0] >= pts[1], 'الترتيب تنازلي بالنقاط، والترتيب نفسه لكل المستخدمين');
  ok(/لوحة عالمية/.test(await A.textContent('.sheet')), 'ملاحظة اللوحة العالمية بدل المحلية');
  await A.screenshot({ path: OUT + '/cloud-board.png' });
  await A.keyboard.press('Escape');

  // ===== البلاغ يصل إلى المؤلف =====
  await C.evaluate(() => openQuiz('family'));
  await C.click('#opts .opt[data-i="0"]'); await C.click('#go');
  await C.click('#rep');
  await C.click('.sheet [data-r="2"]');
  await C.fill('#rpn', 'تجربة بلاغ');
  await C.click('#rps');
  ok(/أُرسل البلاغ/.test(await toastText(C)), 'البلاغ أُرسل إلى الخادم');
  ok(sql(`select count(*) from qt_reports where note='تجربة بلاغ'`) === '1', 'البلاغ في جدول البلاغات');
  await C.click('#qx');

  // ===== إعلان حي من المؤلف =====
  await ablyAll('announce', { id: 7, ar: 'نُشر القانون الجديد للمسطرة المدنية.', url: 'https://example.org/x' });
  await A.waitForSelector('#annc:not(.hidden)', { timeout: 4000 }).catch(() => null);
  ok(/للمسطرة المدنية/.test(await A.textContent('#annc').catch(() => '')), 'الإعلان يظهر فوراً في الردهة');
  await A.click('#annc .x');
  ok(await A.evaluate(() => S.cfg.annSeen === '7' && document.querySelector('#annc').classList.contains('hidden')), 'إغلاق الإعلان يُحفظ فلا يعود');

  // ===== الإحصاءات بموافقة =====
  ok(await A.isVisible('#consent'), 'شريط الموافقة على الإحصاءات يظهر في الردهة (لا لوح يقطع العمل)');
  await A.screenshot({ path: OUT + '/cloud-lobby.png' });
  await A.click('#anY');
  await A.waitForFunction(() => window.__fa && window.__fa.events.some(e => e[0] === 'login'), null, { timeout: 6000 }).catch(() => null);
  await A.evaluate(() => openQuiz('commercial'));
  await answerN(A, 1); await A.click('#qx');
  const fa = await A.evaluate(() => window.__fa || { events: [] });
  ok(fa.events.some(e => e[0] === 'login') && fa.events.some(e => e[0] === 'answer'), 'Firebase يستقبل أحداث الدخول والجواب بعد الموافقة');
  ok(!JSON.stringify(fa.events).includes('سلمى'), 'لا اسم مستعار في أي حدث إحصائي');
  ok(fa.cfg && fa.cfg.measurementId === 'G-GFL2SEHLZW', 'إعداد Firebase الصحيح للويب');
  ok(!(await A.isVisible('#consent')), 'الشريط يختفي بعد الاختيار');

  // ===== الجهاز 3: سلمى على هاتف جديد =====
  const B = await device(browser, 'B');
  await enter(B, 'سلمى');
  await B.waitForSelector('#rci', { timeout: 12000 });
  ok(true, 'هاتف جديد بالاسم نفسه: لوح «هذا الاسم محجوز»');
  await B.fill('#rci', 'AAAA-BBBB-CCCC'); await B.click('#rca');
  ok(/غير صحيح/.test(await toastText(B)), 'رمز خاطئ يُرفض');
  await B.fill('#rci', code.toLowerCase()); await B.click('#rca');
  await B.waitForFunction(() => CS.mine === true, null, { timeout: 6000 }).catch(() => null);
  const ansA = +sql(`select answered from qt_progress where alias='سلمى'`);
  ok(await B.evaluate(() => S.p.answered) === ansA && ansA > 0, `نُقل الحساب وتقدمه (${ansA} جواباً) إلى الهاتف الجديد`);
  ok(await A.evaluate(async () => { await cloudPush(true); return CS.mine; }) === false, 'الجهاز القديم يفقد الملكية فلا يكتب فوق التقدم');

  // ===== حذف البيانات من السحابة (حق المستخدم) =====
  await B.evaluate(() => openCloud());
  await B.waitForSelector('#cld', { timeout: 4000 });
  await sleep(600); await B.screenshot({ path: OUT + '/cloud-account.png' });
  await B.click('#cld');
  await sleep(700);
  ok(sql(`select count(*) from qt_profiles where alias='سلمى'`) === '0' && sql(`select count(*) from qt_progress where alias='سلمى'`) === '0',
     'الحذف يمسح الاسم والتقدم من الخادم');
  ok(await B.evaluate(() => S.cfg.noCloud === true && S.p.answered > 0), 'المزامنة تتوقف ويبقى التقدم على الجهاز');

  // ===== الأمان في المتصفح: لا سر في الصفحة =====
  const html = await B.content();
  ok(!/7YUitA|sb_secret_|service_role/.test(html), 'لا مفتاح Ably الجذر ولا سر خادم في الصفحة');
  ok(CALLS.includes('qt_claim') && CALLS.includes('qt_adopt') && CALLS.includes('qt_forget'), 'مسار الهوية كاملاً عبر الدوال: حجز ونقل وحذف');

  console.log('\n' + (errs.length ? errs.join('\n') : 'لا أخطاء في الصفحات ولا في وحدة التحكم'));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
