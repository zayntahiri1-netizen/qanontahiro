// دالة «qt-ads» بشيفرتها نفسها: استدعاءات AdMob موقَّعة بمفتاح ECDSA حقيقي (P-256) كما يوقّعها Google،
// ومفاتيح التحقق تُقدَّم بدل gstatic، والقاعدة Postgres المحلي بهجرة v6.
import crypto from 'node:crypto';
import { sql, sqlRaw } from './mock-sb-ai.mjs';
const fails = []; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails.push(m); };
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', QT_ADS_REWARDED_UNITS: 'ca-app-pub-1725525147318224/8197582346' };
let handler; globalThis.Deno = { env: { get: k => ENV[k] }, serve: h => { handler = h; } };

const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const spki = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
let KEYS = { keys: [{ keyId: 3335741209, pem: kp.publicKey.export({ type: 'spki', format: 'pem' }), base64: spki }] };
let keyFetches = 0;
globalThis.fetch = async (url) => {
  if (/gstatic\.com\/admob\/reward\/verifier-keys\.json$/.test(String(url))) { keyFetches++; return new Response(JSON.stringify(KEYS), { status: 200 }); }
  return new Response('not found', { status: 404 });
};
await import('./fn-ads.mts');

const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// يبني الاستدعاء كما يرسله AdMob: المعاملات بالترتيب، ثم signature ثم key_id، والتوقيع على ما قبل «&signature=»
function callback(p, { key = kp.privateKey, keyId = 3335741209, tamper } = {}) {
  const order = ['ad_network', 'ad_unit', 'custom_data', 'reward_amount', 'reward_item', 'timestamp', 'transaction_id', 'user_id'];
  const msg = order.filter(k => p[k] !== undefined).map(k => `${k}=${encodeURIComponent(p[k])}`).join('&');
  const sig = crypto.sign('sha256', Buffer.from(msg), { key, dsaEncoding: 'der' });
  const q = (tamper ? tamper(msg) : msg) + `&signature=${b64url(sig)}&key_id=${keyId}`;
  return q;
}
const get = async q => { const r = await handler(new Request('https://x/functions/v1/qt-ads' + (q ? '?' + q : ''))); return { s: r.status, b: await r.json() }; };
const U1 = sqlRaw(`insert into auth.users(id) values (gen_random_uuid()) returning id`).split('\n').pop();
const base = (tx, extra = {}) => ({ ad_network: '5450213213286189855', ad_unit: '8197582346', custom_data: 'ai', reward_amount: '1',
  reward_item: 'Reward', timestamp: String(Date.now()), transaction_id: tx, user_id: U1, ...extra });
const rows = (w = '') => +sql(`select count(*) from qt_ad_rewards ${w}`).split('\n').pop();

let r = await get('');
ok(r.s === 200 && r.b.service === 'qt-ads', 'فحص الوصول دون معاملات: الدالة حية');
r = await get(callback(base('tx-1')));
ok(r.s === 200 && r.b.grant && r.b.grant.ok && r.b.grant.bonus === 3, 'استدعاء AdMob موقَّع: 3 طلبات إضافية للمستخدم');
ok(rows(`where via = 'ssv' and uid = '${U1}'`) === 1 && keyFetches === 1, 'سُجّلت المكافأة «موثّقة»، والمفاتيح جُلبت مرة واحدة');
r = await get(callback(base('tx-1')));
ok(r.s === 200 && r.b.grant.dup === true && rows() === 1, 'إعادة المحاولة بالمعاملة نفسها لا تُحتسب مرتين');
r = await get(callback(base('tx-2'), { tamper: m => m.replace('reward_amount=1', 'reward_amount=9') }));
ok(r.s === 403 && r.b.error === 'sig' && rows() === 1, 'عبث بمحتوى الاستدعاء بعد توقيعه: يُرفض (403)');
const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
r = await get(callback(base('tx-3'), { key: other.privateKey }));
ok(r.s === 403 && rows() === 1, 'توقيع بمفتاح غير مفتاح Google: يُرفض');
r = await get(callback(base('tx-4'), { keyId: 999 }));
ok(r.s === 403 && r.b.error === 'key', 'رقم مفتاح مجهول: يُرفض دون انهيار');
r = await get('ad_unit=8197582346&transaction_id=x&user_id=' + U1);
ok(r.s === 400, 'استدعاء بلا توقيع: 400');
r = await get(callback({ ad_network: '1', ad_unit: '8197582346', reward_amount: '1', reward_item: 'Reward', timestamp: '1', transaction_id: 'test-ui' }));
ok(r.s === 200 && r.b.ignored === 'user' && rows() === 1, 'استدعاء الاختبار من لوحة AdMob (بلا مستخدم): 200 دون منح');
r = await get(callback(base('tx-5', { ad_unit: '1111111111' })));
ok(r.s === 200 && r.b.ignored === 'unit' && rows() === 1, 'إعلان من وحدة ليست لتطبيقنا: لا يمنح شيئاً');
for (const tx of ['tx-6', 'tx-7']) await get(callback(base(tx)));
r = await get(callback(base('tx-8')));
ok(r.s === 200 && r.b.grant.ok === false && r.b.grant.why === 'limit' && rows(`where uid = '${U1}'`) === 3, 'الحد اليومي: ثلاث مكافآت فقط');
// أطوال r وs في DER تتفاوت (بايت صفر في أولها أو أقصر من 32): مئتا توقيع عشوائي كلها تُقبل
const U2 = sqlRaw(`insert into auth.users(id) values (gen_random_uuid()) returning id`).split('\n').pop();
const mod = await import('./fn-ads.mts');
let good = 0;
for (let i = 0; i < 200; i++) {
  const m = 'ad_network=1&ad_unit=8197582346&transaction_id=v' + i + '&user_id=' + U2 + '&x=' + crypto.randomBytes(6).toString('hex');
  const sig = crypto.sign('sha256', Buffer.from(m), { key: kp.privateKey, dsaEncoding: 'der' });
  const v = await mod.verifyQuery(m + '&signature=' + b64url(sig) + '&key_id=3335741209');
  if (v.ok) good++;
}
ok(good === 200, `تحويل التوقيع من DER سليم في كل الأطوال (${good}/200)`);
ok(mod.derToRaw(new Uint8Array([0x31, 0x02, 0x02, 0x00])) === null, 'توقيع DER مشوَّه يُرفض دون استثناء');

console.log(fails.length ? `\n✗ ${fails.length} فشل` : '\n✓ مكافآت الإعلانات: كل الفحوص نجحت');
process.exit(fails.length ? 1 : 0);
