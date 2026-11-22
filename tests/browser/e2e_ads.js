// الإعلانات في نسخة أندرويد (www/ من tools/cap-web.mjs) بـ capacitor.js الحقيقي ومحاكٍ لإضافة AdMob الأصلية:
//   • الموافقة (UMP) قبل التهيئة، ولا طلب إعلان قبلها؛ ونموذج الموافقة حيث يلزم، وخيارات الخصوصية من «المزيد ← الإعلانات»
//   • النسخة غير الموقَّعة بإعلانات Google التجريبية، والموقَّعة بوحدات التطبيق الحقيقية
//   • الشريط في الردهة وحدها ومكانه محجوز، ويختفي فوق النوافذ والجلسات؛ ولا يظهر أبداً فوق سؤال
//   • الإعلان البيني بعد جلسة مكتملة فقط: لا في اليوم الأول ولا في الدقائق الأولى، وبحد أدنى للأجوبة وفاصل بين إعلانين
//   • المكافأة: +3 طلبات لـ«المساعد» بتحقق الخادم (SSV) أو بمطالبة التطبيق قبل ضبطه، وساعة دون إعلانات
//   • شاشة الفتح لمن غاب ساعة فأكثر فقط، ولا تتكدس فوق إعلان آخر، ولا تظهر فوق جلسة قائمة
//   • ونسخة الويب بلا أي إعلان
// التشغيل كما في e2e_native.js (www/ على المنفذ 8771، والتطبيق على الويب على 8765 لفحص الويب).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path'), os = require('os'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.env.QT_SHOTS || path.join(os.tmpdir(), 'qt-shots'); fs.mkdirSync(OUT, { recursive: true });
const PG_HOST = process.env.QT_PG_HOST || '/var/lib/postgresql', PG_PORT = process.env.QT_PG_PORT || '5439';
const URL0 = process.env.QT_NATIVE_URL || 'http://localhost:8771/index.html';
const WEB = process.env.QT_WEB_URL || 'http://localhost:8765/index.html';
const CLOUD = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'cloud.json'), 'utf8'));
const DEMO = { banner: 'ca-app-pub-3940256099942544/9214589741', interstitial: 'ca-app-pub-3940256099942544/1033173712',
               rewarded: 'ca-app-pub-3940256099942544/5224354917', appOpen: 'ca-app-pub-3940256099942544/9257395921' };
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
// «المساعد» البديل: الرصيد من القاعدة نفسها (الحد 12 + مكافأة اليوم)
function aiReply(uid, body) {
  const left = +sql(`select public.qt_ai_left('${uid}', 12)`), ad = JSON.parse(sql(`select public.qt_ad_today('${uid}')`));
  const base = { left, cap: 12 + ad.bonus, google: false, capGoogle: 40, ads: { left: ad.left, per: ad.per, max: ad.max, ssv: ad.ssv } };
  if (body.kind === 'quota') return { ok: true, kind: 'quota', ready: true, ...base };
  return left > 0 ? { ok: true, kind: body.kind, data: { title: 'شرح', options: [] }, ...base } : { ok: false, error: 'quota', ...base };
}

