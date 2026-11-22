-- =========================================================================
-- قانون تاهيرو v7 — مكتبة النصوص القانونية التي يجيب منها «المساعد» (اسمه السابق «المستشار»)
-- نصوص القوانين التي رفعها المؤلف، مادةً مادة (data/corpus/ يولّدها tools/build_corpus.py، وتحمّلها أداة النشر).
-- «المساعد» لا يذكر مادة إلا إذا جلبها الخادم من هذه المكتبة، ويعرض نصها مع الجواب.
-- كل شيء هنا للخادم وحده (service_role): لا يقرأ العميل الجداول ولا يستدعي الدوال.
-- قابلة لإعادة التشغيل، وتُطبَّق بعد 20261121000000_qanoun_tahiro_v6.sql
-- =========================================================================

-- تطبيع عربي للبحث: حذف التشكيل والتطويل، وتوحيد صور الألف والهمزة والياء والتاء المربوطة،
-- فيجد «الاجر» ما كُتب «الأجر»، و«مسئولية» ما كُتب «مسؤولية».
create or replace function public.qt_norm(p text) returns text
language sql immutable parallel safe set search_path = public as $$
  select translate(regexp_replace(coalesce(p, ''), '[ً-ٰٟـ]', '', 'g'), 'أإآٱىةؤئ', 'اااايهوي')
$$;

create table if not exists public.qt_laws (
  slug         text primary key,
  key          text,                          -- مفتاحه في سجل القوانين (data/laws.json)
  title        text not null,
  branch       text,
  word         text not null default 'المادة', -- «المادة» أو «الفصل»
  match        text,                          -- كيف يُذكر في سؤال المستخدم (تعبير منتظم على نص مُطبَّع)
  bank         text,                          -- كيف يُذكر في مراجع بنك الأسئلة
  source       text,                          -- الملف الذي استُخرج منه النص
  sha          text,
  consolidated date,                          -- تاريخ آخر تحيين للنص المعتمد
  stale        jsonb not null default '[]',   -- تعديلات صدرت بعد ذلك التحيين (يُنبَّه إليها مع الجواب)
  articles     int not null default 0,
  stamp        text
);
create table if not exists public.qt_law_articles (
  slug   text not null references public.qt_laws (slug) on delete cascade,
  n      text not null,                       -- «53»، «82-3»، «16 مكرر»
  ord    int  not null,                       -- ترتيبها في القانون
  label  text not null,                       -- «المادة 53»
  path   text,                                -- الكتاب ← القسم ← الباب
  body   text not null default '',            -- النص (فارغ إن نُسخت المادة وبقي رقمها)
  notes  jsonb,                               -- حواشي الناشر (نسخ، تغيير، إحالة) — ليست من نص القانون
  stamp  text,
  tsv    tsvector generated always as (
           setweight(to_tsvector('arabic', public.qt_norm(body)), 'A') ||
           setweight(to_tsvector('arabic', public.qt_norm(label || ' ' || coalesce(path, ''))), 'C')) stored,
  primary key (slug, n)
);
create index if not exists qt_law_articles_tsv on public.qt_law_articles using gin (tsv);
create index if not exists qt_law_articles_ord on public.qt_law_articles (slug, ord);

alter table public.qt_laws         enable row level security;
alter table public.qt_law_articles enable row level security;
revoke all on public.qt_laws, public.qt_law_articles from anon, authenticated;

-- تحميل قانون ومواده (أداة النشر، على دفعات): يُحدَّث القانون، وتُكتب مواد الدفعة فوق ما كان
create or replace function public.qt_law_load(p_law jsonb, p_items jsonb, p_stamp text) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if coalesce(p_law->>'slug', '') !~ '^[a-z_]{2,40}$' then raise exception 'bad slug'; end if;
  insert into qt_laws (slug, key, title, branch, word, match, bank, source, sha, consolidated, stale, articles, stamp)
  values (p_law->>'slug', p_law->>'key', coalesce(p_law->>'title', p_law->>'slug'), p_law->>'branch',
          coalesce(nullif(p_law->>'word', ''), 'المادة'), p_law->>'match', p_law->>'bank', p_law->>'source', p_law->>'sha',
          nullif(p_law->>'consolidated', '')::date, coalesce(p_law->'stale', '[]'::jsonb), coalesce(qt_int(p_law->>'articles'), 0), p_stamp)
  on conflict (slug) do update set key = excluded.key, title = excluded.title, branch = excluded.branch, word = excluded.word,
    match = excluded.match, bank = excluded.bank, source = excluded.source, sha = excluded.sha,
    consolidated = excluded.consolidated, stale = excluded.stale, articles = excluded.articles, stamp = excluded.stamp;
  insert into qt_law_articles (slug, n, ord, label, path, body, notes, stamp)
  select p_law->>'slug', r->>'n', coalesce(qt_int(r->>'ord'), 0), coalesce(r->>'label', r->>'n'), nullif(r->>'path', ''),
         coalesce(r->>'text', ''),
         case when jsonb_typeof(r->'notes') = 'array' and jsonb_array_length(r->'notes') > 0 then r->'notes' end, p_stamp
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) r
   where coalesce(r->>'n', '') <> ''
  on conflict (slug, n) do update set ord = excluded.ord, label = excluded.label, path = excluded.path, body = excluded.body,
    notes = excluded.notes, stamp = excluded.stamp;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- نسخة المكتبة على الخادم (واحدة لكل القوانين، أو لا شيء): أداة النشر لا تعيد التحميل إن لم يتغير شيء
