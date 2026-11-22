\set ON_ERROR_STOP 1
create or replace function public.t_ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', m; end if; end $$;
grant execute on function public.t_ok(boolean,text) to anon, authenticated, service_role;
insert into auth.users(id) values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
create temp table k(code text);
grant all on k to authenticated, anon;

-- ===== A يحجز اسماً =====
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
insert into k select qt_claim('أحمد', 123)->>'code';
select t_ok((select length(code)=12 from k), 'claim new returns 12-hex code');
select t_ok(qt_claim('أحمد', 123)->>'status' = 'mine', 'second claim = mine');
select t_ok(qt_claim('x', 1)->>'status' = 'alias', 'too short alias rejected');
select t_ok(qt_claim('  أحمد  ', 1)->>'status' = 'mine', 'alias trimmed');
-- الجداول مغلقة
do $$ begin perform * from qt_profiles; raise exception 'FAIL: direct select allowed'; exception when insufficient_privilege then null; end $$;
do $$ begin insert into qt_progress(alias,data) values('أحمد','{}'); raise exception 'FAIL: direct insert allowed'; exception when insufficient_privilege then null; end $$;
do $$ begin perform qt_owns('أحمد'); raise exception 'FAIL: qt_owns callable'; exception when insufficient_privilege then null; end $$;
-- المزامنة والتحقق من المعقولية
select t_ok(qt_push('أحمد', '{"points":50}', 50, 2, 3, '2026-W47', 10)->>'status' = 'invalid', 'correct>answered rejected');
select t_ok(qt_push('أحمد', '{"points":500}', 500, 2, 1, '2026-W47', 10)->>'status' = 'invalid', 'points>answered*100 rejected');
select t_ok(qt_push('أحمد', '{"points":90}', 90, 2, 1, '2026-W47', 100)->>'status' = 'invalid', 'week>points rejected');
select t_ok(qt_push('أحمد', '{"points":90,"answered":3}', 90, 3, 2, '2026-W47', 40)->>'status' = 'ok', 'valid push ok');
select t_ok((qt_pull('أحمد')->>'answered')::int = 3, 'pull returns answered');
select t_ok((qt_pull('أحمد')->'data'->>'points')::int = 90, 'pull returns data');
select t_ok(qt_push('أحمد', '{"points":10}', 10, 1, 1, '2026-W47', 10)->>'status' = 'behind', 'stale device cannot overwrite');
select t_ok(qt_push('أحمد', '{"points":10}', 10, 1, 1, '2026-W47', 10, true)->>'status' = 'ok', 'forced restore allowed');
select t_ok(qt_push('أحمد', '{"points":120}', 120, 4, 3, '2026-W47', 70)->>'status' = 'ok', 'push after restore');
-- سؤال اليوم
select qt_daily_answer('أحمد', current_date, true);
select qt_daily_answer('أحمد', current_date, false);          -- المحاولة الثانية لا تُحتسب
select qt_daily_answer('أحمد', current_date - 5, true);       -- خارج النافذة
select t_ok((qt_daily_stats(current_date)->>'n')::int = 1 and (qt_daily_stats(current_date)->>'ok')::int = 1, 'daily counted once');
select t_ok((qt_daily_stats(current_date - 5)->>'n')::int = 0, 'daily outside window ignored');
-- التحدي
select qt_duel_result('qt-abc-xa-zz', 'أحمد', 7, 10, 95);
select qt_duel_result('QT-ABC-XA-ZZ', 'أحمد', 10, 10, 20);    -- المحاولة الثانية لا تغيّر
select qt_duel_result('QT-ABC-XA-ZZ', 'أحمد', 11, 10, 20);    -- غير معقول
select t_ok((select ok from qt_duel_board('QT-ABC-XA-ZZ') limit 1) = 7, 'first duel attempt kept');
-- البلاغات وحدها
select qt_report('OBL-001', 'الجواب المعتمد خاطئ', repeat('x', 900), 'أحمد', '2026-11-02');
reset role;
select t_ok((select length(note) from qt_reports limit 1) = 600, 'report note truncated');
select t_ok((select uid from qt_reports limit 1) = '00000000-0000-0000-0000-00000000000a', 'report uid recorded');

