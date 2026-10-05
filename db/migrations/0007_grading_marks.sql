-- Phase 5: grading & marks (SRS 4.6 FR-ASG-08..10, 4.8 FR-MARK-01..07, 5.3, 5.6, 9.2, 15). Run once, after 0001-0006.
begin;

-- =====================================================================================================
-- 1. Submission grading integrity
-- =====================================================================================================
-- A graded submission always has a mark and a grader; anything else (submitted, late, returned) has no mark
-- and is never "released". (The mark <= assignment.max_marks rule is trg_check_submission_mark from 0001.)
alter table submissions add constraint submissions_grading_consistency check (
  (status = 'graded' and mark is not null and graded_by is not null and graded_at is not null)
  or (status <> 'graded' and mark is null and grade_released = false)
);

-- Only a lecturer assigned to the assignment's course may be recorded as the grader (FR-ASG-08).
create or replace function trg_submissions_grader() returns trigger language plpgsql as $$
begin
  if new.graded_by is not null and new.graded_by is distinct from old.graded_by then
    if not exists (select 1 from course_lecturers cl join assignments a on a.course_id = cl.course_id
                   where a.id = new.assignment_id and cl.lecturer_id = new.graded_by) then
      raise exception 'grader is not assigned to this course' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger submissions_grader before update on submissions
  for each row execute function trg_submissions_grader();

-- =====================================================================================================
-- 2. Assessments (CAT, exam, ...) and student marks
-- =====================================================================================================
-- assessments: creator must be assigned; course/creator immutable; max_marks cannot drop below a mark already
-- entered; the weights of a course's assessments may not add up to more than 100; never hard-deleted.
create or replace function trg_assessments_guard() returns trigger language plpgsql as $$
declare top_mark numeric; other_weight numeric;
begin
  if tg_op = 'DELETE' then
    raise exception 'assessments are never hard-deleted' using errcode = '23514';
  elsif tg_op = 'INSERT' then
    if not exists (select 1 from course_lecturers where course_id = new.course_id and lecturer_id = new.created_by) then
      raise exception 'creator is not assigned to this course' using errcode = '23514';
    end if;
  else
    if new.course_id <> old.course_id or new.created_by <> old.created_by then
      raise exception 'assessment course and creator are immutable' using errcode = '23514';
    end if;
    select max(mark) into top_mark from assessment_marks where assessment_id = new.id;
    if top_mark is not null and new.max_marks < top_mark then
      raise exception 'max_marks cannot be lower than a mark already entered (%)', top_mark using errcode = '23514';
    end if;
  end if;
  if new.weight is not null then
    select coalesce(sum(weight), 0) into other_weight from assessments
    where course_id = new.course_id and id <> new.id and weight is not null;
    if other_weight + new.weight > 100 then
      raise exception 'total assessment weight for a course cannot exceed 100 (others: %, this: %)',
        other_weight, new.weight using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger assessments_guard before insert or update or delete on assessments
  for each row execute function trg_assessments_guard();

-- assessment_marks: only for actively enrolled students, entered by a lecturer assigned to the course; the
-- (assessment, student) key is immutable; marks are corrected, never deleted (SRS 15). The 0 <= mark <= max
-- range check is trigger assessment_marks_range from 0001; uniqueness is UNIQUE(assessment_id, student_id).
create or replace function trg_assessment_marks_guard() returns trigger language plpgsql as $$
declare a assessments%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'marks are never hard-deleted; correct the value instead' using errcode = '23514';
  end if;
  select * into a from assessments where id = new.assessment_id;
  if tg_op = 'UPDATE' and (new.assessment_id <> old.assessment_id or new.student_id <> old.student_id) then
    raise exception 'mark assessment and student are immutable' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and not exists (select 1 from course_enrollments
        where course_id = a.course_id and student_id = new.student_id and status = 'active') then
    raise exception 'student is not actively enrolled in this course' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.entered_by is distinct from old.entered_by) and not exists (
        select 1 from course_lecturers where course_id = a.course_id and lecturer_id = new.entered_by) then
    raise exception 'marks may only be entered by a lecturer assigned to this course' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger assessment_marks_guard before insert or update or delete on assessment_marks
  for each row execute function trg_assessment_marks_guard();

