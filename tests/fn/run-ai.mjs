// «المساعد» يُشغَّل بشيفرته نفسها في Node: Gemini بديل يردّ بحسب مخطط الطلب، والقاعدة Postgres حقيقي فيه البنك كاملاً
// ومكتبة القوانين كاملة (tests/fn/load-kb.py ثم tests/fn/load-corpus.py)
import { sql, sqlRaw, USERS } from './mock-sb-ai.mjs';
const fails = []; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails.push(m); };
const ENV = { GEMINI_API_KEY: 'AQ.test-key-0123456789abcdef', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', QT_AI_CAP_ANON: '4', QT_AI_CAP_GOOGLE: '60' };
let handler; globalThis.Deno = { env: { get: k => ENV[k] }, serve: h => { handler = h; } };
const CALLS = []; const SCRIPT = [];   // ردود Gemini المبرمجة مسبقاً (تُستهلك بالترتيب)، وإلا ردّ افتراضي سليم بحسب المخطط
const L = ['أ', 'ب', 'ج', 'د'];
const txt = c => c.body.contents[0].parts.filter(p => typeof p.text === 'string').map(p => p.text).join('\n');
const sys = c => c.body.systemInstruction.parts[0].text;
const mdl = c => decodeURIComponent((String(c.url).match(/\/models\/([^:/]+):generateContent$/) || [])[1] || '');
const schemaOf = c => c.body.generationConfig.responseFormat?.text?.schema ?? c.body.generationConfig.responseJsonSchema ?? {};
const gem = (obj, extra = {}) => new Response(JSON.stringify({
  candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP', index: 0 }],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 300, thoughtsTokenCount: 120, totalTokenCount: 1420 }, modelVersion: 'x', ...extra }), { status: 200 });
globalThis.fetch = async (url, o) => {
  const body = JSON.parse(o.body); const c = { url, body, headers: o.headers }; CALLS.push(c);
  const u = txt(c), sc = schemaOf(c), props = Object.keys(sc.properties ?? {});
  const keys = [...new Set([...u.matchAll(/\[([a-z_]+:[^\]\s][^\]]*)\]/g)].map(m => m[1]))], art = keys[0] || '';
  let obj = SCRIPT.length ? SCRIPT.shift() : null;
  if (obj && obj.$status) return new Response(JSON.stringify({ error: { code: obj.$status, message: obj.$msg || 'err', status: obj.$s || 'X' } }), { status: obj.$status });
  if (obj && obj.$raw) return new Response(JSON.stringify(obj.$raw), { status: 200 });
  if (!obj) {
    const id = (u.match(/\[([A-Z]+-\d+)\]/) || [])[1] || 'X';
    if (props.includes('terms')) obj = /الشباكية/.test(u) ? { laws: [], terms: [], refs: [] }
      : { laws: ['labour'], terms: ['فترة الاختبار', 'الفصل التعسفي', 'التعويض عن الفصل'], refs: [{ slug: 'labour', n: '13' }, { slug: 'labour', n: '41' }, { slug: 'nolaw', n: '1' }] };
    else if (props.includes('legal')) obj = { legal: true, type: 'mcq', text: 'ما مدة فترة الاختبار بالنسبة للأطر في مدونة الشغل؟', options: ['ثلاثة أشهر', 'سنة كاملة', 'يوم واحد', 'خمس سنوات'] };
    else if (props.includes('verdicts')) { const n = sc.properties.verdicts.minItems || 4; obj = { verdicts: Array.from({ length: n }, (_, i) => ({ letter: L[i], ok: i === 0, why: `السبب [${art}]` })), rule: 'القاعدة.', covered: true, arts: [art] }; }
    else if (props.includes('issues')) obj = { facts: 'أجير فُصل دون سبب.', issues: [{ point: 'هل الفصل تعسفي؟', rule: `القاعدة كما في النص [${art}].`, arts: [art], apply: 'ينطبق على الوقائع.' }], conclusion: 'الفصل تعسفي.', missing: ['مدة الأقدمية'], covered: true, arts: [art], followups: ['ما أجل الدعوى؟', 'كيف يُحسب التعويض؟'] };
    else if (props.includes('rows')) obj = { intro: 'تعريف موجز.', rows: [{ aspect: 'الأساس', a: `حكم الأول [${art}]`, b: 'حكم الثاني' }, { aspect: 'الأثر', a: 'أ', b: 'ب' }], same: ['كلاهما جزاء'], summary: 'الفرق الجوهري.', trap: 'الخلط الشائع.', covered: true, arts: [art] };
    else if (props.includes('trap')) obj = { title: 'فخ الأجل', trap: 'خلطت بين الأجلين.', options: L.map((l, i) => ({ letter: l, ok: i === 0, why: 'لأن التعليل يقول ذلك.' })), rule: '**القاعدة** كما في التعليل.', hook: 'تذكّر: الأول هو الصحيح.', check: { q: 'ما الحكم؟', a: 'كما في التعليل.' } };
    else if (props.includes('items')) {
      // مولّد التمارين: مرجع كل تمرين مادة من المادة المرجعية (السطر الذي يبدأ بمفتاحها)، لا المثال الوارد في التعليمات
      const ip = sc.properties.items, tp = ip.items.properties.type.enum, cnt = ip.maxItems || 5;
      const ks = [...new Set([...u.matchAll(/^\[([a-z_]+:[^\]\s][^\]]*)\]/gm)].map(m => m[1]))];
      obj = { items: Array.from({ length: cnt }, (_, i) => { const t = tp[i % tp.length], k = ks[i % ks.length];
        return { type: t, stem: `تمرين ${i + 1} من نوع ${t}: ما الحكم في هذه الوضعية؟`, options: [1, 2, 3, 4].map(j => `الخيار ${j} في التمرين ${i + 1}`),
                 correct: t === 'riddle' ? [1] : (i % 3 === 2 ? [0, 2] : [0]), why: [1, 2, 3, 4].map(j => `تعليل الخيار ${j} من النص.`),
                 rule: `القاعدة كما في النص [${k}].`, ref: k, difficulty: /صعبة/.test(u) ? 5 : /سهلة/.test(u) ? 1 : 3, hint: t === 'riddle' ? 'تلميح: فكّر في الأجل.' : 'لا يبقى' }; }) };
    }
    else if (props.includes('stem')) obj = { stem: 'نازلة جديدة بوقائع أخرى؟', options: ['خيار صحيح', 'خيار خاطئ أول', 'خيار خاطئ ثان', 'خيار خاطئ ثالث'], correct: [0], explain: 'التعليل من المرجع نفسه.', rule: 'القاعدة.' };
    else if (props.includes('simple')) obj = { simple: 'شرح مبسط للمادة.', elements: [`شرط أول [${art}]`, 'شرط ثان'], effects: ['الأثر'], exceptions: [], example: { facts: 'وقائع قصيرة.', solution: 'الحل.' }, traps: ['فخ شائع'], hook: 'للحفظ.', related: keys[1] ? [{ key: keys[1], why: 'مرتبطة بها.' }] : [] };
    else if (props.includes('parts')) obj = { intro: 'تقديم.', problem: 'ما الإشكالية؟', subq: ['سؤال فرعي'], parts: [1, 2].map(p => ({ title: 'القسم ' + p, sections: [1, 2].map(s => ({ title: 'المطلب ' + s, points: [`فكرة [${art}]`] })) })), conclusion: 'خاتمة.', tips: ['نصيحة'], covered: true, arts: [art] };
    else if (props.includes('structure')) obj = { intro: 7, problem: 4, structure: 3, basis: 2, analysis: 1, verdict: 'تحرير متوسط.', strengths: ['تصميم واضح'], gaps: ['إسناد ضعيف'], fixes: [`استند إلى [${art}]`], better: ['القسم الأول', 'القسم الثاني'], arts: [art] };
    else if (props.includes('questions')) obj = { title: 'نازلة الأجير', facts: 'اشتغل «أ» لدى «شركة س» مدة ثم أنهي عقده دون إخطار.', questions: ['ما حكم الإنهاء؟'], model: [{ answer: `القاعدة كذا [${art}]، وتطبيقها كذا.`, arts: [art] }] };
    else if (props.includes('cards')) obj = { cards: [1, 2, 3, 4].map(i => ({ front: 'سؤال ' + i + '؟', back: 'جواب ' + i + '.', key: art })) };
    else if (props.includes('covered')) obj = { answer: `الحكم كذا${art ? ` [${art}]` : ''}${id !== 'X' ? ` [${id}]` : ''}.`, covered: true, arts: art ? [art] : [], cites: id !== 'X' ? [id] : [], followups: ['سؤال 1', 'سؤال 2'] };
    else if (props.includes('application') && props.includes('model')) obj = { ...(props.includes('transcript') ? { transcript: 'القاعدة أن العقد صحيح حسب المادة 9999.' } : {}), rule: 9, basis: 2, application: 3, verdict: 'جواب جيد.', strengths: ['حدد القاعدة'], gaps: ['لم يذكر المرجع'], model: 'الجواب النموذجي.' };
    else if (props.includes('application')) obj = { rule: 12, basis: 5, application: 9, verdict: 'حل جيد.', strengths: ['حدد القاعدة'], gaps: [`فاتك السند [${art}]`] };
    else obj = { headline: 'ابدأ بالأضعف.', days: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, title: 'يوم ' + (i + 1), minutes: 30, steps: [{ kind: 'law', ref: i ? 'قانون غير موجود' : 'k1', n: 50, why: 'ضعف' }, { kind: 'branch', ref: 'labour', n: 10, why: 'توازن' }] })) };
  }
  return gem(obj);
};
await import('./fn-ai.mts');
const ANON = 't-anon', GOOG = 't-goog', OTHER = 't-other';
const newUser = () => sqlRaw(`insert into auth.users(id) values (gen_random_uuid()) returning id`).split('\n').pop();
const ida = newUser(), idg = newUser(), ido = newUser();
USERS.set(ANON, { id: ida, is_anonymous: true }); USERS.set(GOOG, { id: idg, is_anonymous: false }); USERS.set(OTHER, { id: ido, is_anonymous: false });
const call = async (tok, body) => { const r = await handler(new Request('https://x/functions/v1/qt-ai', { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) })); return { s: r.status, b: await r.json() }; };
const lab = JSON.parse(sql(`select to_jsonb(k) from qt_kb k where id like 'LAB-%' and conf is distinct from 'r' order by id limit 1`).split('\n').pop());
const lastErr = () => sql(`select coalesce(err, '') from qt_ai_log order by id desc limit 1`).split('\n').pop();

