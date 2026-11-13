-- Which migrations are applied to THIS database? Read-only: run it in the Supabase SQL Editor after
-- applying migrations (docs/DEPLOYMENT.md). Every row must say applied = true.
-- Each migration is recognised by an object it creates.
select m.migration, m.marker, m.applied
from (
  values
    ('0001_init_schema', 'tables profiles, students, lecturers, courses, audit_logs',
       (select count(*) = 5 from information_schema.tables
         where table_schema = 'public'
           and table_name in ('profiles', 'students', 'lecturers', 'courses', 'audit_logs'))),
    ('0002_views', 'view v_student_attendance_summary',
       exists (select 1 from information_schema.views
                where table_schema = 'public' and table_name = 'v_student_attendance_summary')),
    ('0003_auth_integrity', 'function provision_profile + trigger profiles_immutable',
       exists (select 1 from pg_proc where proname = 'provision_profile')
       and exists (select 1 from pg_trigger where tgname = 'profiles_immutable' and not tgisinternal)),
    ('0004_courses_enrollment', 'view v_course_roster + trigger enrollment_rules',
       exists (select 1 from information_schema.views
                where table_schema = 'public' and table_name = 'v_course_roster')
       and exists (select 1 from pg_trigger where tgname = 'enrollment_rules' and not tgisinternal)),
    ('0005_materials', 'trigger materials_guard + index materials_course_listing_idx',
       exists (select 1 from pg_trigger where tgname = 'materials_guard' and not tgisinternal)
       and exists (select 1 from pg_indexes
                    where schemaname = 'public' and indexname = 'materials_course_listing_idx')),
    ('0006_assignments_submissions', 'trigger submissions_guard + view v_submission_overview',
       exists (select 1 from pg_trigger where tgname = 'submissions_guard' and not tgisinternal)
       and exists (select 1 from information_schema.views
                    where table_schema = 'public' and table_name = 'v_submission_overview')),
    ('0007_grading_marks', 'trigger assessment_marks_guard',
       exists (select 1 from pg_trigger where tgname = 'assessment_marks_guard' and not tgisinternal)),
    ('0008_attendance', 'function upsert_attendance_records',
       exists (select 1 from pg_proc where proname = 'upsert_attendance_records')),
    ('0009_announcements_notifications', 'function create_announcement + trigger notifications_guard',
       exists (select 1 from pg_proc where proname = 'create_announcement')
       and exists (select 1 from pg_trigger where tgname = 'notifications_guard' and not tgisinternal)),
    ('0010_timetable_reporting', 'trigger timetable_recurrence + index course_enrollments_active_idx',
       exists (select 1 from pg_trigger where tgname = 'timetable_recurrence' and not tgisinternal)
       and exists (select 1 from pg_indexes
                    where schemaname = 'public' and indexname = 'course_enrollments_active_idx')),
    ('0011_hardening', 'function purge_read_notifications + trigger audit_logs_no_truncate',
       exists (select 1 from pg_proc where proname = 'purge_read_notifications')
       and exists (select 1 from pg_trigger where tgname = 'audit_logs_no_truncate' and not tgisinternal))
) as m(migration, marker, applied)
order by m.migration;
