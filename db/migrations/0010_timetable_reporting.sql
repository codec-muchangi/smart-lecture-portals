-- Phase 8: timetable integrity and reporting indexes (SRS 4.10 FR-TIME-01..03, 4.11 FR-REP-01..05, NFR-PERF-01).
-- Run once, after 0001-0009. Dashboards and reports read existing tables; this migration only tightens the
-- timetable rules and adds the indexes the report queries use. It changes no existing rows.
begin;

-- =====================================================================================================
-- 1. Timetable entries (FR-TIME-01): either a weekly slot (day_of_week, optionally limited by recurrence) or
--    a one-off date, never both and never neither; recurrence metadata applies to weekly slots only.
-- =====================================================================================================
alter table timetable_entries add constraint timetable_weekly_or_one_off
  check ((day_of_week is null) <> (specific_date is null));
alter table timetable_entries add constraint timetable_recurrence_shape
  check (recurrence is null or (jsonb_typeof(recurrence) = 'object' and day_of_week is not null));

-- Recurrence metadata may carry "from" and/or "until" (ISO dates); anything else in it is ignored. When present
-- they must be real dates in order, so the API can always expand a weekly slot into dated occurrences.
create or replace function trg_timetable_recurrence() returns trigger language plpgsql as $$
declare d_from date; d_until date;
begin
  if new.recurrence is null then
    return new;
  end if;
  begin
    d_from := (new.recurrence ->> 'from')::date;
    d_until := (new.recurrence ->> 'until')::date;
  exception when others then
    raise exception 'recurrence "from" and "until" must be ISO dates (YYYY-MM-DD)' using errcode = '23514';
  end;
  if d_from is not null and d_until is not null and d_until < d_from then
    raise exception 'recurrence "until" cannot be before "from"' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger timetable_recurrence before insert or update on timetable_entries
  for each row execute function trg_timetable_recurrence();

-- =====================================================================================================
-- 2. Indexes for the dashboard, timetable and report queries
-- =====================================================================================================
create index timetable_course_day_idx on timetable_entries (course_id, day_of_week);
-- "who is actively enrolled" is asked by every report, dashboard and notification fan-out
create index course_enrollments_active_idx on course_enrollments (course_id) where status = 'active';

commit;
