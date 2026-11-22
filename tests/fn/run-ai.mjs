// «المساعد» يُشغَّل بشيفرته نفسها في Node: Claude بديل يردّ بحسب نوع الطلب، والقاعدة Postgres حقيقي فيه البنك كاملاً
// ومكتبة القوانين كاملة (tests/fn/load-kb.py ثم tests/fn/load-corpus.py)
import { sql, sqlRaw, USERS } from './mock-sb-ai.mjs';
const fails = []; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails.push(m); };
const ENV = { ANTHROPIC_API_KEY: 'sk-ant-test', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', QT_AI_CAP_ANON: '4', QT_AI_CAP_GOOGLE: '9' };
let handler; globalThis.Deno = { env: { get: k => ENV[k] }, serve: h => { handler = h; } };
const CALLS = []; const SCRIPT = [];   // ردود Claude المبرمجة مسبقاً (تُستهلك بالترتيب)، وإلا ردّ افتراضي سليم
globalThis.fetch = async (url, o) => {
  const body = JSON.parse(o.body); CALLS.push({ url, body, headers: o.headers });
  const u = body.messages[0].content, props = Object.keys(body.output_config?.format?.schema?.properties ?? {});
  let obj = SCRIPT.length ? SCRIPT.shift() : null;
  if (!obj) {
    const id = (u.match(/\[([A-Z]+-\d+)\]/) || [])[1] || 'X';
    const art = (u.match(/\[([a-z_]+:[^\]\s][^\]]*)\]/) || [])[1] || '';
    if (props.includes('terms')) obj = /الشباكية/.test(u) ? { laws: [], terms: [], refs: [] }
      : { laws: ['labour'], terms: ['فترة الاختبار', 'الفصل التعسفي', 'التعويض عن الفصل'], refs: [{ slug: 'labour', n: '13' }, { slug: 'labour', n: '41' }, { slug: 'nolaw', n: '1' }] };
    else if (props.includes('issues')) obj = { facts: 'أجير فُصل دون سبب.', issues: [{ point: 'هل الفصل تعسفي؟', rule: `القاعدة كما في النص [${art}].`, arts: [art], apply: 'ينطبق على الوقائع.' }], conclusion: 'الفصل تعسفي.', missing: ['مدة الأقدمية'], covered: true, arts: [art], followups: ['ما أجل الدعوى؟', 'كيف يُحسب التعويض؟'] };
    else if (props.includes('trap')) obj = { title: 'فخ الأجل', trap: 'خلطت بين الأجلين.', options: ['أ','ب','ج','د'].map((l, i) => ({ letter: l, ok: i === 0, why: 'لأن التعليل يقول ذلك.' })), rule: '**القاعدة** كما في التعليل.', hook: 'تذكّر: الأول هو الصحيح.', check: { q: 'ما الحكم؟', a: 'كما في التعليل.' } };
    else if (props.includes('stem')) obj = { stem: 'نازلة جديدة بوقائع أخرى؟', options: ['خيار صحيح', 'خيار خاطئ أول', 'خيار خاطئ ثان', 'خيار خاطئ ثالث'], correct: [0], explain: 'التعليل من المرجع نفسه.', rule: 'القاعدة.' };
    else if (props.includes('covered')) obj = { answer: `الحكم كذا${art ? ` [${art}]` : ''}${id !== 'X' ? ` [${id}]` : ''}.`, covered: true, arts: art ? [art] : [], cites: id !== 'X' ? [id] : [], followups: ['سؤال 1', 'سؤال 2'] };
    else if (props.includes('application')) obj = { rule: 9, basis: 2, application: 3, verdict: 'جواب جيد.', strengths: ['حدد القاعدة'], gaps: ['لم يذكر المرجع'], model: 'الجواب النموذجي.' };
    else obj = { headline: 'ابدأ بالأضعف.', days: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, title: 'يوم ' + (i + 1), minutes: 30, steps: [{ kind: 'law', ref: i ? 'قانون غير موجود' : 'k1', n: 50, why: 'ضعف' }, { kind: 'branch', ref: 'labour', n: 10, why: 'توازن' }] })) };
  }
  return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 1000, output_tokens: 300 }, stop_reason: 'end_turn' }), { status: 200 });
};
await import('./fn-ai.mts');
const ANON = 't-anon', GOOG = 't-goog';
const ida = sqlRaw(`insert into auth.users(id) values (gen_random_uuid()) returning id`).split('\n').pop(), idg = sqlRaw(`insert into auth.users(id) values (gen_random_uuid()) returning id`).split('\n').pop();
USERS.set(ANON, { id: ida, is_anonymous: true }); USERS.set(GOOG, { id: idg, is_anonymous: false });
const call = async (tok, body) => { const r = await handler(new Request('https://x/functions/v1/qt-ai', { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) })); return { s: r.status, b: await r.json() }; };
const lab = JSON.parse(sql(`select to_jsonb(k) from qt_kb k where id like 'LAB-%' and conf is distinct from 'r' order by id limit 1`).split('\n').pop());

