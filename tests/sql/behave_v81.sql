\set ON_ERROR_STOP 1
-- v8.1: مولّد التمارين على القاعدة — عينة عشوائية من مواد مختلفة، بطول معقول، ومن القانون المطلوب وحده،
-- ومواد الآجال والمقادير للمسائل، والصلاحيات (للخادم وحده)
create or replace function public.t_ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', m; end if; end $$;
grant execute on function public.t_ok(boolean,text) to anon, authenticated, service_role;

select t_ok(qt_law_load('{"slug":"gen_t","title":"مدونة الشغل (اختبار)","word":"المادة","articles":7}'::jsonb,
  '[{"n":"1","ord":0,"label":"المادة 1","text":"تطبق أحكام هذا القانون على الأشخاص المرتبطين بعقد شغل أياً كانت طرق تنفيذه وطبيعة الأجر المقرر فيه وكيفية أدائه."},
    {"n":"2","ord":1,"label":"المادة 2","text":"قصير."},
    {"n":"3","ord":2,"label":"المادة 3","text":""},
    {"n":"4","ord":3,"label":"المادة 4","text":"يستفيد الأجير من راحة أسبوعية إلزامية مدتها أربع وعشرون ساعة على الأقل، وتمنح يوم الجمعة أو السبت أو الأحد أو يوم السوق الأسبوعي."},
    {"n":"5","ord":4,"label":"المادة 5","text":"يحق للأجير الذي قضى ستة أشهر متصلة من الشغل في نفس المقاولة أو لدى نفس المشغل الاستفادة من عطلة سنوية مؤدى عنها."},
    {"n":"6","ord":5,"label":"المادة 6","text":"يعتبر أجيراً كل شخص التزم ببذل نشاطه المهني تحت تبعية مشغل واحد أو عدة مشغلين لقاء أجر أياً كان نوعه وطريقة أدائه."},
    {"n":"7","ord":6,"label":"المادة 7","text":"يعتبر مشغلاً كل شخص طبيعي أو اعتباري خاصاً كان أو عاماً يستأجر خدمات شخص ذاتي واحد أو أكثر."}]'::jsonb, 's1') = 7, 'load');

-- العينة: مواد مختلفة، من القانون المطلوب وحده، بنص طويل بما يكفي (لا القصير ولا الفارغ)
select t_ok((select count(*) from qt_law_sample('gen_t', 8, 60, 3000)) = 5, 'sample: the five articles long enough, no short or empty one');
select t_ok((select count(distinct n) from qt_law_sample('gen_t', 5, 60, 3000)) = 5, 'sample: distinct articles');
select t_ok((select count(*) from qt_law_sample('gen_t', 3, 60, 3000)) = 3, 'sample: k articles');
select t_ok((select bool_and(slug = 'gen_t') from qt_law_sample('gen_t', 8, 40, 3000)), 'sample: never another law');
select t_ok((select count(*) from qt_law_sample('gen_t', 99, 40, 3000)) <= 8, 'sample: k capped at 8');
select t_ok((select count(*) from qt_law_sample('gen_t', 0, 40, 3000)) = 1, 'sample: at least one');
select t_ok((select bool_and(char_length(body) >= 40) from qt_law_sample(null, 8, 0, 8000)), 'sample: minimum length 40 even when asked for less');
select t_ok((select count(*) from qt_law_sample('nope_t', 5, 40, 3000)) = 0, 'sample: unknown law gives nothing');
select t_ok((select count(*) from qt_law_sample(null, 8, 40, 3000)) >= 5, 'sample: any law when none is given');
select t_ok((select count(*) from qt_law_sample('', 8, 40, 3000)) >= 5, 'sample: empty slug means any law');
select t_ok((select title from qt_law_sample('gen_t', 1, 60, 3000)) = 'مدونة الشغل (اختبار)', 'sample: carries the law title');

-- للمسائل: مواد فيها آجال أو مدد أو مقادير وحدها
select t_ok((select string_agg(n, ',' order by n) from qt_law_sample('gen_t', 8, 60, 3000, true)) = '4,5', 'sample num: only articles with durations or amounts');

-- الصلاحيات: للخادم وحده
set role anon;
do $$ begin perform public.qt_law_sample('gen_t', 1, 40, 3000, false); raise exception 'FAIL: anon can sample';
exception when insufficient_privilege then null; end $$;
reset role;
set role authenticated;
do $$ begin perform public.qt_law_sample('gen_t', 1, 40, 3000, false); raise exception 'FAIL: authenticated can sample';
exception when insufficient_privilege then null; end $$;
reset role;

select 'ALL V8.1 CHECKS PASSED';