/* ---------- حزم بديلة ---------- */
const MOCK_SB = `window.supabase={createClient(url,key,o){
  const st=o.auth.storage, K=o.auth.storageKey;
  const sess=async()=>{ const raw=await st.getItem(K); return raw?JSON.parse(raw):null; };
  const uid=async()=>{ const s=await sess(); return s&&s.user&&s.user.id||null; };
  const save=async user=>{ const s={ access_token:'t-'+user.id, user }; await st.setItem(K, JSON.stringify(s)); return s; };
  return { auth:{ async getSession(){ return { data:{ session:await sess() }, error:null }; },
      async signInAnonymously(){ const id=await window.__sbSignIn(); const s=await save({ id, is_anonymous:true }); return { data:{ session:s, user:s.user }, error:null }; },
      async signOut(){ await st.removeItem(K); return { error:null }; } },
    rpc(fn,args){ return (async()=>{ (window.__rpcs=window.__rpcs||[]).push(fn); return window.__sbRpc(await uid(), fn, args||{}); })(); },
    functions:{ invoke:async(name,o)=>{ if(name==='qt-ai'){ return { data: await window.__ai(await uid(), (o&&o.body)||{}), error:null }; } return { data:{ ok:true }, error:null }; } } };
}};`;
const MOCK_PN = `(function(){ class PubNub{ constructor(c){ this.ls=[]; } addListener(l){ this.ls.push(l); }
  subscribe(){ setTimeout(()=>this.ls.forEach(l=>l.status&&l.status({category:'PNConnectedCategory'})),5); } unsubscribe(){} unsubscribeAll(){}
  publish(){ return Promise.resolve({}); } async hereNow(){ return { totalOccupancy:1 }; } destroy(){} } window.PubNub=PubNub; })();`;
const MOCK_AB = `window.Ably={ Realtime:class{ constructor(){ this.connection={ on(cb){ setTimeout(()=>cb({current:'connected'}),5); }, close(){}, connect(){} };
  this.channels={ get:()=>({ subscribe:async()=>{} }) }; } close(){} } };`;