ok((await call(null, { kind: 'quota' })).s === 401, 'دون جلسة: 401');
let r = await call(ANON, { kind: 'quota' });
ok(r.b.ok && r.b.cap === 4 && r.b.left === 4 && r.b.google === false && r.b.ready, 'الرصيد: 4 للمجهول');
ok((await call(GOOG, { kind: 'quota' })).b.cap === 9, 'الرصيد: 9 لحساب Google (الربط يضاعف الرصيد)');
ok((await call(ANON, { kind: 'hack' })).s === 400, 'نوع مجهول مرفوض');

// لماذا أخطأتُ؟ — مع حارس المراجع: الرد الأول يذكر مادة غير موجودة فيُعاد التوليد
SCRIPT.push({ title: 't', trap: 'حسب المادة 9999 من القانون.', options: [], rule: 'r', hook: 'h', check: { q: 'q', a: 'a' } });
let n0 = CALLS.length;
r = await call(ANON, { kind: 'why', id: lab.id, sel: [2, 2, 7] });
ok(r.b.ok && r.b.data.guard === true && CALLS.length - n0 === 2, 'حارس المراجع يرفض مادة مخترعة ويعيد التوليد');
ok(r.b.left === 3 && r.b.data.options.length === 4, 'الشرح بأحكام الخيارات الأربعة، ويخصم جواباً واحداً');
const c0 = CALLS.at(-1);
ok(c0.headers['anthropic-version'] === '2026-10-21' && c0.body.model === 'claude-haiku-5-5' && !('temperature' in c0.body), 'Haiku 5.5 بإصدار الواجهة 2026-10-21 ودون temperature');
ok(c0.body.output_config.format.type === 'json_schema' && c0.body.system.includes('لا تخترع'), 'مخرجات JSON مقيدة بمخطط، وقواعد التأسيس في التعليمات');
ok(c0.body.messages[0].content.includes(lab.explain.slice(0, 40)), 'المادة المرجعية من قاعدة المعرفة لا من العميل');
ok(c0.body.system.includes('«المساعد»') && !c0.body.system.includes('المستشار'), 'اسمه «المساعد» في التعليمات');
const withArt = JSON.parse(sql(`select coalesce(jsonb_agg(x), '[]') from (select k.id from qt_kb k where k.law ~ 'مدونة الشغل' and k.ref ~ '^المادة [0-9]+$' and k.conf is distinct from 'r' order by k.id limit 1) x`).split('\n').pop())[0];
n0 = CALLS.length; r = await call(GOOG, { kind: 'why', id: withArt.id, sel: [1] });
ok(r.b.ok && r.b.data.articles.length >= 1 && r.b.data.articles[0].slug === 'labour' && r.b.data.articles[0].text.length > 20, 'شرح الخطأ ومعه نص المادة من مكتبة القوانين');
ok(CALLS.at(-1).body.messages[0].content.includes('من مكتبة القوانين'), 'نص المادة في المادة المرجعية للنموذج');
n0 = CALLS.length; r = await call(ANON, { kind: 'why', id: lab.id, sel: [2] });
ok(r.b.cached === true && CALLS.length === n0 && r.b.left === 3, 'الشرح نفسه لمستخدم آخر من الذاكرة دون كلفة ولا خصم');

// سؤال توأم — الرد الأول بخيار ممنوع («جميع ما سبق») فيُرفض ويُعاد
SCRIPT.push({ stem: 's', options: ['أ', 'ب', 'ج', 'جميع ما سبق'], correct: [3], explain: 'e', rule: 'r' });
n0 = CALLS.length; r = await call(ANON, { kind: 'twin', id: lab.id, n: 0 });
ok(r.b.ok && r.b.data.options.length === 4 && !r.b.data.options.includes('جميع ما سبق') && CALLS.length - n0 === 2, 'السؤال التوأم يرفض الصيغ الممنوعة ويعيد');
ok(CALLS.at(-1).body.model === 'claude-sonnet-5-5' && r.b.data.of === lab.id, 'التوأم بـ Sonnet 5.5 ومرتبط بأصله');

