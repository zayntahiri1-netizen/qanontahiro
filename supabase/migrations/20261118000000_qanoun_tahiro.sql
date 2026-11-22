-- =========================================================================
-- قانون تاهيرو — قاعدة Supabase
-- الهوية: اسم مستعار فريد + رمز استرجاع (لا بريد ولا كلمة مرور)، فوق جلسة مجهولة.
-- كل الكتابة والقراءة تمر عبر دوال SECURITY DEFINER تتحقق من الملكية؛ الجداول نفسها مغلقة.
-- =========================================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- الجداول ----------
create table if not exists public.qt_profiles (
  alias       text primary key check (char_length(alias) between 2 and 18),
  owner       uuid not null references auth.users(id) on delete cascade,
  seed        bigint not null default 0,
  secret_hash text not null,                 -- bcrypt لرمز الاسترجاع، لا يُخزن الرمز نفسه
  fails       int not null default 0,
  last_fail   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists qt_profiles_owner on public.qt_profiles(owner);

create table if not exists public.qt_progress (
  alias       text primary key references public.qt_profiles(alias) on delete cascade on update cascade,
  data        jsonb not null,
  points      int not null default 0,
  answered    int not null default 0,
  correct     int not null default 0,
  week        text not null default '',
  week_points int not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists qt_progress_points on public.qt_progress(points desc, alias);
create index if not exists qt_progress_week   on public.qt_progress(week, week_points desc, alias);

create table if not exists public.qt_daily (
  day   date not null,
  alias text not null references public.qt_profiles(alias) on delete cascade on update cascade,
  ok    boolean not null,
  at    timestamptz not null default now(),
  primary key (day, alias)
);

create table if not exists public.qt_duels (
  code  text not null,
  alias text not null references public.qt_profiles(alias) on delete cascade on update cascade,
  ok    int not null,
  n     int not null,
  secs  int not null,
  at    timestamptz not null default now(),
  primary key (code, alias)
);
create index if not exists qt_duels_code on public.qt_duels(code, ok desc, secs);

create table if not exists public.qt_reports (
  id         bigserial primary key,
  qid        text not null,
  why        text,
  note       text,
  alias      text,
  bank       text,
  uid        uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- إعلانات المؤلف: تُبث حية عبر Ably وتُحفظ هنا ليراها من يفتح التطبيق أو الموقع لاحقاً
create table if not exists public.qt_announcements (
  id         bigserial primary key,
  ar         text not null,
  fr         text,
  en         text,
  url        text,
  created_at timestamptz not null default now()
);

alter table public.qt_profiles      enable row level security;
alter table public.qt_progress      enable row level security;
alter table public.qt_daily         enable row level security;
alter table public.qt_duels         enable row level security;
alter table public.qt_reports       enable row level security;
alter table public.qt_announcements enable row level security;
-- لا سياسات مباشرة: لا يقرأ عميل ولا يكتب في الجداول إلا عبر الدوال أدناه (دالة الخادم تستعمل service_role).
revoke all on public.qt_profiles, public.qt_progress, public.qt_daily, public.qt_duels, public.qt_reports,
              public.qt_announcements from anon, authenticated;

-- ---------- الملكية ----------
create or replace function public.qt_owns(p_alias text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from qt_profiles where alias = p_alias and owner = auth.uid());
$$;

-- حجز الاسم المستعار أول مرة، ويعيد رمز الاسترجاع مرة واحدة فقط
create or replace function public.qt_claim(p_alias text, p_seed bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r qt_profiles; v_code text;
begin
  if auth.uid() is null then return jsonb_build_object('status','auth'); end if;
  p_alias := btrim(p_alias);
  if char_length(p_alias) < 2 or char_length(p_alias) > 18 then return jsonb_build_object('status','alias'); end if;
  select * into r from qt_profiles where alias = p_alias;
  if not found then
    v_code := upper(encode(gen_random_bytes(6), 'hex'));
    insert into qt_profiles(alias, owner, seed, secret_hash)
      values (p_alias, auth.uid(), coalesce(p_seed, 0), crypt(v_code, gen_salt('bf')));
    return jsonb_build_object('status','new', 'code', v_code);
  elsif r.owner = auth.uid() then
    return jsonb_build_object('status','mine');
  else
    return jsonb_build_object('status','taken');
  end if;
exception when unique_violation then
  return jsonb_build_object('status','taken');
end $$;

-- نقل الاسم إلى جهاز جديد برمز الاسترجاع، مع حد للمحاولات الخاطئة
create or replace function public.qt_adopt(p_alias text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r qt_profiles; v text := upper(replace(replace(btrim(coalesce(p_code,'')), '-', ''), ' ', ''));
begin
  if auth.uid() is null then return jsonb_build_object('status','auth'); end if;
  select * into r from qt_profiles where alias = btrim(p_alias) for update;
  if not found then return jsonb_build_object('status','unknown'); end if;
  if r.fails >= 8 and r.last_fail > now() - interval '1 hour' then return jsonb_build_object('status','locked'); end if;
  if r.secret_hash = crypt(v, r.secret_hash) then
    update qt_profiles set owner = auth.uid(), fails = 0, last_fail = null where alias = r.alias;
    return jsonb_build_object('status','ok');
  end if;
  update qt_profiles
     set fails = case when last_fail is null or last_fail < now() - interval '1 hour' then 1 else fails + 1 end,
         last_fail = now()
   where alias = r.alias;
  return jsonb_build_object('status','bad');
end $$;

-- ---------- المزامنة ----------
create or replace function public.qt_pull(p_alias text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not qt_owns(p_alias) then return null; end if;
  select jsonb_build_object('data', data, 'answered', answered, 'points', points, 'updated_at', updated_at)
    into v from qt_progress where alias = p_alias;
  return v;
end $$;

-- أقصى نقاط للسؤال الواحد 90 (نقاط الفرع 12 × الصعوبة 5 × مكافأة سؤال اليوم 1.5)، فالسقف 100 لكل جواب.
-- لا يُكتب فوق نسخة أكثر تقدماً (جهاز قديم عاد إلى الاتصال) إلا باستعادة نسخة احتياطية صريحة (p_force).
create or replace function public.qt_push(p_alias text, p_data jsonb, p_points int, p_answered int, p_correct int,
                                          p_week text, p_week_points int, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prev int;
begin
  if not qt_owns(p_alias) then return jsonb_build_object('status','denied'); end if;
  if p_data is null or p_points is null or p_answered is null or p_correct is null
     or p_points < 0 or p_answered < 0 or p_correct < 0 or p_correct > p_answered
     or p_points > p_answered * 100 or coalesce(p_week_points,0) < 0 or coalesce(p_week_points,0) > p_points
     or octet_length(p_data::text) > 1500000 then
    return jsonb_build_object('status','invalid');
  end if;
  select answered into v_prev from qt_progress where alias = p_alias;
  if found and v_prev > p_answered and not coalesce(p_force, false) then
    return jsonb_build_object('status','behind', 'answered', v_prev);
  end if;
  insert into qt_progress(alias, data, points, answered, correct, week, week_points, updated_at)
  values (p_alias, p_data, p_points, p_answered, p_correct, left(coalesce(p_week,''), 10), coalesce(p_week_points,0), now())
  on conflict (alias) do update
    set data = excluded.data, points = excluded.points, answered = excluded.answered, correct = excluded.correct,
        week = excluded.week, week_points = excluded.week_points, updated_at = now();
  return jsonb_build_object('status','ok');
end $$;

-- ---------- اللوحة العالمية: الترتيب نفسه لكل المستخدمين ----------
create or replace function public.qt_board(p_kind text default 'all', p_week text default '', p_limit int default 100)
returns table(alias text, seed bigint, points int, answered int, week_points int)
language sql stable security definer set search_path = public as $$
  select g.alias, pr.seed, g.points, g.answered, g.week_points
    from qt_progress g join qt_profiles pr using (alias)
   where (p_kind <> 'week' or (g.week = p_week and g.week_points > 0))
   order by case when p_kind = 'week' then g.week_points else g.points end desc, g.alias asc
   limit least(greatest(coalesce(p_limit,100), 1), 200);
$$;

-- ---------- سؤال اليوم ----------
create or replace function public.qt_daily_answer(p_alias text, p_day date, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not qt_owns(p_alias) then return; end if;
  if p_day not between current_date - 1 and current_date + 1 then return; end if;   -- فارق التوقيت
  insert into qt_daily(day, alias, ok) values (p_day, p_alias, p_ok) on conflict do nothing;
end $$;

create or replace function public.qt_daily_stats(p_day date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('n', count(*), 'ok', count(*) filter (where ok)) from qt_daily where day = p_day;
$$;

-- ---------- تحدَّ صديقاً: أول محاولة لكل لاعب في الرمز هي المعتمدة ----------
create or replace function public.qt_duel_result(p_code text, p_alias text, p_ok int, p_n int, p_secs int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not qt_owns(p_alias) or p_n <= 0 or p_n > 30 or p_ok < 0 or p_ok > p_n then return; end if;
  insert into qt_duels(code, alias, ok, n, secs)
  values (left(upper(p_code), 40), p_alias, p_ok, p_n, greatest(coalesce(p_secs,0), 0))
  on conflict (code, alias) do nothing;
end $$;

create or replace function public.qt_duel_board(p_code text) returns table(alias text, seed bigint, ok int, n int, secs int)
language sql stable security definer set search_path = public as $$
  select d.alias, p.seed, d.ok, d.n, d.secs
    from qt_duels d join qt_profiles p using (alias)
   where d.code = upper(p_code)
   order by d.ok desc, d.secs asc, d.alias asc
   limit 100;
$$;

-- ---------- البلاغات: كتابة فقط، وتُقرأ من لوحة Supabase ----------
create or replace function public.qt_report(p_qid text, p_why text, p_note text, p_alias text, p_bank text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if (select count(*) from qt_reports where uid = auth.uid() and created_at > now() - interval '1 hour') >= 30 then return; end if;
  insert into qt_reports(qid, why, note, alias, bank)
  values (left(p_qid,40), left(p_why,120), left(p_note,600), left(p_alias,24), left(p_bank,20));
end $$;

-- ---------- آخر إعلان (خلال 21 يوماً) ----------
create or replace function public.qt_announce_last() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'ar', a.ar, 'fr', a.fr, 'en', a.en, 'url', a.url, 'at', a.created_at)
    from qt_announcements a
   where a.created_at > now() - interval '21 days'
   order by a.id desc
   limit 1;
$$;

-- ---------- حذف الحساب (حق المستخدم، ومطلوب في Google Play) ----------
create or replace function public.qt_forget(p_alias text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not qt_owns(p_alias) then return jsonb_build_object('status','denied'); end if;
  delete from qt_profiles where alias = p_alias;          -- يحذف معه التقدم وسؤال اليوم والتحديات
  return jsonb_build_object('status','ok');
end $$;

-- ---------- الصلاحيات: الدوال قابلة للتنفيذ لـ PUBLIC افتراضياً، فتُسحب ثم تُمنح بدقة ----------
revoke execute on function public.qt_owns(text), public.qt_claim(text,bigint), public.qt_adopt(text,text),
  public.qt_pull(text), public.qt_push(text,jsonb,int,int,int,text,int,boolean), public.qt_board(text,text,int),
  public.qt_daily_answer(text,date,boolean), public.qt_daily_stats(date), public.qt_duel_result(text,text,int,int,int),
  public.qt_duel_board(text), public.qt_report(text,text,text,text,text), public.qt_forget(text),
  public.qt_announce_last() from public, anon, authenticated;

grant execute on function public.qt_claim(text,bigint), public.qt_adopt(text,text), public.qt_pull(text),
  public.qt_push(text,jsonb,int,int,int,text,int,boolean), public.qt_daily_answer(text,date,boolean),
  public.qt_duel_result(text,text,int,int,int), public.qt_report(text,text,text,text,text), public.qt_forget(text)
  to authenticated;
grant execute on function public.qt_board(text,text,int), public.qt_daily_stats(date), public.qt_duel_board(text),
  public.qt_announce_last() to anon, authenticated;

-- دالة الخادم (qt-pulse) تعمل بدور service_role: صلاحيات صريحة لا تتوقف على الامتيازات الافتراضية
grant select, insert, update, delete on public.qt_profiles, public.qt_progress, public.qt_daily, public.qt_duels,
  public.qt_reports, public.qt_announcements to service_role;
grant usage, select on sequence public.qt_reports_id_seq, public.qt_announcements_id_seq to service_role;
grant execute on function public.qt_daily_stats(date), public.qt_board(text,text,int), public.qt_announce_last() to service_role;