/* ---------- البيئة الأصلية ومحاكي AdMob ---------- */
// consent: 'none' (المغرب: لا يلزم)، 'eea' (نموذج الموافقة يلزم)، 'fail' (دون اتصال أول مرة)
const NATIVE_ENV = (consent) => `(() => {
  window.__calls = []; window.__listeners = {}; window.__bannerLog = [];
  const AD = window.__ad = { consent: ${JSON.stringify(consent)}, banner: 'none', inter: false, open: false, reward: null, full: null, consentTries: 0 };
  window.androidBridge = { postMessage() {} };
  const H = (name, ms) => ({ name, methods: ms.map(([n, r]) => ({ name: n, rtype: r || 'promise' })) });
  const emit = (ev, data) => (window.__listeners['AdMob:' + ev] || []).forEach(cb => cb(data || {}));
  window.__adEmit = emit;
  const fake = on => { let d = document.getElementById('fakeBanner');
    if (!d && document.body) { d = document.createElement('div'); d.id = 'fakeBanner';
      d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:62px;z-index:99999;background:repeating-linear-gradient(45deg,#2b3a44,#2b3a44 8px,#34474f 8px,#34474f 16px);color:#cfd8dc;font:12px system-ui;display:flex;align-items:center;justify-content:center';
      d.textContent = 'إعلان AdMob تجريبي (شريط أصلي)'; document.body.appendChild(d); }
    if (d) d.style.display = on ? 'flex' : 'none'; };
  const log = st => { AD.banner = st; fake(st === 'shown');
    const q = document.getElementById('quiz'), sh = document.getElementById('sheets');
    window.__bannerLog.push({ st, quiz: !!(q && !q.classList.contains('hidden')), sheets: sh ? sh.children.length : 0 }); };
  const ADMOB = {
    requestConsentInfo() { AD.consentTries++;
      if (AD.consent === 'fail' && AD.consentTries === 1) return Promise.reject(new Error('offline'));
      if (AD.consent === 'eea') return Promise.resolve({ status: AD.eeaDone ? 'OBTAINED' : 'REQUIRED', isConsentFormAvailable: true, canRequestAds: !!AD.eeaDone, privacyOptionsRequirementStatus: 'REQUIRED' });
      return Promise.resolve({ status: 'NOT_REQUIRED', isConsentFormAvailable: false, canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' }); },
    showConsentForm() { AD.eeaDone = true; return Promise.resolve({ status: 'OBTAINED', canRequestAds: true, privacyOptionsRequirementStatus: 'REQUIRED' }); },
    showPrivacyOptionsForm() { return Promise.resolve({}); },
    initialize() { return Promise.resolve({}); },
    showBanner() { log('shown'); setTimeout(() => { emit('bannerAdLoaded'); emit('bannerAdSizeChanged', { width: 390, height: 62 }); }, 20); return Promise.resolve({}); },
    hideBanner() { log('hidden'); emit('bannerAdSizeChanged', { width: 0, height: 0 }); return Promise.resolve({}); },
    resumeBanner() { log('shown'); emit('bannerAdSizeChanged', { width: 390, height: 62 }); return Promise.resolve({}); },
    removeBanner() { log('none'); emit('bannerAdSizeChanged', { width: 0, height: 0 }); return Promise.resolve({}); },
    prepareInterstitial(o) { AD.inter = true; setTimeout(() => emit('interstitialAdLoaded', { adUnitId: o.adId }), 10); return Promise.resolve({ adUnitId: o.adId }); },
    showInterstitial() { if (!AD.inter) return Promise.reject(new Error('not ready')); AD.inter = false; AD.full = 'inter'; emit('interstitialAdShowed'); return Promise.resolve({}); },
    prepareRewardVideoAd(o) { AD.reward = o; setTimeout(() => emit('onRewardedVideoAdLoaded', { adUnitId: o.adId }), 10); return Promise.resolve({ adUnitId: o.adId }); },
    showRewardVideoAd() { AD.full = 'reward'; emit('onRewardedVideoAdShowed'); return new Promise(res => { window.__rewardRes = res; }); },
    loadAppOpen(o) { AD.open = true; setTimeout(() => emit('appOpenAdLoaded', { adUnitId: o.adId }), 10); return Promise.resolve({ adUnitId: o.adId }); },
    isAppOpenLoaded() { return Promise.resolve({ value: !!AD.open }); },
    showAppOpen() { AD.open = false; AD.full = 'open'; emit('appOpenAdOpened'); return Promise.resolve({}); },
  };
  window.__adReward = () => { emit('onRewardedVideoAdReward', { type: 'Reward', amount: 1 }); if (window.__rewardRes) window.__rewardRes({ type: 'Reward', amount: 1 }); };
  window.__adDismiss = () => { const k = AD.full; AD.full = null;
    emit({ inter: 'interstitialAdDismissed', reward: 'onRewardedVideoAdDismissed', open: 'appOpenAdClosed' }[k] || 'x'); };
  window.Capacitor = {
    PluginHeaders: [
      H('App', [['getLaunchUrl'], ['addListener', 'callback'], ['removeListener'], ['exitApp']]),
      H('Browser', [['open'], ['close'], ['addListener', 'callback'], ['removeListener']]),
      H('FirebaseAnalytics', [['setEnabled'], ['logEvent'], ['addListener', 'callback'], ['removeListener']]),
      H('SystemBars', [['setStyle'], ['addListener', 'callback'], ['removeListener']]),
      H('AdMob', Object.keys(ADMOB).map(n => [n]).concat([['addListener', 'callback'], ['removeListener']])),
    ],
    nativePromise(p, m, o) {
      window.__calls.push([p, m, JSON.parse(JSON.stringify(o || {})), Date.now()]);
      if (p === 'AdMob' && ADMOB[m]) return ADMOB[m](o || {});
      if (p === 'App' && m === 'getLaunchUrl') return Promise.resolve({});
      return Promise.resolve({});
    },
    nativeCallback(p, m, o, cb) {
      window.__calls.push([p, m, JSON.parse(JSON.stringify(o || {})), Date.now()]);
      if (m === 'addListener') (window.__listeners[p + ':' + o.eventName] = window.__listeners[p + ':' + o.eventName] || []).push(cb);
      return 'cb' + window.__calls.length;
    },
  };
})();`;