ok((await call(null, { kind: 'quota' })).s === 401, 'دون جلسة: 401');
let r = await call(ANON, { kind: 'quota' });
ok(r.b.ok && r.b.cap === 4 && r.b.left === 4 && r.b.google === false && r.b.ready && r.b.engine === 'gemini', 'الرصيد: 4 للمجهول، والمحرك Gemini');
ok((await call(GOOG, { kind: 'quota' })).b.cap === 60, 'الرصيد: حد حساب Google');
ok((await call(ANON, { kind: 'hack' })).s === 400, 'نوع مجهول مرفوض');

// لماذا أخطأتُ؟ — مع حارس المراجع: الرد الأول يذكر مادة غير موجودة فيُعاد التوليد
SCRIPT.push({ title: 't', trap: 'حسب المادة 9999 من القانون.', options: [], rule: 'r', hook: 'h', check: { q: 'q', a: 'a' } });
let n0 = CALLS.length;
r = await call(ANON, { kind: 'why', id: lab.id, sel: [2, 2, 7] });
ok(r.b.ok && r.b.data.guard === true && CALLS.length - n0 === 2, 'حارس المراجع يرفض مادة مخترعة ويعيد التوليد');
ok(r.b.left === 3 && r.b.data.options.length === 4, 'الشرح بأحكام الخيارات الأربعة، ويخصم جواباً واحداً');
const c0 = CALLS.at(-1), g0 = c0.body.generationConfig;
ok(mdl(c0) === 'gemini-3.5-flash-lite' && String(c0.url).startsWith('https://generativelanguage.googleapis.com/v1beta/models/'), 'شرح الخطأ بـ Gemini 3.5 Flash-Lite عبر generateContent');
ok(c0.headers['x-goog-api-key'] === ENV.GEMINI_API_KEY && !JSON.stringify(c0.body).includes(ENV.GEMINI_API_KEY), 'المفتاح في ترويسة x-goog-api-key وحدها، لا في جسم الطلب');
ok(c0.body.store === false && !('temperature' in g0) && !g0.thinkingConfig && g0.maxOutputTokens >= 1100, 'store: false (لا حفظ لدى Google)، ودون temperature، والنموذج السريع بتفكيره الافتراضي');
ok(g0.responseFormat.text.mimeType === 'APPLICATION_JSON' && g0.responseFormat.text.schema.additionalProperties === false && g0.responseFormat.text.schema.properties.options.minItems === 4, 'مخرجات JSON مقيدة بمخطط (responseFormat)');
ok(sys(c0).includes('لا تخترع') && sys(c0).includes('«المساعد»') && !sys(c0).includes('المستشار'), 'قواعد التأسيس في systemInstruction، واسمه «المساعد»');
ok(txt(c0).includes(lab.explain.slice(0, 40)) && c0.body.contents[0].role === 'user', 'المادة المرجعية من قاعدة المعرفة لا من العميل');
const withArt = JSON.parse(sql(`select coalesce(jsonb_agg(x), '[]') from (select k.id from qt_kb k where k.law ~ 'مدونة الشغل' and k.ref ~ '^المادة [0-9]+$' and k.conf is distinct from 'r' order by k.id limit 1) x`).split('\n').pop())[0];
r = await call(GOOG, { kind: 'why', id: withArt.id, sel: [1] });
ok(r.b.ok && r.b.data.articles.length >= 1 && r.b.data.articles[0].slug === 'labour' && r.b.data.articles[0].text.length > 20, 'شرح الخطأ ومعه نص المادة من مكتبة القوانين');
ok(txt(CALLS.at(-1)).includes('من مكتبة القوانين'), 'نص المادة في المادة المرجعية للنموذج');
n0 = CALLS.length; r = await call(ANON, { kind: 'why', id: lab.id, sel: [2] });
ok(r.b.cached === true && CALLS.length === n0 && r.b.left === 3, 'الشرح نفسه لمستخدم آخر من الذاكرة دون كلفة ولا خصم');
ok(+sql(`select in_tok from qt_ai_log where kind = 'why' and not cached order by id desc limit 1`).split('\n').pop() === 1000
   && +sql(`select out_tok from qt_ai_log where kind = 'why' and not cached order by id desc limit 1`).split('\n').pop() === 420, 'الرموز في السجل: المدخلات، والمخرجات مع رموز التفكير');

