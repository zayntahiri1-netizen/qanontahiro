#!/usr/bin/env node
// =========================================================================
// قانون تاهيرو — نشر الخادم السحابي من الهاتف (Termux) أو أي حاسوب، بلا Supabase CLI.
// يعمل بـ Node 18+ وحده عبر واجهة Supabase الإدارية:
//   1) القاعدة: الهجرات بالترتيب، ولا يُعاد تطبيق ما سُجّل منها (supabase_migrations.schema_migrations، كما يفعل Supabase CLI)
//   2) المصادقة: الدخول المجهول، والربط اليدوي للهويات، ومزوّد Google، وعناوين العودة للويب ولتطبيق أندرويد
//   3) أسرار الخادم: ABLY_ROOT_KEY و QT_ADMIN_SECRET و ANTHROPIC_API_KEY وحصص المساعد (لا تُكتب في أي ملف يصل إلى العميل)
//   4) الدوال: qt-pulse (النبض) و qt-ai (المساعد) و qt-ads (التحقق من مكافآت AdMob من جهة الخادم)
//   5) قاعدة معرفة المساعد: بنك الأسئلة المبني (dist/app/questions.json) يُحمَّل إلى qt_kb
//   5ب) مكتبة القوانين: نصوص المواد (data/corpus/) تُحمَّل إلى qt_laws وqt_law_articles، ولا يُعاد التحميل إن لم تتغير
//   6) فحوص حية: اللوحة، والدالتان، وAbly، وحضور PubNub، وجلسة مجهولة تسأل المساعد سؤالاً حقيقياً من المكتبة
//
//   node tools/deploy-cloud.mjs
// المتغيرات (اختيارية، وإلا سُئلت عنها بإدخال مخفي؛ و«Enter» فارغاً يُبقي القيمة المحفوظة على الخادم):
//   SUPABASE_ACCESS_TOKEN  ABLY_ROOT_KEY  ANTHROPIC_API_KEY  GOOGLE_CLIENT_ID  GOOGLE_CLIENT_SECRET  QT_ADMIN_SECRET
//   QT_AI_CAP_ANON (12)  QT_AI_CAP_GOOGLE (40)  QT_AI_DAILY_BUDGET (3000)
// =========================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'cloud.json'), 'utf8'));
const REF = (CFG.supabase.url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/) || [])[1];
// QT_API و QT_SUPABASE_URL للاختبار المحلي فقط؛ القيم الافتراضية هي خوادم Supabase الحقيقية
const URL0 = (process.env.QT_SUPABASE_URL || CFG.supabase.url).replace(/\/+$/, '');
const API = (process.env.QT_API || 'https://api.supabase.com') + '/v1/projects/' + REF;
const SECRET_FILE = path.join(os.homedir(), '.qanoun-tahiro-admin');
const LEAKED_ROOT = 'bjCE2A.7YUitA';          // اسم المفتاح الذي أُرسل نصاً في المحادثة (الاسم وحده، لا السر)

const say = (...a) => console.log(...a);
const step = (n, t) => say(`\n[${n}] ${t}`);
const fail = m => { console.error('\n✗ ' + m); if (RL) RL.close(); process.exit(1); };
if (!REF) fail('تعذّر استخراج معرّف مشروع Supabase من config/cloud.json');
if (typeof fetch !== 'function' || typeof FormData !== 'function') fail('يلزم Node 18 أو أحدث (pkg install nodejs-lts)');