async function setup(ctx, live) {
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase|unpkg\.com\/@supabase/, r => r.fulfill({ contentType: 'application/javascript', body: MOCK_SB }));
  await ctx.route(/pubnub@8\.10\.0/, r => r.fulfill({ contentType: 'application/javascript', body: MOCK_PN }));
  await ctx.route(/cdn\.ably\.com|npm\/ably@2/, r => r.fulfill({ contentType: 'application/javascript', body: MOCK_AB }));
  await ctx.route(/gstatic\.com\/firebasejs/, r => r.abort());
  if (live) await ctx.route(/\/native\.js$/, async r => { const res = await r.fetch(); const b = (await res.text()).replace('window.QT_ADS_MODE="test";', 'window.QT_ADS_MODE="live";'); r.fulfill({ response: res, body: b }); });
  await ctx.exposeBinding('__sbSignIn', () => { const id = crypto.randomUUID(); sql(`insert into auth.users(id) values ('${id}')`); return id; });
  await ctx.exposeBinding('__sbRpc', (src, uid, fn, args) => rpc(uid, fn, args));
  await ctx.exposeBinding('__ai', (src, uid, body) => aiReply(uid, body));
}
async function device(browser, name, consent, { live = false, url = URL0, native = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: +(process.env.QT_SHOT_SCALE || 1), locale: 'ar-MA', serviceWorkers: 'block' });
  await setup(ctx, live);
  if (native) await ctx.addInitScript(NATIVE_ENV(consent));
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::|ERR_|gstatic/.test(m.text())) errs.push(name + ' console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(url); await page.waitForSelector('#alias');
  return page;
}
const ad = (page, m) => page.evaluate(m => window.__calls.filter(c => c[0] === 'AdMob' && (!m || c[1] === m)), m);
const idx = (list, m) => list.findIndex(c => c[1] === m);
const adh = page => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--adh').trim());
const fire = (page, key, data) => page.evaluate(([k, d]) => (window.__listeners[k] || []).forEach(cb => cb(d)), [key, data]);
async function enter(page, alias, { cloud = true } = {}) {
  await page.fill('#alias', alias); await page.click('#enter');
  const b = await page.waitForSelector('#onbs', { timeout: 3000 }).catch(() => null); if (b) await b.click();
  if (!cloud) return sleep(400);
  await page.waitForFunction(() => window.CS && CS.auth && CS.uid, null, { timeout: 12000 }).catch(() => null);
  // حساب جديد دون Google: لوح «رمز الاسترجاع» (والشريط مخفي ما دام مفتوحاً)
  await page.waitForSelector('.sheet .code', { timeout: 12000 }); await page.click('#rcx');
  await sleep(400);
}
const until = (page, fn, arg, ms = 6000) => page.waitForFunction(fn, arg, { timeout: ms }).catch(() => null);

