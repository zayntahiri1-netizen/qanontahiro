-- =========================================================================
-- قانون تاهيرو v5 — الدخول بـ Google، والترتيب العالمي الكامل، و«المستشار» (الذكاء الاصطناعي)
-- قابلة لإعادة التشغيل، وتُطبَّق بعد 20261118000000_qanoun_tahiro.sql
-- =========================================================================

-- تحويل آمن لنص إلى عدد: لا يُسقط سجلٌّ مشوَّه في بيانات مستخدم لوحةً يراها الجميع
create or replace function public.qt_int(p text) returns int
language sql immutable as $$ select case when p ~ '^\d{1,9}$' then p::int else 0 end $$;

-- ---------- 1) الترتيب العالمي: الشهر وأطول سلسلة وإخفاء المخالف وسجل الأبطال ----------
alter table public.qt_profiles add column if not exists hidden boolean not null default false;
alter table public.qt_progress add column if not exists month text not null default '';
alter table public.qt_progress add column if not exists month_points int not null default 0;
alter table public.qt_progress add column if not exists best int not null default 0;
create index if not exists qt_progress_month on public.qt_progress(month, month_points desc, alias);

-- نقاط الأسابيع والشهور المنتهية تُحفظ لحظة يبدأ صاحبها أسبوعاً جديداً، فيبقى «أبطال الأسبوع الماضي» دقيقاً دون مهام مجدولة
create table if not exists public.qt_period_hist (
  kind   text not null check (kind in ('week','month')),
  key    text not null,
  alias  text not null references public.qt_profiles(alias) on delete cascade on update cascade,
  points int  not null,
  primary key (kind, key, alias)
);
alter table public.qt_period_hist enable row level security;
revoke all on public.qt_period_hist from anon, authenticated;