-- ===== B على جهاز آخر =====
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);
select t_ok(qt_claim('أحمد', 1)->>'status' = 'taken', 'other user sees taken');
select t_ok(qt_pull('أحمد') is null, 'other user cannot pull');
select t_ok(qt_push('أحمد', '{}', 0, 0, 0, '', 0)->>'status' = 'denied', 'other user cannot push');
select t_ok(qt_forget('أحمد')->>'status' = 'denied', 'other user cannot delete');
select t_ok(qt_adopt('أحمد', 'WRONGCODE000')->>'status' = 'bad', 'wrong code = bad');
select t_ok(qt_adopt('غير موجود', 'x')->>'status' = 'unknown', 'unknown alias');
-- رمز صحيح بشرطات وحروف صغيرة
select t_ok(qt_adopt('أحمد', (select lower(substr(code,1,4)||'-'||substr(code,5,4)||'-'||substr(code,9,4)) from k))->>'status' = 'ok', 'adopt with formatted code');
select t_ok((qt_pull('أحمد')->>'answered')::int = 4, 'adopter pulls progress');
select t_ok(qt_claim('أحمد', 1)->>'status' = 'mine', 'now mine for B');

-- ===== A فقد الملكية =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
select t_ok(qt_claim('أحمد', 1)->>'status' = 'taken', 'A lost ownership');
-- القفل بعد ثماني محاولات خاطئة
select qt_adopt('أحمد', 'BAD'||g) from generate_series(1,8) g;
select t_ok(qt_adopt('أحمد', (select code from k))->>'status' = 'locked', 'locked after 8 fails even with right code');

-- ===== الزائر المجهول (الموقع) =====
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select t_ok((select count(*) from qt_board('all','',10)) = 1, 'anon reads board');
select t_ok((select points from qt_board('all','',10) limit 1) = 120, 'board points');
select t_ok((select count(*) from qt_board('week','2026-W47',10)) = 1, 'week board filter');
select t_ok((select count(*) from qt_board('week','2026-W01',10)) = 0, 'other week empty');
select t_ok((qt_daily_stats(current_date)->>'n')::int = 1, 'anon reads daily stats');
select t_ok(qt_announce_last() is null, 'no announcement yet');
do $$ begin perform qt_claim('زائر', 1); raise exception 'FAIL: anon claim allowed'; exception when insufficient_privilege then null; end $$;
do $$ begin perform qt_report('X','y','z','a','b'); raise exception 'FAIL: anon report allowed'; exception when insufficient_privilege then null; end $$;
do $$ begin perform * from qt_reports; raise exception 'FAIL: anon reads reports'; exception when insufficient_privilege then null; end $$;

-- ===== دالة الخادم (service_role) =====
reset role;
set role service_role;
insert into qt_announcements(ar, fr, en, url) values ('صدر القانون 58.25', 'Loi 58.25', 'Law 58.25', 'https://example.org');
select t_ok((select count(*) from qt_reports) = 1, 'service role reads reports');
reset role;
set role anon;
select t_ok(qt_announce_last()->>'ar' = 'صدر القانون 58.25', 'announcement visible to anon');

-- ===== الحذف المتسلسل =====
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);
select t_ok(qt_forget('أحمد')->>'status' = 'ok', 'owner deletes');
reset role;
select t_ok((select count(*) from qt_progress) = 0 and (select count(*) from qt_daily) = 0 and (select count(*) from qt_duels) = 0, 'cascade delete');
select t_ok((select count(*) from qt_reports) = 1, 'reports kept (anonymous)');
select 'ALL SQL CHECKS PASSED' as result;
