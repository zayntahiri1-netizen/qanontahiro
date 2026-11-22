// نسخة أندرويد (www/ من tools/cap-web.mjs) في متصفح حقيقي، بـ capacitor.js الحقيقي وبيئة أصلية محاكاة:
// يحاكي هذا الاختبار ما يحقنه Capacitor في WebView (androidBridge وPluginHeaders وnativePromise/nativeCallback)
// ويتحقق من أن الجسر native.js يربط التطبيق بالإضافات الأصلية كما يلزم:
//   • الدخول بـ Google يفتح متصفح النظام (Browser.open) لا WebView، والعودة برابط com.qanontahiro.app://auth-callback
//   • الرابط نفسه إن وصل مرتين لا يُستبدل رمزه إلا مرة، وإقلاع بارد من الرابط (getLaunchUrl) يُدخل المستخدم
//   • لون شريط الحالة يتبع السمة، والإحصاءات الأصلية لا تعمل إلا بعد الموافقة، ورفض Browser.close لا يُسقط شيئاً
//   • والصفحة نفسها في متصفح عادي تبقى تطبيق ويب (لا QT_CAP)
// التشغيل: npm install && python3 build.py && node tools/cap-web.mjs، ثم خادم على www/ (المنفذ 8771) وPostgres كما في e2e_v5.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path'), os = require('os'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.env.QT_SHOTS || path.join(os.tmpdir(), 'qt-shots'); fs.mkdirSync(OUT, { recursive: true });
const PG_HOST = process.env.QT_PG_HOST || '/var/lib/postgresql', PG_PORT = process.env.QT_PG_PORT || '5439';
const URL0 = process.env.QT_NATIVE_URL || 'http://localhost:8771/index.html';
const CB = 'com.qanontahiro.app://auth-callback';
const errs = [];
const ok = (c, m) => { if (!c) { errs.push('FAIL: ' + m); console.log('✗', m); } else console.log('✓', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- القاعدة ---------- */
const PSQL = ['-h', PG_HOST, '-p', PG_PORT, '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'];
const psql = (args, input) => execFileSync('psql', PSQL.concat(args), { encoding: 'utf8', input });
psql(['-f', path.join(ROOT, 'tests', 'sql', 'shim.sql')]);
for (const f of fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => f.endsWith('.sql')).sort())
  psql(['-d', 'qt', '-f', path.join(ROOT, 'supabase', 'migrations', f)]);
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

/* ---------- حزم بديلة (كما في e2e_v5) ---------- */
const MOCK_SB = `window.supabase={createClient(url,key,o){
  const st=o.auth.storage, K=o.auth.storageKey;
  const sess=async()=>{ const raw=await st.getItem(K); return raw?JSON.parse(raw):null; };
  const uid=async()=>{ const s=await sess(); return s&&s.user&&s.user.id||null; };
  const save=async user=>{ const s={ access_token:'t-'+user.id, user }; await st.setItem(K, JSON.stringify(s)); return s; };
  return { auth:{ async getSession(){ return { data:{ session:await sess() }, error:null }; },
      async signInAnonymously(){ const id=await window.__sbSignIn(); const s=await save({ id, is_anonymous:true }); return { data:{ session:s, user:s.user }, error:null }; },
      async signInWithOAuth({options}){ window.__lastRedirect=options.redirectTo; window.__skip=options.skipBrowserRedirect;
        return { data:{ url:'https://zorbawbrcgmchvzdtekq.supabase.co/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(options.redirectTo) }, error:null }; },
      async linkIdentity({options}){ return { data:{ url:'https://zorbawbrcgmchvzdtekq.supabase.co/auth/v1/user/identities/authorize?provider=google' }, error:null }; },
      async exchangeCodeForSession(code){ window.__exchanges=(window.__exchanges||0)+1; const r=await window.__sbExchange(code); if(r.error) return { data:{ session:null }, error:r.error };
        const s=await save(r.user); return { data:{ session:s, user:s.user }, error:null }; },
      async signOut(){ await st.removeItem(K); return { error:null }; } },
    rpc(fn,args){ return (async()=>window.__sbRpc(await uid(), fn, args||{}))(); },
    functions:{ invoke:async()=>({ data:{ ok:true }, error:null }) } };
}};`;
const MOCK_PN = `(function(){ class PubNub{ constructor(c){ this.ls=[]; } addListener(l){ this.ls.push(l); }
  subscribe(){ setTimeout(()=>this.ls.forEach(l=>l.status&&l.status({category:'PNConnectedCategory'})),5); } unsubscribe(){} unsubscribeAll(){}
  publish(){ return Promise.resolve({}); } async hereNow(){ return { totalOccupancy:1 }; } destroy(){} } window.PubNub=PubNub; })();`;
const MOCK_AB = `window.Ably={ Realtime:class{ constructor(){ this.connection={ on(cb){ setTimeout(()=>cb({current:'connected'}),5); }, close(){}, connect(){} };
  this.channels={ get:()=>({ subscribe:async()=>{} }) }; } close(){} } };`;

/* ---------- البيئة الأصلية المحاكاة: ما يحقنه Capacitor في WebView قبل أي سكربت ---------- */
const NATIVE_ENV = (launchUrl) => `(() => {
  window.__calls = []; window.__listeners = {}; window.__launchUrl = ${JSON.stringify(launchUrl || '')};
  window.androidBridge = { postMessage() {} };
  const H = (name, ms) => ({ name, methods: ms.map(([n, r]) => ({ name: n, rtype: r || 'promise' })) });
  window.Capacitor = {
    PluginHeaders: [
      H('App', [['getLaunchUrl'], ['addListener', 'callback'], ['removeListener'], ['exitApp']]),
      H('Browser', [['open'], ['close'], ['addListener', 'callback'], ['removeListener']]),
      H('FirebaseAnalytics', [['setEnabled'], ['logEvent'], ['addListener', 'callback'], ['removeListener']]),
      H('SystemBars', [['setStyle'], ['show'], ['hide'], ['addListener', 'callback'], ['removeListener']]),
    ],
    nativePromise(p, m, o) {
      window.__calls.push([p, m, JSON.parse(JSON.stringify(o || {}))]);
      if (p === 'App' && m === 'getLaunchUrl') return Promise.resolve(window.__launchUrl ? { url: window.__launchUrl } : {});
      if (p === 'Browser' && m === 'close') return Promise.reject(new Error('close is not implemented on android'));
      return Promise.resolve({});
    },
    nativeCallback(p, m, o, cb) {
      window.__calls.push([p, m, JSON.parse(JSON.stringify(o || {}))]);
      if (m === 'addListener') (window.__listeners[p + ':' + o.eventName] = window.__listeners[p + ':' + o.eventName] || []).push(cb);
      return 'cb' + window.__calls.length;
    },
  };
})();`;

/* ---------- Google البديل ---------- */
const GOOGLE = new Map(), CODES = new Map();
const newCode = g => { const code = 'c' + crypto.randomBytes(6).toString('hex'); CODES.set(code, { g }); return code; };
async function setup(ctx) {
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase|unpkg\.com\/@supabase/, r => r.fulfill({ contentType: 'application/javascript', body: MOCK_SB }));
  await ctx.route(/pubnub@8\.10\.0/, r => r.fulfill({ contentType: 'application/javascript', body: MOCK_PN }));
  await ctx.route(/cdn\.ably\.com|npm\/ably@2/, r => r.fulfill({ contentType: 'application/javascript', body: MOCK_AB }));
  await ctx.route(/gstatic\.com\/firebasejs/, r => r.abort());           // في أندرويد لا تُجلب حزمة Firebase للويب أصلاً
  await ctx.exposeBinding('__sbSignIn', () => { const id = crypto.randomUUID(); sql(`insert into auth.users(id) values ('${id}')`); return id; });
  await ctx.exposeBinding('__sbExchange', (src, code) => {
    const c = CODES.get(code); if (!c) return { error: { message: 'invalid code' } }; CODES.delete(code);
    let uid = GOOGLE.get(c.g.email);
    if (!uid) { uid = crypto.randomUUID(); sql(`insert into auth.users(id) values ('${uid}')`); }
    sql(`update auth.users set is_anonymous = false where id = '${uid}'`);   // كما في Supabase: الربط بـ Google يجعل الحساب دائماً
    GOOGLE.set(c.g.email, uid);
    return { user: { id: uid, is_anonymous: false, email: c.g.email, identities: [{ provider: 'google', identity_data: { email: c.g.email, full_name: c.g.name } }] } };
  });
  await ctx.exposeBinding('__sbRpc', (src, uid, fn, args) => rpc(uid, fn, args));
}
async function device(browser, name, native, launchUrl) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-MA', serviceWorkers: 'block' });
  await setup(ctx);
  if (native) await ctx.addInitScript(NATIVE_ENV(launchUrl));
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::|ERR_|gstatic/.test(m.text())) errs.push(name + ' console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  return page;
}
const calls = (page, p, m) => page.evaluate(([p, m]) => window.__calls.filter(c => c[0] === p && (!m || c[1] === m)), [p, m]);
const fire = (page, key, data) => page.evaluate(([k, d]) => (window.__listeners[k] || []).forEach(cb => cb(d)), [key, data]);
const skipOnb = async page => { const b = await page.waitForSelector('#onbs', { timeout: 3000 }).catch(() => null); if (b) await b.click(); };

