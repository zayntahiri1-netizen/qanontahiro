\set ON_ERROR_STOP 1
-- v7: مكتبة القوانين التي يجيب منها «المساعد» — التحميل والتحديث والحذف، والتطبيع، والبحث بالجذور، والمطابقة الدقيقة، والصلاحيات
create or replace function public.t_ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', m; end if; end $$;
grant execute on function public.t_ok(boolean,text) to anon, authenticated, service_role;

-- التطبيع: التشكيل والتطويل وصور الألف والياء والتاء المربوطة والهمزات
select t_ok(qt_norm('الأَوْقافُ') = 'الاوقاف', 'norm: diacritics and hamza on alef');
select t_ok(qt_norm('إلى المحكمة مسئولية') = 'الي المحكمه مسيوليه', 'norm: alef maqsura, ta marbuta, hamza on ya');
select t_ok(qt_norm('الـمـادة') = 'الماده', 'norm: tatweel');

-- التحميل: قانونان صغيران بنسخة أولى
select t_ok(qt_law_load('{"slug":"lab_t","key":"مدونة الشغل 65.99","title":"مدونة الشغل","word":"المادة","match":"مدونة الشغل","bank":"مدونة الشغل","stale":[{"law":"99.99","date":"2030-01-01"}],"articles":3}'::jsonb,
  '[{"n":"13","ord":0,"label":"المادة 13","path":"الكتاب الأول","text":"فترة الاختبار، هي الفترة التي يمكن خلالها لأحد الطرفين إنهاء عقد الشغل بإرادته دون أجل إخطار ولا تعويض."},
    {"n":"41","ord":1,"label":"المادة 41","text":"يحق للطرف المتضرر، في حالة إنهاء الطرف الآخر للعقد تعسفيا، مطالبته بالتعويض عن الضرر.","notes":["تم تغيير هذه المادة"]},
    {"n":"16 مكرر","ord":2,"label":"المادة 16 مكرر","text":"","notes":["نسخت"]}]'::jsonb, 's1') = 3, 'load: three articles');
select t_ok(qt_law_load('{"slug":"fam_t","title":"مدونة الأسرة","word":"المادة","articles":1}'::jsonb,
  '[{"n":"166","ord":0,"label":"المادة 166","text":"تستمر الحضانة إلى بلوغ سن الرشد القانوني للذكر والأنثى على حد سواء."}]'::jsonb, 's1') = 1, 'load: second law');
select t_ok(qt_law_stamp() = 's1', 'stamp: one version for the whole library');
select t_ok((select notes->>0 from qt_law_articles where slug = 'lab_t' and n = '41') = 'تم تغيير هذه المادة', 'notes kept apart from the text');
select t_ok((select notes from qt_law_articles where slug = 'fam_t' and n = '166') is null, 'no notes: null');
do $$ begin perform qt_law_load('{"slug":"Bad Slug!"}'::jsonb, '[]'::jsonb, 's1'); raise exception 'FAIL: bad slug accepted';
exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end $$;

-- البحث بالجذور على نص مُطبَّع: «الاختبار» و«الإختبار» سواء، والقانون المقيَّد يحصر البحث
select t_ok((select n from qt_law_search('ما مدة فترة الإختبار في عقد الشغل', 5, null) limit 1) = '13', 'search: probation article first');
select t_ok((select count(*) from qt_law_search('الحضانه سن الرشد', 5, null) where slug = 'fam_t') = 1, 'search: custody found despite ta marbuta written as ha');
select t_ok((select count(*) from qt_law_search('الحضانة سن الرشد', 5, array['lab_t'])) = 0, 'search: restricted to the given laws');
select t_ok((select count(*) from qt_law_search('وصفة حلوى الشباكية بالعسل', 5, null)) = 0, 'search: nothing for an off-topic question');
select t_ok((select count(*) from qt_law_search('', 5, null)) = 0, 'search: empty query');
select t_ok((select count(*) from qt_law_search('نسخت', 5, null) where n = '16 مكرر') = 0, 'search: an article without text is never returned');
select t_ok((select title from qt_law_search('التعويض عن الضرر إنهاء العقد تعسفيا', 3, null) limit 1) = 'مدونة الشغل', 'search: carries the law title');
select t_ok((select stale->0->>'law' from qt_law_search('التعويض عن الضرر', 3, null) limit 1) = '99.99', 'search: carries the staleness notice');

-- المطابقة الدقيقة بالترتيب المطلوب
select t_ok((select string_agg(n, ',' order by ordinality) from (select n, row_number() over () as ordinality from qt_law_get('[{"slug":"lab_t","n":"41"},{"slug":"lab_t","n":"13"},{"slug":"lab_t","n":"999"}]'::jsonb)) x) = '41,13', 'get: exact articles in the requested order, missing ones skipped');
select t_ok((select count(*) from qt_law_get('"not an array"'::jsonb)) = 0, 'get: invalid input gives nothing');

-- نسخة ثانية: تحديث نص، وحذف قانون لم يعد في المكتبة، وإبطال الأجوبة المحفوظة
insert into qt_ai_cache(key, kind, payload) values ('ask:v2:ar:x', 'ask', '{}'), ('why:v2:ar:x', 'why', '{}'), ('plan:v2:ar:x', 'plan', '{}');
select t_ok(qt_law_load('{"slug":"lab_t","title":"مدونة الشغل","word":"المادة","articles":1}'::jsonb,
  '[{"n":"13","ord":0,"label":"المادة 13","text":"نص جديد لفترة الاختبار."}]'::jsonb, 's2') = 1, 'reload with a new version');
select t_ok(qt_law_stamp() is null, 'stamp: mixed versions during an upload');
select t_ok((qt_law_prune('s2')->>'laws_removed')::int = 1 and (qt_law_prune('s2')->>'articles')::int = 1, 'prune: old law and old articles removed');
select t_ok(qt_law_stamp() = 's2' and (select articles from qt_laws where slug = 'lab_t') = 1, 'prune: counts updated');
select t_ok((select body from qt_law_articles where slug = 'lab_t' and n = '13') = 'نص جديد لفترة الاختبار.', 'text updated');
select t_ok(not exists (select 1 from qt_ai_cache where kind in ('ask', 'why')) and exists (select 1 from qt_ai_cache where kind = 'plan'), 'prune: grounded answers invalidated, plans kept');
select t_ok((qt_ai_stats(current_date)->>'articles')::int = 1 and (qt_ai_stats(current_date)->>'laws')::int = 1, 'author stats show the library size');

-- الصلاحيات: لا يقرأ العميل المكتبة ولا يستدعي دوالها؛ الخادم وحده
set role authenticated;
do $$ begin perform * from qt_law_articles; raise exception 'FAIL: client reads articles'; exception when insufficient_privilege then null; end $$;
do $$ begin perform * from qt_laws; raise exception 'FAIL: client reads laws'; exception when insufficient_privilege then null; end $$;
do $$ begin perform * from qt_law_search('الاختبار', 5, null); raise exception 'FAIL: client searches'; exception when insufficient_privilege then null; end $$;
do $$ begin perform qt_law_load('{"slug":"x"}'::jsonb, '[]'::jsonb, 's9'); raise exception 'FAIL: client loads'; exception when insufficient_privilege then null; end $$;
do $$ begin perform qt_law_prune('s9'); raise exception 'FAIL: client prunes'; exception when insufficient_privilege then null; end $$;
reset role;
set role anon;
do $$ begin perform * from qt_law_get('[]'::jsonb); raise exception 'FAIL: anon gets'; exception when insufficient_privilege then null; end $$;
do $$ begin perform qt_norm('x'); raise exception 'FAIL: anon norm'; exception when insufficient_privilege then null; end $$;
reset role;
set role service_role;
select t_ok((select count(*) from qt_law_search('نص جديد الاختبار', 5, null)) = 1, 'service role searches');
reset role;
delete from qt_law_articles; delete from qt_laws;
select 'ALL V7 CHECKS PASSED' as result;
