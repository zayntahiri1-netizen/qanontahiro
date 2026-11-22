-- محاكاة بيئة Supabase: الأدوار ومخطط auth ودالة auth.uid() والامتيازات الافتراضية
drop database if exists qt; create database qt;
\c qt
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
create schema auth;
-- is_anonymous كما في Supabase؛ والافتراضي هنا true لأن مستخدمي الاختبارات مجهولون ما لم يُذكر غير ذلك (في Supabase: false)
create table auth.users (id uuid primary key default gen_random_uuid(), is_anonymous boolean not null default true);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