// اسأل المساعد — من نصوص القوانين (والبنك)، والمادة المخترعة تُرفض
SCRIPT.push({ laws: ['labour'], terms: ['فترة الاختبار'], refs: [{ slug: 'labour', n: '13' }] },
            { answer: 'حسب [labour:9999] مدة الاختبار سنة.', covered: true, arts: ['labour:9999'], cites: [], followups: [] });
n0 = CALLS.length;
r = await call(GOOG, { kind: 'ask', q: 'ما هي مدة فترة الاختبار بالنسبة للأجراء في مدونة الشغل؟' });
ok(r.b.ok && r.b.data.guard === true && CALLS.length - n0 === 3, 'تحضير البحث بـ Haiku، ثم جواب يحيل على مادة لم تُجلب فيُرفض ويعاد');
ok(CALLS[n0].body.model === 'claude-haiku-5-5' && CALLS[n0].body.system.includes('تحضير بحث'), 'تحضير البحث بـ Haiku وتعليماته الخاصة');
const p1 = CALLS.at(-1).body.messages[0].content;
ok(p1.includes('[labour:13]') && p1.includes('فترة الاختبار، هي الفترة') && p1.includes('<user>'), 'نص المادة 13 من مدونة الشغل من المكتبة في المادة المرجعية، وكلام المستخدم معزول');
ok(r.b.data.articles.some(a => a.key === 'labour:13' && a.title.includes('مدونة الشغل') && a.text.includes('فترة الاختبار')), 'الجواب يحمل نص المادة المستشهد بها وعنوان قانونها');
ok(!JSON.stringify(r.b.data).includes('9999'), 'لا أثر للمادة المخترعة في الجواب');
n0 = CALLS.length; r = await call(ANON, { kind: 'ask', q: 'ما هي مدة فترة الاختبار بالنسبة للأجراء في مدونة الشغل؟' });
ok(r.b.cached === true && CALLS.length === n0, 'السؤال نفسه من الذاكرة دون كلفة');
r = await call(GOOG, { kind: 'ask', q: 'ماذا تنص عليه المادة 53 من مدونة الشغل؟' });
ok(r.b.ok && CALLS.at(-1).body.messages[0].content.includes('[labour:53]'), 'المادة المذكورة صراحة بقانونها تُجلب بعينها');
n0 = CALLS.length; r = await call(GOOG, { kind: 'ask', q: 'وصفة حلوى الشباكية بالعسل' });
ok(r.b.ok && r.b.data.covered === false && CALLS.length - n0 <= 1, 'سؤال خارج القانون: لا جواب من النموذج ولا خصم');

// نازلة — تحليل من النصوص وحدها، لا يُحفظ، والمادة المخترعة ترفض
const CASE = 'أعمل منذ عشر سنوات في شركة بعقد غير محدد المدة، وطردني المشغل فجأة دون سبب ودون إخطار. ما حقوقي؟';
ok((await call(GOOG, { kind: 'case', q: 'قصيرة جداً' })).b.error === 'input', 'نازلة قصيرة جداً تُرفض');
n0 = CALLS.length; r = await call(GOOG, { kind: 'case', q: CASE });
ok(r.b.ok && r.b.data.issues.length === 1 && r.b.data.articles.length >= 1 && r.b.data.articles.every(a => a.slug === 'labour'), 'النازلة: مسائل وقواعد من مواد مدونة الشغل بنصوصها');
ok(CALLS.length - n0 === 2 && CALLS.at(-1).body.model === 'claude-sonnet-5-5' && r.b.data.missing.length === 1, 'تحضير ثم تحليل بـ Sonnet، ومعه ما ينقص من معطيات');
ok(!CALLS[n0].body.messages[0].content.includes('[nolaw') && !CALLS.at(-1).body.messages[0].content.includes('nolaw:'), 'قانون غير موجود في المكتبة لا يُطلب');
n0 = CALLS.length; r = await call(GOOG, { kind: 'case', q: CASE });
ok(r.b.ok && !r.b.cached && CALLS.length - n0 === 2, 'النازلة لا تُحفظ في الذاكرة (وقائع شخصية)');
ok(!sql(`select coalesce(string_agg(payload::text, ''), '') from qt_ai_cache`).includes('عشر سنوات في شركة'), 'نص النازلة لا يُخزَّن في الخادم');
SCRIPT.push({ laws: ['labour'], terms: ['الفصل التعسفي'], refs: [] },
            { facts: 'f', issues: [{ point: 'p', rule: 'حسب [criminal:9999].', arts: ['criminal:9999'], apply: 'a' }], conclusion: 'c', missing: [], covered: true, arts: [], followups: [] });