// واجهة قراءة واحدة طوال التشغيل: الإدخال المخفي في الطرفية، ونهاية الإدخال تُعاد نصاً فارغاً فتظهر رسالة واضحة لا خروج صامت
let RL = null;
function ask(q, hidden = false) {
  return new Promise(res => {
    if (!RL) {
      RL = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
      RL.on('close', () => { RL.closed = true; });
    }
    if (RL.closed) return res('');
    const tty = !!process.stdin.isTTY;
    RL._writeToOutput = hidden && tty ? s => { RL.output.write(s.includes(q) ? q : s.replace(/[^\r\n]/g, '•')); } : s => RL.output.write(s);
    const onClose = () => res('');
    RL.once('close', onClose);
    RL.question(q, a => { RL.removeListener('close', onClose); if (hidden && tty) process.stdout.write('\n'); res(a.trim()); });
  });
}
async function call(method, url, { token, json, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const r = await fetch(url, { method, headers: h, body });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data, text };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
// الفحوص الحية لا تُسقط النشر إن انقطعت الشبكة: تُبلغ فقط
const probe = (...a) => call(...a).catch(e => ({ ok: false, status: 0, data: (e && e.cause && e.cause.code) || (e && e.message) || 'network' }));
const short = v => (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 300);

const sqlq = (token, query) => call('POST', API + '/database/query', { token, json: { query } });
const NATIVE_CB = 'com.qanontahiro.app://auth-callback';

(async () => {
  say('قانون تاهيرو — نشر الخادم السحابي');
  say('المشروع: ' + REF);

  // ---------- المفاتيح ----------
  let token = process.env.SUPABASE_ACCESS_TOKEN || '';
  if (!token) {
    say('\nرمز الوصول الشخصي لـ Supabase: أنشئه من https://supabase.com/dashboard/account/tokens (يبدأ بـ sbp_)');
    token = await ask('SUPABASE_ACCESS_TOKEN: ', true);
  }
  if (!/^sbp_[A-Za-z0-9_]+$/.test(token)) fail('رمز الوصول يجب أن يبدأ بـ sbp_');

  step(0, 'التحقق من الوصول إلى المشروع');
  const pj = await call('GET', API, { token });
  if (!pj.ok) fail(`تعذّر الوصول إلى المشروع (${pj.status}): ${short(pj.data)}`);
  say(`  ✓ ${pj.data.name || REF} · ${pj.data.region || ''} · ${pj.data.status || ''}`);
  const sl = await call('GET', API + '/secrets', { token });
  const have = new Set(sl.ok && Array.isArray(sl.data) ? sl.data.map(x => x.name) : []);

  let ably = process.env.ABLY_ROOT_KEY || '';
  if (!ably) {
    say('\nمفتاح Ably الجذر (Root) بعد تدويره: لوحة Ably ← التطبيق ← API Keys ← Root ← Revoke، ثم انسخ المفتاح الجديد.'
      + (have.has('ABLY_ROOT_KEY') ? '\n(اضغط Enter وحده لإبقاء المفتاح المحفوظ على الخادم)' : ''));
    ably = await ask('ABLY_ROOT_KEY: ', true);
  }
  if (ably) {
    if (!/^[\w-]+\.[\w-]+:[\w+/=-]+$/.test(ably)) fail('صيغة مفتاح Ably غير صحيحة (appId.keyId:secret)');
    if (ably === CFG.ably.key) fail('هذا مفتاح الاستماع العام؛ المطلوب هنا مفتاح Root السري.');
    if (ably.startsWith(LEAKED_ROOT + ':')) {
      say('\n⚠ هذا هو المفتاح الجذر نفسه الذي أُرسل نصاً في المحادثة. الأسلم تدويره أولاً من لوحة Ably.');
      const go = await ask('المتابعة به رغم ذلك؟ اكتب نعم للمتابعة: ');
      if (!/^(نعم|y|yes)$/i.test(go)) fail('أُوقف النشر. دوّر المفتاح ثم أعد تشغيل الأمر.');
    }
  } else if (!have.has('ABLY_ROOT_KEY')) fail('مفتاح Ably الجذر مطلوب في النشر الأول.');

  let claude = process.env.ANTHROPIC_API_KEY || '';
  if (!claude) {
    say('\nمفتاح Claude لـ«المساعد»: أنشئه من https://platform.claude.com/settings/keys (يبدأ بـ sk-ant-)'
      + (have.has('ANTHROPIC_API_KEY') ? '\n(Enter وحده يُبقي المفتاح المحفوظ)' : '\n(Enter وحده يؤجل تفعيل المساعد)'));
    claude = await ask('ANTHROPIC_API_KEY: ', true);
  }
  if (claude && !/^sk-ant-[\w-]+$/.test(claude)) fail('مفتاح Claude يجب أن يبدأ بـ sk-ant-');

  let gid = process.env.GOOGLE_CLIENT_ID || '', gsec = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!gid) {
    say('\nالدخول بـ Google: معرّف عميل OAuth من نوع «Web application» من Google Cloud (انظر الخطوات في README).'
      + '\n(Enter وحده يُبقي إعداد Google الحالي كما هو)');
    gid = await ask('GOOGLE_CLIENT_ID: ');
    if (gid && !gsec) gsec = await ask('GOOGLE_CLIENT_SECRET: ', true);
  }
  if (gid && !/\.apps\.googleusercontent\.com$/.test(gid)) fail('معرّف عميل Google ينتهي بـ .apps.googleusercontent.com');
  if (gid && !gsec) fail('سر عميل Google مطلوب مع معرّفه.');

  let admin = process.env.QT_ADMIN_SECRET || '';
  if (!admin && fs.existsSync(SECRET_FILE)) admin = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  if (!admin) {
    admin = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(SECRET_FILE, admin + '\n', { mode: 0o600 });
    say(`\nأُنشئ سر المؤلف وحُفظ في ${SECRET_FILE} (للوحة المؤلف على الموقع).`);
  }

  // ---------- 1) القاعدة ----------
  step(1, 'القاعدة: الهجرات بالترتيب');
  const mt = await sqlq(token, `create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);
    select version from supabase_migrations.schema_migrations;`);
  if (!mt.ok) fail(`تعذّر قراءة سجل الهجرات (${mt.status}): ${short(mt.data)}`);
  const applied = new Set((Array.isArray(mt.data) ? mt.data : []).map(r => String(r.version)));
  const migDir = path.join(ROOT, 'supabase', 'migrations');
  for (const f of fs.readdirSync(migDir).filter(f => /^\d+_.+\.sql$/.test(f)).sort()) {
    const [, version, name] = f.match(/^(\d+)_(.+)\.sql$/);
    if (applied.has(version)) { say('  · ' + f + ' (مطبقة من قبل)'); continue; }
    // الهجرة كلها في معاملة واحدة: إن فشل سطر لم يبق منها أثر جزئي
    const q = await sqlq(token, 'begin;\n' + fs.readFileSync(path.join(migDir, f), 'utf8') + '\ncommit;');
    if (!q.ok) fail(`فشل تطبيق ${f} (${q.status}): ${short(q.data)}`);
    const rec = await sqlq(token, `insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name.replace(/'/g, "''")}') on conflict do nothing;`);
    if (!rec.ok) fail(`طُبقت ${f} وتعذّر تسجيلها: ${short(rec.data)}`);
    say('  ✓ ' + f);
  }
  const chk = await sqlq(token, "select count(*)::int as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname like 'qt\\_%'");
  say(`  ✓ ${chk.ok && Array.isArray(chk.data) ? chk.data[0].n : '?'} دالة qt_* في المخطط العام`);
  // حذف حساب Google من داخل التطبيق (qt_forget) يحتاج أن يملك صاحب الدالة حق الحذف من auth.users
  const del = await sqlq(token, "select has_table_privilege(p.proowner, 'auth.users'::regclass, 'DELETE') as ok from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname='qt_forget' limit 1");
  const delOk = del.ok && Array.isArray(del.data) && del.data[0] && (del.data[0].ok === true || del.data[0].ok === 't');
  say(delOk ? '  ✓ حذف الحساب من التطبيق يشمل حساب Google (حق الحذف من auth.users قائم)'
            : '  ⚠ تعذّر التحقق من حق الحذف من auth.users: جرّب «حذف بياناتي من السحابة» بحساب Google تجريبي بعد النشر');

  // ---------- 2) المصادقة ----------
  step(2, 'المصادقة: الاسم المستعار وGoogle وعناوين العودة');
  const cur = await call('GET', API + '/config/auth', { token });
  const allow = new Set(String((cur.ok && cur.data && cur.data.uri_allow_list) || '').split(',').map(x => x.trim()).filter(Boolean));
  const site = String(CFG.site || '').replace(/\/+$/, '');
  for (const u of [site + '/**', NATIVE_CB]) if (u && u !== '/**') allow.add(u);
  const authCfg = { external_anonymous_users_enabled: true, security_manual_linking_enabled: true, uri_allow_list: [...allow].join(','),
                    rate_limit_anonymous_users: Number(process.env.QT_ANON_PER_HOUR || 120) };
  if (site && !(cur.ok && cur.data && cur.data.site_url && !/localhost|127\.0\.0\.1/.test(cur.data.site_url))) authCfg.site_url = site + '/app/';
  if (gid) Object.assign(authCfg, { external_google_enabled: true, external_google_client_id: gid, external_google_secret: gsec });
  const au = await call('PATCH', API + '/config/auth', { token, json: authCfg });
  if (!au.ok) fail(`تعذّر ضبط المصادقة (${au.status}): ${short(au.data)}`);
  say('  ✓ الدخول المجهول، وربط الهويات، وعناوين العودة: ' + [...allow].join('  '));
  say(gid ? '  ✓ مزوّد Google مفعّل' : (cur.ok && cur.data && cur.data.external_google_enabled ? '  · مزوّد Google باقٍ كما هو (مفعّل)' : '  ⚠ مزوّد Google غير مفعّل بعد: أعد الأمر مع GOOGLE_CLIENT_ID'));

  // ---------- 3) الأسرار ----------
  step(3, 'أسرار الخادم');
  const secrets = [{ name: 'QT_ADMIN_SECRET', value: admin },
    { name: 'QT_AI_CAP_ANON', value: String(process.env.QT_AI_CAP_ANON || 12) },
    { name: 'QT_AI_CAP_GOOGLE', value: String(process.env.QT_AI_CAP_GOOGLE || 40) },
    { name: 'QT_AI_DAILY_BUDGET', value: String(process.env.QT_AI_DAILY_BUDGET || 3000) }];
  if (ably) secrets.push({ name: 'ABLY_ROOT_KEY', value: ably });
  if (claude) secrets.push({ name: 'ANTHROPIC_API_KEY', value: claude });
  if (CFG.admob && CFG.admob.rewarded) secrets.push({ name: 'QT_ADS_REWARDED_UNITS', value: CFG.admob.rewarded });
  const se = await call('POST', API + '/secrets', { token, json: secrets });
  if (!se.ok) fail(`تعذّر ضبط الأسرار (${se.status}): ${short(se.data)}`);
  say('  ✓ ' + secrets.map(x => x.name).join('، ') + ' — على الخادم وحده');

  // ---------- 4) الدالتان ----------
  step(4, 'نشر الدوال');
  for (const slug of ['qt-pulse', 'qt-ai', 'qt-ads']) {
    const src = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', slug, 'index.ts'), 'utf8');
    const fd = new FormData();
    fd.append('metadata', new Blob([JSON.stringify({ entrypoint_path: 'index.ts', name: slug, verify_jwt: false })], { type: 'application/json' }));
    fd.append('file', new Blob([src], { type: 'application/typescript' }), 'index.ts');
    const dp = await call('POST', API + '/functions/deploy?slug=' + slug, { token, form: fd });
    if (!dp.ok) fail(`فشل نشر ${slug} (${dp.status}): ${short(dp.data)}`);
    say(`  ✓ ${slug} ${dp.data && dp.data.version ? 'الإصدار ' + dp.data.version : 'منشورة'}`);
  }

  // ---------- 5) قاعدة معرفة المساعد ----------
  step(5, 'قاعدة معرفة المساعد: بنك الأسئلة');
  const bankPath = path.join(ROOT, 'dist', 'app', 'questions.json');
  if (!fs.existsSync(bankPath)) fail('لا يوجد dist/app/questions.json: شغّل python3 build.py أولاً');
  const raw = fs.readFileSync(bankPath, 'utf8');
  const stamp = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
  const qs = JSON.parse(raw).questions.map(q => ({ id: q.id, branch: q.branch, difficulty: q.difficulty, type: q.type, conf: q.conf,
    stem: q.stem, options: q.options, correct: q.correct, explain: q.explain, source: q.source }));
  const have2 = await sqlq(token, `select count(*)::int as n from public.qt_kb where stamp = '${stamp}'`);
  if (have2.ok && Array.isArray(have2.data) && have2.data[0].n === qs.length) say(`  · ${qs.length} سؤالاً محمّلة من قبل (النسخة ${stamp})`);
  else {
    let n = 0;
    for (let i = 0; i < qs.length; i += 400) {
      const body = JSON.stringify(qs.slice(i, i + 400));
      if (body.includes('$qtkb$')) fail('نص في البنك يحمل الفاصل $qtkb$');
      const r = await sqlq(token, `select public.qt_kb_load($qtkb$${body}$qtkb$::jsonb, '${stamp}') as n;`);
      if (!r.ok) fail(`فشل تحميل قاعدة المعرفة (${r.status}): ${short(r.data)}`);
      n += Array.isArray(r.data) ? Number(r.data[0].n) : 0;
      process.stdout.write(`\r  … ${Math.min(i + 400, qs.length)}/${qs.length}`);
    }
    const pr = await sqlq(token, `select public.qt_kb_prune('${stamp}') as n;`);
    say(`\r  ✓ ${n} سؤالاً في قاعدة المعرفة (النسخة ${stamp})، وحُذف ${pr.ok && Array.isArray(pr.data) ? pr.data[0].n : 0} لم يعد في البنك`);
  }

  // ---------- 5ب) مكتبة القوانين ----------
  step('5ب', 'مكتبة القوانين: نصوص المواد التي يجيب منها «المساعد»');
  const cdir = path.join(ROOT, 'data', 'corpus');
  if (!fs.existsSync(path.join(cdir, 'index.json'))) fail('لا يوجد data/corpus/index.json: شغّل python3 tools/build_corpus.py --write');
  const idxRaw = fs.readFileSync(path.join(cdir, 'index.json'), 'utf8');
  const idx = JSON.parse(idxRaw);
  const ch = crypto.createHash('sha1').update(idxRaw);
  const libs = idx.laws.map(l => {
    const rawL = fs.readFileSync(path.join(cdir, l.slug + '.json'), 'utf8');
    ch.update(rawL);
    return { meta: l, items: JSON.parse(rawL).items };
  });
  const cstamp = ch.digest('hex').slice(0, 12);
  const cs = await sqlq(token, 'select public.qt_law_stamp() as s');
  if (cs.ok && Array.isArray(cs.data) && cs.data[0] && cs.data[0].s === cstamp) say(`  · ${libs.length} قانوناً محمّلة من قبل (النسخة ${cstamp})`);
  else {
    const total = libs.reduce((a, l) => a + l.items.length, 0);
    let n = 0;
    for (const { meta, items } of libs) {
      items.forEach((it, i) => { it.ord = i; });
      const m = JSON.stringify(meta);
      for (let i = 0; i < items.length; i += 200) {
        const body = JSON.stringify(items.slice(i, i + 200));
        if (body.includes('$qtc$') || m.includes('$qtc$')) fail('نص في المكتبة يحمل الفاصل $qtc$');
        const r = await sqlq(token, `select public.qt_law_load($qtc$${m}$qtc$::jsonb, $qtc$${body}$qtc$::jsonb, '${cstamp}') as n;`);
        if (!r.ok) fail(`فشل تحميل ${meta.slug} (${r.status}): ${short(r.data)}`);
        n += Array.isArray(r.data) ? Number(r.data[0].n) : 0;
        process.stdout.write(`\r  … ${n}/${total}`);
      }
    }
    const pr = await sqlq(token, `select public.qt_law_prune('${cstamp}') as r;`);
    const pv = (pr.ok && Array.isArray(pr.data) && pr.data[0] && pr.data[0].r) || {};
    say(`\r  ✓ ${pv.laws ?? libs.length} قانوناً و${pv.articles ?? n} مادة في المكتبة (النسخة ${cstamp})`);
  }
  if (idx.excluded && idx.excluded.length) say(`  · لم تدخل المكتبة (النص المتاح غير صالح للاستشهاد): ${idx.excluded.map(e => e.title).join('، ')}`);

  // ---------- 6) فحوص حية ----------
  step(6, 'فحوص حية');
  const pub = { apikey: CFG.supabase.key, Authorization: 'Bearer ' + CFG.supabase.key };
  const bd = await probe('POST', URL0 + '/rest/v1/rpc/qt_board', { json: { p_kind: 'all', p_week: '', p_limit: 5 }, headers: pub });
  say(bd.ok && Array.isArray(bd.data) ? `  ✓ اللوحة العالمية تُقرأ بالمفتاح المنشور (${bd.data.length} صفاً)` : `  ✗ اللوحة: ${bd.status} ${short(bd.data)}`);

  let st = null;
  for (let i = 0; i < 6; i++) {
    st = await probe('POST', URL0 + '/functions/v1/qt-pulse', { json: { type: 'stats' }, headers: { ...pub, 'x-qt-admin': admin } });
    if (st.ok) break;
    await wait(4000);
  }
  say(st && st.ok ? `  ✓ دالة النبض: ${st.data.profiles} اسماً مستعاراً، ${st.data.reports} بلاغاً، مفتاح Ably ${st.data.ably ? 'مضبوط' : 'غير مضبوط'}`
                  : `  ✗ دالة النبض: ${st && st.status} ${short(st && st.data)}`);
  const today = new Date().toISOString().slice(0, 10);
  const dl = await probe('POST', URL0 + '/functions/v1/qt-pulse', { json: { type: 'daily', day: today }, headers: pub });
  say(dl.ok ? '  ✓ البث عبر Ably بمفتاح الجذر من الخادم يعمل' : `  ✗ البث عبر Ably: ${dl.status} ${short(dl.data)} — تحقق من ABLY_ROOT_KEY`);

  // جلسة مجهولة حقيقية تسأل المساعد سؤالاً واحداً من المكتبة، ثم تُحذف
  const su = await probe('POST', URL0 + '/auth/v1/signup', { json: {}, headers: { apikey: CFG.supabase.key } });
  const tok = su.ok && su.data && su.data.access_token, uid = tok && su.data.user && su.data.user.id;
  if (!tok) say(`  ✗ الدخول المجهول: ${su.status} ${short(su.data)}`);
  else {
    say('  ✓ الدخول المجهول يعمل');
    const ai = { apikey: CFG.supabase.key, Authorization: 'Bearer ' + tok };
    let qa = null;
    for (let i = 0; i < 6; i++) { qa = await probe('POST', URL0 + '/functions/v1/qt-ai', { json: { kind: 'quota' }, headers: ai }); if (qa.ok) break; await wait(4000); }
    if (!(qa && qa.ok && qa.data && qa.data.ok)) say(`  ✗ دالة المساعد: ${qa && qa.status} ${short(qa && qa.data)}`);
    else if (!qa.data.ready) say(`  · دالة المساعد تعمل (رصيد ${qa.data.cap} يومياً)، والمساعد ينتظر ANTHROPIC_API_KEY`);
    else {
      const wy = await probe('POST', URL0 + '/functions/v1/qt-ai', { json: { kind: 'ask', q: 'ما هي فترة الاختبار في مدونة الشغل؟' }, headers: ai });
      const arts = (wy.ok && wy.data && wy.data.ok && wy.data.data && wy.data.data.articles) || [];
      if (wy.ok && wy.data && wy.data.ok) say(arts.length ? `  ✓ المساعد أجاب من المكتبة، ومعه نص ${arts.map(a => a.label + ' من ' + a.title).slice(0, 2).join(' و')}`
                                                          : '  ⚠ المساعد أجاب دون نص من المكتبة: تحقق من تحميل المكتبة (الخطوة 5ب)');
      else {
        const lg = await sqlq(token, "select err from public.qt_ai_log order by id desc limit 1");
        say(`  ✗ المساعد: ${short(wy.data)} ${lg.ok && Array.isArray(lg.data) && lg.data[0] ? '— ' + lg.data[0].err : ''}`);
      }
    }
    if (uid && /^[0-9a-f-]{36}$/.test(uid)) await sqlq(token, `delete from public.qt_ai_usage where uid = '${uid}'; delete from auth.users where id = '${uid}';`);
  }

  // دالة التحقق من مكافآت AdMob: تُستدعى بلا مفتاح (verify_jwt=false)، وترفض التوقيع الباطل
  const ssvUrl = URL0 + '/functions/v1/qt-ads';
  const ad0 = await probe('GET', ssvUrl);
  const ad1 = await probe('GET', ssvUrl + '?ad_network=1&ad_unit=8197582346&transaction_id=probe&user_id=x&signature=AAAA&key_id=1');
  say(ad0.ok && ad0.data && ad0.data.service === 'qt-ads' && (ad1.status === 403 || ad1.status === 503)
    ? '  ✓ دالة مكافآت الإعلانات تعمل وترفض التوقيع الباطل'
    : `  ✗ دالة مكافآت الإعلانات: ${ad0.status} ${short(ad0.data)} / ${ad1.status} ${short(ad1.data)}`);

  const ab = await probe('GET', 'https://rest.ably.io/channels/' + encodeURIComponent(CFG.ably.channel || 'qt:pulse'),
    { headers: { Authorization: 'Basic ' + Buffer.from(CFG.ably.key).toString('base64') } });
  say(ab.status === 401 ? '  ✗ مفتاح Ably العام (subscribe) مرفوض: راجع config/cloud.json'
    : ab.status ? '  ✓ مفتاح Ably العام مقبول' : `  ⚠ تعذّر الوصول إلى Ably للفحص (${ab.data})`);
  const pn = await probe('GET', `https://ps.pndsn.com/v2/presence/sub-key/${CFG.pubnub.sub}/channel/qt-lobby?disable_uuids=1&uuid=qt-deploy`);
  if (pn.ok && pn.data && typeof pn.data.occupancy === 'number') say(`  ✓ حضور PubNub مفعّل (${pn.data.occupancy} الآن)`);
  else if (!pn.status) say(`  ⚠ تعذّر الوصول إلى PubNub للفحص (${pn.data})`);
  else say('  ⚠ حضور PubNub غير مفعّل: لوحة PubNub ← Keysets ← Presence ← فعّله. (عدّاد «يتدربون الآن» وحده يتأثر)');

  say(`\n✓ اكتمل نشر الخادم.\n  لوحة المؤلف: ${site}/admin  — سر المؤلف في ${SECRET_FILE}`
    + `\n  عنوان العودة الذي يُضاف في Google Cloud (Authorized redirect URI): ${URL0}/auth/v1/callback`
    + `\n  عنوان التحقق من المكافآت في AdMob (وحدة «بمكافأة» ← الإعدادات المتقدمة ← التحقق من جهة الخادم): ${URL0}/functions/v1/qt-ads`);
  if (RL) RL.close();
})().catch(e => fail(e && e.message || String(e)));