(async () => {
  const browser = await chromium.launch();

  // ===== 1) الصفحة نفسها في متصفح عادي: تطبيق ويب =====
  const W = await device(browser, 'web', false);
  await W.goto(URL0); await W.waitForSelector('#alias');
  ok(await W.evaluate(() => !!window.capacitorExports && window.Capacitor.getPlatform() === 'web' && window.QT_CAP === undefined),
    'في المتصفح العادي: capacitor.js محمَّل، المنصة web، ولا جسر أصلي');
  await W.waitForSelector('#gsign:not(.hidden)', { timeout: 8000 }).catch(() => null);
  ok(await W.isVisible('#gsign'), 'زر Google ظاهر على الويب أيضاً');

  // ===== 2) أندرويد: الإقلاع والجسر =====
  const A = await device(browser, 'A', true);
  await A.goto(URL0); await A.waitForSelector('#alias');
  ok(await A.evaluate(() => window.Capacitor.getPlatform() === 'android' && window.Capacitor.isNativePlatform() && Object.isFrozen(window.QT_CAP)
    && ['App', 'Browser', 'FirebaseAnalytics', 'SystemBars'].every(k => !!window.QT_CAP[k])), 'أندرويد: QT_CAP بإضافاته الأربع');
  await A.waitForFunction(() => window.__calls.some(c => c[0] === 'App' && c[1] === 'getLaunchUrl'), null, { timeout: 5000 }).catch(() => null);
  ok((await calls(A, 'App', 'addListener')).some(c => c[2].eventName === 'appUrlOpen'), 'التطبيق يستمع لروابط العودة (appUrlOpen)');
  ok((await calls(A, 'App', 'getLaunchUrl')).length === 1, 'ويسأل عن رابط الإقلاع مرة واحدة');
  const st0 = await calls(A, 'SystemBars', 'setStyle');
  ok(st0.length >= 1 && st0[st0.length - 1][2].style === 'DARK', 'شريط الحالة: أيقونات فاتحة على السمة الليلية (DARK)');
  await A.evaluate(() => { S.cfg.theme = 'light'; applyCfg(); });
  const st1 = await calls(A, 'SystemBars', 'setStyle');
  ok(st1[st1.length - 1][2].style === 'LIGHT', 'وعند السمة النهارية: أيقونات داكنة (LIGHT)');
  await A.evaluate(() => { S.cfg.theme = 'dark'; applyCfg(); });

  // ===== 3) الدخول بـ Google: متصفح النظام ثم العودة بالرابط =====
  await A.waitForSelector('#gsign:not(.hidden)', { timeout: 8000 }).catch(() => null);
  const url0 = A.url();
  await A.click('#gsign');
  await A.waitForFunction(() => window.__calls.some(c => c[0] === 'Browser' && c[1] === 'open'), null, { timeout: 8000 }).catch(() => null);
  const opens = await calls(A, 'Browser', 'open');
  ok(opens.length === 1 && /supabase\.co\/auth\/v1\/authorize\?provider=google/.test(opens[0][2].url), 'صفحة Google تُفتح في متصفح النظام (Browser.open)');
  ok(await A.evaluate(() => window.__lastRedirect) === CB && await A.evaluate(() => window.__skip) === true, 'redirectTo = com.qanontahiro.app://auth-callback، دون تحويل الـ WebView');
  ok(A.url() === url0, 'الـ WebView لم يغادر التطبيق');
  const code1 = newCode({ email: 'amine@gmail.com', name: 'Amine Idrissi' });
  await fire(A, 'App:appUrlOpen', { url: CB + '?code=' + code1 });
  await fire(A, 'App:appUrlOpen', { url: CB + '?code=' + code1 });       // الرابط نفسه مرة ثانية
  await A.waitForFunction(() => window.CS && CS.google === true, null, { timeout: 10000 }).catch(() => null);
  ok(await A.evaluate(() => CS.google && CS.email === 'amine@gmail.com'), 'العودة بالرابط: جلسة Google قائمة');
  ok(await A.evaluate(() => window.__exchanges) === 1, 'الرمز يُستبدل مرة واحدة ولو وصل الرابط مرتين');
  ok((await calls(A, 'Browser', 'close')).length === 1, 'يُغلق متصفح النظام بعد العودة (ورفضه لا يُسقط شيئاً)');
  // Google وحده يكفي: لا يُطلب من مستخدم Google جديد اسم مستعار، ويظهر في اللوحة اسم يولّده التطبيق لا اسمه في Google
  await A.waitForFunction(() => window.S && S.user && !document.getElementById('lobby').classList.contains('hidden'), null, { timeout: 12000 }).catch(() => null);
  const gAlias = await A.evaluate(() => S.user && S.user.alias);
  ok(/^طالب \d{4}$/.test(gAlias || '') && await A.isHidden('#login'), `حساب Google جديد: يدخل مباشرة دون أن يُطلب منه اسم مستعار («${gAlias}»)`);
  await skipOnb(A);
  await A.waitForFunction(() => window.CS && CS.mine === true, null, { timeout: 12000 }).catch(() => null);
  const gUid = sql(`select owner from qt_profiles where alias = '${gAlias}'`);
  ok(gUid && sql(`select is_anonymous from auth.users where id = '${gUid}'`) === 'f', 'الاسم الظاهر محجوز بحساب Google نفسه');
  ok(!/Amine|Idrissi|amine@/.test(await A.textContent('#lobby')) && !/Amine|Idrissi/.test(sql(`select string_agg(alias, ',') from qt_profiles`)),
    'اسمه في Google وبريده لا يظهران في الردهة ولا في اللوحة');
  ok(!(await A.$('.sheet .code')), 'لا رمز استرجاع لحساب Google');

  // ===== 4) الإحصاءات الأصلية بموافقة =====
  ok((await calls(A, 'FirebaseAnalytics')).length === 0, 'لا استدعاء للإحصاءات قبل الموافقة');
  await A.evaluate(() => setAna(true));
  await A.waitForFunction(() => window.__calls.some(c => c[0] === 'FirebaseAnalytics' && c[1] === 'logEvent'), null, { timeout: 5000 }).catch(() => null);
  const fa = await calls(A, 'FirebaseAnalytics');
  ok(fa.some(c => c[1] === 'setEnabled' && c[2].enabled === true) && fa.some(c => c[1] === 'logEvent' && c[2].name === 'login'), 'بعد الموافقة: الإضافة الأصلية (setEnabled ثم logEvent)');
  ok(await A.evaluate(() => FA && FA.kind === 'android'), 'نوع الإحصاءات: android (لا حزمة الويب)');
  ok(!JSON.stringify(fa).includes(gAlias), 'لا اسم مستعار في أي حدث');
  await A.evaluate(() => setAna(false));
  ok((await calls(A, 'FirebaseAnalytics', 'setEnabled')).slice(-1)[0][2].enabled === false, 'سحب الموافقة يوقفها');
  await A.screenshot({ path: OUT + '/native-lobby.png' });

  // ===== 5) إقلاع بارد من رابط العودة (أُغلق التطبيق أثناء صفحة Google) =====
  const code2 = newCode({ email: 'amine@gmail.com', name: 'Amine Idrissi' });
  const B = await device(browser, 'B', true, CB + '?code=' + code2);
  await B.goto(URL0);
  await B.waitForFunction(a => window.S && S.user && S.user.alias === a, gAlias, { timeout: 15000 }).catch(() => null);
  ok(await B.evaluate(a => S.user && S.user.alias === a && CS.google, gAlias), 'إقلاع بارد من الرابط على هاتف آخر: يدخل بحسابه واسمه نفسه مباشرة');
  await fire(B, 'App:appUrlOpen', { url: CB + '?code=' + code2 });       // وصول متأخر للرابط نفسه
  await sleep(600);
  ok(await B.evaluate(() => window.__exchanges) === 1, 'ولا يُعاد استبدال الرمز عند وصوله ثانية');
  ok(!/gErr|تعذّر/.test(await B.evaluate(() => (document.querySelector('.toast') || {}).textContent || '')), 'ولا رسالة خطأ');

  console.log('\n' + (errs.length ? errs.join('\n') : 'لا أخطاء في الصفحات ولا في وحدة التحكم'));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