// سؤال توأم — الرد الأول بخيار ممنوع («جميع ما سبق») فيُرفض ويُعاد
SCRIPT.push({ stem: 's', options: ['أ', 'ب', 'ج', 'جميع ما سبق'], correct: [3], explain: 'e', rule: 'r' });
n0 = CALLS.length; r = await call(ANON, { kind: 'twin', id: lab.id, n: 0 });
ok(r.b.ok && r.b.data.options.length === 4 && !r.b.data.options.includes('جميع ما سبق') && CALLS.length - n0 === 2, 'السؤال التوأم يرفض الصيغ الممنوعة ويعيد');
const ct = CALLS.at(-1);
ok(mdl(ct) === 'gemini-3.8-flash' && ct.body.generationConfig.thinkingConfig.thinkingLevel === 'LOW' && ct.body.generationConfig.maxOutputTokens >= 1400 + 3000 && r.b.data.of === lab.id,
   'التوأم بـ Gemini 3.8 Flash بتفكير منخفض، وهامش رموز للتفكير، ومرتبط بأصله');

// اسأل المساعد — من نصوص القوانين (والبنك)، والمادة المخترعة تُرفض
SCRIPT.push({ laws: ['labour'], terms: ['فترة الاختبار'], refs: [{ slug: 'labour', n: '13' }] },
            { answer: 'حسب [labour:9999] مدة الاختبار سنة.', covered: true, arts: ['labour:9999'], cites: [], followups: [] });
n0 = CALLS.length;
r = await call(GOOG, { kind: 'ask', q: 'ما هي مدة فترة الاختبار بالنسبة للأجراء في مدونة الشغل؟' });
ok(r.b.ok && r.b.data.guard === true && CALLS.length - n0 === 3, 'تحضير البحث بالنموذج السريع، ثم جواب يحيل على مادة لم تُجلب فيُرفض ويعاد');
ok(mdl(CALLS[n0]) === 'gemini-3.5-flash-lite' && sys(CALLS[n0]).includes('تحضير بحث'), 'تحضير البحث بـ Flash-Lite وتعليماته الخاصة');
const p1 = txt(CALLS.at(-1));
ok(p1.includes('[labour:13]') && p1.includes('فترة الاختبار، هي الفترة') && p1.includes('<user>'), 'نص المادة 13 من مدونة الشغل من المكتبة في المادة المرجعية، وكلام المستخدم معزول');
ok(r.b.data.articles.some(a => a.key === 'labour:13' && a.title.includes('مدونة الشغل') && a.text.includes('فترة الاختبار')), 'الجواب يحمل نص المادة المستشهد بها وعنوان قانونها');
ok(!JSON.stringify(r.b.data).includes('9999'), 'لا أثر للمادة المخترعة في الجواب');
n0 = CALLS.length; r = await call(ANON, { kind: 'ask', q: 'ما هي مدة فترة الاختبار بالنسبة للأجراء في مدونة الشغل؟' });
ok(r.b.cached === true && CALLS.length === n0, 'السؤال نفسه من الذاكرة دون كلفة');
r = await call(GOOG, { kind: 'ask', q: 'ماذا تنص عليه المادة 53 من مدونة الشغل؟' });
ok(r.b.ok && txt(CALLS.at(-1)).includes('[labour:53]'), 'المادة المذكورة صراحة بقانونها تُجلب بعينها');
n0 = CALLS.length; r = await call(GOOG, { kind: 'ask', q: 'وصفة حلوى الشباكية بالعسل' });
ok(r.b.ok && r.b.data.covered === false && CALLS.length - n0 <= 1, 'سؤال خارج القانون: لا جواب من النموذج ولا خصم');
// محادثة متصلة: السؤال التابع يُفهم بسياقه، والسياق كلام مستخدم معزول، ولا يُحفظ الجواب
const CTX = [{ q: 'ما هي فترة الاختبار في مدونة الشغل؟', a: 'هي الفترة التي يمكن خلالها إنهاء العقد دون إخطار ولا تعويض.' }];
n0 = CALLS.length; r = await call(GOOG, { kind: 'ask', q: 'وما مدتها بالنسبة للأطر؟', ctx: [...CTX, { q: 'x'.repeat(900), a: 'y' }, 'bad', { a: 'بلا سؤال' }] });
const pc = txt(CALLS.at(-1));
ok(r.b.ok && !r.b.cached && pc.includes('سياق المحادثة السابقة') && pc.includes('س: ما هي فترة الاختبار') && /<user>\nس: /.test(pc) && !pc.includes('x'.repeat(301)), 'المحادثة المتصلة: السياق (مقصوصاً) داخل وسمَي المستخدم');
ok(txt(CALLS[n0]).includes('ما هي فترة الاختبار في مدونة الشغل؟') && txt(CALLS[n0]).includes('وما مدتها'), 'البحث للسؤال التابع يشمل السؤال السابق');
n0 = CALLS.length; r = await call(GOOG, { kind: 'ask', q: 'وما مدتها بالنسبة للأطر؟', ctx: CTX });
ok(r.b.ok && !r.b.cached && CALLS.length - n0 === 2, 'السؤال داخل محادثة لا يُحفظ ولا يُعاد من الذاكرة');

