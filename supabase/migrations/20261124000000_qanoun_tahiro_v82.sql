-- =========================================================================
-- قانون تاهيرو v8.2 — TAHIRO AI دون رصيد يومي للمستخدم
--   1) qt_ai_gate: حارس ذري لكل طلب، بدل الحصة اليومية لكل مستخدم:
--      • نافذتان لكل مستخدم ولكل مسار (دقيقة وساعة) تمنعان الإغراق الآلي وحده، ولا يبلغهما استعمال بشري؛
--      • وصمام يومي عام لكل مسار (ai للأجوبة، tts للصوت، web للبحث في الإنترنت) يحمي ميزانية المؤلف،
--        ويُضبط من أسرار الدالة (0 = دون سقف). لا عدّاد يراه المستخدم ولا رصيد ينفد له.
--   2) qt_ai_ungate: يردّ الطلب إلى الصمام والنافذتين حين يأتي الجواب من الذاكرة أو يفشل أو لا يُستعمل البحث.
--   3) qt_ai_log.web: عدد عمليات البحث في الإنترنت في كل طلب، وlane: مسار الطلب (للكلفة في لوحة المؤلف).
--   4) qt_ai_stats: يضيف أرقام البحث والصوت والصمامات.
--   5) qt_ai_gc وqt_forget: تنظيف النوافذ القديمة، وحذفها مع بيانات المستخدم.
-- جداول v5/v6 (qt_ai_usage وqt_ad_rewards) تبقى كما هي لسجلات الإصدارات السابقة، ولا تُستعمل للحصة بعد الآن.
-- قابلة لإعادة التشغيل، وتُطبَّق بعد 20261123190000_qanoun_tahiro_v81.sql
-- =========================================================================

create table if not exists public.qt_ai_rate (
  uid   uuid not null,
  lane  text not null,
  win   text not null check (win in ('m', 'h')),
  start timestamptz not null default now(),
  n     int not null default 0,
  primary key (uid, lane, win)
);
create table if not exists public.qt_ai_day (
  day  date not null,
  lane text not null,
  n    int not null default 0,
  primary key (day, lane)
);
alter table public.qt_ai_rate enable row level security;
alter table public.qt_ai_day  enable row level security;
revoke all on public.qt_ai_rate, public.qt_ai_day from anon, authenticated;
alter table public.qt_ai_log add column if not exists web  int  not null default 0;
alter table public.qt_ai_log add column if not exists lane text;

