// وحدة مشتركة لاختبارات المتصفح (v8.2): بديل Gemini API الذي تستدعيه دالة TAHIRO AI الحقيقية في Node.
// generateContent: ردّ بحسب مخطط الطلب (كما كان في e2e_v5)، وInteractions: الدردشة بالأقسام والمصادر واقتراحات البحث، والصوت (WAV قصير صالح للتشغيل).
const SUGG = '<style>.container{display:flex;gap:6px;flex-wrap:wrap}.chip{display:inline-block;border:1px solid #1a73e8;border-radius:16px;padding:4px 10px;color:#1a73e8;font:13px sans-serif;text-decoration:none}</style>'
  + '<div class="container"><a class="chip" href="https://www.google.com/search?q=%D9%85%D8%AF%D9%88%D9%86%D8%A9+%D8%A7%D9%84%D8%B4%D8%BA%D9%84">مدونة الشغل آخر تعديل</a><img src=x onerror="window.__xss=1"></div><script>window.__xss=2</script>';
function wav(ms = 400, rate = 16000) {
  const n = Math.round(rate * ms / 1000) * 2, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n / 2; i++) b.writeInt16LE(Math.round(Math.sin(i / 9) * 900), 44 + i * 2);
  return b.toString('base64');
}
const WAV = wav();
const ixText = body => (body.input || []).map(st => (st.content || []).map(x => x.text || '').join('')).join('\n');
function chatText(u, web) {
  if (/رادار المستجدات/.test(u))
    return '[[LIB]]\nالصيغة المعتمدة في المكتبة لمدونة الشغل مؤرخة، ولا تعديل مسجل بعدها في المكتبة.\n[[WEB]]\n- 2026-10-01: مرسوم تطبيقي جديد منشور في الجريدة الرسمية (نافذ).\n- 2026-07-15: مشروع قانون لتعديل مقتضيات الإضراب قيد الدراسة (مشروع).\n[[AI]]\nيهمك في الامتحان التمييز بين النافذ والمشروع.\n[[NEXT]]\nما أثر المرسوم الجديد؟\nمتى يدخل حيز التنفيذ؟';
  const k = ([...u.matchAll(/^\[([a-z_]+:[^\]\s][^\]]*)\]/gm)][0] || [])[1];
  const id = (u.match(/\[([A-Z]{2,5}-\d{1,5})\]/) || [])[1];
  return `[[LIB]]\n**فترة الاختبار** يجوز خلالها إنهاء العقد دون إخطار ولا تعويض${k ? ` [${k}]` : ''}${id ? ` [${id}]` : ''}.\n- للأطر وأشباههم مدة أطول.\n- وللمستخدمين مدة أقصر.\n`
    + `[[AI]]\nالغاية من فترة الاختبار أن يتعرف كل طرف على الآخر قبل استقرار العلاقة.\n`
    + (web ? '[[WEB]]\nلا تعديل جديد على هذه المقتضيات منذ آخر صيغة منشورة (2025).\n' : '')
    + '[[NEXT]]\n- ما مدة الاختبار للعمال؟\n- متى يلزم الإخطار؟';
}
function ixReply(body) {
  if (body.response_format && body.response_format.type === 'audio')
    return { id: 'ix-tts', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: WAV }] }], usage: { total_input_tokens: 30, total_output_tokens: 300 } };
  const web = (body.tools || []).some(t => t.type === 'google_search');
  const steps = [{ type: 'thought', summary: [{ type: 'text', text: 'تفكير داخلي' }], signature: 's' }];
  if (web) steps.push({ type: 'google_search_call', id: 'g1', arguments: { queries: ['مدونة الشغل آخر تعديل'] } },
                      { type: 'google_search_result', call_id: 'g1', result: [{ search_suggestions: SUGG }] });
  steps.push({ type: 'model_output', content: [{ type: 'text', text: chatText(ixText(body), web),
    annotations: web ? [{ type: 'url_citation', url: 'https://www.sgg.gov.ma/BO/AR/2026.pdf', title: 'sgg.gov.ma', start_index: 0, end_index: 9 }] : [] }] });
  return { id: 'ix-1', status: 'completed', steps, usage: { total_input_tokens: 2500, total_output_tokens: 500, total_thought_tokens: 120, ...(web ? { grounding_tool_count: [{ type: 'google_search', count: 1 }] } : {}) } };
}
function install(GEM, real) {
  globalThis.fetch = async (url, o) => {
    if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return real(url, o);
    const body = JSON.parse(o.body);
    GEM.push({ url: String(url), body });
    if (String(url).endsWith('/interactions')) return new Response(JSON.stringify(ixReply(body)), { status: 200 });
    const sc = body.generationConfig.responseFormat?.text?.schema ?? body.generationConfig.responseJsonSchema ?? {};
    const u = body.contents[0].parts.filter(p => typeof p.text === 'string').map(p => p.text).join('\n'), props = Object.keys(sc.properties ?? {});
    const keys = [...new Set([...u.matchAll(/\[([a-z_]+:[^\]\s][^\]]*)\]/g)].map(m => m[1]))], art = keys[0] || '';
    const id = (u.match(/\[([A-Z]+-\d+)\]/) || [])[1] || 'X', L = ['أ', 'ب', 'ج', 'د'];
    const obj = props.includes('terms') ? { laws: ['labour'], terms: ['فترة الاختبار', 'الفصل التعسفي', 'التعويض عن الفصل'], refs: [{ slug: 'labour', n: '13' }, { slug: 'labour', n: '41' }] }
      : props.includes('legal') ? { legal: true, type: 'mcq', text: 'ما المدة القصوى لفترة الاختبار بالنسبة للأطر وأشباههم في مدونة الشغل؟', options: ['ثلاثة أشهر', 'سنة كاملة', 'شهر ونصف', 'خمسة عشر يوماً'] }
      : props.includes('verdicts') ? { verdicts: Array.from({ length: sc.properties.verdicts.minItems || 4 }, (_, i) => ({ letter: L[i], ok: i === 0, why: i === 0 ? `هذه مدة الأطر وأشباههم [${art}].` : 'لا تطابق المدة المحددة في النص.' })), rule: `**مدة الاختبار القصوى** محددة بحسب الفئة [${art}].`, covered: true, arts: [art] }
      : props.includes('issues') ? { facts: `أجير فُصل دون سبب بعد أقدمية طويلة [${art}].`, issues: [{ point: 'هل الفصل تعسفي؟', rule: `للمتضرر من الإنهاء التعسفي التعويض [${art}].`, arts: [art], apply: 'الفصل دون سبب ودون إخطار تعسفي.' }], conclusion: 'يستحق التعويض.', missing: ['مدة الأقدمية بدقة', 'هل وقع إخطار كتابي؟'], covered: true, arts: [art], followups: ['كيف يُحسب التعويض؟', 'ما أجل رفع الدعوى؟'] }
      : props.includes('rows') ? { intro: `فترة الاختبار مرحلة أولى من العقد [${art}]، وأجل الإخطار مهلة قبل الإنهاء.`, rows: [{ aspect: 'التوقيت', a: `في بداية العقد [${art}]`, b: 'عند إنهاء العقد' }, { aspect: 'الأثر', a: 'إنهاء دون تعويض', b: 'إنهاء بعد مهلة' }, { aspect: 'من يتمسك به', a: 'الطرفان', b: 'الطرفان' }], same: ['كلاهما يتعلق بإنهاء عقد الشغل'], summary: 'الأولى تجربة، والثاني مهلة.', trap: 'الخلط بين انقضاء الاختبار والإخطار.', covered: true, arts: [art] }
      : props.includes('trap') ? { title: 'فخ الأجل', trap: 'خلطتَ بين الأجلين.', options: L.map((l, i) => ({ letter: l, ok: i === 0, why: 'كما في التعليل.' })), rule: '**القاعدة** كما في التعليل.', hook: 'الأول هو الصحيح.', check: { q: 'ما الحكم؟', a: 'كما في التعليل.' } }
      : props.includes('items') ? (() => { const ip = sc.properties.items, tp = ip.items.properties.type.enum, cnt = ip.maxItems || 5;
          const ks = [...new Set([...u.matchAll(/^\[([a-z_]+:[^\]\s][^\]]*)\]/gm)].map(m => m[1]))];
          return { items: Array.from({ length: cnt }, (_, i) => { const t = tp[i % tp.length], k = ks[i % ks.length];
            return { type: t, stem: t === 'riddle' ? `لغز ${i + 1}: أبدأ مع العقد وأنتهي قبل أن يستقر، ولا إخطار فيّ ولا تعويض. فمن أنا؟` : `تمرين ${i + 1}: ما حكم إنهاء العقد خلال فترة الاختبار؟`,
              options: ['أجل الإخطار', 'فترة الاختبار', 'العطلة السنوية', 'الراحة الأسبوعية'].map(o => o + (i ? ' ' + (i + 1) : '')), correct: [1],
              why: ['ليس هو: الإخطار يكون بعد انتهاء فترة الاختبار.', `هو المقصود: يجوز فيها الإنهاء دون إخطار ولا تعويض [${k}].`, 'لا علاقة لها بإنهاء العقد.', 'لا علاقة لها بإنهاء العقد أيضاً.'],
              rule: `**فترة الاختبار** يجوز خلالها إنهاء العقد دون إخطار ولا تعويض [${k}].`, ref: k, difficulty: 3, hint: t === 'riddle' ? 'فكّر في بداية عقد الشغل.' : '' }; }) }; })()
      : props.includes('stem') ? { stem: 'نازلة توأم بوقائع أخرى؟', options: ['خيار صحيح', 'خيار خاطئ أول', 'خيار خاطئ ثان', 'خيار خاطئ ثالث'], correct: [0], explain: 'التعليل من المرجع نفسه.', rule: 'القاعدة.' }
      : props.includes('simple') ? { simple: `تحدد هذه المادة معنى فترة الاختبار: مدة يجرب فيها كل طرف الآخر وينهي العقد دون إخطار ولا تعويض [${art}].`, elements: ['عقد شغل قائم', 'إنهاء خلال الفترة نفسها'], effects: ['لا إخطار ولا تعويض في الأصل'], exceptions: ['بعد أسبوع شغل يلزم أجل إخطار'], example: { facts: 'شغّلت «شركة س» الأجير «أ» ثم أنهت عقده في اليوم الخامس.', solution: `الإنهاء صحيح دون تعويض [${art}].` }, traps: ['الخلط بين الاختبار والإخطار'], hook: 'الاختبار تجربة لا التزام.', related: keys[1] ? [{ key: keys[1], why: 'تحدد مدد الاختبار.' }] : [] }
      : props.includes('parts') ? { intro: 'يحظى إنهاء عقد الشغل بأهمية بالغة.', problem: 'كيف وازن المشرع بين حرية الإنهاء وحماية الأجير؟', subq: ['ما شروط الإنهاء؟', 'ما جزاء الإنهاء التعسفي؟'], parts: [1, 2].map(p => ({ title: p === 1 ? 'شروط الإنهاء' : 'آثار الإنهاء', sections: [1, 2].map(x => ({ title: 'المطلب ' + x, points: [`فكرة مسندة [${art}]`, 'فكرة ثانية'] })) })), conclusion: 'خلاصة وأفق.', tips: ['ابدأ بتحديد المفاهيم'], covered: true, arts: [art] }
      : props.includes('structure') ? { intro: 2, problem: 3, structure: 3, basis: 2, analysis: 2, verdict: 'تحرير متوسط يحتاج إسناداً أقوى.', strengths: ['تصميم واضح'], gaps: ['إسناد ضعيف'], fixes: [`استند إلى النص صراحة [${art}].`], better: ['القسم الأول: الشروط', 'القسم الثاني: الآثار'], arts: [art] }
      : props.includes('questions') ? { title: 'الأجير والإنهاء المبكر', facts: 'اشتغل «أ» لدى «شركة س» عشرة أيام بعقد غير محدد المدة، ثم أخبرته الشركة شفوياً بانتهاء علاقة الشغل دون أي مهلة.', questions: ['ما حكم الإنهاء؟ وما حقوق «أ»؟'], model: [{ answer: `فترة الاختبار تجيز الإنهاء دون تعويض [${art}]، لكن بعد أسبوع يلزم أجل الإخطار؛ فالإنهاء دون مهلة مخالف.`, arts: [art] }] }
      : props.includes('branches') ? { root: 'فترة الاختبار وإنهاء العقد', branches: [['المفهوم', 'تجربة متبادلة بين الطرفين'], ['المدة', 'تختلف بحسب فئة الأجير'], ['الإنهاء', 'دون إخطار ولا تعويض في الأصل'], ['الاستثناء', 'بعد أسبوع شغل يلزم الإخطار']].map(([b, k]) => ({ t: b, k: art, kids: [{ t: k, k: art }, { t: 'تفصيل من النص', k: keys[1] || art }] })), hook: 'الاختبار تجربة لا التزام.' }
      : props.includes('groups') ? (() => { const ids = [...new Set([...u.matchAll(/\[([A-Z]+-\d+)\]/g)].map(m => m[1]))];
          return { headline: 'أغلب أخطائك في الآجال والجهات المختصة.', groups: [{ title: 'الخلط بين الآجال', ids: ids.slice(0, 3), why: 'تخلط بين أجلين متقاربين.', lesson: `الأجل يبدأ من التبليغ [${ids[0]}]، ولا يمتد إلا بنص.`, tip: 'التبليغ أولاً ثم العدّ.' },
                                                                                       { title: 'الجهة المختصة', ids: ids.slice(3, 6), why: 'تنسب الاختصاص لغير صاحبه.', lesson: 'لكل نزاع جهته كما في التعليلات.', tip: 'اسأل: من ينظر؟' }] }; })()
      : props.includes('lang') && props.includes('text') ? { text: 'ما هي مدة فترة الاختبار بالنسبة للأطر في مدونة الشغل؟', lang: 'ar' }
      : props.includes('cards') ? { cards: ['ما فترة الاختبار؟', 'متى يلزم الإخطار خلالها؟', 'هل يُستحق تعويض؟', 'من يملك الإنهاء؟'].map((f, i) => ({ front: f, back: 'الجواب ' + (i + 1) + ' كما في النص.', key: art })) }
      : props.includes('covered') ? { answer: `الحكم كذا${art ? ` [${art}]` : ''}${id !== 'X' ? ` [${id}]` : ''}.`, covered: true, arts: art ? [art] : [], cites: id !== 'X' ? [id] : [], followups: ['ما الاستثناء؟', 'ما الجزاء؟'] }
      : props.includes('application') && props.includes('model') ? { ...(props.includes('transcript') ? { transcript: 'العقد صحيح لأن أركانه متوفرة.' } : {}), rule: 4, basis: 2, application: 3, verdict: 'جواب جيد.', strengths: ['حدد القاعدة'], gaps: ['لم يذكر المرجع'], model: 'الجواب النموذجي.' }
      : props.includes('application') ? { rule: 6, basis: 4, application: 4, verdict: 'حل جيد ينقصه السند.', strengths: ['حدد القاعدة'], gaps: [`لم تذكر أجل الإخطار [${art}]`] }
      : { headline: 'ابدأ بالأضعف.', days: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, title: 'يوم ' + (i + 1), minutes: 30, steps: [{ kind: 'branch', ref: 'labour', n: 10, why: 'توازن' }, { kind: 'due', ref: '', n: 10, why: 'مراجعة' }] })) };

    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 250, thoughtsTokenCount: 60 } }), { status: 200 });
  };
}
module.exports = { install, SUGG, WAV };
