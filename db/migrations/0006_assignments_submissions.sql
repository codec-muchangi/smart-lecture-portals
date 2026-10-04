-- Phase 4: assignments & submissions (SRS 4.6, 5.2, 9, 13, 14, 15). Run once, after 0001-0005.
begin;

-- 1. Assignment integrity.
alter table assignments add constraint assignments_closed_requires_published check (published or not closed);

-- Reusable window check for submissions: assignment published and open, student actively enrolled, deadline
-- respected (late submissions only when the lecturer enabled allow_late). Defence in depth behind the API.
create or replace function check_submission_window(p_assignment uuid, p_student uuid) returns void
language plpgsql as $$
declare a assignments%rowtype;
begin
  select * into a from assignments where id = p_assignment;
  if not found or not a.published or a.closed then
    raise exception 'assignment is not open for submissions' using errcode = '23514';
  end if;
  if not exists (select 1 from course_enrollments
                 where course_id = a.course_id and student_id = p_student and status = 'active') then
    raise exception 'student is not enrolled in this course' using errcode = '23514';
  end if;
  if now() > a.due_at and not a.allow_late then
    raise exception 'the submission deadline has passed' using errcode = '23514';
  end if;
end $$;

create or replace function trg_assignments_guard() returns trigger language plpgsql as $$
declare top_mark numeric; sub_count bigint;
begin
  if tg_op = 'DELETE' then
    raise exception 'assignments are never hard-deleted; close them instead' using errcode = '23514';
  elsif tg_op = 'INSERT' then
    if not exists (select 1 from course_lecturers where course_id = new.course_id and lecturer_id = new.created_by) then
      raise exception 'creator is not assigned to this course' using errcode = '23514';
    end if;
    return new;
  end if;
  -- UPDATE
  if new.course_id <> old.course_id or new.created_by <> old.created_by then
    raise exception 'assignment course and creator are immutable' using errcode = '23514';
  end if;
  select max(mark) into top_mark from submissions where assignment_id = new.id;
  if top_mark is not null and new.max_marks < top_mark then
    raise exception 'max_marks cannot be lower than a mark already awarded (%)', top_mark using errcode = '23514';
  end if;
  if old.published and not new.published then
    select count(*) into sub_count from submissions where assignment_id = new.id;
    if sub_count > 0 then
      raise exception 'cannot unpublish an assignment that already has submissions; close it instead'
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger assignments_guard before insert or update or delete on assignments
  for each row execute function trg_assignments_guard();

-- 2. Submission integrity: window rules on every new submission AND every replacement of the file; keys
--    immutable; a graded submission cannot be replaced; no hard deletes (academic history).
create or replace function trg_submissions_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'submissions are never hard-deleted' using errcode = '23514';
  elsif tg_op = 'INSERT' then
    perform check_submission_window(new.assignment_id, new.student_id);
    return new;
  end if;
  -- UPDATE
  if new.assignment_id <> old.assignment_id or new.student_id <> old.student_id then
    raise exception 'submission assignment and student are immutable' using errcode = '23514';
  end if;
  if new.storage_path <> old.storage_path then  -- the student replaced their file
    if old.status = 'graded' then
      raise exception 'a graded submission cannot be replaced' using errcode = '23514';
    end if;
    perform check_submission_window(new.assignment_id, new.student_id);
  end if;
  return new;
end $$;
create trigger submissions_guard before insert or update or delete on submissions
  for each row execute function trg_submissions_guard();

alter table submissions add constraint submissions_storage_path_unique unique (storage_path);

-- 3. Lecturer overview of submissions with student identity (no storage path; searchable and paginated in SQL).
create or replace view v_submission_overview with (security_invoker = true) as
select s.id, s.assignment_id, s.student_id, s.file_name, s.file_size, s.submitted_at, s.status,
       s.mark, s.feedback, s.grade_released, s.graded_by, s.graded_at,
       st.registration_number, p.full_name, p.email
from submissions s
join students st on st.id = s.student_id
join profiles p on p.id = s.student_id;
revoke all on v_submission_overview from anon, authenticated;
grant select on v_submission_overview to service_role;

-- 4. Indexes.
create index submissions_listing_idx on submissions (assignment_id, submitted_at desc);
create index submissions_status_idx on submissions (assignment_id, status);
create index assignments_listing_idx on assignments (course_id, published, due_at desc);

-- 5. Private submissions bucket with the same second-wall limits as materials (25 MB, 8 verified types).
update storage.buckets
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'image/png',
      'image/jpeg',
      'application/zip'
    ]
where id = 'submissions';

commit;