-- =====================================================================================================
-- 3. Transactional operations: the change and its audit row succeed or fail TOGETHER (FR-MARK-07, NFR-REL-01).
--    Callable by the backend's service role only.
-- =====================================================================================================
-- 3a. Grade, regrade, release/unrelease or return one submission.
create or replace function apply_grade(
  p_submission uuid, p_actor uuid, p_action text, p_status submission_status, p_mark numeric,
  p_feedback text, p_release boolean, p_regrade boolean
) returns void language plpgsql set search_path = public as $$
declare old_row submissions%rowtype;
begin
  select * into old_row from submissions where id = p_submission for update;
  if not found then
    raise exception 'submission not found' using errcode = 'P0002';
  end if;
  update submissions set
    status = p_status,
    mark = p_mark,
    feedback = p_feedback,
    grade_released = p_release,
    graded_by = case when p_status <> 'graded' then null when p_regrade then p_actor else old_row.graded_by end,
    graded_at = case when p_status <> 'graded' then null when p_regrade then now() else old_row.graded_at end
  where id = p_submission;
  insert into audit_logs (actor_user_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor, p_action, 'submission', p_submission,
          jsonb_build_object('status', old_row.status, 'mark', old_row.mark, 'feedback', old_row.feedback,
                             'grade_released', old_row.grade_released),
          jsonb_build_object('status', p_status, 'mark', p_mark, 'feedback', p_feedback,
                             'grade_released', p_release));
end $$;

-- 3b. Release (or hide) every graded submission of an assignment at once. Returns how many rows changed.
create or replace function release_grades(p_assignment uuid, p_actor uuid, p_released boolean)
returns integer language plpgsql set search_path = public as $$
declare n integer;
begin
  update submissions set grade_released = p_released
  where assignment_id = p_assignment and status = 'graded' and grade_released is distinct from p_released;
  get diagnostics n = row_count;
  insert into audit_logs (actor_user_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor, case when p_released then 'grades.release_all' else 'grades.hide_all' end,
          'assignment', p_assignment, null, jsonb_build_object('count', n));
  return n;
end $$;

-- 3c. Bulk upsert of marks for one assessment (the whole batch or nothing). p_rows is a JSON array of
--     {student_id, mark, feedback}. Each created/changed mark writes its own audit row with old and new values.
create or replace function upsert_assessment_marks(p_assessment uuid, p_actor uuid, p_rows jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  a assessments%rowtype; existing assessment_marks%rowtype; r jsonb;
  sid uuid; m numeric; fb text; n_created integer := 0; n_updated integer := 0; n_same integer := 0;
begin
  select * into a from assessments where id = p_assessment;
  if not found then
    raise exception 'assessment not found' using errcode = 'P0002';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    sid := (r ->> 'student_id')::uuid;
    m := (r ->> 'mark')::numeric;
    fb := nullif(r ->> 'feedback', '');
    select * into existing from assessment_marks where assessment_id = p_assessment and student_id = sid for update;
    if not found then
      insert into assessment_marks (assessment_id, student_id, mark, feedback, entered_by)
      values (p_assessment, sid, m, fb, p_actor);
      insert into audit_logs (actor_user_id, action, entity_type, entity_id, old_value, new_value)
      values (p_actor, 'mark.create', 'assessment', p_assessment, null,
              jsonb_build_object('student_id', sid, 'mark', m, 'feedback', fb));
      n_created := n_created + 1;
    elsif existing.mark is distinct from m or existing.feedback is distinct from fb then
      update assessment_marks set mark = m, feedback = fb, entered_by = p_actor where id = existing.id;
      insert into audit_logs (actor_user_id, action, entity_type, entity_id, old_value, new_value)
      values (p_actor, 'mark.update', 'assessment', p_assessment,
              jsonb_build_object('student_id', sid, 'mark', existing.mark, 'feedback', existing.feedback),
              jsonb_build_object('student_id', sid, 'mark', m, 'feedback', fb));
      n_updated := n_updated + 1;
    else
      n_same := n_same + 1;
    end if;
  end loop;
  return jsonb_build_object('created', n_created, 'updated', n_updated, 'unchanged', n_same);
end $$;

revoke all on function apply_grade(uuid, uuid, text, submission_status, numeric, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function apply_grade(uuid, uuid, text, submission_status, numeric, text, boolean, boolean)
  to service_role;
revoke all on function release_grades(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function release_grades(uuid, uuid, boolean) to service_role;
revoke all on function upsert_assessment_marks(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function upsert_assessment_marks(uuid, uuid, jsonb) to service_role;

commit;