create or replace function public.qt_law_stamp() returns text
language sql stable security definer set search_path = public as $$
  select min(stamp) from qt_laws having count(*) > 0 and count(distinct stamp) = 1;
$$;

-- بعد تحميل كل القوانين: حذف ما لم يعد في المكتبة، وإبطال أجوبة «المساعد» المحفوظة (تتبع نسخة المكتبة)
create or replace function public.qt_law_prune(p_stamp text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a int; l int;
begin
  delete from qt_law_articles where stamp is distinct from p_stamp;
  get diagnostics a = row_count;
  delete from qt_laws where stamp is distinct from p_stamp;
  get diagnostics l = row_count;
  update qt_laws set articles = (select count(*) from qt_law_articles x where x.slug = qt_laws.slug);
  delete from qt_ai_cache where kind in ('ask', 'why');
  return jsonb_build_object('articles_removed', a, 'laws_removed', l,
                            'laws', (select count(*) from qt_laws), 'articles', (select count(*) from qt_law_articles));
end $$;

-- مواد بأعيانها: [{"slug":"labour","n":"53"}, …] بالترتيب المطلوب
create or replace function public.qt_law_get(p_refs jsonb)
returns table(slug text, n text, label text, path text, body text, notes jsonb, title text, word text, stale jsonb)
language sql stable security definer set search_path = public as $$
  select a.slug, a.n, a.label, a.path, a.body, a.notes, l.title, l.word, l.stale
    from jsonb_array_elements(case when jsonb_typeof(p_refs) = 'array' then p_refs else '[]'::jsonb end) with ordinality r(v, i)
    join qt_law_articles a on a.slug = r.v->>'slug' and a.n = r.v->>'n'
    join qt_laws l on l.slug = a.slug
   order by r.i
   limit 12;
$$;

-- البحث في المكتبة: جذور الكلمات (مُجذِّع Snowball العربي) على نص مُطبَّع، ثم ترتيب بكثافة التطابق وعدد الجذور المطابقة.
-- يُقبل الوصف الطويل للنازلة: نأخذ أقرب 200 مادة بالترتيب الأول، ثم نعدّ الجذور المطابقة فيها وحدها.
create or replace function public.qt_law_search(p_q text, p_limit int default 8, p_slugs text[] default null)
returns table(slug text, n text, label text, path text, body text, notes jsonb, title text, word text, stale jsonb, score real)
language sql stable security definer set search_path = public as $$
  with q as (
    select lx, case when cardinality(lx) > 0
                    then to_tsquery('arabic', (select string_agg(quote_literal(l), ' | ') from unnest(lx) l)) end as tq
      from (select tsvector_to_array(to_tsvector('arabic', qt_norm(left(coalesce(p_q, ''), 4000)))) as lx) t
  ), c0 as (
    select a.slug, a.n, a.ord, a.label, a.path, a.body, a.notes, a.tsv, ts_rank_cd(a.tsv, q.tq, 1) as rk
      from qt_law_articles a, q
     where q.tq is not null and a.tsv @@ q.tq and a.body <> ''
       and (p_slugs is null or cardinality(p_slugs) = 0 or a.slug = any (p_slugs))
     order by rk desc
     limit 200
  ), c as (
    select c0.*, (select count(*) from unnest(q.lx) l where c0.tsv @@ to_tsquery('arabic', quote_literal(l)))::int as hits,
           cardinality(q.lx) as nlx
      from c0, q
  )
  select c.slug, c.n, c.label, c.path, c.body, c.notes, l.title, l.word, l.stale, (c.rk + 0.12 * c.hits)::real as score
    from c join qt_laws l on l.slug = c.slug
   where c.hits >= least(2, c.nlx)
   order by score desc, c.slug, c.ord
   limit least(greatest(coalesce(p_limit, 8), 1), 20);
$$;

-- أرقام المؤلف: ومعها حجم المكتبة (يحل محل نسخة v5 بالتوقيع نفسه، فتبقى صلاحياتها)
create or replace function public.qt_ai_stats(p_day date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('calls', count(*), 'cached', count(*) filter (where cached), 'failed', count(*) filter (where not ok),
                            'in_tok', coalesce(sum(in_tok), 0), 'out_tok', coalesce(sum(out_tok), 0),
                            'users', count(distinct uid), 'kb', (select count(*) from qt_kb),
                            'laws', (select count(*) from qt_laws), 'articles', (select count(*) from qt_law_articles),
                            'cases', count(*) filter (where kind = 'case'))
    from qt_ai_log where at >= p_day and at < p_day + 1;
$$;

revoke execute on function public.qt_norm(text), public.qt_law_load(jsonb,jsonb,text), public.qt_law_stamp(), public.qt_law_prune(text),
  public.qt_law_get(jsonb), public.qt_law_search(text,int,text[]) from public, anon, authenticated;
grant select, insert, update, delete on public.qt_laws, public.qt_law_articles to service_role;
grant execute on function public.qt_norm(text), public.qt_law_load(jsonb,jsonb,text), public.qt_law_stamp(), public.qt_law_prune(text),
  public.qt_law_get(jsonb), public.qt_law_search(text,int,text[]) to service_role;