// نازلة — تحليل من النصوص وحدها، لا يُحفظ، والمادة المخترعة ترفض
const CASE = 'أعمل منذ عشر سنوات في شركة بعقد غير محدد المدة، وطردني المشغل فجأة دون سبب ودون إخطار. ما حقوقي؟';
ok((await call(GOOG, { kind: 'case', q: 'قصيرة جداً' })).b.error === 'input', 'نازلة قصيرة جداً تُرفض');
n0 = CALLS.length; r = await call(GOOG, { kind: 'case', q: CASE });
ok(r.b.ok && r.b.data.issues.length === 1 && r.b.data.articles.length >= 1 && r.b.data.articles.every(a => a.slug === 'labour'), 'النازلة: مسائل وقواعد من مواد مدونة الشغل بنصوصها');
ok(CALLS.length - n0 === 2 && mdl(CALLS.at(-1)) === 'gemini-3.8-flash' && CALLS.at(-1).body.generationConfig.thinkingConfig.thinkingLevel === 'MEDIUM' && r.b.data.missing.length === 1, 'تحضير ثم تحليل بـ 3.8 Flash بتفكير متوسط، ومعه ما ينقص من معطيات');
ok(!txt(CALLS[n0]).includes('[nolaw') && !txt(CALLS.at(-1)).includes('nolaw:'), 'قانون غير موجود في المكتبة لا يُطلب');
n0 = CALLS.length; r = await call(GOOG, { kind: 'case', q: CASE });
ok(r.b.ok && !r.b.cached && CALLS.length - n0 === 2, 'النازلة لا تُحفظ في الذاكرة (وقائع شخصية)');
ok(!sql(`select coalesce(string_agg(payload::text, ''), '') from qt_ai_cache`).includes('عشر سنوات في شركة'), 'نص النازلة لا يُخزَّن في الخادم');
SCRIPT.push({ laws: ['labour'], terms: ['الفصل التعسفي'], refs: [] },
            { facts: 'f', issues: [{ point: 'p', rule: 'حسب [criminal:9999].', arts: ['criminal:9999'], apply: 'a' }], conclusion: 'c', missing: [], covered: true, arts: [], followups: [] });
n0 = CALLS.length; r = await call(GOOG, { kind: 'case', q: CASE + ' وأريد معرفة أجل رفع الدعوى.' });
ok(r.b.ok && r.b.data.guard === true && CALLS.length - n0 === 3 && !JSON.stringify(r.b.data).includes('9999'), 'النازلة: إحالة على مادة لم تُجلب تُرفض ويعاد التحليل');

// صوّر سؤالاً — الصورة تُقرأ ثم يُحل السؤال من النصوص، ولا تُحفظ الصورة في أي مكان
const IMG = 'iVBORw0KGgo' + 'A'.repeat(3000) + 'AAAASUVORK5CYII=';
ok((await call(GOOG, { kind: 'scan', img: 'abc' })).b.error === 'input', 'صورة فارغة أو قصيرة تُرفض');
ok((await call(GOOG, { kind: 'scan', img: '<script>' + 'A'.repeat(3000) })).b.error === 'input', 'محتوى ليس base64 يُرفض');
n0 = CALLS.length; r = await call(GOOG, { kind: 'scan', img: 'data:image/png;base64,' + IMG, mime: 'image/png' });
const ocr = CALLS[n0], ip = ocr.body.contents[0].parts.find(p => p.inlineData);
ok(ip && ip.inlineData.mimeType === 'image/png' && ip.inlineData.data === IMG && sys(ocr).includes('قارئ صور') && mdl(ocr) === 'gemini-3.8-flash', 'الصورة إلى Gemini بـ inlineData (دون بادئة data:)، بتعليمات النسخ لا الجواب');
ok(r.b.ok && r.b.data.mode === 'mcq' && r.b.data.extracted.options.length === 4 && r.b.data.verdicts.length === 4 && r.b.data.verdicts[0].ok === true, 'سؤال متعدد الاختيارات من الصورة: حكم على كل خيار');
ok(r.b.data.articles.length >= 1 && r.b.data.articles[0].slug === 'labour' && CALLS.length - n0 === 3, 'قراءة الصورة ثم تحضير البحث ثم الحل، ومعه نصوص المواد');
ok(CALLS.at(-1).body.generationConfig.responseFormat.text.schema.properties.verdicts.minItems === 4, 'عدد الأحكام مقيد بعدد الخيارات في المخطط');
ok(!sql(`select coalesce(string_agg(payload::text, ''), '') from qt_ai_cache`).includes('iVBORw0KGgo') && !sql(`select coalesce(string_agg(coalesce(err,''), ''), '') from qt_ai_log`).includes('iVBORw0KGgo'), 'الصورة لا تُخزَّن في الذاكرة ولا في السجل');
SCRIPT.push({ legal: true, type: 'case', text: CASE, options: [] });
n0 = CALLS.length; r = await call(GOOG, { kind: 'scan', img: IMG, mime: 'image/jpeg' });
ok(r.b.ok && r.b.data.mode === 'case' && r.b.data.issues.length === 1 && r.b.data.extracted.text === CASE, 'نازلة مصوَّرة: تُحلَّل كنازلة');
SCRIPT.push({ legal: false, type: 'other', text: '', options: [] });
const left0 = (await call(GOOG, { kind: 'quota' })).b.left;
r = await call(GOOG, { kind: 'scan', img: IMG, mime: 'image/webp' });
ok(r.b.ok && r.b.data.mode === 'none' && r.b.data.covered === false && r.b.left === left0, 'صورة بلا سؤال قانوني: لا حل ولا خصم من الرصيد');

// اشرح المادة — شرح محفوظ لكل من يطلبه، ومعه نص المادة وما يرتبط بها، والمفتاح المخترع يُرفض
ok((await call(GOOG, { kind: 'explain', slug: 'Labour!', n: '13' })).b.error === 'input', 'معرّف قانون غير صالح يُرفض');
ok((await call(GOOG, { kind: 'explain', slug: 'labour', n: '99999' })).b.error === 'notfound', 'مادة غير موجودة: notfound');
SCRIPT.push({ simple: 'شرح', elements: ['شرط [labour:777777]'], effects: [], exceptions: [], example: { facts: 'f', solution: 's' }, traps: [], hook: 'h', related: [] });
n0 = CALLS.length; r = await call(GOOG, { kind: 'explain', slug: 'labour', n: '13' });
ok(r.b.ok && r.b.data.guard === true && CALLS.length - n0 === 2 && r.b.data.article.key === 'labour:13' && r.b.data.elements.length === 2, 'شرح المادة: مفتاح مخترع يُرفض ويعاد');
const pe = txt(CALLS.at(-1));
ok(pe.includes('[labour:13]') && pe.includes('[labour:12]') && pe.includes('[labour:14]'), 'المادة في سياقها: ما قبلها وما بعدها من المكتبة');
ok(r.b.data.related.every(x => x.key !== 'labour:13') && r.b.data.articles.some(a => a.key === 'labour:13') && r.b.data.example.facts, 'مواد مرتبطة من المرفق وحده، ومثال تطبيقي');
n0 = CALLS.length; r = await call(ANON, { kind: 'explain', slug: 'labour', n: '13' });
ok(r.b.cached === true && CALLS.length === n0, 'شرح المادة نفسها من الذاكرة لكل الطلبة');