(async () => {
  const browser = await chromium.launch();

  // ===== 1) المغرب (لا يلزم نموذج موافقة)، نسخة غير موقَّعة: إعلانات تجريبية =====
  const N = await device(browser, 'N', 'none');
  await until(N, () => window.ADS && ADS.ready);
  let L = await ad(N);
  ok(idx(L, 'requestConsentInfo') >= 0 && idx(L, 'initialize') > idx(L, 'requestConsentInfo') && L.slice(0, idx(L, 'initialize')).every(c => /^(requestConsentInfo|addListener)$/.test(c[1])),
    'الموافقة أولاً، ولا طلب إعلان قبل التهيئة');
  const init = L.find(c => c[1] === 'initialize')[2];
  ok(init.maxAdContentRating === 'ParentalGuidance' && init.tagForChildDirectedTreatment === false && init.initializeForTesting === true, 'التهيئة: محتوى إعلاني لائق (PG)، ووضع الاختبار في النسخة غير الموقَّعة');
  ok(!(await ad(N, 'showBanner')).length, 'لا شريط على شاشة الدخول');
  await enter(N, 'إعلان');
  await until(N, () => window.__ad.banner === 'shown');
  const sb = (await ad(N, 'showBanner'))[0];
  ok(sb && sb[2].adId === DEMO.banner && sb[2].isTesting === true && sb[2].adSize === 'ADAPTIVE_BANNER' && sb[2].position === 'BOTTOM_CENTER',
    'الشريط في الردهة: متكيّف أسفل الشاشة، بوحدة Google التجريبية');
  await until(N, () => getComputedStyle(document.documentElement).getPropertyValue('--adh').trim() === '62px');
  ok(await adh(N) === '62px' && await N.evaluate(() => getComputedStyle(document.getElementById('lobby')).paddingBottom) === '62px', 'مكان الشريط محجوز أسفل الردهة فلا يغطي محتوى');
  ok((await ad(N, 'prepareInterstitial'))[0][2].adId === DEMO.interstitial && (await ad(N, 'loadAppOpen'))[0][2].adId === DEMO.appOpen, 'البيني وشاشة الفتح يُحضَّران بوحدات تجريبية');
  await N.screenshot({ path: OUT + '/ads-lobby.png' });

  // النوافذ والجلسات: الشريط يختفي والمكان يبقى محجوزاً (لا اهتزاز)
  await N.click('#openMore'); await until(N, () => window.__ad.banner === 'hidden');
  ok(await N.evaluate(() => window.__ad.banner) === 'hidden' && await adh(N) === '62px', 'نافذة فوق الردهة: الشريط يختفي والمكان يبقى');
  ok(await N.isVisible('.sheet [data-k="ads"]'), '«الإعلانات» في قائمة «المزيد»');
  await N.evaluate(() => document.querySelectorAll('.sheet').forEach(s => s.remove()));
  await until(N, () => window.__ad.banner === 'shown');
  ok(await N.evaluate(() => window.__ad.banner) === 'shown' && (await ad(N, 'resumeBanner')).length >= 1, 'إغلاق النافذة: يعود الشريط نفسه دون طلب جديد');
  await N.evaluate(() => openQuiz('mixed')); await until(N, () => window.__ad.banner === 'hidden');
  ok(await N.evaluate(() => !document.getElementById('quiz').classList.contains('hidden') && window.__ad.banner === 'hidden'), 'جلسة أسئلة: لا شريط فوق السؤال');

  // نهاية الجلسة تمر بالإعلان البيني (والجلسة الفارغة لا تؤهله)
  await N.evaluate(() => { window.__breaks = []; const o = window.adsBreak; window.adsBreak = s => { window.__breaks.push((s.answers || []).length); return o(s); }; });
  await N.evaluate(() => { S.sess.i = S.sess.queue.length; serve(); });
  await sleep(800);
  ok(await N.evaluate(() => window.__breaks.length === 1) && !(await ad(N, 'showInterstitial')).length, 'نهاية جلسة التدرب تمر بقرار الإعلان البيني، وجلسة بلا أجوبة لا تؤهله');
  await N.evaluate(() => { const q = BANK.questions[0]; startSess({ bid: 'exam', mode: 'exam', queue: [q] }); S.sess.i = 1; serve(); });
  await N.waitForSelector('#quiz #qx'); await N.click('#quiz #qx'); await sleep(300);
  ok(await N.evaluate(() => window.__breaks.length === 2), 'وإغلاق نتيجة الامتحان كذلك');

  // سياسة البيني
  const six = '{ answers: [{},{},{},{},{},{}] }';
  ok(await N.evaluate(`adsBreak(${six})`) === false, 'اليوم الأول: لا إعلان بيني');
  await N.evaluate(() => { ADS.st.first = '2020-01-01'; });
  ok(await N.evaluate(`adsBreak(${six})`) === false, 'الدقائق الثلاث الأولى بعد الفتح: لا إعلان بيني');
  await N.evaluate(() => { ADS.bootAt = Date.now() - 10 * 60e3; });
  ok(await N.evaluate(() => adsBreak({ answers: [{}, {}, {}, { skip: true }, { skip: true }, { skip: true }] })) === false, 'أقل من خمسة أجوبة فعلية: لا إعلان بيني');
  ok(await N.evaluate(`adsBreak(${six})`) === true, 'جلسة مكتملة بعد اليوم الأول: إعلان بيني');
  await until(N, () => window.__ad.full === 'inter', null, 3000);
  ok(await N.evaluate(() => window.__ad.full === 'inter' && window.__ad.banner === 'hidden'), 'البيني يظهر والشريط مخفي تحته');
  await fire(N, 'App:appStateChange', { isActive: false });
  await N.evaluate(() => window.__adDismiss());
  await fire(N, 'App:appStateChange', { isActive: true });
  await until(N, () => window.__ad.banner === 'shown');
  ok(await N.evaluate(() => window.__ad.banner) === 'shown' && !(await ad(N, 'showAppOpen')).length, 'بعد إغلاقه: يعود الشريط، ولا إعلان فتح فوقه (لا تكديس)');
  ok(await N.evaluate(`adsBreak(${six})`) === false, 'فاصل أربع دقائق بين إعلانين');

  // المكافأة: +3 طلبات لـ«المساعد» — أولاً بمطالبة التطبيق (قبل ضبط التحقق في AdMob)
  const uidN = await N.evaluate(() => CS.uid);
  sql(`insert into qt_ai_usage(day, uid, n) values (current_date, '${uidN}', 12) on conflict (day, uid) do update set n = 12`);
  await N.evaluate(() => openAI('ask'));
  await N.waitForSelector('#aiq [data-aiad]', { timeout: 6000 }).catch(() => null);
  ok(await N.isVisible('#aiq [data-aiad]') && /0/.test(await N.textContent('#aiq')), 'نفد الرصيد: يظهر «شاهد إعلاناً: +3 طلبات»');
  await sleep(500); await N.screenshot({ path: OUT + '/ads-ai.png' });
  await N.click('#aiq [data-aiad]');
  await until(N, () => window.__ad.full === 'reward');
  const pr1 = (await ad(N, 'prepareRewardVideoAd')).pop();
  ok(pr1 && pr1[2].adId === DEMO.rewarded && pr1[2].ssv && pr1[2].ssv.userId === uidN && pr1[2].ssv.customData === 'ai', 'إعلان المكافأة يحمل معرّف الحساب للتحقق من جهة الخادم (SSV)');
  await N.evaluate(() => { window.__adReward(); window.__adDismiss(); });
  await until(N, () => AI.cap === 15, null, 16000);
  ok(await N.evaluate(() => AI.cap === 15 && AI.left === 3) && await N.evaluate(() => (window.__rpcs || []).includes('qt_ad_claim')),
    'قبل ضبط التحقق في AdMob: مطالبة التطبيق تمنح 3 طلبات (12 + 3)');
  ok(sql(`select via from qt_ad_rewards where uid = '${uidN}'`) === 'client', 'سُجّلت «بمطالبة التطبيق»');
  await until(N, () => !document.querySelector('#aiq [data-aiad]'), null, 3000);
  ok(/3/.test(await N.textContent('#aiq')), 'سطر الرصيد يتحدث فوراً');
  await N.screenshot({ path: OUT + '/ads-ai-after.png' });

  // ثم بتحقق AdMob نفسه (SSV): يصل الاستدعاء الموقَّع فيظهر الرصيد دون مطالبة
  sql(`update qt_ai_usage set n = 15 where uid = '${uidN}' and day = current_date`);
  await N.evaluate(() => { window.__rpcs = []; document.querySelectorAll('.sheet').forEach(s => s.remove()); ADS.lastFull = 0; });
  await N.evaluate(() => openAI('ask'));
  await N.waitForSelector('#aiq [data-aiad]', { timeout: 6000 }).catch(() => null);
  await N.click('#aiq [data-aiad]');
  await until(N, () => window.__ad.full === 'reward');
  await N.evaluate(() => window.__adReward());
  sql(`select public.qt_ad_grant('admob-tx-e2e', '${uidN}', 'ai', 'ssv')`);
  await N.evaluate(() => window.__adDismiss());
  await until(N, () => AI.cap === 18, null, 8000);
  ok(await N.evaluate(() => AI.cap === 18 && !(window.__rpcs || []).includes('qt_ad_claim')), 'بالتحقق الموقَّع: يظهر الرصيد (18) ولا مطالبة من التطبيق');
  ok(await N.evaluate(() => adsBreak({ answers: [{}, {}, {}, {}, {}, {}] })) === false, 'بعد إعلان مكافأة: لا إعلان بيني قريباً');

  // ساعة دون إعلانات
  await N.evaluate(() => { document.querySelectorAll('.sheet,.toast').forEach(s => s.remove()); openAds(); });
  await N.waitForSelector('.sheet #adfree'); await sleep(700);
  const icon = await N.evaluate(() => { const r = document.querySelector('#adfree svg').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  ok(icon[0] <= 20 && icon[1] <= 20, `أيقونة الزر بحجم السطر (${icon.join('×')})`);
  ok(await N.isVisible('.sheet #adai') && /تجريبية/.test(await N.textContent('.sheet')), 'مركز الإعلانات: القواعد، وساعة دون إعلانات، ورصيد المساعد، ووسم النسخة التجريبية');
  await N.screenshot({ path: OUT + '/ads-center.png' });
  await N.click('.sheet #adfree');
  await until(N, () => window.__ad.full === 'reward');
  const pr2 = (await ad(N, 'prepareRewardVideoAd')).pop();
  ok(pr2 && !pr2[2].ssv, 'مكافأة الساعة لا تُرسل معرّف الحساب (لا شأن للخادم بها)');
  await N.evaluate(() => { window.__adReward(); window.__adDismiss(); });
  await until(N, () => window.__ad.banner === 'none');
  ok(await N.evaluate(() => adsFree() && window.__ad.banner === 'none') && await adh(N) === '0px', 'ساعة دون إعلانات: يُزال الشريط ويُحرَّر مكانه');
  await N.evaluate(() => { ADS.lastFull = ADS.lastReward = 0; });
  ok(await N.evaluate(`adsBreak(${six})`) === false, 'ولا إعلان بيني خلالها');

  // شاشة الفتح
  await N.evaluate(() => { ADS.st.free = 0; ADS.st.open = 0; ADS.lastFull = 0; adsSync(); });
  await until(N, () => window.__ad.banner === 'shown');
  await fire(N, 'App:appStateChange', { isActive: false });
  await fire(N, 'App:appStateChange', { isActive: true }); await sleep(400);
  ok(!(await ad(N, 'showAppOpen')).length, 'غياب قصير (دخول Google، مكالمة): لا إعلان فتح');
  await fire(N, 'App:appStateChange', { isActive: false });
  await N.evaluate(() => { ADS.awayAt = Date.now() - 2 * 3600e3; });
  await fire(N, 'App:appStateChange', { isActive: true });
  await until(N, () => window.__ad.full === 'open', null, 3000);
  ok((await ad(N, 'showAppOpen')).length === 1 && await N.evaluate(() => window.__ad.banner) === 'hidden', 'عودة بعد ساعتين: إعلان فتح واحد، والشريط تحته مخفي');
  await N.evaluate(() => window.__adDismiss()); await sleep(300);
  await fire(N, 'App:appStateChange', { isActive: false });
  await N.evaluate(() => { ADS.awayAt = Date.now() - 2 * 3600e3; });
  await fire(N, 'App:appStateChange', { isActive: true }); await sleep(400);
  ok((await ad(N, 'showAppOpen')).length === 1, 'ولا يتكرر قبل أربع ساعات');
  await N.evaluate(() => { ADS.st.open = 0; openQuiz('mixed'); });
  await fire(N, 'App:appStateChange', { isActive: false });
  await N.evaluate(() => { ADS.awayAt = Date.now() - 2 * 3600e3; });
  await fire(N, 'App:appStateChange', { isActive: true }); await sleep(400);
  ok((await ad(N, 'showAppOpen')).length === 1, 'ولا يظهر فوق جلسة أسئلة قائمة');
  const bad = await N.evaluate(() => window.__bannerLog.filter(x => x.st === 'shown' && (x.quiz || x.sheets)));
  ok(bad.length === 0, `الشريط لم يظهر قط فوق سؤال أو نافذة (${await N.evaluate(() => window.__bannerLog.length)} تغييراً مسجلاً)`);

  // ===== 2) أوروبا: نموذج الموافقة قبل أي إعلان، وخيارات الخصوصية متاحة =====
  const E = await device(browser, 'E', 'eea');
  await until(E, () => window.ADS && ADS.ready);
  L = await ad(E);
  ok(idx(L, 'showConsentForm') > idx(L, 'requestConsentInfo') && idx(L, 'initialize') > idx(L, 'showConsentForm'), 'أوروبا: نموذج الموافقة ثم التهيئة');
  await enter(E, 'أوروبي');
  await E.evaluate(() => openAds()); await E.waitForSelector('.sheet #adpriv');
  await E.click('.sheet #adpriv'); await sleep(300);
  ok((await ad(E, 'showPrivacyOptionsForm')).length === 1, 'خيارات الخصوصية للإعلانات تفتح نموذج Google');

  // ===== 3) دون اتصال عند الإقلاع: لا إعلان، ثم يعاد المحاولة عند العودة إلى التطبيق =====
  const F = await device(browser, 'F', 'fail');
  await sleep(600);
  ok(!(await ad(F, 'initialize')).length && await F.evaluate(() => ADS.bootFailed === true), 'تعذّرت الموافقة: لا تهيئة ولا إعلان');
  await fire(F, 'App:appStateChange', { isActive: false }); await fire(F, 'App:appStateChange', { isActive: true });
  await until(F, () => ADS.ready, null, 5000);
  ok((await ad(F, 'initialize')).length === 1, 'عند العودة إلى التطبيق تُعاد المحاولة فتنجح');

  // ===== 4) النسخة الموقَّعة: وحدات التطبيق الحقيقية =====
  const V = await device(browser, 'V', 'none', { live: true });
  await until(V, () => window.ADS && ADS.ready);
  await enter(V, 'حقيقي');
  await until(V, () => window.__ad.banner === 'shown');
  const sbV = (await ad(V, 'showBanner'))[0], inV = (await ad(V, 'initialize'))[0];
  ok(sbV && sbV[2].adId === CLOUD.admob.banner && sbV[2].isTesting === false && inV[2].initializeForTesting === false
     && (await ad(V, 'prepareInterstitial'))[0][2].adId === CLOUD.admob.interstitial, 'النسخة الموقَّعة: وحدات التطبيق الحقيقية دون وضع الاختبار');

  // ===== 5) نسخة الويب: لا إعلانات أبداً =====
  const W = await device(browser, 'W', 'none', { native: false, url: WEB });
  await enter(W, 'ويب');
  ok(await W.evaluate(() => !window.QT_CAP && ADS.on === false && ADS.ready === false) && await adh(W) === '', 'نسخة الويب: لا إضافة ولا إعلان');
  await W.click('#openMore');
  ok(!(await W.$('.sheet [data-k="ads"]')), 'ولا «إعلانات» في قائمتها');

  console.log('\n' + (errs.length ? errs.join('\n') : 'لا أخطاء في الصفحات ولا في وحدة التحكم'));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
