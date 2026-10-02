-- Phase 2: courses & enrollment integrity + roster view + view lockdown.
-- Run once, after 0001-0003.
begin;

-- 1. SECURITY FIX for views from 0002. Views run with their OWNER's rights and so bypass RLS, and Supabase
--    exposes public-schema objects to the anon/authenticated API roles by default. Make them respect the
--    caller's rights and remove client access entirely (only the backend's service_role reads them).
alter view v_student_attendance_summary set (security_invoker = true);
alter view v_student_course_total       set (security_invoker = true);
revoke all on v_student_attendance_summary from anon, authenticated;
revoke all on v_student_course_total       from anon, authenticated;

-- 2. Roster view for lecturers (paginated/searchable in the database, not in Python). No phone numbers.
create or replace view v_course_roster with (security_invoker = true) as
select e.course_id, e.student_id, e.status as enrollment_status, e.enrolled_at,
       s.registration_number, s.program, s.year_of_study,
       p.full_name, p.email
from course_enrollments e
join students s on s.id = e.student_id
join profiles p on p.id = e.student_id;
revoke all on v_course_roster from anon, authenticated;
grant select on v_course_roster to service_role;

-- 3. Enrollment rules (FR-COURSE-02/04/05): keys are immutable; a student can only become ACTIVE in an
--    ACTIVE course and only if the student account is active. Duplicates are blocked by UNIQUE(course_id, student_id).
create or replace function trg_enrollment_rules() returns trigger language plpgsql as $$
declare c_status course_status; s_status person_status; becoming_active boolean := false;
begin
  -- OLD only exists on UPDATE; it must never be referenced on the INSERT path, hence the nested IFs.
  if tg_op = 'UPDATE' then
    if new.course_id <> old.course_id or new.student_id <> old.student_id then
      raise exception 'enrollment course_id and student_id are immutable' using errcode = '23514';
    end if;
    becoming_active := new.status = 'active' and old.status is distinct from 'active';
  else
    becoming_active := new.status = 'active';
  end if;

  if becoming_active then
    select status into c_status from courses where id = new.course_id;
    if c_status is distinct from 'active' then
      raise exception 'cannot enroll into a course that is not active' using errcode = '23514';
    end if;
    select status into s_status from students where id = new.student_id;
    if s_status is distinct from 'active' then
      raise exception 'cannot enroll a student whose account is not active' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger enrollment_rules before insert or update on course_enrollments
  for each row execute function trg_enrollment_rules();

-- 4. Lecturer assignment rules (FR-COURSE-03): keys immutable; only active lecturers can be assigned.
create or replace function trg_course_lecturer_rules() returns trigger language plpgsql as $$
declare l_status person_status;
begin
  if tg_op = 'UPDATE' then
    if new.course_id <> old.course_id or new.lecturer_id <> old.lecturer_id then
      raise exception 'assignment course_id and lecturer_id are immutable' using errcode = '23514';
    end if;
  else
    select status into l_status from lecturers where id = new.lecturer_id;
    if l_status is distinct from 'active' then
      raise exception 'cannot assign a lecturer whose account is not active' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger course_lecturer_rules before insert or update on course_lecturers
  for each row execute function trg_course_lecturer_rules();

-- 5. Hot-path index for filtered course lists.
create index on courses (status, academic_year, semester);

commit;