-- حارس الطلب: p_min وp_hour حدّا النافذتين للمستخدم (0 = دون حد)، وp_budget الصمام اليومي العام للمسار (0 = دون سقف).
-- كل نافذة تبدأ مع أول طلب فيها وتُصفَّر بعد انقضائها؛ والزيادة مشروطة داخل on conflict فلا يتجاوز الحدَّ سباقٌ بين طلبين.
create or replace function public.qt_ai_gate(p_uid uuid, p_lane text, p_min int, p_hour int, p_budget int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_m int; v_h int; v_d int;
begin
  if p_uid is null or p_lane is null or p_lane !~ '^[a-z]{2,8}$' then
    return jsonb_build_object('ok', false, 'why', 'bad');
  end if;
  if coalesce(p_min, 0) > 0 then
    insert into qt_ai_rate as r (uid, lane, win, start, n) values (p_uid, p_lane, 'm', now(), 1)
    on conflict (uid, lane, win) do update
      set n     = case when r.start < now() - interval '1 minute' then 1 else r.n + 1 end,
          start = case when r.start < now() - interval '1 minute' then now() else r.start end
      where r.start < now() - interval '1 minute' or r.n < p_min
    returning n into v_m;
    if v_m is null then return jsonb_build_object('ok', false, 'why', 'rate', 'win', 'm'); end if;
  end if;
  if coalesce(p_hour, 0) > 0 then
    insert into qt_ai_rate as r (uid, lane, win, start, n) values (p_uid, p_lane, 'h', now(), 1)
    on conflict (uid, lane, win) do update
      set n     = case when r.start < now() - interval '1 hour' then 1 else r.n + 1 end,
          start = case when r.start < now() - interval '1 hour' then now() else r.start end
      where r.start < now() - interval '1 hour' or r.n < p_hour
    returning n into v_h;
    if v_h is null then
      update qt_ai_rate set n = greatest(n - 1, 0) where uid = p_uid and lane = p_lane and win = 'm';
      return jsonb_build_object('ok', false, 'why', 'rate', 'win', 'h');
    end if;
  end if;
  insert into qt_ai_day as d (day, lane, n) values (current_date, p_lane, 1)
  on conflict (day, lane) do update set n = d.n + 1
    where coalesce(p_budget, 0) <= 0 or d.n < p_budget
  returning n into v_d;
  if v_d is null or (coalesce(p_budget, 0) > 0 and v_d > p_budget) then
    if v_d is not null then update qt_ai_day set n = greatest(n - 1, 0) where day = current_date and lane = p_lane; end if;
    update qt_ai_rate set n = greatest(n - 1, 0) where uid = p_uid and lane = p_lane;
    return jsonb_build_object('ok', false, 'why', 'budget');
  end if;
  return jsonb_build_object('ok', true, 'day', v_d);
end $$;

-- ردّ طلب لم يكلّف شيئاً (من الذاكرة، أو فشل، أو لم يُستعمل البحث): إلى الصمام وإلى نافذتي المستخدم
create or replace function public.qt_ai_ungate(p_uid uuid, p_lane text) returns void
language sql security definer set search_path = public as $$
  update qt_ai_day  set n = greatest(n - 1, 0) where day = current_date and lane = p_lane;
  update qt_ai_rate set n = greatest(n - 1, 0) where uid = p_uid and lane = p_lane;
$$;

-- التنظيف: النوازل التدريبية بعد ثلاثة أيام (كما في v8)، والنوافذ المنقضية، والصمامات بعد 90 يوماً
create or replace function public.qt_ai_gc() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from qt_ai_cache where kind = 'drill' and created_at < now() - interval '3 days';
  get diagnostics n = row_count;
  delete from qt_ai_rate where start < now() - interval '2 hours';
  delete from qt_ai_day where day < current_date - 90;
  return n;
end $$;

-- أرقام المؤلف: كما في v8، ومعها البحث في الإنترنت والصوت والصمامات اليومية
create or replace function public.qt_ai_stats(p_day date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('calls', count(*) filter (where coalesce(lane, 'ai') = 'ai'),
                            'cached', count(*) filter (where cached), 'failed', count(*) filter (where not ok),
                            'in_tok', coalesce(sum(in_tok) filter (where coalesce(lane, 'ai') = 'ai'), 0),
                            'out_tok', coalesce(sum(out_tok) filter (where coalesce(lane, 'ai') = 'ai'), 0),
                            'tts', count(*) filter (where lane = 'tts' and ok),
                            'tts_out', coalesce(sum(out_tok) filter (where lane = 'tts'), 0),
                            'web', coalesce(sum(web), 0), 'web_calls', count(*) filter (where web > 0),
                            'users', count(distinct uid), 'kb', (select count(*) from qt_kb),
                            'laws', (select count(*) from qt_laws), 'articles', (select count(*) from qt_law_articles),
                            'cases', count(*) filter (where kind = 'case'),
                            'valves', coalesce((select jsonb_object_agg(d.lane, d.n) from qt_ai_day d where d.day = p_day), '{}'::jsonb),
                            'kinds', coalesce((select jsonb_object_agg(k.kind, k.c) from (
                                select coalesce(kind, '?') as kind, count(*) as c from qt_ai_log
                                 where at >= p_day and at < p_day + 1 group by 1) k), '{}'::jsonb))
    from qt_ai_log where at >= p_day and at < p_day + 1;
$$;

-- حذف البيانات (كما في v8) ومعه نوافذ المستخدم
create or replace function public.qt_forget(p_alias text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); perm boolean;
begin
  if not qt_owns(p_alias) then return jsonb_build_object('status','denied'); end if;
  delete from qt_profiles where alias = p_alias;
  if exists (select 1 from qt_profiles where owner = me) then
    return jsonb_build_object('status','ok', 'account','kept');
  end if;
  delete from qt_ai_log where uid = me;
  delete from qt_ai_rate where uid = me;
  delete from qt_ai_cache where kind = 'plan' and key like 'plan:%:' || me::text || ':%';
  delete from qt_ai_cache where kind in ('drill', 'weak') and payload->>'uid' = me::text;
  select not coalesce(u.is_anonymous, true) into perm from auth.users u where u.id = me;
  if coalesce(perm, false) then
    delete from qt_ai_usage where uid = me;
    delete from qt_ad_rewards where uid = me;
    delete from auth.users where id = me;
    return jsonb_build_object('status','ok', 'account','deleted');
  end if;
  return jsonb_build_object('status','ok');
end $$;

-- ---------- الصلاحيات ----------
revoke execute on function public.qt_ai_gate(uuid,text,int,int,int), public.qt_ai_ungate(uuid,text), public.qt_ai_gc(),
  public.qt_ai_stats(date) from public, anon, authenticated;
grant select, insert, update, delete on public.qt_ai_rate, public.qt_ai_day to service_role;
grant execute on function public.qt_ai_gate(uuid,text,int,int,int), public.qt_ai_ungate(uuid,text), public.qt_ai_gc(),
  public.qt_ai_stats(date) to service_role;
revoke execute on function public.qt_forget(text) from public, anon;
grant execute on function public.qt_forget(text) to authenticated;