drop function if exists public.qt_push(text,jsonb,int,int,int,text,int,boolean);
create or replace function public.qt_push(p_alias text, p_data jsonb, p_points int, p_answered int, p_correct int,
                                          p_week text, p_week_points int, p_force boolean default false,
                                          p_month text default '', p_month_points int default 0, p_best int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare prev qt_progress;
begin
  if not qt_owns(p_alias) then return jsonb_build_object('status','denied'); end if;
  if p_data is null or p_points is null or p_answered is null or p_correct is null
     or p_points < 0 or p_answered < 0 or p_correct < 0 or p_correct > p_answered
     or p_points > p_answered * 100
     or coalesce(p_week_points,0) < 0 or coalesce(p_week_points,0) > p_points
     or coalesce(p_month_points,0) < 0 or coalesce(p_month_points,0) > p_points
     or coalesce(p_best,0) < 0 or coalesce(p_best,0) > p_answered
     or octet_length(p_data::text) > 1500000 then
    return jsonb_build_object('status','invalid');
  end if;
  select * into prev from qt_progress where alias = p_alias;
  if found then
    if prev.answered > p_answered and not coalesce(p_force,false) then
      return jsonb_build_object('status','behind', 'answered', prev.answered);
    end if;
    -- لا قفزة في النقاط أكبر مما تسمح به الأجوبة الجديدة (100 نقطة للجواب كحد أقصى)
    if not coalesce(p_force,false) and (p_points - prev.points) > greatest(p_answered - prev.answered, 0) * 100 then
      return jsonb_build_object('status','invalid', 'why','jump');
    end if;
    if prev.week <> '' and prev.week <> coalesce(p_week,'') and prev.week_points > 0 then
      insert into qt_period_hist values ('week', prev.week, p_alias, prev.week_points)
      on conflict (kind, key, alias) do update set points = greatest(qt_period_hist.points, excluded.points);
    end if;
    if prev.month <> '' and prev.month <> coalesce(p_month,'') and prev.month_points > 0 then
      insert into qt_period_hist values ('month', prev.month, p_alias, prev.month_points)
      on conflict (kind, key, alias) do update set points = greatest(qt_period_hist.points, excluded.points);
    end if;
  end if;
  insert into qt_progress(alias, data, points, answered, correct, week, week_points, month, month_points, best, updated_at)
  values (p_alias, p_data, p_points, p_answered, p_correct, left(coalesce(p_week,''),10), coalesce(p_week_points,0),
          left(coalesce(p_month,''),7), coalesce(p_month_points,0), coalesce(p_best,0), now())
  on conflict (alias) do update
    set data = excluded.data, points = excluded.points, answered = excluded.answered, correct = excluded.correct,
        week = excluded.week, week_points = excluded.week_points, month = excluded.month,
        month_points = excluded.month_points, best = excluded.best, updated_at = now();
  return jsonb_build_object('status','ok');
end $$;

-- اللوحة: كل الأوقات أو الأسبوع أو الشهر، برتبة صريحة (المتساوون في الرتبة نفسها) وترتيب ثابت لكل المستخدمين
drop function if exists public.qt_board(text,text,int);
create or replace function public.qt_board(p_kind text default 'all', p_week text default '', p_limit int default 100)
returns table(rank int, alias text, seed bigint, points int, answered int, week_points int, month_points int, acc int, best int)
language sql stable security definer set search_path = public as $$
  with b as (
    select g.alias, pr.seed, g.points, g.answered, g.week_points, g.month_points, g.best,
           case when g.answered > 0 then round(100.0 * g.correct / g.answered)::int else 0 end as acc,
           case p_kind when 'week' then g.week_points when 'month' then g.month_points else g.points end as v
      from qt_progress g join qt_profiles pr using (alias)
     where not pr.hidden
       and case p_kind when 'week'  then g.week  = p_week and g.week_points  > 0
                       when 'month' then g.month = p_week and g.month_points > 0
                       else g.points > 0 end
  )
  select (rank() over (order by v desc))::int, alias, seed, points, answered, week_points, month_points, acc, best
    from b order by v desc, alias asc
   limit least(greatest(coalesce(p_limit,100), 1), 200);
$$;

-- ترتيبي أنا ولو كنتُ خارج الأوائل: الرتبة والعدد الكلي ونسبة من أتقدم عليهم وجيراني في اللوحة
create or replace function public.qt_my_rank(p_alias text, p_kind text default 'all', p_key text default '')
returns jsonb language sql stable security definer set search_path = public as $$
  with b as (
    select g.alias, pr.seed,
           case p_kind when 'week' then g.week_points when 'month' then g.month_points else g.points end as v
      from qt_progress g join qt_profiles pr using (alias)
     where not pr.hidden
       and case p_kind when 'week'  then g.week  = p_key and g.week_points  > 0
                       when 'month' then g.month = p_key and g.month_points > 0
                       else g.points > 0 end
  ), r as (
    select alias, seed, v, (rank() over (order by v desc))::int as rk, (row_number() over (order by v desc, alias))::int as pos,
           count(*) over () as total from b
  ), me as (select * from r where alias = p_alias)
  select case when not exists (select 1 from me) then jsonb_build_object('total', coalesce((select max(total) from r), 0))
  else jsonb_build_object(
    'rank',  (select rk from me), 'value', (select v from me), 'total', (select total from me),
    'pct',   (select case when total <= 1 then 100 else round(100.0 * (total - pos) / (total - 1))::int end from me),
    'near',  (select coalesce(jsonb_agg(jsonb_build_object('rank', rk, 'alias', alias, 'seed', seed, 'value', v) order by pos), '[]'::jsonb)
                from r where pos between (select pos from me) - 2 and (select pos from me) + 2))
  end;
$$;

-- أقوى المتنافسين في فرع واحد: بعدد الأجوبة الصحيحة فيه (عشرة أجوبة على الأقل)
create or replace function public.qt_board_branch(p_branch text, p_limit int default 50)
returns table(rank int, alias text, seed bigint, correct int, answered int, acc int)
language sql stable security definer set search_path = public as $$
  with b as (
    select g.alias, pr.seed,
           qt_int(g.data -> 'byBranch' -> p_branch ->> 'c') as c,
           qt_int(g.data -> 'byBranch' -> p_branch ->> 'a') as a
      from qt_progress g join qt_profiles pr using (alias)
     where not pr.hidden
  )
  select (rank() over (order by c desc))::int, alias, seed, c, a, case when a > 0 then round(100.0 * c / a)::int else 0 end
    from b where a >= 10 and c > 0
   order by c desc, alias
   limit least(greatest(coalesce(p_limit,50), 1), 200);
$$;

-- أبطال الأسبوع الماضي والشهر الماضي: الثلاثة الأوائل
create or replace function public.qt_hall(p_week text, p_month text) returns jsonb
language sql stable security definer set search_path = public as $$
  with w as (
    select x.alias, max(x.points) as points from (
      select alias, points from qt_period_hist where kind = 'week' and key = p_week
      union all select alias, week_points from qt_progress where week = p_week and week_points > 0) x
    group by x.alias
  ), m as (
    select x.alias, max(x.points) as points from (
      select alias, points from qt_period_hist where kind = 'month' and key = p_month
      union all select alias, month_points from qt_progress where month = p_month and month_points > 0) x
    group by x.alias
  )
  select jsonb_build_object(
    'week', p_week, 'month', p_month,
    'w', (select coalesce(jsonb_agg(jsonb_build_object('alias', t.alias, 'seed', t.seed, 'points', t.points) order by t.points desc, t.alias), '[]'::jsonb)
            from (select w.alias, pr.seed, w.points from w join qt_profiles pr using (alias) where not pr.hidden
                   order by w.points desc, w.alias limit 3) t),
    'm', (select coalesce(jsonb_agg(jsonb_build_object('alias', t.alias, 'seed', t.seed, 'points', t.points) order by t.points desc, t.alias), '[]'::jsonb)
            from (select m.alias, pr.seed, m.points from m join qt_profiles pr using (alias) where not pr.hidden
                   order by m.points desc, m.alias limit 3) t));
$$;

-- ---------- 2) الدخول بـ Google: الأسماء المستعارة المملوكة للجلسة ----------
-- الهوية نفسها (auth.uid) قبل ربط Google وبعده، فيبقى الاسم المستعار وتقدمه دون أي نقل
create or replace function public.qt_my_aliases() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('alias', p.alias, 'seed', p.seed, 'answered', coalesce(g.answered, 0),
                                               'points', coalesce(g.points, 0)) order by coalesce(g.answered, 0) desc, p.alias), '[]'::jsonb)
    from qt_profiles p left join qt_progress g using (alias)
   where p.owner = auth.uid();
