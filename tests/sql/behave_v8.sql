\set ON_ERROR_STOP 1
-- v8: أدوات «المساعد» الجديدة على القاعدة — المواد المجاورة، والمادة العشوائية للنازلة التدريبية، وإبطال الذاكرة،
-- وحذف النوازل التدريبية القديمة، وتوزيع الطلبات على الأدوات، وحذف بيانات المستخدم، والصلاحيات
create or replace function public.t_ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', m; end if; end $$;
grant execute on function public.t_ok(boolean,text) to anon, authenticated, service_role;
delete from qt_ai_cache; delete from qt_ai_log;

select t_ok(qt_law_load('{"slug":"lab_t","title":"مدونة الشغل","word":"المادة","articles":5}'::jsonb,
  '[{"n":"12","ord":0,"label":"المادة 12","text":"نص المادة الثانية عشرة، وهو نص قصير."},
    {"n":"13","ord":1,"label":"المادة 13","text":"فترة الاختبار، هي الفترة التي يمكن خلالها لأحد الطرفين إنهاء عقد الشغل بإرادته دون أجل إخطار ولا تعويض. وهذه جملة إضافية تجعل النص أطول من الحد الأدنى المطلوب لنازلة تدريبية، فتصلح المادة لبناء نازلة عليها في الاختبار."},
    {"n":"14","ord":2,"label":"المادة 14","text":"نص المادة الرابعة عشرة."},
    {"n":"15","ord":3,"label":"المادة 15","text":""},
    {"n":"16","ord":4,"label":"المادة 16","text":"نص المادة السادسة عشرة."}]'::jsonb, 's1') = 5, 'load');
select t_ok(qt_law_load('{"slug":"fam_t","title":"مدونة الأسرة","word":"المادة","articles":1}'::jsonb,
  '[{"n":"166","ord":0,"label":"المادة 166","text":"تستمر الحضانة إلى بلوغ سن الرشد القانوني للذكر والأنثى على حد سواء."}]'::jsonb, 's1') = 1, 'load 2');

-- المواد المجاورة بالترتيب، دون المادة نفسها، وبسقف ثلاث من كل جهة
select t_ok((select string_agg(n, ',' order by ord) from (select n, row_number() over () as ord from qt_law_near('lab_t', '13', 1)) x) = '12,14', 'near: one before and one after, in order');
select t_ok((select count(*) from qt_law_near('lab_t', '13', 2)) = 3, 'near k=2: 12, 14, 15 (16 is three away)');
select t_ok((select count(*) from qt_law_near('lab_t', '13', 99)) = 4, 'near: k capped at 3');
select t_ok((select count(*) from qt_law_near('lab_t', '999', 1)) = 0, 'near: unknown article gives nothing');
select t_ok((select count(*) from qt_law_near('lab_t', '13', 1) where slug <> 'lab_t') = 0, 'near: never crosses into another law');
select t_ok((select title from qt_law_near('lab_t', '12', 1) limit 1) = 'مدونة الشغل', 'near: carries the law title');

-- المادة العشوائية: نص بطول معقول، ومن القانون المطلوب وحده
select t_ok((select n from qt_law_pick(array['lab_t'], 120, 2500)) = '13', 'pick: the only article long enough');
select t_ok((select count(*) from qt_law_pick(array['fam_t'], 250, 2500)) = 0, 'pick: nothing when no article fits');
select t_ok((select count(*) from qt_law_pick(null, 20, 2500)) = 1, 'pick: any law when none is given');
select t_ok((select bool_and(char_length(body) >= 40) from qt_law_pick(null, 0, 2500)), 'pick: never an empty or one-line article (minimum 40)');

-- إبطال الذاكرة بعد تحميل المكتبة: الأجوبة المؤسَّسة على النصوص تُحذف، وتبقى الخطط والنوازل التدريبية
insert into qt_ai_cache(key, kind, payload) values ('ask:v3:ar:x', 'ask', '{}'), ('explain:v3:ar:lab_t:13', 'explain', '{}'), ('compare:v3:ar:y', 'compare', '{}'),
  ('cards:v3:ar:z', 'cards', '{}'), ('essay:v3:ar:w', 'essay', '{}'), ('plan:v3:ar:u:2026-11-23', 'plan', '{}'), ('drill:d1', 'drill', '{"uid":"00000000-0000-0000-0000-000000000001"}');
select qt_law_prune('s1');
select t_ok(not exists (select 1 from qt_ai_cache where kind in ('ask', 'explain', 'compare', 'cards', 'essay')), 'prune: grounded answers of all tools invalidated');
select t_ok((select count(*) from qt_ai_cache where kind in ('plan', 'drill')) = 2, 'prune: plans and drills kept');

-- النوازل التدريبية القديمة تُحذف بعد ثلاثة أيام، والحديثة تبقى
insert into qt_ai_cache(key, kind, payload, created_at) values ('drill:old', 'drill', '{}', now() - interval '4 days'), ('plan:old', 'plan', '{}', now() - interval '9 days');
select t_ok(qt_ai_gc() = 1, 'gc: one old drill removed');
select t_ok(exists (select 1 from qt_ai_cache where key = 'drill:d1') and exists (select 1 from qt_ai_cache where key = 'plan:old'), 'gc: recent drills and all plans kept');

-- توزيع الطلبات على الأدوات في أرقام المؤلف
insert into qt_ai_log(uid, kind, model, cached, in_tok, out_tok, ms, ok) values
  (null, 'scan', 'gemini-3.8-flash', false, 1500, 400, 900, true), (null, 'scan', 'gemini-3.8-flash', false, 1500, 400, 900, true),
  (null, 'explain', 'gemini-3.8-flash', true, 0, 0, 20, true);
select t_ok((qt_ai_stats(current_date)->'kinds'->>'scan')::int = 2 and (qt_ai_stats(current_date)->'kinds'->>'explain')::int = 1, 'stats: calls per tool');
select t_ok((qt_ai_stats(current_date)->>'calls')::int = 3 and (qt_ai_stats(current_date)->>'articles')::int = 6, 'stats: totals and library size kept');
select t_ok(qt_ai_stats(current_date - 30)->'kinds' = '{}'::jsonb, 'stats: empty day');

-- حذف البيانات: النوازل التدريبية للمستخدم تُحذف معه، ونوازل غيره تبقى
insert into auth.users(id, is_anonymous) values ('00000000-0000-0000-0000-000000000001', true), ('00000000-0000-0000-0000-000000000002', true);
insert into qt_profiles(alias, owner, secret_hash) values ('طالب_ث', '00000000-0000-0000-0000-000000000001', 'x');
insert into qt_ai_cache(key, kind, payload) values ('drill:d2', 'drill', '{"uid":"00000000-0000-0000-0000-000000000002"}');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', false);
select t_ok((qt_forget('طالب_ث')->>'status') = 'ok', 'forget: ok');
reset role;
select t_ok(not exists (select 1 from qt_ai_cache where key = 'drill:d1') and exists (select 1 from qt_ai_cache where key = 'drill:d2'), 'forget: own drills removed, others kept');

-- الصلاحيات: الدوال الجديدة للخادم وحده
set role authenticated;
do $$ begin perform * from qt_law_near('lab_t', '13', 1); raise exception 'FAIL: client reads near'; exception when insufficient_privilege then null; end $$;
do $$ begin perform * from qt_law_pick(null, 0, 99); raise exception 'FAIL: client picks'; exception when insufficient_privilege then null; end $$;
do $$ begin perform qt_ai_gc(); raise exception 'FAIL: client gc'; exception when insufficient_privilege then null; end $$;
reset role;
set role anon;
do $$ begin perform * from qt_law_near('lab_t', '13', 1); raise exception 'FAIL: anon reads near'; exception when insufficient_privilege then null; end $$;
do $$ begin perform qt_forget('x'); raise exception 'FAIL: anon forgets'; exception when insufficient_privilege then null; end $$;
reset role;
set role service_role;
select t_ok((select count(*) from qt_law_near('lab_t', '13', 1)) = 2 and qt_ai_gc() = 0, 'service role uses the new functions');
reset role;
delete from qt_ai_cache; delete from qt_ai_log; delete from qt_law_articles; delete from qt_laws;
select 'ALL V8 CHECKS PASSED' as result;
