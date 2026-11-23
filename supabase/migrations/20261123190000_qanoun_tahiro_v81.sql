-- =========================================================================
-- قانون تاهيرو v8.1 — مولّد التمارين: «المساعد» يولّد أسئلة ومسائل ونوازل وألغازاً بصيغة البنك وقواعده
-- من مواد مكتبة القوانين نفسها (مادة يختارها الطالب، أو عينة عشوائية من قانون أو من المكتبة كلها).
-- للخادم وحده (service_role). قابلة لإعادة التشغيل، وتُطبَّق بعد 20261123000000_qanoun_tahiro_v8.sql
-- =========================================================================

-- عينة عشوائية من مواد مختلفة لها نص بطول معقول، من قانون بعينه أو من المكتبة كلها؛
-- وp_num يقصرها على مواد فيها آجال أو مدد أو مقادير (تصلح لمسألة تُحسب أو تُطبَّق فيها قاعدة عددية)
create or replace function public.qt_law_sample(p_slug text default null, p_k int default 5, p_min int default 120,
                                                p_max int default 3000, p_num boolean default false)
returns table(slug text, n text, label text, path text, body text, notes jsonb, title text, word text, stale jsonb)
language sql volatile security definer set search_path = public as $$
  select a.slug, a.n, a.label, a.path, a.body, a.notes, l.title, l.word, l.stale
    from qt_law_articles a join qt_laws l on l.slug = a.slug
   where char_length(a.body) between greatest(coalesce(p_min, 120), 40) and least(coalesce(p_max, 3000), 8000)
     and (p_slug is null or p_slug = '' or a.slug = p_slug)
     and (not coalesce(p_num, false)
          or a.body ~ '(يوما|يوم|أيام|شهرا|شهر|أشهر|سنة|سنوات|ساعة|ساعات|درهم|دراهم|في المائة|%)')
   order by random()
   limit least(greatest(coalesce(p_k, 5), 1), 8);
$$;

-- ---------- الصلاحيات ----------
revoke execute on function public.qt_law_sample(text,int,int,int,boolean) from public, anon, authenticated;
grant execute on function public.qt_law_sample(text,int,int,int,boolean) to service_role;