// قارن — جدول فروق من النصوص، محفوظ
ok((await call(GOOG, { kind: 'compare', a: 'الفسخ', b: 'الفسخ' })).b.error === 'input', 'مقارنة الشيء بنفسه تُرفض');
n0 = CALLS.length; r = await call(GOOG, { kind: 'compare', a: 'فترة الاختبار', b: 'أجل الإخطار' });
ok(r.b.ok && r.b.data.rows.length === 2 && r.b.data.articles.length >= 1 && CALLS.length - n0 === 2 && txt(CALLS.at(-1)).includes('أ) فترة الاختبار'), 'قارن: جدول فروق بمواد المكتبة');
n0 = CALLS.length; r = await call(ANON, { kind: 'compare', a: 'أجل الإخطار', b: 'فترة الاختبار' });
ok(r.b.cached === true && CALLS.length === n0, 'المقارنة نفسها (بأي ترتيب) من الذاكرة');

// الموضوع الإنشائي — تصميم محفوظ، وتنقيط مقيد بالسقوف لا يُحفظ
n0 = CALLS.length; r = await call(GOOG, { kind: 'essay', topic: 'إنهاء عقد الشغل غير محدد المدة في القانون المغربي' });
ok(r.b.ok && r.b.data.mode === 'plan' && r.b.data.parts.length === 2 && r.b.data.parts[0].sections.length === 2 && r.b.data.problem && CALLS.at(-1).body.generationConfig.thinkingConfig.thinkingLevel === 'MEDIUM', 'الموضوع: تصميم بقسمين ومطلبين وإشكالية');
n0 = CALLS.length; ok((await call(ANON, { kind: 'essay', topic: 'إنهاء عقد الشغل غير محدد المدة في القانون المغربي' })).b.cached === true && CALLS.length === n0, 'تصميم الموضوع نفسه من الذاكرة');
ok((await call(GOOG, { kind: 'essay', topic: 'إنهاء عقد الشغل', mode: 'grade', text: 'قصير' })).b.error === 'input', 'تحرير قصير جداً يُرفض');
const ESSAY = 'تقديم: عقد الشغل من أهم العقود... '.repeat(12) + 'الخصوصية الفريدة للتحرير';
r = await call(GOOG, { kind: 'essay', topic: 'إنهاء عقد الشغل غير محدد المدة', mode: 'grade', text: ESSAY });
ok(r.b.ok && r.b.data.intro === 3 && r.b.data.score === 3 + 4 + 3 + 2 + 1 && r.b.data.fixes.length === 1, 'تنقيط التحرير على 20 بمعايير مقيدة بسقوفها');
ok(!sql(`select coalesce(string_agg(payload::text, ''), '') from qt_ai_cache`).includes('الخصوصية الفريدة'), 'نص التحرير لا يُخزَّن');

// نازلة تدريبية — تولَّد من مادة حقيقية، وحلها النموذجي لا يصل إلى الطالب قبل حله، ولا يقيّمها غير صاحبها
ok((await call(GOOG, { kind: 'drill', slug: 'nolaw' })).b.error === 'input', 'قانون غير موجود في المكتبة يُرفض');
n0 = CALLS.length; r = await call(GOOG, { kind: 'drill', slug: 'labour', level: 'hard' });
const drill = r.b.data;
ok(r.b.ok && /^[0-9a-f-]{36}$/.test(drill.id) && drill.facts && drill.questions.length === 1 && drill.slug === 'labour' && !('model' in drill) && !JSON.stringify(drill).includes('القاعدة كذا'), 'النازلة التدريبية: وقائع وأسئلة، والحل النموذجي لا يُرسل');
ok(txt(CALLS.at(-1)).includes('صعبة') && /\[labour:[^\]]+\]/.test(txt(CALLS.at(-1))), 'تُبنى على مواد حقيقية من القانون المختار، بالمستوى المطلوب');
ok(sql(`select payload->>'uid' from qt_ai_cache where key = 'drill:${drill.id}'`).split('\n').pop() === idg, 'الحل النموذجي محفوظ في الخادم باسم صاحب النازلة');
ok((await call(OTHER, { kind: 'drill', id: drill.id, answer: 'حل طويل بما يكفي ليُقبل في التصحيح هنا.' })).b.error === 'notfound', 'لا يقيّم نازلة غيره');
ok((await call(GOOG, { kind: 'drill', id: drill.id, answer: 'قصير' })).b.error === 'input', 'حل قصير جداً يُرفض');
r = await call(GOOG, { kind: 'drill', id: drill.id, answer: 'الإنهاء تعسفي لأن المشغل لم يحترم أجل الإخطار، فيستحق الأجير التعويض.' });
ok(r.b.ok && r.b.data.rule === 8 && r.b.data.application === 6 && r.b.data.score === 8 + 5 + 6 && r.b.data.model[0].answer.includes('القاعدة كذا') && r.b.data.articles.length >= 1, 'التصحيح على 20 بسقوف المعايير، ثم يظهر الحل النموذجي ونصوصه');
sql(`update qt_ai_cache set created_at = now() - interval '4 days' where key = 'drill:${drill.id}'`);
await call(GOOG, { kind: 'drill', slug: 'family' });
ok(sql(`select count(*) from qt_ai_cache where key = 'drill:${drill.id}'`).split('\n').pop() === '0', 'النوازل التدريبية القديمة (أكثر من 3 أيام) تُحذف');

// بطاقات المراجعة — من مادة أو موضوع، بمفاتيح صحيحة، ومحفوظة
SCRIPT.push({ cards: [{ front: 'س', back: 'ج', key: 'labour:9999' }] });
n0 = CALLS.length; r = await call(GOOG, { kind: 'cards', slug: 'labour', n: '13' });
ok(r.b.ok && r.b.data.cards.length === 4 && r.b.data.cards.every(c => c.key.startsWith('labour:')) && CALLS.length - n0 === 2, 'بطاقات المادة: مفتاح مخترع يُرفض ويعاد');
n0 = CALLS.length; ok((await call(ANON, { kind: 'cards', slug: 'labour', n: '13' })).b.cached === true && CALLS.length === n0, 'بطاقات المادة نفسها من الذاكرة');
r = await call(GOOG, { kind: 'cards', topic: 'الفصل التعسفي والتعويض عنه' });
ok(r.b.ok && r.b.data.cards.length === 4 && r.b.data.articles.length >= 1, 'بطاقات من موضوع بالبحث في المكتبة');

