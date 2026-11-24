\set ON_ERROR_STOP 1
-- v8.2: TAHIRO AI دون رصيد يومي — نافذتا الدقيقة والساعة لكل مستخدم (ضد الإغراق الآلي)، والصمام اليومي العام لكل مسار،
-- وردّ الطلب، والتنظيف، وأرقام المؤلف (البحث والصوت)، والحذف، والصلاحيات (للخادم وحده)
create or replace function public.t_ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', m; end if; end $$;
grant execute on function public.t_ok(boolean,text) to anon, authenticated, service_role;
delete from qt_ai_rate; delete from qt_ai_day; delete from qt_ai_log;
insert into auth.users(id, is_anonymous) values
  ('00000000-0000-0000-0000-0000000082a1', true), ('00000000-0000-0000-0000-0000000082a2', false), ('00000000-0000-0000-0000-0000000082a3', true);

-- بلا حدود: كل الطلبات تمر، والصمام يعدّها
select t_ok((select bool_and((qt_ai_gate('00000000-0000-0000-0000-0000000082a1', 'free', 0, 0, 0)->>'ok')::boolean) from generate_series(1, 50)), 'no limits: 50 requests pass');
select t_ok((select n from qt_ai_day where day = current_date and lane = 'free') = 50, 'no limits: the daily valve still counts');

-- نافذة الدقيقة: 3 ثم يُرفض الرابع، والسبب «rate» بنافذة m
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a1', 'ai', 3, 0, 0)->>'ok')::boolean, 'minute: 1st');
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a1', 'ai', 3, 0, 0)->>'ok')::boolean, 'minute: 2nd');
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a1', 'ai', 3, 0, 0)->>'day')::int = 3, 'minute: 3rd, valve at 3');
select t_ok(qt_ai_gate('00000000-0000-0000-0000-0000000082a1', 'ai', 3, 0, 0) = '{"ok": false, "why": "rate", "win": "m"}'::jsonb, 'minute: 4th refused');
select t_ok((select n from qt_ai_day where day = current_date and lane = 'ai') = 3, 'minute: a refused request is not counted in the valve');
-- مستخدم آخر لا يتأثر بنافذة غيره
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a2', 'ai', 3, 0, 0)->>'ok')::boolean, 'minute: per user');
-- انقضاء النافذة يعيدها إلى 1
update qt_ai_rate set start = now() - interval '61 seconds' where uid = '00000000-0000-0000-0000-0000000082a1' and lane = 'ai' and win = 'm';
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a1', 'ai', 3, 0, 0)->>'ok')::boolean, 'minute: window reset after a minute');
select t_ok((select n from qt_ai_rate where uid = '00000000-0000-0000-0000-0000000082a1' and lane = 'ai' and win = 'm') = 1, 'minute: counter back to 1');

-- نافذة الساعة: ترفض الثالث، وتردّ ما زادته نافذة الدقيقة
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a3', 'hr', 10, 2, 0)->>'ok')::boolean, 'hour: 1st');
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a3', 'hr', 10, 2, 0)->>'ok')::boolean, 'hour: 2nd');
select t_ok(qt_ai_gate('00000000-0000-0000-0000-0000000082a3', 'hr', 10, 2, 0) = '{"ok": false, "why": "rate", "win": "h"}'::jsonb, 'hour: 3rd refused');
select t_ok((select n from qt_ai_rate where uid = '00000000-0000-0000-0000-0000000082a3' and lane = 'hr' and win = 'm') = 2, 'hour: the minute window is refunded');
update qt_ai_rate set start = now() - interval '61 minutes' where uid = '00000000-0000-0000-0000-0000000082a3' and lane = 'hr' and win = 'h';
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a3', 'hr', 10, 2, 0)->>'ok')::boolean, 'hour: window reset after an hour');

-- الصمام اليومي العام: سقف 2 لكل المستخدمين معاً، والثالث «budget» دون أن يبقى أثر في نافذته
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a1', 'tts', 40, 600, 2)->>'ok')::boolean, 'valve: 1st (user 1)');
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a2', 'tts', 40, 600, 2)->>'ok')::boolean, 'valve: 2nd (user 2)');
select t_ok(qt_ai_gate('00000000-0000-0000-0000-0000000082a3', 'tts', 40, 600, 2) = '{"ok": false, "why": "budget"}'::jsonb, 'valve: 3rd refused for everyone');
select t_ok((select coalesce(sum(n), 0) from qt_ai_rate where uid = '00000000-0000-0000-0000-0000000082a3' and lane = 'tts') = 0, 'valve: the refused user windows are refunded');
select t_ok((select n from qt_ai_day where day = current_date and lane = 'tts') = 2, 'valve: stays at its cap');
-- صمام البحث وحده (دون نوافذ)
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a1', 'web', 0, 0, 1)->>'ok')::boolean, 'web valve: 1st');
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a2', 'web', 0, 0, 1)->>'why') = 'budget', 'web valve: 2nd refused');
select t_ok(not exists (select 1 from qt_ai_rate where lane = 'web'), 'web valve: no per-user window');

-- ردّ الطلب: إلى الصمام والنافذتين، ولا ينزل تحت الصفر
select qt_ai_ungate('00000000-0000-0000-0000-0000000082a1', 'tts');
select t_ok((select n from qt_ai_day where day = current_date and lane = 'tts') = 1, 'ungate: valve decremented');
select t_ok((select bool_and(n = 0) from qt_ai_rate where uid = '00000000-0000-0000-0000-0000000082a1' and lane = 'tts'), 'ungate: windows decremented');
select qt_ai_ungate('00000000-0000-0000-0000-0000000082a1', 'tts'); select qt_ai_ungate('00000000-0000-0000-0000-0000000082a1', 'tts');
select t_ok((select n from qt_ai_day where day = current_date and lane = 'tts') = 0
        and (select bool_and(n = 0) from qt_ai_rate where uid = '00000000-0000-0000-0000-0000000082a1' and lane = 'tts'), 'ungate: never below zero');
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a3', 'tts', 40, 600, 2)->>'ok')::boolean, 'ungate: the freed slot is usable again');
select t_ok((qt_ai_gate(null, 'ai', 1, 1, 1)->>'why') = 'bad' and (qt_ai_gate('00000000-0000-0000-0000-0000000082a1', 'A; drop', 1, 1, 1)->>'why') = 'bad', 'gate: bad input');

