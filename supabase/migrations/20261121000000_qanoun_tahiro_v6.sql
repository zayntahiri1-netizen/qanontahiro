-- =========================================================================
-- قانون تاهيرو v6 — الإعلانات المكافِئة تموّل «المستشار»
-- كل إعلان مكافأة يشاهده المستخدم حتى آخره يمنحه 3 طلبات إضافية من «المستشار» في يومه، حتى 3 مرات في اليوم.
-- المكافأة تُثبَت من جهة الخادم: AdMob يستدعي الدالة qt-ads بتوقيع ECDSA تتحقق منه (Server-Side Verification)،
-- ورقم المعاملة مفتاح فريد فلا تُحتسب مرتين. وقبل أن يصل أول استدعاء موقَّع (أي قبل ضبط التحقق في AdMob)
-- يقبل الخادم مطالبة التطبيق نفسه بالحدود ذاتها؛ وبعد أول استدعاء موقَّع تُغلق المطالبة الذاتية تلقائياً.
-- قابلة لإعادة التشغيل، وتُطبَّق بعد 20261119000000_qanoun_tahiro_v5.sql
-- =========================================================================

create table if not exists public.qt_ad_rewards (
  tx     text primary key,                                   -- transaction_id من AdMob، أو c:<uuid> للمطالبة الذاتية
  uid    uuid not null,
  kind   text not null check (kind in ('ai')),
  amount int  not null check (amount > 0),
  day    date not null default current_date,
  via    text not null check (via in ('ssv','client')),
  at     timestamptz not null default now()
);
create index if not exists qt_ad_rewards_uid_day on public.qt_ad_rewards (uid, day);
alter table public.qt_ad_rewards enable row level security;
revoke all on public.qt_ad_rewards from anon, authenticated;

-- حدود المكافأة: 3 مرات يومياً، وكل مرة 3 طلبات
create or replace function public.qt_ad_today(p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('bonus', coalesce(sum(amount), 0)::int, 'n', count(*)::int, 'max', 3, 'per', 3,
                            'left', greatest(3 - count(*)::int, 0),
                            'ssv', exists (select 1 from qt_ad_rewards where via = 'ssv'))
    from qt_ad_rewards where uid = p_uid and kind = 'ai' and day = current_date;
$$;

-- منح مكافأة (من الخادم وحده): مرة لكل معاملة، وبحد يومي، ومتسلسلة لكل مستخدم فلا يتجاوز الحد سباقٌ بين طلبين
create or replace function public.qt_ad_grant(p_tx text, p_uid uuid, p_kind text, p_via text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_kind is distinct from 'ai' then return jsonb_build_object('ok', false, 'why', 'kind'); end if;
  if p_tx is null or length(p_tx) not between 1 and 200 or p_uid is null then return jsonb_build_object('ok', false, 'why', 'bad'); end if;
  perform pg_advisory_xact_lock(hashtext('qt_ad:' || p_uid::text));
  if exists (select 1 from qt_ad_rewards where tx = p_tx) then return jsonb_build_object('ok', true, 'dup', true); end if;
  select count(*) into v_n from qt_ad_rewards where uid = p_uid and kind = p_kind and day = current_date;
  if v_n >= 3 then return jsonb_build_object('ok', false, 'why', 'limit'); end if;
  insert into qt_ad_rewards (tx, uid, kind, amount, via) values (p_tx, p_uid, p_kind, 3, p_via);
  return jsonb_build_object('ok', true, 'bonus', (v_n + 1) * 3, 'left', 2 - v_n);
end $$;

-- مطالبة التطبيق بعد مشاهدة الإعلان: مقبولة فقط ما لم يصل بعدُ أي استدعاء موقَّع من AdMob،
-- وبفاصل 25 ثانية على الأقل بين مطالبتين (مدة إعلان قصير)، وضمن الحد اليومي نفسه
create or replace function public.qt_ad_claim(p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_last timestamptz;
begin
  if me is null then return jsonb_build_object('ok', false, 'why', 'auth'); end if;
  if exists (select 1 from qt_ad_rewards where via = 'ssv') then return jsonb_build_object('ok', false, 'why', 'ssv'); end if;
  select max(at) into v_last from qt_ad_rewards where uid = me;
  if v_last is not null and v_last > now() - interval '25 seconds' then return jsonb_build_object('ok', false, 'why', 'soon'); end if;
  return qt_ad_grant('c:' || gen_random_uuid()::text, me, p_kind, 'client');
end $$;

-- حصة «المستشار» = الحد الأساسي + مكافأة اليوم (التوقيع نفسه، فتبقى الصلاحيات ودالة qt-ai كما هي)
create or replace function public.qt_ai_take(p_uid uuid, p_cap int, p_budget int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_used int; v_all int; v_cap int;
begin
  v_cap := p_cap + coalesce((select sum(amount) from qt_ad_rewards where uid = p_uid and kind = 'ai' and day = current_date), 0);
  select coalesce(sum(n), 0) into v_all from qt_ai_usage where day = current_date;
  if v_all >= p_budget then return jsonb_build_object('ok', false, 'why', 'budget', 'left', 0); end if;
  insert into qt_ai_usage (day, uid, n) values (current_date, p_uid, 1)
  on conflict (day, uid) do update set n = qt_ai_usage.n + 1 where qt_ai_usage.n < v_cap
  returning n into v_used;
  if v_used is null then return jsonb_build_object('ok', false, 'why', 'quota', 'left', 0); end if;
  return jsonb_build_object('ok', true, 'left', greatest(v_cap - v_used, 0));
end $$;
create or replace function public.qt_ai_left(p_uid uuid, p_cap int) returns int
language sql stable security definer set search_path = public as $$
  select greatest(p_cap
    + coalesce((select sum(amount) from qt_ad_rewards where uid = p_uid and kind = 'ai' and day = current_date), 0)::int
    - coalesce((select n from qt_ai_usage where day = current_date and uid = p_uid), 0), 0);
$$;

-- أرقام الإعلانات المكافئة للوحة المؤلف
create or replace function public.qt_ad_stats(p_day date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('rewards', count(*), 'ssv', count(*) filter (where via = 'ssv'),
                            'client', count(*) filter (where via = 'client'), 'users', count(distinct uid))
    from qt_ad_rewards where day = p_day;
$$;

-- حذف البيانات (كما في v5) ومعه سجل المكافآت حين يُحذف حساب Google
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
  delete from qt_ai_cache where kind = 'plan' and key like 'plan:%:' || me::text || ':%';
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
revoke execute on function public.qt_ad_today(uuid), public.qt_ad_grant(text,uuid,text,text), public.qt_ad_claim(text),
  public.qt_ad_stats(date) from public, anon, authenticated;
revoke execute on function public.qt_forget(text) from public, anon;
grant execute on function public.qt_ad_claim(text), public.qt_forget(text) to authenticated;
grant select, insert, update, delete on public.qt_ad_rewards to service_role;
grant execute on function public.qt_ad_today(uuid), public.qt_ad_grant(text,uuid,text,text), public.qt_ad_stats(date) to service_role;