// الشفوي — كتابةً أو صوتاً؛ الصوت إلى Gemini بنوعه الصحيح، ونصه المنسوخ لا يُعرض على حارس المراجع
const cs = JSON.parse(sql(`select to_jsonb(k) from qt_kb k where type = 'case' and conf is distinct from 'r' order by id limit 1`).split('\n').pop());
r = await call(GOOG, { kind: 'oral', id: cs.id, answer: 'الحل أن العقد صحيح لأن الشروط متوفرة طبقاً للقانون.' });
ok(r.b.ok && r.b.data.rule === 4 && r.b.data.score === 9, 'الشفوي: المعايير مقيدة بسقوفها (4+3+3)');
ok((await call(GOOG, { kind: 'oral', id: cs.id, answer: 'قصير' })).b.error === 'input', 'جواب شفوي قصير جداً يُرفض');
const AUD = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH' + 'B'.repeat(4000);
n0 = CALLS.length; r = await call(GOOG, { kind: 'oral', id: cs.id, audio: AUD, mime: 'audio/mp4;codecs=mp4a.40.2' });
const ca = CALLS.at(-1), ap = ca.body.contents[0].parts.find(p => p.inlineData);
ok(r.b.ok && r.b.data.voice === true && r.b.data.transcript.includes('9999') && CALLS.length - n0 === 1, 'الشفوي بالصوت: نسخ ثم تنقيط، والرقم الذي قاله الطالب لا يستدعي إعادة');
ok(ap && ap.inlineData.mimeType === 'audio/m4a' && ap.inlineData.data === AUD && Object.keys(schemaOf(ca).properties).includes('transcript'), 'تسجيل iPhone (audio/mp4) يُرسل بنوع audio/m4a');
r = await call(GOOG, { kind: 'oral', id: cs.id, audio: AUD, mime: 'audio/webm;codecs=opus' });
ok(r.b.ok && CALLS.at(-1).body.contents[0].parts.find(p => p.inlineData).inlineData.mimeType === 'audio/webm', 'تسجيل أندرويد (audio/webm) يُرسل كما هو');
ok((await call(GOOG, { kind: 'oral', id: cs.id, audio: AUD, mime: 'video/mp4' })).b.error === 'input', 'نوع صوت غير مدعوم يُرفض');
ok(!sql(`select coalesce(string_agg(payload::text, ''), '') from qt_ai_cache`).includes('GkXfo59'), 'التسجيل الصوتي لا يُخزَّن');

// خطتي — خطوات صالحة للتنفيذ في التطبيق فقط
r = await call(GOOG, { kind: 'plan', stats: { answered: 120, acc: 61, laws: [{ key: 'k1', title: 'مدونة الشغل', a: 30, c: 12 }], branches: [{ id: 'labour', title: 'الشغل', a: 30, c: 12, n: 900 }] } });
const steps = r.b.data.days.flatMap(d => d.steps);
ok(r.b.ok && r.b.data.days.length === 7 && steps.every(s => ['law', 'branch', 'due', 'wrong', 'exam', 'oral', 'daily'].includes(s.kind)), 'الخطة سبعة أيام بخطوات معروفة');
ok(steps.every(s => s.kind !== 'law' || s.ref === 'k1') && steps.every(s => s.n <= 30), 'مرجع قانون مجهول يُصحَّح، والعدد مقيد');
n0 = CALLS.length; ok((await call(GOOG, { kind: 'plan', stats: {} })).b.cached === true && CALLS.length === n0, 'خطة اليوم من الذاكرة');