$$;

-- ---------- 3) «المستشار»: قاعدة المعرفة والبحث والحصص والذاكرة ----------
-- قاعدة المعرفة هي بنك الأسئلة نفسه بمراجعه وتعليلاته: الذكاء الاصطناعي لا يجيب إلا منها
create table if not exists public.qt_kb (
  id         text primary key,
  branch     text not null,
  difficulty int,
  type       text,
  conf       text,
  stem       text not null,
  options    jsonb not null,
  correct    jsonb not null,
  explain    text,
  law        text,
  ref        text,
  stamp      text,
  tsv        tsvector generated always as (
               setweight(to_tsvector('arabic', coalesce(stem, '')), 'A') ||
               setweight(to_tsvector('arabic', coalesce(law, '') || ' ' || coalesce(ref, '')), 'A') ||
               setweight(to_tsvector('arabic', coalesce(explain, '')), 'B')) stored
);
create index if not exists qt_kb_tsv on public.qt_kb using gin (tsv);
create index if not exists qt_kb_branch on public.qt_kb (branch);

create table if not exists public.qt_ai_usage (
  day date not null, uid uuid not null, n int not null default 0, primary key (day, uid));
create table if not exists public.qt_ai_cache (
  key text primary key, kind text not null, payload jsonb not null, hits int not null default 0,
  created_at timestamptz not null default now());
create table if not exists public.qt_ai_log (
  id bigserial primary key, at timestamptz not null default now(), uid uuid, kind text, model text,
  cached boolean, in_tok int, out_tok int, ms int, ok boolean, err text);
create index if not exists qt_ai_log_at on public.qt_ai_log (at);

alter table public.qt_kb       enable row level security;
alter table public.qt_ai_usage enable row level security;
alter table public.qt_ai_cache enable row level security;
alter table public.qt_ai_log   enable row level security;
revoke all on public.qt_kb, public.qt_ai_usage, public.qt_ai_cache, public.qt_ai_log from anon, authenticated;

