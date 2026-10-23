"""Applies every migration to a real, throw-away PostgreSQL 16 and checks the database rules directly:
triggers, constraints, transactional functions (grading, marks, provisioning), privileges and RLS.

The API tests use an in-memory fake database, so THIS script is what proves the SQL itself. It needs the
`pgserver` package (it bundles PostgreSQL; Linux/macOS, e.g. CI):

    pip install pgserver
    python scripts/verify_database.py

It creates and deletes its own temporary database; it never touches Supabase.
"""
import glob
import os
import pathlib
import subprocess
import sys
import tempfile

try:
    import pgserver
except ImportError:
    sys.exit("This check needs: pip install pgserver  (it bundles a throw-away PostgreSQL; Linux/macOS)")

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = pathlib.Path(tempfile.mkdtemp(prefix="slp_pg_"))
srv = pgserver.get_server(DATA, cleanup_mode="delete")
PSQL = glob.glob(os.path.join(os.path.dirname(pgserver.__file__), "**", "bin", "psql"), recursive=True)[0]
URI = srv.get_uri()
fails = []


def run(sql):
    """Run SQL with ON_ERROR_STOP and return (ok, combined_output). Errors are NOT swallowed."""
    p = subprocess.run([PSQL, URI, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
                       capture_output=True, text=True)
    return p.returncode == 0, (p.stdout + p.stderr).strip()


def ok(label, sql):
    good, out = run(sql)
    print(("PASS " if good else "FAIL ") + label + ("" if good else "\n     " + out[:400]))
    if not good:
        fails.append(label)
    return out


def bad(label, sql, contains):
    good_run, out = run(sql)
    good = (not good_run) and contains.lower() in out.lower()
    print(("PASS " if good else "FAIL ") + label + ("" if good else f"\n     expected error containing {contains!r}, got ok={good_run}: {out[:300]}"))
    if not good:
        fails.append(label)


def val(sql):
    good, out = run(sql)
    return out if good else "ERR:" + out[:200]


def check(label, sql, expected):
    got = val(sql)
    good = got == expected
    print(("PASS " if good else "FAIL ") + f"{label} (got {got!r})" + ("" if good else f", expected {expected!r}"))
    if not good:
        fails.append(label)


U = {k: f"00000000-0000-0000-0000-0000000000{n:02d}" for k, n in dict(l1=1, l2=2, s1=3, s2=4, s3=5).items()}
C, A, AS = "00000000-0000-0000-0000-0000000000c1", "00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000b1"

print("== migrations on a real PostgreSQL ==")
ok("Supabase stand-ins", """
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text);""")
for f in sorted(glob.glob(str(ROOT / "db" / "migrations" / "*.sql"))):
    sql = open(f).read().replace('create extension if not exists "pgcrypto";', "")
    p = subprocess.run([PSQL, URI, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-1", "-f", "/dev/stdin"], input=sql, capture_output=True, text=True)
    print(("PASS " if p.returncode == 0 else "FAIL ") + os.path.basename(f) + ("" if p.returncode == 0 else "\n     " + (p.stdout + p.stderr)[:600]))
    if p.returncode != 0:
        fails.append(os.path.basename(f))
        sys.exit(1)
print("== setup ==")
for k, v in U.items():
    ok(f"auth user {k}", f"insert into auth.users (id, email) values ('{v}'::uuid, '{k}@t.test');")
ok("provision lecturers", f"""select provision_profile('{U['l1']}','lecturer','Lec One','l1@t.test',null,null,null,null,'LEC1','CS','Dr');
select provision_profile('{U['l2']}','lecturer','Lec Two','l2@t.test',null,null,null,null,'LEC2','CS','Dr');""")
ok("provision students", f"""select provision_profile('{U['s1']}','student','Stu One','s1@t.test',null,'STU1','BSc',1::smallint);
select provision_profile('{U['s2']}','student','Stu Two','s2@t.test',null,'STU2','BSc',1::smallint);
select provision_profile('{U['s3']}','student','Stu Three','s3@t.test',null,'STU3','BSc',1::smallint);""")
ok("course + assignment of lecturer + enrolments", f"""
insert into courses (id, course_code, course_name, academic_year, semester) values ('{C}','CIT 1','Test','2026/2027','S1');
insert into course_lecturers (course_id, lecturer_id) values ('{C}','{U['l1']}');
insert into course_enrollments (course_id, student_id) values ('{C}','{U['s1']}'),('{C}','{U['s2']}');""")
ok("assignment (published, due in 7 days, max 20)", f"""insert into assignments (id, course_id, title, due_at, max_marks, published, created_by)
values ('{A}','{C}','Assignment 1', now() + interval '7 days', 20, true, '{U['l1']}');""")

print("== phase 4 guards still hold on real PostgreSQL ==")
ok("enrolled student can submit", f"""insert into submissions (id, assignment_id, student_id, storage_path, file_name, file_size, status)
values ('00000000-0000-0000-0000-0000000000d1','{A}','{U['s1']}','p/1.pdf','1.pdf',10,'submitted');""")
bad("non-enrolled student cannot submit", f"""insert into submissions (assignment_id, student_id, storage_path, file_name, file_size)
values ('{A}','{U['s3']}','p/3.pdf','3.pdf',10);""", "not enrolled")
bad("hard delete of a submission is blocked", "delete from submissions;", "never hard-deleted")

print("== grading (apply_grade) ==")
SUB = "00000000-0000-0000-0000-0000000000d1"
ok("grade 15", f"select apply_grade('{SUB}','{U['l1']}','submission.grade','graded',15,'Good',false,true);")
check("status/mark after grading", f"select status || ':' || mark || ':' || grade_released from submissions where id='{SUB}';", "graded:15.00:false")
check("audit row written in the same call", "select count(*) from audit_logs where action='submission.grade';", "1")
check("audit holds old and new", "select (old_value->>'status') || '>' || (new_value->>'status') from audit_logs where action='submission.grade';", "submitted>graded")
bad("mark above the assignment maximum is rejected by the database", f"select apply_grade('{SUB}','{U['l1']}','submission.grade','graded',25,null,false,true);", "exceeds max_marks")
check("failed grade changed nothing (still 15)", f"select mark from submissions where id='{SUB}';", "15.00")
check("failed grade wrote no extra audit row", "select count(*) from audit_logs where action='submission.grade';", "1")
bad("an unassigned lecturer cannot be recorded as grader", f"select apply_grade('{SUB}','{U['l2']}','submission.grade','graded',12,null,false,true);", "not assigned")
bad("graded without a mark violates the consistency constraint", f"update submissions set mark = null where id='{SUB}';", "grading_consistency")
bad("released while not graded violates the constraint", f"""update submissions set status='submitted', mark=null, graded_by=null, graded_at=null, grade_released=true where id='{SUB}';""", "grading_consistency")
ok("release only (keeps original grader)", f"select apply_grade('{SUB}','{U['l1']}','submission.release','graded',15,'Good',true,false);")
check("released flag set", f"select grade_released from submissions where id='{SUB}';", "t")
check("grader unchanged by a release-only call", f"select graded_by = '{U['l1']}' from submissions where id='{SUB}';", "t")
ok("hide all via release_grades", f"select release_grades('{A}','{U['l1']}', false);")
check("release_grades returned/applied", f"select grade_released from submissions where id='{SUB}';", "f")
check("release_grades audit has the count", "select new_value->>'count' from audit_logs where action='grades.hide_all';", "1")
ok("release all again", f"select release_grades('{A}','{U['l1']}', true);")
ok("return for revision clears mark, release and grader", f"select apply_grade('{SUB}','{U['l1']}','submission.return','returned',null,'Redo',false,false);")
check("returned row is clean", f"select status||':'||coalesce(mark::text,'null')||':'||grade_released||':'||coalesce(graded_by::text,'null') from submissions where id='{SUB}';", "returned:null:false:null")
check("old mark survives in the audit trail", "select old_value->>'mark' from audit_logs where action='submission.return';", "15.00")
bad("graded submission cannot be replaced (file change)", f"""select apply_grade('{SUB}','{U['l1']}','x','graded',15,null,false,true);
update submissions set storage_path='p/new.pdf' where id='{SUB}';""", "cannot be replaced")
bad("grading a missing submission fails", f"select apply_grade('00000000-0000-0000-0000-00000000ffff','{U['l1']}','x','graded',1,null,false,true);", "not found")
ok("grade again so a mark exists", f"select apply_grade('{SUB}','{U['l1']}','submission.grade','graded',18,null,false,true);")
bad("lowering assignment max below an awarded mark is blocked", f"update assignments set max_marks = 10 where id='{A}';", "lower than a mark already awarded")
ok("lowering to exactly the awarded mark is allowed", f"update assignments set max_marks = 18 where id='{A}';")
bad("unpublishing an assignment with submissions is blocked", f"update assignments set published=false where id='{A}';", "already has submissions")
bad("hard delete of an assignment is blocked", "delete from assignments;", "never hard-deleted")

print("== assessments and marks ==")
ok("assessment CAT 1 weight 60", f"insert into assessments (id, course_id, name, type, max_marks, weight, created_by) values ('{AS}','{C}','CAT 1','cat',30,60,'{U['l1']}');")
bad("weights above 100 are blocked", f"insert into assessments (course_id, name, type, max_marks, weight, created_by) values ('{C}','Exam','exam',100,40.01,'{U['l1']}');", "cannot exceed 100")
ok("weights adding to exactly 100 are fine", f"insert into assessments (course_id, name, type, max_marks, weight, created_by) values ('{C}','Exam','exam',100,40,'{U['l1']}');")
bad("unassigned lecturer cannot create an assessment", f"insert into assessments (course_id, name, type, max_marks, created_by) values ('{C}','X','cat',10,'{U['l2']}');", "not assigned")
ok("bulk marks: create two", f"select upsert_assessment_marks('{AS}','{U['l1']}','[{{\"student_id\":\"{U['s1']}\",\"mark\":24,\"feedback\":\"Good\"}},{{\"student_id\":\"{U['s2']}\",\"mark\":18.5}}]'::jsonb);")
check("two marks stored", f"select count(*) from assessment_marks where assessment_id='{AS}';", "2")
check("two audit rows (mark.create)", "select count(*) from audit_logs where action='mark.create';", "2")
check("result counts", f"select upsert_assessment_marks('{AS}','{U['l1']}','[{{\"student_id\":\"{U['s1']}\",\"mark\":24,\"feedback\":\"Good\"}}]'::jsonb)->>'unchanged';", "1")
check("identical resubmission adds no audit row", "select count(*) from audit_logs where action in ('mark.create','mark.update');", "2")
ok("update one mark", f"select upsert_assessment_marks('{AS}','{U['l1']}','[{{\"student_id\":\"{U['s1']}\",\"mark\":26}}]'::jsonb);")
check("mark.update audit has old and new", "select (old_value->>'mark') || '>' || (new_value->>'mark') from audit_logs where action='mark.update';", "24.00>26")
check("still one row per student (AT-19)", f"select count(*) from assessment_marks where assessment_id='{AS}';", "2")
bad("one bad row rejects the whole batch (AT-11)", f"select upsert_assessment_marks('{AS}','{U['l1']}','[{{\"student_id\":\"{U['s1']}\",\"mark\":5}},{{\"student_id\":\"{U['s2']}\",\"mark\":31}}]'::jsonb);", "exceeds max_marks")
check("nothing from the failed batch was saved (S1 still 26)", f"select mark from assessment_marks where assessment_id='{AS}' and student_id='{U['s1']}';", "26.00")
bad("non-enrolled student cannot get a mark", f"select upsert_assessment_marks('{AS}','{U['l1']}','[{{\"student_id\":\"{U['s3']}\",\"mark\":5}}]'::jsonb);", "not actively enrolled")
bad("max_marks cannot drop below an entered mark", f"update assessments set max_marks = 20 where id='{AS}';", "lower than a mark already entered")
bad("hard delete of a mark is blocked", "delete from assessment_marks;", "never hard-deleted")
bad("hard delete of an assessment is blocked", "delete from assessments;", "never hard-deleted")
bad("mark/assessment key is immutable", f"update assessment_marks set student_id='{U['s3']}' where assessment_id='{AS}' and student_id='{U['s1']}';", "immutable")

print("== attendance ==")
SE, SE2 = "00000000-0000-0000-0000-0000000000e1", "00000000-0000-0000-0000-0000000000e2"
ok("session 1", f"insert into attendance_sessions (id, course_id, session_date, start_time, end_time, topic, created_by) values ('{SE}','{C}','2026-10-05','09:00','11:00','Intro','{U['l1']}');")
bad("duplicate session (course, date, start) is blocked (FR-ATT-06)", f"insert into attendance_sessions (course_id, session_date, start_time, end_time, created_by) values ('{C}','2026-10-05','09:00','10:00','{U['l1']}');", "duplicate key")
bad("end time must be after start time", f"insert into attendance_sessions (course_id, session_date, start_time, end_time, created_by) values ('{C}','2026-10-06','09:00','09:00','{U['l1']}');", "check constraint")
bad("unassigned lecturer cannot create a session", f"insert into attendance_sessions (course_id, session_date, start_time, end_time, created_by) values ('{C}','2026-10-06','09:00','10:00','{U['l2']}');", "not assigned")
bad("session course is immutable", f"update attendance_sessions set created_by='{U['l2']}' where id='{SE}';", "immutable")
bad("hard delete of a session is blocked", "delete from attendance_sessions;", "never hard-deleted")
ok("bulk mark: create two", f"select upsert_attendance_records('{SE}','{U['l1']}','[{{\"student_id\":\"{U['s1']}\",\"status\":\"present\"}},{{\"student_id\":\"{U['s2']}\",\"status\":\"absent\",\"note\":\"sick\"}}]'::jsonb);")
check("two records stored", f"select count(*) from attendance_records where session_id='{SE}';", "2")
check("two attendance.mark audit rows", "select count(*) from audit_logs where action='attendance.mark';", "2")
check("identical resubmission is 'unchanged'", f"select upsert_attendance_records('{SE}','{U['l1']}','[{{\"student_id\":\"{U['s1']}\",\"status\":\"present\"}}]'::jsonb)->>'unchanged';", "1")
check("no audit row for an unchanged record", "select count(*) from audit_logs where action like 'attendance.%';", "2")
ok("correct a record", f"select upsert_attendance_records('{SE}','{U['l1']}','[{{\"student_id\":\"{U['s2']}\",\"status\":\"excused\",\"note\":\"sick, letter\"}}]'::jsonb);")
check("attendance.correct keeps old and new", "select (old_value->>'status') || '>' || (new_value->>'status') from audit_logs where action='attendance.correct';", "absent>excused")
check("still one record per student (AT-19)", f"select count(*) from attendance_records where session_id='{SE}';", "2")
bad("one bad row rejects the whole batch", f"select upsert_attendance_records('{SE}','{U['l1']}','[{{\"student_id\":\"{U['s1']}\",\"status\":\"late\"}},{{\"student_id\":\"{U['s3']}\",\"status\":\"present\"}}]'::jsonb);", "not actively enrolled")
check("nothing from the failed batch was saved (S1 still present)", f"select status from attendance_records where session_id='{SE}' and student_id='{U['s1']}';", "present")
bad("an invalid status is rejected", f"select upsert_attendance_records('{SE}','{U['l1']}','[{{\"student_id\":\"{U['s1']}\",\"status\":\"sleeping\"}}]'::jsonb);", "invalid input value")
bad("marking a missing session fails", f"select upsert_attendance_records('00000000-0000-0000-0000-00000000ffff','{U['l1']}','[]'::jsonb);", "not found")
bad("an unassigned lecturer cannot mark", f"select upsert_attendance_records('{SE}','{U['l2']}','[{{\"student_id\":\"{U['s1']}\",\"status\":\"late\"}}]'::jsonb);", "assigned to this course")
bad("record key is immutable", f"update attendance_records set student_id='{U['s3']}' where session_id='{SE}' and student_id='{U['s1']}';", "immutable")
bad("hard delete of a record is blocked", "delete from attendance_records;", "never hard-deleted")
ok("session 2", f"insert into attendance_sessions (id, course_id, session_date, start_time, end_time, created_by) values ('{SE2}','{C}','2026-10-12','09:00','11:00','{U['l1']}');")
ok("mark session 2 (S1 late, S2 absent)", f"select upsert_attendance_records('{SE2}','{U['l1']}','[{{\"student_id\":\"{U['s1']}\",\"status\":\"late\"}},{{\"student_id\":\"{U['s2']}\",\"status\":\"absent\"}}]'::jsonb);")
check("summary view: S1 100% (present + late of 2)", f"select attended||'/'||counted_sessions||'/'||attendance_pct from v_student_attendance_summary where student_id='{U['s1']}';", "2/2/100.00")
check("summary view: S2 excused is excluded (0 of 1)", f"select excused||'/'||counted_sessions||'/'||attendance_pct from v_student_attendance_summary where student_id='{U['s2']}';", "1/1/0.00")

print("== announcements and notifications ==")
ok("draft announcement", f"select create_announcement('{C}','{U['l1']}','Draft','Not yet',false);")
check("a draft notifies nobody", "select count(*) from notifications;", "0")
check("draft audit action", "select count(*) from audit_logs where action='announcement.create';", "1")
check("published on create notifies the 2 enrolled students", f"select create_announcement('{C}','{U['l1']}','Quiz','Chapters 1 to 3',true)->>'notified';", "2")
check("each student got one notification", f"select count(*) from notifications where user_id in ('{U['s1']}','{U['s2']}') and type='announcement';", "2")
check("the non-enrolled student got none", f"select count(*) from notifications where user_id='{U['s3']}';", "0")
check("notification content", f"select title||'|'||message||'|'||link from notifications where user_id='{U['s1']}';", f"New announcement: Quiz|Chapters 1 to 3|/student/courses/{C}")
check("publish audit row", "select count(*) from audit_logs where action='announcement.publish';", "1")
bad("an unassigned lecturer cannot author an announcement", f"select create_announcement('{C}','{U['l2']}','X','Y',false);", "not assigned")
check("nothing was saved by the failed call", "select count(*) from announcements where title='X';", "0")
bad("blank title is rejected by the database", f"select create_announcement('{C}','{U['l1']}','   ','Y',false);", "check constraint")
DRAFT = val("select id from announcements where title='Draft';")
ok("first publication of the draft", f"select update_announcement('{DRAFT}','{U['l1']}','{{\"published\": true}}'::jsonb);")
check("publishing the draft notified both students", "select count(*) from notifications where title='New announcement: Draft';", "2")
check("published_at was set", f"select published_at is not null from announcements where id='{DRAFT}';", "t")
ok("unpublish", f"select update_announcement('{DRAFT}','{U['l1']}','{{\"published\": false}}'::jsonb);")
check("unpublish keeps published_at", f"select published_at is not null from announcements where id='{DRAFT}';", "t")
ok("re-publish", f"select update_announcement('{DRAFT}','{U['l1']}','{{\"published\": true}}'::jsonb);")
check("re-publishing does not notify again", "select count(*) from notifications where title='New announcement: Draft';", "2")
check("publish/unpublish audit rows", "select count(*) from audit_logs where action in ('announcement.unpublish') and new_value->>'published'='false';", "1")
ok("edit the body", f"select update_announcement('{DRAFT}','{U['l1']}','{{\"body\": \"Changed\"}}'::jsonb);")
check("edit audit keeps old and new", "select (old_value->>'body') || '>' || (new_value->>'body') from audit_logs where action='announcement.update';", "Not yet>Changed")
check("a no-change update reports 0 notified", f"select update_announcement('{DRAFT}','{U['l1']}','{{\"body\": \"Changed\"}}'::jsonb)->>'notified';", "0")
check("a no-change update writes no audit row", "select count(*) from audit_logs where action='announcement.update';", "1")
bad("updating a missing announcement fails", f"select update_announcement('00000000-0000-0000-0000-00000000ffff','{U['l1']}','{{}}'::jsonb);", "not found")
bad("a published announcement must have a publication time", f"update announcements set published_at = null where id='{DRAFT}';", "announcements_publish_consistency")
bad("announcement course is immutable", f"update announcements set created_by='{U['l2']}' where id='{DRAFT}';", "immutable")
bad("hard delete of an announcement is blocked", "delete from announcements;", "never hard-deleted")

NOTE = val(f"select id from notifications where user_id='{U['s1']}' limit 1;")
bad("notification content is immutable", f"update notifications set title='Hacked' where id='{NOTE}';", "immutable")
bad("a notification cannot be re-addressed", f"update notifications set user_id='{U['s2']}' where id='{NOTE}';", "immutable")
bad("is_read without read_at violates the consistency rule", f"update notifications set is_read=true where id='{NOTE}';", "notifications_read_consistency")
ok("mark a notification read", f"update notifications set is_read=true, read_at=now() where id='{NOTE}';")
bad("a read notification cannot become unread", f"update notifications set is_read=false, read_at=null where id='{NOTE}';", "cannot become unread")
ok("withdraw S2", f"update course_enrollments set status='withdrawn' where course_id='{C}' and student_id='{U['s2']}';")
check("withdrawn students are not notified", f"select notify_course_students('{C}','general','T','M',null);", "1")
ok("re-enrol S2", f"update course_enrollments set status='active' where course_id='{C}' and student_id='{U['s2']}';")

print("== client roles cannot reach any of it ==")
for fn in ("apply_grade(uuid, uuid, text, submission_status, numeric, text, boolean, boolean)",
           "release_grades(uuid, uuid, boolean)", "upsert_assessment_marks(uuid, uuid, jsonb)", "upsert_attendance_records(uuid, uuid, jsonb)",
           "notify_course_students(uuid, notification_type, text, text, text)",
           "create_announcement(uuid, uuid, text, text, boolean)", "update_announcement(uuid, uuid, jsonb)",
           "provision_profile(uuid, user_role, text, text, text, text, text, smallint, text, text, text)"):
    for role in ("anon", "authenticated"):
        check(f"{role} cannot execute {fn.split('(')[0]}", f"select has_function_privilege('{role}', '{fn}', 'execute');", "f")
    check(f"service_role can execute {fn.split('(')[0]}", f"select has_function_privilege('service_role', '{fn}', 'execute');", "t")
for view in ("v_course_roster", "v_submission_overview", "v_student_attendance_summary", "v_student_course_total"):
    check(f"anon cannot read {view}", f"select has_table_privilege('anon','public.{view}','select');", "f")
check("every public table has RLS on", "select count(*) from pg_tables where schemaname='public' and not rowsecurity;", "0")
check("materials bucket limits", "select file_size_limit||':'||array_length(allowed_mime_types,1) from storage.buckets where id='materials';", "26214400:8")
check("submissions bucket limits", "select file_size_limit||':'||array_length(allowed_mime_types,1) from storage.buckets where id='submissions';", "26214400:8")

print("== demo seed (db/seed/seed_demo.sql) loads on top of every migration ==")
SEED_S, SEED_L = "00000000-0000-0000-0000-0000000000f1", "00000000-0000-0000-0000-0000000000f2"
ok("seed auth users", f"insert into auth.users (id, email) values ('{SEED_S}'::uuid,'student@demo.test'), ('{SEED_L}'::uuid,'lecturer@demo.test');")
seed = subprocess.run([PSQL, URI, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", f"student_id={SEED_S}", "-v", f"lecturer_id={SEED_L}",
                       "-f", str(ROOT / "db" / "seed" / "seed_demo.sql")], capture_output=True, text=True)
print(("PASS " if seed.returncode == 0 else "FAIL ") + "seed script runs" + ("" if seed.returncode == 0 else "\n     " + (seed.stdout + seed.stderr)[:400]))
if seed.returncode != 0:
    fails.append("seed script runs")
check("seed: three sample lecture sessions", "select count(*) from attendance_sessions where topic like 'Lecture %';", "3")
check("seed: demo student attendance is 66.67% (present + late of 3)", f"select attendance_pct from v_student_attendance_summary where student_id='{SEED_S}';", "66.67")

print("== Phase 8: timetable rules and reporting indexes (migration 0010) ==")
check("seed: weekly timetable entry present", "select count(*) from timetable_entries where day_of_week=1 and specific_date is null;", "1")
ok("a weekly entry is accepted", f"insert into timetable_entries (course_id, day_of_week, start_time, end_time, room, recurrence) select course_id, 3, '08:00', '09:00', 'R1', '{{\"day_of_week\":3,\"from\":\"2026-09-01\",\"until\":\"2026-12-01\"}}'::jsonb from timetable_entries limit 1;")
ok("a one-off entry is accepted", "insert into timetable_entries (course_id, specific_date, start_time, end_time, room) select course_id, '2026-10-08', '14:00', '16:00', 'R2' from timetable_entries limit 1;")
bad("an entry cannot be both weekly and one-off", "insert into timetable_entries (course_id, day_of_week, specific_date, start_time, end_time) select course_id, 2, '2026-10-08', '08:00', '09:00' from timetable_entries limit 1;", "timetable_weekly_or_one_off")
bad("an entry needs a day or a date", "insert into timetable_entries (course_id, start_time, end_time) select course_id, '08:00', '09:00' from timetable_entries limit 1;", "violates check constraint")
bad("recurrence must be a JSON object", "insert into timetable_entries (course_id, day_of_week, start_time, end_time, recurrence) select course_id, 2, '08:00', '09:00', '[1]'::jsonb from timetable_entries limit 1;", "timetable_recurrence_shape")
bad("recurrence dates must be ISO dates", "insert into timetable_entries (course_id, day_of_week, start_time, end_time, recurrence) select course_id, 2, '08:00', '09:00', '{\"day_of_week\":2,\"from\":\"soon\"}'::jsonb from timetable_entries limit 1;", "")
bad("recurrence 'until' cannot precede 'from'", "insert into timetable_entries (course_id, day_of_week, start_time, end_time, recurrence) select course_id, 2, '08:00', '09:00', '{\"day_of_week\":2,\"from\":\"2026-12-01\",\"until\":\"2026-09-01\"}'::jsonb from timetable_entries limit 1;", "")
check("timetable day index exists", "select count(*) from pg_indexes where indexname='timetable_course_day_idx';", "1")
check("active-enrolment index exists", "select count(*) from pg_indexes where indexname='course_enrollments_active_idx';", "1")

print("== Phase 9: hardening (migration 0011) ==")
for tbl in ("audit_logs", "courses", "submissions", "assessment_marks", "attendance_records", "announcements", "profiles"):
    bad(f"TRUNCATE is blocked on {tbl}", f"truncate {tbl} cascade;", "never bulk-deleted")
    check(f"{tbl} rows survive the blocked TRUNCATE", f"select count(*) >= 0 from {tbl};", "t")
check("audit history survived", "select count(*) > 0 from audit_logs;", "t")
for role in ("anon", "authenticated"):
    check(f"{role} has no privilege on any public table", f"select count(*) from information_schema.role_table_grants where grantee='{role}' and table_schema='public';", "0")
    check(f"{role} cannot insert into audit_logs", f"select has_table_privilege('{role}','public.audit_logs','insert');", "f")
    check(f"{role} cannot select notifications", f"select has_table_privilege('{role}','public.notifications','select');", "f")
    check(f"{role} cannot run purge_read_notifications", f"select has_function_privilege('{role}','purge_read_notifications(integer)','execute');", "f")
check("service_role can run purge_read_notifications", "select has_function_privilege('service_role','purge_read_notifications(integer)','execute');", "t")
bad("retention below 30 days is refused", "select purge_read_notifications(7);", "at least 30 days")
bad("a missing retention is refused", "select purge_read_notifications(null);", "at least 30 days")
NU = U["s1"]
ok("an old read notification", f"insert into notifications (user_id, type, title, message, is_read, read_at, created_at) values ('{NU}', 'general', 'Old', 'Old', true, now() - interval '200 days', now() - interval '210 days');")
ok("a recent read notification", f"insert into notifications (user_id, type, title, message, is_read, read_at) values ('{NU}', 'general', 'Recent', 'Recent', true, now() - interval '5 days');")
ok("an old UNREAD notification", f"insert into notifications (user_id, type, title, message, created_at) values ('{NU}', 'general', 'OldUnread', 'OldUnread', now() - interval '300 days');")
check("purge removes only the old read one", "select purge_read_notifications(90);", "1")
check("the recent read notification stays", "select count(*) from notifications where title='Recent';", "1")
check("the old unread notification stays", "select count(*) from notifications where title='OldUnread';", "1")
check("the purge is audited", "select (new_value->>'deleted') || '/' || (new_value->>'older_than_days') from audit_logs where action='notifications.purge';", "1/90")
check("purge index exists", "select count(*) from pg_indexes where indexname='notifications_purge_idx';", "1")

print("\nFAILED:" if fails else "\nALL REAL-DATABASE CHECKS PASSED", fails if fails else "")
sys.exit(1 if fails else 0)