n0 = CALLS.length; r = await call(GOOG, { kind: 'case', q: CASE + ' وأريد معرفة أجل رفع الدعوى.' });
ok(r.b.ok && r.b.data.guard === true && CALLS.length - n0 === 3 && !JSON.stringify(r.b.data).includes('9999'), 'النازلة: إحالة على مادة لم تُجلب تُرفض ويعاد التحليل');

// الشفوي — تنقيط مقيد بالسقوف
const cs = JSON.parse(sql(`select to_jsonb(k) from qt_kb k where type = 'case' and conf is distinct from 'r' order by id limit 1`).split('\n').pop());
r = await call(GOOG, { kind: 'oral', id: cs.id, answer: 'الحل أن العقد صحيح لأن الشروط متوفرة طبقاً للقانون.' });
ok(r.b.ok && r.b.data.rule === 4 && r.b.data.score === 9, 'الشفوي: المعايير مقيدة بسقوفها (4+3+3)');
ok((await call(GOOG, { kind: 'oral', id: cs.id, answer: 'قصير' })).b.error === 'input', 'جواب شفوي قصير جداً يُرفض');

// خطتي — خطوات صالحة للتنفيذ في التطبيق فقط
r = await call(GOOG, { kind: 'plan', stats: { answered: 120, acc: 61, laws: [{ key: 'k1', title: 'مدونة الشغل', a: 30, c: 12 }], branches: [{ id: 'labour', title: 'الشغل', a: 30, c: 12, n: 900 }] } });
const steps = r.b.data.days.flatMap(d => d.steps);
ok(r.b.ok && r.b.data.days.length === 7 && steps.every(s => ['law', 'branch', 'due', 'wrong', 'exam', 'oral', 'daily'].includes(s.kind)), 'الخطة سبعة أيام بخطوات معروفة');
ok(steps.every(s => s.kind !== 'law' || s.ref === 'k1') && steps.every(s => s.n <= 30), 'مرجع قانون مجهول يُصحَّح، والعدد مقيد');
n0 = CALLS.length; ok((await call(GOOG, { kind: 'plan', stats: {} })).b.cached === true && CALLS.length === n0, 'خطة اليوم من الذاكرة');

// نفاد الرصيد
for (let i = 0; i < 4; i++) await call(ANON, { kind: 'twin', id: lab.id, n: 1 + (i % 2) });
r = await call(ANON, { kind: 'oral', id: cs.id, answer: 'جواب طويل بما يكفي ليُقبل في الامتحان الشفوي.' });
ok(r.b.ok === false && r.b.error === 'quota', 'نفاد الرصيد اليومي');
ok(+sql(`select count(*) from qt_ai_log`).split('\n').pop() >= 8, 'كل استدعاء مسجل للمؤلف (الرموز والزمن والنتيجة)');
// مكافأة إعلان (v6): الرصيد يزيد 3 ويُستعمل فوراً
ok(r.b.ads && r.b.ads.left === 3 && r.b.ads.per === 3, 'رد نفاد الرصيد يحمل عدد مكافآت الإعلانات المتاحة اليوم');
sql(`select public.qt_ad_grant('admob-tx-ai', '${ida}', 'ai', 'ssv')`);
r = await call(ANON, { kind: 'quota' });
ok(r.b.cap === 7 && r.b.left === 3 && r.b.ads.left === 2 && r.b.ads.ssv === true, 'بعد إعلان مكافأة موثَّق: الرصيد 4 + 3، وتبقى مكافأتان');
r = await call(ANON, { kind: 'oral', id: cs.id, answer: 'جواب طويل بما يكفي ليُقبل في الامتحان الشفوي.' });
ok(r.b.ok === true && r.b.left === 2 && r.b.cap === 7, 'المكافأة تُستعمل فوراً في «المساعد»');
console.log(fails.length ? `✗ ${fails.length} فشل` : '✓ المساعد: كل الفحوص نجحت');
process.exit(fails.length ? 1 : 0);
