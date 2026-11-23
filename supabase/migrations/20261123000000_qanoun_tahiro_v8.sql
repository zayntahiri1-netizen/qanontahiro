-- =========================================================================
-- قانون تاهيرو v8 — «المساعد» بنموذج Gemini من Google، وأدوات جديدة للطالب:
-- شرح المادة، والمقارنة، والموضوع الإنشائي، والنازلة التدريبية، وبطاقات المراجعة، وتصوير السؤال، والشفوي بالصوت.
-- كل ما هنا للخادم وحده (service_role)، عدا qt_forget للمستخدم نفسه كما في الإصدارات السابقة.
-- قابلة لإعادة التشغيل، وتُطبَّق بعد 20261122000000_qanoun_tahiro_v7.sql
-- =========================================================================

-- المواد المجاورة لمادة في قانونها بالترتيب (مادة قبلها ومادة بعدها، وحتى ثلاث): لشرح المادة في سياقها، ولبناء نازلة تدريبية
create or replace function public.qt_law_near(p_slug text, p_n text, p_k int default 1)
returns table(slug text, n text, label text, path text, body text, notes jsonb, title text, word text, stale jsonb)
language sql stable security definer set search_path = public as $$
  select a.slug, a.n, a.label, a.path, a.body, a.notes, l.title, l.word, l.stale
    from qt_law_articles me
    join qt_law_articles a on a.slug = me.slug and a.n <> me.n
                          and abs(a.ord - me.ord) <= least(greatest(coalesce(p_k, 1), 1), 3)
    join qt_laws l on l.slug = a.slug
   where me.slug = p_slug and me.n = p_n
   order by a.ord;
$$;

-- مادة عشوائية صالحة لنازلة تدريبية: لها نص بطول معقول (لا مادة تعريفية من سطر، ولا باب كامل)،
-- من قوانين بعينها أو من المكتبة كلها
create or replace function public.qt_law_pick(p_slugs text[] default null, p_min int default 250, p_max int default 2500)
returns table(slug text, n text, label text, path text, body text, notes jsonb, title text, word text, stale jsonb)
language sql volatile security definer set search_path = public as $$
  select a.slug, a.n, a.label, a.path, a.body, a.notes, l.title, l.word, l.stale
    from qt_law_articles a join qt_laws l on l.slug = a.slug
   where char_length(a.body) between greatest(coalesce(p_min, 250), 40) and least(coalesce(p_max, 2500), 8000)
     and (p_slugs is null or cardinality(p_slugs) = 0 or a.slug = any (p_slugs))
   order by random()
   limit 1;
$$;

-- بعد تحميل المكتبة: الأجوبة المؤسَّسة على نصوصها تُبطَل كلها (ومعها أدوات v8 المحفوظة)، وتبقى الخطط
create or replace function public.qt_law_prune(p_stamp text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a int; l int;
begin
  delete from qt_law_articles where stamp is distinct from p_stamp;
  get diagnostics a = row_count;
  delete from qt_laws where stamp is distinct from p_stamp;
  get diagnostics l = row_count;
  update qt_laws set articles = (select count(*) from qt_law_articles x where x.slug = qt_laws.slug);
  delete from qt_ai_cache where kind in ('ask', 'why', 'explain', 'compare', 'cards', 'essay');
  return jsonb_build_object('articles_removed', a, 'laws_removed', l,
                            'laws', (select count(*) from qt_laws), 'articles', (select count(*) from qt_law_articles));
end $$;

-- النوازل التدريبية المولَّدة تُحفظ ثلاثة أيام فقط (حتى يقيّم الطالب حله)، ثم تُحذف
create or replace function public.qt_ai_gc() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from qt_ai_cache where kind = 'drill' and created_at < now() - interval '3 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- أرقام المؤلف: ومعها توزيع الطلبات على الأدوات
create or replace function public.qt_ai_stats(p_day date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('calls', count(*), 'cached', count(*) filter (where cached), 'failed', count(*) filter (where not ok),
                            'in_tok', coalesce(sum(in_tok), 0), 'out_tok', coalesce(sum(out_tok), 0),
                            'users', count(distinct uid), 'kb', (select count(*) from qt_kb),
                            'laws', (select count(*) from qt_laws), 'articles', (select count(*) from qt_law_articles),
                            'cases', count(*) filter (where kind = 'case'),
                            'kinds', coalesce((select jsonb_object_agg(k.kind, k.c) from (
                                select coalesce(kind, '?') as kind, count(*) as c from qt_ai_log
                                 where at >= p_day and at < p_day + 1 group by 1) k), '{}'::jsonb))
    from qt_ai_log where at >= p_day and at < p_day + 1;
$$;

-- حذف البيانات (كما في v6) ومعه النوازل التدريبية التي ولّدها المستخدم
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
  delete from qt_ai_cache where kind = 'drill' and payload->>'uid' = me::text;
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
revoke execute on function public.qt_law_near(text,text,int), public.qt_law_pick(text[],int,int), public.qt_ai_gc()
  from public, anon, authenticated;
grant execute on function public.qt_law_near(text,text,int), public.qt_law_pick(text[],int,int), public.qt_ai_gc(),
  public.qt_law_prune(text), public.qt_ai_stats(date) to service_role;
revoke execute on function public.qt_forget(text) from public, anon;
grant execute on function public.qt_forget(text) to authenticated;