-- أرقام المؤلف: الأجوبة وحدها في calls، والصوت والبحث والصمامات منفصلة
insert into qt_ai_log(uid, kind, model, cached, in_tok, out_tok, ms, ok, web, lane) values
  ('00000000-0000-0000-0000-0000000082a1', 'chat', 'm', false, 4000, 900, 9000, true, 2, 'ai'),
  ('00000000-0000-0000-0000-0000000082a1', 'chat', 'm', false, 3000, 700, 7000, true, 0, 'ai'),
  ('00000000-0000-0000-0000-0000000082a2', 'tts', 'tts', false, 40, 1000, 3000, true, 0, 'tts'),
  ('00000000-0000-0000-0000-0000000082a2', 'why', 'm', true, 0, 0, 20, true, 0, null);
select t_ok((qt_ai_stats(current_date)->>'calls')::int = 3 and (qt_ai_stats(current_date)->>'tts')::int = 1, 'stats: answers and voice apart');
select t_ok((qt_ai_stats(current_date)->>'web')::int = 2 and (qt_ai_stats(current_date)->>'web_calls')::int = 1, 'stats: web searches');
select t_ok((qt_ai_stats(current_date)->>'in_tok')::int = 7000 and (qt_ai_stats(current_date)->>'tts_out')::int = 1000, 'stats: tokens per lane');
select t_ok((qt_ai_stats(current_date)->'valves'->>'tts')::int = 1 and (qt_ai_stats(current_date)->'kinds'->>'chat')::int = 2, 'stats: valves and kinds');

-- التنظيف: النوافذ المنقضية منذ ساعتين، والصمامات الأقدم من 90 يوماً
insert into qt_ai_day(day, lane, n) values (current_date - 120, 'ai', 9);
update qt_ai_rate set start = now() - interval '3 hours' where uid = '00000000-0000-0000-0000-0000000082a2';
set role service_role;
select qt_ai_gc();
reset role;
select t_ok(not exists (select 1 from qt_ai_rate where uid = '00000000-0000-0000-0000-0000000082a2'), 'gc: old windows removed');
select t_ok(exists (select 1 from qt_ai_rate where uid = '00000000-0000-0000-0000-0000000082a1'), 'gc: fresh windows kept');
select t_ok(not exists (select 1 from qt_ai_day where day = current_date - 120), 'gc: old valves removed');

-- الحذف: نوافذ المستخدم وسجله ودفتر أخطائه تُحذف معه
insert into qt_profiles(alias, owner, secret_hash) values ('طالب_ط', '00000000-0000-0000-0000-0000000082a1', 'x');
insert into qt_ai_cache(key, kind, payload) values ('weak:w1', 'weak', '{"uid":"00000000-0000-0000-0000-0000000082a1"}'),
  ('weak:w2', 'weak', '{"uid":"00000000-0000-0000-0000-0000000082a2"}');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000082a1","role":"authenticated"}', false);
select t_ok((qt_forget('طالب_ط')->>'status') = 'ok', 'forget: ok');
reset role;
select t_ok(not exists (select 1 from qt_ai_rate where uid = '00000000-0000-0000-0000-0000000082a1')
        and not exists (select 1 from qt_ai_log where uid = '00000000-0000-0000-0000-0000000082a1'), 'forget: windows and log removed');
select t_ok(not exists (select 1 from qt_ai_cache where key = 'weak:w1') and exists (select 1 from qt_ai_cache where key = 'weak:w2'), 'forget: own notebook removed, others kept');

-- الصلاحيات: الحارس والردّ والجداول للخادم وحده
set role authenticated;
do $$ begin perform qt_ai_gate('00000000-0000-0000-0000-0000000082a1', 'ai', 0, 0, 0); raise exception 'FAIL: client opens the gate'; exception when insufficient_privilege then null; end $$;
do $$ begin perform qt_ai_ungate('00000000-0000-0000-0000-0000000082a1', 'ai'); raise exception 'FAIL: client refunds'; exception when insufficient_privilege then null; end $$;
do $$ begin perform 1 from qt_ai_rate; raise exception 'FAIL: client reads windows'; exception when insufficient_privilege then null; end $$;
do $$ begin perform 1 from qt_ai_day; raise exception 'FAIL: client reads valves'; exception when insufficient_privilege then null; end $$;
reset role;
set role anon;
do $$ begin perform qt_ai_gate('00000000-0000-0000-0000-0000000082a1', 'ai', 0, 0, 0); raise exception 'FAIL: anon opens the gate'; exception when insufficient_privilege then null; end $$;
reset role;
set role service_role;
select t_ok((qt_ai_gate('00000000-0000-0000-0000-0000000082a2', 'ai', 5, 50, 0)->>'ok')::boolean, 'service role opens the gate');
reset role;
delete from qt_ai_rate; delete from qt_ai_day; delete from qt_ai_log; delete from qt_ai_cache;
delete from auth.users where id in ('00000000-0000-0000-0000-0000000082a1', '00000000-0000-0000-0000-0000000082a2', '00000000-0000-0000-0000-0000000082a3');
select 'ALL V8.2 CHECKS PASSED' as result;
