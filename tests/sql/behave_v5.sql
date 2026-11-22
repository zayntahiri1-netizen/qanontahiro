\set ON_ERROR_STOP 1
-- v5: الترتيب العالمي الكامل، وأسماء Google، وحصص «المساعد» وقاعدة معرفته
create or replace function public.t_ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', m; end if; end $$;
grant execute on function public.t_ok(boolean,text) to anon, authenticated, service_role;
insert into auth.users(id) select ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid from generate_series(10, 16) g
on conflict do nothing;

-- خمسة متنافسين بنقاط مختلفة، كل واحد بجلسته
do $$ declare i int; a text[] := array['أمين','بشرى','حمزة','دنيا','زكرياء']; begin
  for i in 1..5 loop
    perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000' || (9 + i), 'role', 'authenticated')::text, true);
    perform qt_claim(a[i], i * 1000);
    perform qt_push(a[i], jsonb_build_object('byBranch', jsonb_build_object('labour', jsonb_build_object('a', 20 + i, 'c', 10 + i * 2))),
                    i * 300, i * 10, i * 6, '2026-W46', i * 100, false, '2026-11', i * 200, i);
  end loop; end $$;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}', false);
-- انتقال أسبوع وشهر جديدين: الأسبوع المنتهي يُحفظ في سجل الأبطال قبل الكتابة فوقه
select t_ok(qt_push('بشرى', '{}', 700, 22, 13, '2026-W47', 100, false, '2026-12', 100, 3)->>'status' = 'ok', 'push new week');
select t_ok(qt_push('بشرى', '{}', 99999, 23, 13, '2026-W47', 100, false, '2026-12', 100, 3)->>'status' = 'invalid', 'points jump rejected');
select t_ok(qt_push('بشرى', '{}', 700, 22, 13, '2026-W47', 100, false, '2026-12', 100, 99)->>'status' = 'invalid', 'best > answered rejected');
select t_ok(jsonb_array_length(qt_my_aliases()) = 1 and qt_my_aliases()->0->>'alias' = 'بشرى', 'my aliases for this uid');
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select t_ok((select count(*) from qt_board('all', '', 10)) = 5, 'all-time board has five');
select t_ok((select alias from qt_board('all', '', 10) limit 1) = 'زكرياء', 'top by points');
select t_ok((select rank from qt_board('all', '', 10) where alias = 'أمين') = 5, 'explicit rank column');
select t_ok((select count(*) from qt_board('week', '2026-W46', 10)) = 4, 'week board excludes those who moved on');
select t_ok((select count(*) from qt_board('month', '2026-11', 10)) = 4, 'month board');
select t_ok((select acc from qt_board('all', '', 10) where alias = 'حمزة') = 60, 'accuracy column');
select t_ok((qt_my_rank('أمين', 'all', '')->>'rank')::int = 5 and (qt_my_rank('أمين', 'all', '')->>'total')::int = 5, 'my rank and total');
select t_ok((qt_my_rank('أمين', 'all', '')->>'pct')::int = 0 and (qt_my_rank('زكرياء', 'all', '')->>'pct')::int = 100, 'percentile');
select t_ok(jsonb_array_length(qt_my_rank('حمزة', 'all', '')->'near') = 5, 'neighbours around me');
select t_ok(qt_my_rank('غائب', 'all', '') ? 'total' and not (qt_my_rank('غائب', 'all', '') ? 'rank'), 'absent alias: total only');
select t_ok((select alias from qt_board_branch('labour', 10) limit 1) = 'زكرياء', 'branch board by correct answers');
select t_ok((select count(*) from qt_board_branch('family', 10)) = 0, 'branch with no data');
select t_ok(qt_hall('2026-W46', '2026-11')->'w'->0->>'alias' = 'زكرياء', 'hall of fame week');
select t_ok(jsonb_array_length(qt_hall('2026-W46', '2026-11')->'w') = 3, 'hall shows three');
select t_ok(exists (select 1 from jsonb_array_elements(qt_hall('2026-W46', '2026-11')->'w') e where e->>'alias' = 'زكرياء')
            and (select count(*) from qt_board('week', '2026-W46', 10) where alias = 'بشرى') = 0, 'archived week still counted in hall');
do $$ begin perform qt_my_aliases(); raise exception 'FAIL: anon my_aliases'; exception when insufficient_privilege then null; end $$;
do $$ begin perform * from qt_kb_search('حضانة', 3); raise exception 'FAIL: anon kb search'; exception when insufficient_privilege then null; end $$;
do $$ begin perform qt_ai_take(gen_random_uuid(), 5, 10); raise exception 'FAIL: anon ai take'; exception when insufficient_privilege then null; end $$;
reset role;

-- الإخفاء من اللوحة (لوحة المؤلف)
update qt_profiles set hidden = true where alias = 'زكرياء';
set role anon;
select t_ok((select alias from qt_board('all', '', 10) limit 1) = 'دنيا', 'hidden alias leaves the board');
select t_ok(not exists (select 1 from jsonb_array_elements(qt_hall('2026-W46', '2026-11')->'w') e where e->>'alias' = 'زكرياء'), 'hidden alias leaves the hall');
reset role;
update qt_profiles set hidden = false where alias = 'زكرياء';

