-- Phase 9: hardening (SRS section 12 security, section 15 audit and data integrity, NFR-SEC-01..06, NFR-REL-01).
-- Run once, after 0001-0010. Adds protections only: it changes no existing row and no existing behaviour of the
-- backend (which connects with the service role).
begin;

-- =====================================================================================================
-- 1. Least privilege (SRS 12): the browser roles never read or write tables directly.
--    Row Level Security is already ON for every table with no client policies, so they could not anyway;
--    this removes the privilege as a second, independent barrier. The backend uses service_role, which is
--    not touched. Future tables created by this role start without browser-role privileges too.
-- =====================================================================================================
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- =====================================================================================================
-- 2. Academic history cannot be emptied in one statement (SRS 15). Row deletes are already blocked by
--    triggers; TRUNCATE skips row triggers, so a statement-level guard closes that gap.
-- =====================================================================================================
create or replace function trg_no_truncate() returns trigger language plpgsql as $$
begin
  raise exception 'TRUNCATE is not allowed on %: academic records are never bulk-deleted', tg_table_name
    using errcode = '23514';
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'audit_logs', 'profiles', 'students', 'lecturers', 'courses', 'course_lecturers', 'course_enrollments',
    'materials', 'assignments', 'submissions', 'assessments', 'assessment_marks',
    'attendance_sessions', 'attendance_records', 'announcements'
  ] loop
    execute format(
      'create trigger %I before truncate on %I for each statement execute function trg_no_truncate()',
      t || '_no_truncate', t
    );
  end loop;
end $$;

-- =====================================================================================================
-- 3. Retention for the one transient table (SRS 4.9; Phase 7 decision 8): read notifications older than a
--    chosen number of days can be purged. Unread notifications are never purged. Service role only; the
--    minimum is 30 days so a typing mistake cannot wipe recent inbox history; one audit row records the run.
-- =====================================================================================================
create index notifications_purge_idx on notifications (read_at) where is_read;

create or replace function purge_read_notifications(p_days integer) returns integer
language plpgsql set search_path = public as $$
declare n integer;
begin
  if p_days is null or p_days < 30 then
    raise exception 'retention must be at least 30 days' using errcode = '22023';
  end if;
  delete from notifications where is_read and read_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  insert into audit_logs (actor_user_id, action, entity_type, new_value)
  values (null, 'notifications.purge', 'notifications', jsonb_build_object('older_than_days', p_days, 'deleted', n));
  return n;
end $$;
revoke all on function purge_read_notifications(integer) from public, anon, authenticated;
grant execute on function purge_read_notifications(integer) to service_role;

commit;
