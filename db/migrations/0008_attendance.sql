-- Phase 6: attendance (SRS 4.7 FR-ATT-01..06, 5.4, 9.2, 15; AT-13, AT-14, AT-19). Run once, after 0001-0007.
begin;

-- =====================================================================================================
-- 1. Sessions: the creator must be a lecturer assigned to the course; course and creator never change;
--    sessions are history and are never hard-deleted (SRS 15). One session per course/date/start time is
--    already enforced by UNIQUE (course_id, session_date, start_time) from 0001 (FR-ATT-06).
-- =====================================================================================================
create or replace function trg_attendance_sessions_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'attendance sessions are never hard-deleted' using errcode = '23514';
  elsif tg_op = 'INSERT' then
    if not exists (select 1 from course_lecturers where course_id = new.course_id and lecturer_id = new.created_by) then
      raise exception 'creator is not assigned to this course' using errcode = '23514';
    end if;
  elsif new.course_id <> old.course_id or new.created_by <> old.created_by then
    raise exception 'attendance session course and creator are immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger attendance_sessions_guard before insert or update or delete on attendance_sessions
  for each row execute function trg_attendance_sessions_guard();

-- =====================================================================================================
-- 2. Records: only ACTIVELY enrolled students receive a record (SRS 9.2), marked by a lecturer assigned to
--    the course; the (session, student) key is immutable; records are corrected, never deleted.
--    One record per student per session is UNIQUE (session_id, student_id) from 0001 (AT-19).
-- =====================================================================================================
create or replace function trg_attendance_records_guard() returns trigger language plpgsql as $$
declare cid uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'attendance records are never hard-deleted; correct the status instead' using errcode = '23514';
  end if;
  select course_id into cid from attendance_sessions where id = new.session_id;
  if tg_op = 'UPDATE' and (new.session_id <> old.session_id or new.student_id <> old.student_id) then
    raise exception 'attendance record session and student are immutable' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and not exists (select 1 from course_enrollments
        where course_id = cid and student_id = new.student_id and status = 'active') then
    raise exception 'student is not actively enrolled in this course' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.marked_by is distinct from old.marked_by) and not exists (
        select 1 from course_lecturers where course_id = cid and lecturer_id = new.marked_by) then
    raise exception 'attendance may only be marked by a lecturer assigned to this course' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger attendance_records_guard before insert or update or delete on attendance_records
  for each row execute function trg_attendance_records_guard();

-- =====================================================================================================
-- 3. Transactional bulk marking (FR-ATT-03, FR-LEC-10, NFR-REL-01): every record and the audit row of each
--    created/corrected record are written in ONE transaction, or none are. p_rows is a JSON array of
--    {student_id, status, note}. Returns {created, updated, unchanged}. service_role only.
--    Audit actions: attendance.mark (first mark) and attendance.correct (a change), with old and new values.
-- =====================================================================================================
create or replace function upsert_attendance_records(p_session uuid, p_actor uuid, p_rows jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  existing attendance_records%rowtype; r jsonb; sid uuid; st attendance_status; nt text;
  n_created integer := 0; n_updated integer := 0; n_same integer := 0;
begin
  if not exists (select 1 from attendance_sessions where id = p_session) then
    raise exception 'attendance session not found' using errcode = 'P0002';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    sid := (r ->> 'student_id')::uuid;
    st := (r ->> 'status')::attendance_status;
    nt := nullif(r ->> 'note', '');
    select * into existing from attendance_records where session_id = p_session and student_id = sid for update;
    if not found then
      insert into attendance_records (session_id, student_id, status, marked_by, note)
      values (p_session, sid, st, p_actor, nt);
      insert into audit_logs (actor_user_id, action, entity_type, entity_id, old_value, new_value)
      values (p_actor, 'attendance.mark', 'attendance_session', p_session, null,
              jsonb_build_object('student_id', sid, 'status', st, 'note', nt));
      n_created := n_created + 1;
    elsif existing.status is distinct from st or existing.note is distinct from nt then
      update attendance_records set status = st, note = nt, marked_by = p_actor, marked_at = now()
      where id = existing.id;
      insert into audit_logs (actor_user_id, action, entity_type, entity_id, old_value, new_value)
      values (p_actor, 'attendance.correct', 'attendance_session', p_session,
              jsonb_build_object('student_id', sid, 'status', existing.status, 'note', existing.note),
              jsonb_build_object('student_id', sid, 'status', st, 'note', nt));
      n_updated := n_updated + 1;
    else
      n_same := n_same + 1;
    end if;
  end loop;
  return jsonb_build_object('created', n_created, 'updated', n_updated, 'unchanged', n_same);
end $$;

revoke all on function upsert_attendance_records(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function upsert_attendance_records(uuid, uuid, jsonb) to service_role;

commit;