-- تحميل البنك إلى قاعدة المعرفة (من أداة النشر) ثم حذف ما لم يعد في البنك
create or replace function public.qt_kb_load(p_rows jsonb, p_stamp text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into qt_kb (id, branch, difficulty, type, conf, stem, options, correct, explain, law, ref, stamp)
  select r->>'id', r->>'branch', qt_int(r->>'difficulty'), r->>'type', r->>'conf', r->>'stem', r->'options', r->'correct',
         r->>'explain', r->'source'->>'law', r->'source'->>'ref', p_stamp
    from jsonb_array_elements(p_rows) r
  on conflict (id) do update set branch = excluded.branch, difficulty = excluded.difficulty, type = excluded.type,
    conf = excluded.conf, stem = excluded.stem, options = excluded.options, correct = excluded.correct,
    explain = excluded.explain, law = excluded.law, ref = excluded.ref, stamp = excluded.stamp;
  get diagnostics n = row_count;
  return n;
end $$;
create or replace function public.qt_kb_prune(p_stamp text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from qt_kb where stamp is distinct from p_stamp;
  get diagnostics n = row_count;
  delete from qt_ai_cache where kind in ('why','twin','ask');      -- ذاكرة الشروح تتبع نسخة البنك
  return n;
end $$;

-- البحث في البنك بالعربية: جذور الكلمات (مُجذِّع Snowball العربي) مع ترجيح أرقام المواد المذكورة في السؤال.
-- لا يُقبل سؤال إلا إذا طابق ثلث جذوره على الأقل (وجذرين حين تكون أكثر من جذر): سؤال خارج القانون لا يكلّف استدعاءً للنموذج
create or replace function public.qt_kb_search(p_q text, p_limit int default 6, p_branch text default null)
returns table(id text, branch text, law text, ref text, stem text, options jsonb, correct jsonb, explain text, score real)
language sql stable security definer set search_path = public as $$
  with q as (
    select lx, (select string_agg(quote_literal(l), ' | ') from unnest(lx) l) as s,
           array(select m[1] from regexp_matches(coalesce(p_q, ''), '(\d+(?:[.\-]\d+)?)', 'g') m) as nums
      from (select tsvector_to_array(to_tsvector('arabic', coalesce(p_q, ''))) as lx) t
  ), c as (
    select k.*, q.nums, q.lx,
           (select count(*) from unnest(q.lx) l where k.tsv @@ to_tsquery('arabic', quote_literal(l)))::int as hits,
           ts_rank_cd(k.tsv, to_tsquery('arabic', q.s)) as rk
      from qt_kb k, q
     where q.s is not null and k.tsv @@ to_tsquery('arabic', q.s)
       and (p_branch is null or k.branch = p_branch) and coalesce(k.conf, '') <> 'r'
  )
  select c.id, c.branch, c.law, c.ref, c.stem, c.options, c.correct, c.explain,
         (c.rk + 0.15 * c.hits
          + case when exists (select 1 from unnest(c.nums) n where c.ref ~ ('(^|[^0-9.])' || replace(n, '.', '\.') || '([^0-9.]|$)'))
                 then 0.6 else 0 end)::real as score
    from c
   where c.hits >= least(2, cardinality(c.lx)) and c.hits * 3 >= cardinality(c.lx)
   order by score desc, c.id
   limit least(greatest(coalesce(p_limit, 6), 1), 12);
$$;

-- حصة يومية ذرية لكل مستخدم، وسقف عام يومي يحمي الميزانية
create or replace function public.qt_ai_take(p_uid uuid, p_cap int, p_budget int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_used int; v_all int;
begin
  select coalesce(sum(n), 0) into v_all from qt_ai_usage where day = current_date;
  if v_all >= p_budget then return jsonb_build_object('ok', false, 'why', 'budget', 'left', 0); end if;
  insert into qt_ai_usage (day, uid, n) values (current_date, p_uid, 1)
  on conflict (day, uid) do update set n = qt_ai_usage.n + 1 where qt_ai_usage.n < p_cap
  returning n into v_used;
  if v_used is null then return jsonb_build_object('ok', false, 'why', 'quota', 'left', 0); end if;
  return jsonb_build_object('ok', true, 'left', greatest(p_cap - v_used, 0));
end $$;
create or replace function public.qt_ai_refund(p_uid uuid) returns void
language sql security definer set search_path = public as $$
  update qt_ai_usage set n = greatest(n - 1, 0) where day = current_date and uid = p_uid;
$$;
create or replace function public.qt_ai_left(p_uid uuid, p_cap int) returns int
language sql stable security definer set search_path = public as $$
  select greatest(p_cap - coalesce((select n from qt_ai_usage where day = current_date and uid = p_uid), 0), 0);
$$;

-- أرقام «المستشار» اليومية للوحة المؤلف: الاستدعاءات والذاكرة والرموز (لتقدير الكلفة)
create or replace function public.qt_ai_stats(p_day date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('calls', count(*), 'cached', count(*) filter (where cached), 'failed', count(*) filter (where not ok),
                            'in_tok', coalesce(sum(in_tok), 0), 'out_tok', coalesce(sum(out_tok), 0),
                            'users', count(distinct uid), 'kb', (select count(*) from qt_kb))
    from qt_ai_log where at >= p_day and at < p_day + 1;
$$;

-- ---------- 4) حذف البيانات: الاسم وتقدمه، وأثر المستشار، وحساب Google إن لم يبقَ له اسم مستعار ----------
-- حق الحذف (القانون 09.08) وشرط Google Play لحذف الحساب. تحل محل نسخة v4 بالتوقيع نفسه، فتبقى صلاحياتها.
-- الحساب المجهول يبقى (لا معطى شخصياً فيه، وبه تبقى حصة المستشار اليومية محسوبة)، وحساب Google يُحذف من المصادقة
-- فيزول البريد والاسم المأخوذان من Google وهوياته وجلساته معه، ما لم يملك اسماً مستعاراً آخر ما زال يستعمله.
create or replace function public.qt_forget(p_alias text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); perm boolean;
begin
  if not qt_owns(p_alias) then return jsonb_build_object('status','denied'); end if;
  delete from qt_profiles where alias = p_alias;          -- يحذف معه التقدم وسؤال اليوم والتحديات وسجل الأبطال
  if exists (select 1 from qt_profiles where owner = me) then
    return jsonb_build_object('status','ok', 'account','kept');
  end if;
  delete from qt_ai_log where uid = me;
  delete from qt_ai_cache where kind = 'plan' and key like 'plan:%:' || me::text || ':%';
  select not coalesce(u.is_anonymous, true) into perm from auth.users u where u.id = me;
  if coalesce(perm, false) then
    delete from qt_ai_usage where uid = me;
    delete from auth.users where id = me;
    return jsonb_build_object('status','ok', 'account','deleted');
  end if;
  return jsonb_build_object('status','ok');
end $$;
revoke execute on function public.qt_forget(text) from public, anon;
grant execute on function public.qt_forget(text) to authenticated;

-- ---------- الصلاحيات ----------
revoke execute on function public.qt_int(text), public.qt_push(text,jsonb,int,int,int,text,int,boolean,text,int,int),
  public.qt_board(text,text,int), public.qt_my_rank(text,text,text), public.qt_board_branch(text,int), public.qt_hall(text,text),
  public.qt_my_aliases(), public.qt_kb_load(jsonb,text), public.qt_kb_prune(text), public.qt_kb_search(text,int,text),
  public.qt_ai_take(uuid,int,int), public.qt_ai_refund(uuid), public.qt_ai_left(uuid,int), public.qt_ai_stats(date) from public, anon, authenticated;
grant execute on function public.qt_push(text,jsonb,int,int,int,text,int,boolean,text,int,int), public.qt_my_aliases() to authenticated;
grant execute on function public.qt_board(text,text,int), public.qt_my_rank(text,text,text), public.qt_board_branch(text,int),
  public.qt_hall(text,text) to anon, authenticated;
grant select, insert, update, delete on public.qt_period_hist, public.qt_kb, public.qt_ai_usage, public.qt_ai_cache, public.qt_ai_log to service_role;
grant usage, select on sequence public.qt_ai_log_id_seq to service_role;
grant execute on function public.qt_int(text), public.qt_board(text,text,int), public.qt_kb_load(jsonb,text), public.qt_kb_prune(text),
  public.qt_kb_search(text,int,text), public.qt_ai_take(uuid,int,int), public.qt_ai_refund(uuid), public.qt_ai_left(uuid,int),
  public.qt_hall(text,text), public.qt_ai_stats(date) to service_role;