// أخطاء Gemini: المفتاح، والرصيد المدفوع، والازدحام، والحجب — رسالة واضحة في سجل المؤلف، ولا خصم من رصيد الطالب
let q0 = (await call(GOOG, { kind: 'quota' })).b.left;
SCRIPT.push({ $status: 402, $msg: 'Prepaid credits exhausted', $s: 'PAYMENT_REQUIRED' });
r = await call(GOOG, { kind: 'oral', id: cs.id, answer: 'جواب طويل بما يكفي ليُقبل في الامتحان الشفوي.' });
ok(r.b.ok === false && r.b.error === 'ai' && r.b.left === q0 && lastErr().startsWith('credits: gemini 402'), 'نفاد رصيد Gemini المدفوع (402): خطأ واضح في السجل، ولا خصم');
SCRIPT.push({ $status: 401, $msg: 'API key not valid', $s: 'UNAUTHENTICATED' });
r = await call(GOOG, { kind: 'oral', id: cs.id, answer: 'جواب طويل بما يكفي ليُقبل في الامتحان الشفوي.' });
ok(r.b.ok === false && lastErr().startsWith('key: gemini 401'), 'مفتاح مرفوض (401): «key» في السجل');
SCRIPT.push({ $status: 429, $msg: 'Resource exhausted', $s: 'RESOURCE_EXHAUSTED' }, { $status: 429, $msg: 'Resource exhausted', $s: 'RESOURCE_EXHAUSTED' });
n0 = CALLS.length; r = await call(GOOG, { kind: 'oral', id: cs.id, answer: 'جواب طويل بما يكفي ليُقبل في الامتحان الشفوي.' });
ok(r.b.ok === false && r.b.error === 'busy' && CALLS.length - n0 === 2 && r.b.left === q0, 'ازدحام (429): محاولة ثانية ثم «مشغول» للطالب دون خصم');
SCRIPT.push({ $status: 503, $msg: 'overloaded' });
r = await call(GOOG, { kind: 'oral', id: cs.id, answer: 'جواب طويل بما يكفي ليُقبل في الامتحان الشفوي.' });
ok(r.b.ok === true && r.b.left === q0 - 1, 'عطل عابر (503): المحاولة الثانية تنجح');
q0 = r.b.left;
SCRIPT.push({ $raw: { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, usageMetadata: { promptTokenCount: 50 } } });
r = await call(GOOG, { kind: 'oral', id: cs.id, answer: 'جواب طويل بما يكفي ليُقبل في الامتحان الشفوي.' });
ok(r.b.ok === false && r.b.error === 'blocked' && r.b.left === q0 && lastErr().startsWith('blocked:'), 'طلب محجوب: «blocked» دون خصم');
SCRIPT.push({ $raw: { candidates: [{ content: { parts: [{ text: '{"rule": 2, "basis": 1, "applic' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: {} } });
n0 = CALLS.length; r = await call(GOOG, { kind: 'oral', id: cs.id, answer: 'جواب طويل بما يكفي ليُقبل في الامتحان الشفوي.' });
ok(r.b.ok && CALLS.length - n0 === 2 && CALLS.at(-1).body.generationConfig.maxOutputTokens > CALLS[n0].body.generationConfig.maxOutputTokens, 'جواب مبتور (MAX_TOKENS): يعاد بهامش رموز أكبر');
SCRIPT.push({ $raw: { candidates: [{ content: { parts: [{ text: 'تفكير داخلي', thought: true }, { text: '```json\n' + JSON.stringify({ rule: 1, basis: 1, application: 1, verdict: 'v', strengths: [], gaps: [], model: 'm' }) + '\n```' }] }, finishReason: 'STOP' }] } });
r = await call(GOOG, { kind: 'oral', id: cs.id, answer: 'جواب طويل بما يكفي ليُقبل في الامتحان الشفوي.' });
ok(r.b.ok && r.b.data.score === 3 && !JSON.stringify(r.b.data).includes('تفكير داخلي'), 'أجزاء التفكير تُستبعد، وغلاف ```json يُزال');

// مولّد التمارين (v8.1): أسئلة ومسائل ونوازل وألغاز بصيغة البنك من مواد المكتبة؛ كل تمرين يمر بالقواعد والحارس وحده
const g53 = sql(`select n from qt_law_articles where slug = 'labour' and char_length(body) > 200 order by ord limit 1 offset 40`).split('\n').pop();
const gEmpty = sql(`select slug || '|' || n from qt_law_articles where body = '' order by slug, ord limit 1`).split('\n').pop();
ok((await call(GOOG, { kind: 'gen', slug: 'nolaw', type: 'knowledge' })).b.error === 'input', 'المولّد: قانون مجهول يُرفض');
ok((await call(GOOG, { kind: 'gen', n: '53' })).b.error === 'input', 'المولّد: رقم مادة دون قانون يُرفض');
q0 = (await call(GOOG, { kind: 'quota' })).b.left;
n0 = CALLS.length; r = await call(GOOG, { kind: 'gen', slug: 'labour', n: g53, type: 'knowledge', level: 'easy' });
const cg = CALLS.at(-1), gi = (r.b.data && r.b.data.items) || [];
ok(r.b.ok && gi.length === 5 && CALLS.length - n0 === 1, 'المولّد: خمسة أسئلة من مادة محددة في استدعاء واحد');
ok(gi.every(x => x.options.length === 4 && x.why.length === 4 && x.correct.length >= 1 && x.correct.length <= 3 && x.type === 'knowledge' && x.slug === 'labour'
   && x.branch === 'labour' && x.law.includes('مدونة الشغل') && x.label && x.n && x.difficulty >= 1 && x.difficulty <= 2 && x.hint === ''),
   'كل تمرين بصيغة البنك: أربعة خيارات وتعليل لكل خيار ومادته وفرعه ومستواه، ولا تلميح لغير اللغز');
ok(gi.every(x => r.b.data.articles.some(a => a.key === x.ref)) && r.b.data.articles.every(a => a.slug === 'labour' && a.text.length > 20), 'مرجع كل تمرين مادة مجلوبة، ونصوصها مع التمارين');
ok(txt(cg).includes(`[labour:${g53}]`) && /لا تذكر رقم المادة/.test(txt(cg)) && /جميع ما سبق/.test(txt(cg)) && /toutes les réponses/.test(txt(cg)), 'المادة المطلوبة في المادة المرجعية، والصيغ الممنوعة (بالعربية والفرنسية والإنجليزية) في التعليمات');
ok(mdl(cg) === 'gemini-3.8-flash' && cg.body.generationConfig.thinkingConfig.thinkingLevel === 'LOW' && cg.body.generationConfig.maxOutputTokens >= 700 * 5 + 400 + 3000 && cg.body.store === false,
   'التوليد بـ 3.8 Flash، بتفكير منخفض وهامش رموز كافٍ، ودون حفظ لدى Google');
const gsc = schemaOf(cg).properties.items;
ok(gsc.maxItems === 5 && gsc.items.properties.options.minItems === 4 && gsc.items.properties.options.maxItems === 4 && gsc.items.properties.correct.maxItems === 3
   && gsc.items.properties.type.enum.join() === 'knowledge', 'المخطط يقيّد العدد والخيارات الأربعة والأجوبة (ثلاثة على الأكثر) والنوع');
ok(r.b.left === q0 - 1, 'التوليد يخصم طلباً واحداً');
ok(+sql(`select count(*) from qt_ai_cache where kind = 'gen' or key like 'gen%'`).split('\n').pop() === 0, 'التمارين المولَّدة لا تُحفظ على الخادم');
const GK = `labour:${g53}`;
const gI = (i, x = {}) => ({ type: 'riddle', stem: `لغز رقم ${i}: من أنا؟ أجل يبدأ من يوم التبليغ.`, options: ['الأول ' + i, 'الثاني ' + i, 'الثالث ' + i, 'الرابع ' + i],
                             correct: [2], why: ['ت1', 'ت2', 'ت3', 'ت4'], rule: `القاعدة [${GK}].`, ref: GK, difficulty: 3, hint: 'تلميح.', ...x });
SCRIPT.push({ items: [gI(1), gI(2, { options: ['جميع ما سبق', 'ب', 'ج', 'د'] }), gI(3, { correct: [0, 1] }), gI(4, { ref: 'labour:99999' }),
                      gI(5, { stem: `لغز يكشف مفتاحه [${GK}] في نصه؟` }), gI(6, { options: ['Toutes les réponses', 'b', 'c', 'd'] }), gI(7, { why: ['ت1'] }),
                      gI(8, { rule: 'القاعدة كما في المادة 99999 من مدونة الشغل.' }), gI(9, { options: ['أ', 'أ', 'ج', 'د'] }), gI(10)] });
n0 = CALLS.length; r = await call(GOOG, { kind: 'gen', slug: 'labour', n: g53, type: 'riddle', count: 3 });
ok(r.b.ok && r.b.data.items.length === 2 && CALLS.length - n0 === 1 && r.b.data.items.every(x => x.correct.length === 1 && x.hint === 'تلميح.') && r.b.data.items.map(x => x.stem.slice(0, 9)).join() === 'لغز رقم 1,لغز رقم 1',
   'المخالف يُستبعد وحده دون إعادة: صيغة ممنوعة بالعربية أو الفرنسية، لغز بجوابين، مرجع غير مجلوب، مفتاح في السؤال، تعليل ناقص، مادة مخترعة، خيار مكرر');
ok(schemaOf(CALLS.at(-1)).properties.items.maxItems === 3, 'العدد المطلوب (3) في المخطط');
SCRIPT.push({ items: [gI(1), gI(2, { correct: [] })] });
n0 = CALLS.length; r = await call(GOOG, { kind: 'gen', slug: 'labour', n: g53, type: 'riddle', count: 3 });
ok(r.b.ok && CALLS.length - n0 === 2 && r.b.data.items.length === 3, 'أقل من تمرينين سليمين: يُعاد التوليد مرة بتنبيه صارم');
SCRIPT.push({ items: [gI(1)] }, { items: [] });
q0 = (await call(GOOG, { kind: 'quota' })).b.left;
r = await call(GOOG, { kind: 'gen', slug: 'labour', n: g53, type: 'riddle', count: 3 });
ok(r.b.ok === false && r.b.error === 'ai' && r.b.left === q0 && /gen-invalid/.test(lastErr()), 'تمارين غير صالحة مرتين: اعتذار دون خصم، والسبب في سجل المؤلف');
SCRIPT.push({ items: [gI(1, { type: 'knowledge', correct: [] }), gI(2, { type: 'knowledge', correct: [] }), gI(3, { type: 'knowledge', correct: [0, 1, 3] }), gI(4, { type: 'knowledge' })] });
r = await call(GOOG, { kind: 'gen', slug: 'labour', n: g53, type: 'knowledge' });
ok(r.b.ok && r.b.data.items.length === 3 && r.b.data.items.filter(x => !x.correct.length).length === 1 && r.b.data.items.some(x => x.correct.join() === '0,1,3') && r.b.data.items.every(x => x.hint === ''),
   '«كل الخيارات خاطئة» مقبول مرة واحدة في المجموعة، وثلاثة أجوبة صحيحة مقبولة، ولا تلميح لغير اللغز');
n0 = CALLS.length; r = await call(GOOG, { kind: 'gen', slug: 'labour', type: 'problem', level: 'hard' });
const gpt = txt(CALLS.at(-1));
ok(r.b.ok && r.b.data.items.length >= 2 && r.b.data.items.every(x => x.type === 'problem' && x.slug === 'labour' && x.difficulty >= 4) && (gpt.match(/^\[labour:[^\]]+\]/gm) || []).length >= 2,
   'مسائل من عينة مواد مدونة الشغل، بمستوى صعب');
ok((gpt.match(/^\[labour:[^\]]+\][^\n]*\n[^\n]*(يوما|يوم|أيام|شهرا|شهر|أشهر|سنة|سنوات|ساعة|ساعات|درهم|دراهم|في المائة|%)/gm) || []).length >= 2, 'عينة المسائل من مواد فيها آجال أو مدد أو مقادير');
r = await call(GOOG, { kind: 'gen', type: 'mix', count: 3 });
ok(r.b.ok && r.b.data.items.length === 3 && new Set(r.b.data.items.map(x => x.type)).size === 3 && schemaOf(CALLS.at(-1)).properties.items.items.properties.type.enum.length === 4,
   'مزيج من المكتبة كلها: أنواع مختلفة في مجموعة واحدة');
if (gEmpty) { const [es, en] = gEmpty.split('|'); q0 = (await call(GOOG, { kind: 'quota' })).b.left;
  r = await call(GOOG, { kind: 'gen', slug: es, n: en }); ok(r.b.error === 'empty' && r.b.left === q0, 'مادة بلا نص (منسوخة): لا توليد ولا خصم'); }
r = await call(GOOG, { kind: 'gen', slug: 'labour', n: g53, lang: 'fr', type: 'case', count: 3 });
ok(r.b.ok && /بالفرنسية/.test(txt(CALLS.at(-1))) && r.b.data.items.every(x => x.type === 'case'), 'التمارين بلغة الواجهة، ونوازل حين تُطلب');
r = await call(ANON, { kind: 'quota' });
ok(r.b.kinds && r.b.kinds.includes('gen'), 'نوع «gen» معلن في الرصيد');

// نفاد الرصيد
for (let i = 0; i < 4; i++) await call(ANON, { kind: 'twin', id: lab.id, n: 1 + (i % 2) });
r = await call(ANON, { kind: 'oral', id: cs.id, answer: 'جواب طويل بما يكفي ليُقبل في الامتحان الشفوي.' });
ok(r.b.ok === false && r.b.error === 'quota', 'نفاد الرصيد اليومي');
ok(+sql(`select count(*) from qt_ai_log`).split('\n').pop() >= 8, 'كل استدعاء مسجل للمؤلف (الرموز والزمن والنتيجة)');
ok(r.b.ads && r.b.ads.left === 3 && r.b.ads.per === 3, 'رد نفاد الرصيد يحمل عدد مكافآت الإعلانات المتاحة اليوم');
sql(`select public.qt_ad_grant('admob-tx-ai', '${ida}', 'ai', 'ssv')`);
r = await call(ANON, { kind: 'quota' });
ok(r.b.cap === 7 && r.b.left === 3 && r.b.ads.left === 2 && r.b.ads.ssv === true, 'بعد إعلان مكافأة موثَّق: الرصيد 4 + 3، وتبقى مكافأتان');
r = await call(ANON, { kind: 'oral', id: cs.id, answer: 'جواب طويل بما يكفي ليُقبل في الامتحان الشفوي.' });
ok(r.b.ok === true && r.b.left === 2 && r.b.cap === 7, 'المكافأة تُستعمل فوراً في «المساعد»');

// التوافق: إن رفض الخادم responseFormat أو thinkingConfig يُعاد الطلب بالصيغة البديلة ويُتذكَّر ذلك
SCRIPT.push({ $status: 400, $msg: 'Invalid JSON payload received. Unknown name "responseFormat" at \'generation_config\': Cannot find field.', $s: 'INVALID_ARGUMENT' });
n0 = CALLS.length; r = await call(GOOG, { kind: 'oral', id: cs.id, answer: 'جواب طويل آخر بما يكفي ليُقبل في الامتحان الشفوي.' });
const lg = CALLS.at(-1).body.generationConfig;
ok(r.b.ok && CALLS.length - n0 === 2 && !lg.responseFormat && lg.responseMimeType === 'application/json' && lg.responseJsonSchema.properties.rule, 'responseFormat مرفوض: responseMimeType + responseJsonSchema');
SCRIPT.push({ $status: 400, $msg: 'Thinking level is not supported for this model.', $s: 'INVALID_ARGUMENT' });
n0 = CALLS.length; r = await call(GOOG, { kind: 'oral', id: cs.id, answer: 'جواب طويل ثالث بما يكفي ليُقبل في الامتحان الشفوي.' });
ok(r.b.ok && CALLS.length - n0 === 2 && !CALLS.at(-1).body.generationConfig.thinkingConfig, 'thinkingConfig مرفوض: يعاد دونه');
n0 = CALLS.length; await call(GOOG, { kind: 'oral', id: cs.id, answer: 'جواب طويل رابع بما يكفي ليُقبل في الامتحان الشفوي.' });
ok(CALLS.length - n0 === 1 && CALLS.at(-1).body.generationConfig.responseJsonSchema, 'الصيغة البديلة تُتذكَّر فلا يتكرر الرفض');
console.log(fails.length ? `✗ ${fails.length} فشل` : '✓ المساعد: كل الفحوص نجحت');
process.exit(fails.length ? 1 : 0);
