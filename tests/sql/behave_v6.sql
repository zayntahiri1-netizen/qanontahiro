\set ON_ERROR_STOP 1
-- v6: مكافآت الإعلانات تموّل «المساعد» — الحد اليومي، والمعاملة الفريدة، والمطالبة الذاتية قبل التحقق الموقَّع، والحذف
create or replace function public.t_ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', m; end if; end $$;
grant execute on function public.t_ok(boolean,text) to anon, authenticated, service_role;
insert into auth.users(id, is_anonymous) values ('00000000-0000-0000-0000-0000000000a1', true), ('00000000-0000-0000-0000-0000000000a2', false),
  ('00000000-0000-0000-0000-0000000000a3', true)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;
delete from qt_ad_rewards;

-- البداية: لا مكافأة، وثلاث متاحة
select t_ok((qt_ad_today('00000000-0000-0000-0000-0000000000a1')->>'bonus')::int = 0
        and (qt_ad_today('00000000-0000-0000-0000-0000000000a1')->>'left')::int = 3
        and (qt_ad_today('00000000-0000-0000-0000-0000000000a1')->>'ssv')::boolean = false, 'start: no bonus, three rewards available');

-- المطالبة الذاتية (قبل أي استدعاء موقَّع من AdMob)
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', false);
select t_ok((qt_ad_claim('ai')->>'bonus')::int = 3, 'client claim before ssv: +3');
select t_ok(qt_ad_claim('ai')->>'why' = 'soon', 'a second claim within 25 seconds is refused');
reset role;
update qt_ad_rewards set at = now() - interval '1 minute';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', false);
select t_ok((qt_ad_claim('ai')->>'bonus')::int = 6, 'second claim after a minute: +6 in total');
reset role;
update qt_ad_rewards set at = now() - interval '1 minute';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', false);
select t_ok((qt_ad_claim('ai')->>'left')::int = 0, 'third claim: daily rewards used up');
reset role;
update qt_ad_rewards set at = now() - interval '1 minute';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', false);
select t_ok(qt_ad_claim('ai')->>'why' = 'limit', 'fourth claim: daily limit');
select t_ok(qt_ad_claim('hack')->>'ok' = 'false', 'unknown reward kind refused');
-- صلاحيات: لا يقرأ العميل السجل ولا يمنح نفسه مباشرة
do $$ begin perform * from qt_ad_rewards; raise exception 'FAIL: client reads rewards'; exception when insufficient_privilege then null; end $$;
do $$ begin perform qt_ad_grant('x', '00000000-0000-0000-0000-0000000000a1', 'ai', 'ssv'); raise exception 'FAIL: client grants'; exception when insufficient_privilege then null; end $$;
do $$ begin perform qt_ad_today('00000000-0000-0000-0000-0000000000a1'); raise exception 'FAIL: client reads today'; exception when insufficient_privilege then null; end $$;
reset role;
set role anon;
do $$ begin perform qt_ad_claim('ai'); raise exception 'FAIL: anon claims'; exception when insufficient_privilege then null; end $$;
reset role;

-- الحصة: الحد الأساسي + المكافأة، والخصم يحترمها
select t_ok(qt_ai_left('00000000-0000-0000-0000-0000000000a1', 4) = 13, 'advisor quota = base 4 + bonus 9');
select t_ok((qt_ai_take('00000000-0000-0000-0000-0000000000a1', 4, 100000)->>'left')::int = 12, 'taking uses the bonus too');
update qt_ai_usage set n = 13 where uid = '00000000-0000-0000-0000-0000000000a1' and day = current_date;
select t_ok(qt_ai_take('00000000-0000-0000-0000-0000000000a1', 4, 100000)->>'why' = 'quota', 'beyond base + bonus: quota');

-- أول استدعاء موقَّع من AdMob يغلق المطالبة الذاتية للجميع
select t_ok((qt_ad_grant('admob-tx-1', '00000000-0000-0000-0000-0000000000a3', 'ai', 'ssv')->>'bonus')::int = 3, 'verified grant');
select t_ok(qt_ad_grant('admob-tx-1', '00000000-0000-0000-0000-0000000000a3', 'ai', 'ssv')->>'dup' = 'true', 'same transaction twice: counted once');
select t_ok((select count(*) from qt_ad_rewards where tx = 'admob-tx-1') = 1, 'one row per transaction');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', false);
select t_ok(qt_ad_claim('ai')->>'why' = 'ssv', 'after the first verified callback, client claims are closed');
reset role;
select t_ok((qt_ad_today('00000000-0000-0000-0000-0000000000a3')->>'ssv')::boolean, 'today reports verified mode');
select t_ok((qt_ad_stats(current_date)->>'rewards')::int = 4 and (qt_ad_stats(current_date)->>'ssv')::int = 1, 'author stats count rewards by source');

-- الحذف: حساب Google يُحذف ومعه مكافآته؛ والمجهول يبقى سجله (حدّه اليومي)
select qt_ad_grant('admob-tx-2', '00000000-0000-0000-0000-0000000000a2', 'ai', 'ssv');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', false);
select t_ok(qt_claim('مكافأة', 7)->>'status' = 'new', 'google user alias');
select t_ok(qt_forget('مكافأة')->>'account' = 'deleted', 'google account deleted with its last alias');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', false);
select t_ok(qt_claim('مجهول', 8)->>'status' = 'new', 'anonymous alias');
select t_ok(qt_forget('مجهول')->>'status' = 'ok', 'anonymous data deleted');
reset role;
select t_ok(not exists (select 1 from qt_ad_rewards where uid = '00000000-0000-0000-0000-0000000000a2'), 'google account rewards gone');
select t_ok((select count(*) from qt_ad_rewards where uid = '00000000-0000-0000-0000-0000000000a1') = 3, 'anonymous daily rewards kept (limit integrity)');
select 'ALL V6 CHECKS PASSED' as result;