-- «المساعد»: الحصة اليومية والسقف العام والاسترداد
set role service_role;
select t_ok((qt_ai_take('00000000-0000-0000-0000-000000000010', 2, 100)->>'left')::int = 1, 'quota 1 left');
select t_ok((qt_ai_take('00000000-0000-0000-0000-000000000010', 2, 100)->>'left')::int = 0, 'quota 0 left');
select t_ok(qt_ai_take('00000000-0000-0000-0000-000000000010', 2, 100)->>'why' = 'quota', 'quota exhausted');
select qt_ai_refund('00000000-0000-0000-0000-000000000010');
select t_ok(qt_ai_left('00000000-0000-0000-0000-000000000010', 2) = 1, 'refund restores one');
select t_ok(qt_ai_take('00000000-0000-0000-0000-000000000012', 50, 1)->>'why' = 'budget', 'global daily budget');
select t_ok(qt_kb_load('[{"id":"T-1","branch":"family","difficulty":2,"type":"case","stem":"تسقط الحضانة بزواج الحاضنة","options":["أ","ب","ج","د"],"correct":[0],"explain":"المادة 175","source":{"law":"مدونة الأسرة","ref":"المادة 175"}}]'::jsonb, 's2') = 1, 'kb load');
select t_ok((select id from qt_kb_search('متى تسقط الحضانة؟', 3) limit 1) = 'T-1', 'arabic stemmed search finds the item');
select t_ok((select id from qt_kb_search('المادة 175', 3) limit 1) = 'T-1', 'article number boost');
insert into qt_ai_cache(key, kind, payload) values ('why:x', 'why', '{}');
select qt_kb_prune('s2');
select t_ok((select count(*) from qt_kb) = 1 and (select count(*) from qt_ai_cache) = 0, 'prune keeps current stamp and clears explanation cache');
reset role;
set role authenticated;
do $$ begin perform * from qt_kb; raise exception 'FAIL: client reads kb'; exception when insufficient_privilege then null; end $$;
do $$ begin perform * from qt_ai_cache; raise exception 'FAIL: client reads ai cache'; exception when insufficient_privilege then null; end $$;
reset role;

-- حذف البيانات: حساب Google يُحذف مع آخر أسمائه المستعارة، والحساب المجهول يبقى، وأثر المساعد يزول
insert into auth.users(id, is_anonymous) values ('00000000-0000-0000-0000-0000000000c1', false),
  ('00000000-0000-0000-0000-0000000000c2', true), ('00000000-0000-0000-0000-0000000000c3', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', false);
select t_ok(qt_claim('غيثة', 1)->>'status' = 'new', 'google user claims an alias');
reset role;
insert into qt_ai_usage(day, uid, n) values (current_date, '00000000-0000-0000-0000-0000000000c1', 3), (current_date, '00000000-0000-0000-0000-0000000000c2', 2);
insert into qt_ai_log(uid, kind, model, cached, in_tok, out_tok, ms, ok) values ('00000000-0000-0000-0000-0000000000c1', 'why', 'm', false, 1, 1, 1, true),
  ('00000000-0000-0000-0000-0000000000c2', 'why', 'm', false, 1, 1, 1, true);
insert into qt_ai_cache(key, kind, payload) values ('plan:v1:ar:00000000-0000-0000-0000-0000000000c1:2026-11-21', 'plan', '{}'),
  ('plan:v1:ar:00000000-0000-0000-0000-0000000000c2:2026-11-21', 'plan', '{}');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', false);
select t_ok(qt_forget('غيثة')->>'status' = 'denied', 'another user cannot delete');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', false);
select t_ok(qt_forget('غيثة')->>'account' = 'deleted', 'last alias of a google account: the account is deleted');
reset role;
select t_ok(not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000c1'), 'auth user gone (google email, identities, sessions with it)');
select t_ok(not exists (select 1 from qt_ai_log where uid = '00000000-0000-0000-0000-0000000000c1')
        and not exists (select 1 from qt_ai_usage where uid = '00000000-0000-0000-0000-0000000000c1'), 'advisor traces of that account gone');
select t_ok((select count(*) from qt_ai_cache where kind = 'plan') = 1 and (select count(*) from qt_ai_log) >= 1, 'other users untouched');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', false);
select t_ok(qt_claim('نادر', 2)->>'status' = 'new', 'anonymous user claims');
select t_ok(qt_forget('نادر')->>'status' = 'ok' and not (qt_forget('نادر') ? 'account'), 'anonymous: data deleted, no account deletion');
reset role;
select t_ok(exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000c2')
        and (select n from qt_ai_usage where uid = '00000000-0000-0000-0000-0000000000c2') = 2
        and not exists (select 1 from qt_ai_cache where key like 'plan:%00000000-0000-0000-0000-0000000000c2%'), 'anonymous session and its daily quota kept, its plan cleared');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', false);
select t_ok(qt_claim('مريم', 3)->>'status' = 'new' and qt_claim('مريم ب', 4)->>'status' = 'new', 'google account with two aliases');
select t_ok(qt_forget('مريم')->>'account' = 'kept', 'account kept while another alias remains');
select t_ok(jsonb_array_length(qt_my_aliases()) = 1, 'the other alias is intact');
select t_ok(qt_forget('مريم ب')->>'account' = 'deleted', 'deleted with its last alias');
reset role;
select t_ok(not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000c3'), 'second google account gone');
select 'ALL V5 CHECKS PASSED' as result;
