# Phase 2 — Courses & Enrollment (backend)

Scope: backend only; no pages built or changed. Requirements: FR-COURSE-01…05, FR-STU-02/03, FR-LEC-02/03, NFR-SEC-06, NFR-PERF-02.

## How data is collected and saved
| Data | How it gets in | Stored in | Audit |
|---|---|---|---|
| Courses (code, name, description, credits, year, semester, status) | `manage_academic.py create-course` (setup, no admin UI in v1.0) | `courses` | `course.create`, `course.status` |
| Lecturer ↔ course | `manage_academic.py assign-lecturer` | `course_lecturers` | `course.assign_lecturer` |
| Student ↔ course | `manage_academic.py enroll` / `enroll-csv` / `withdraw` | `course_enrollments` (status active/withdrawn/completed) | `enrollment.create/withdraw/reactivate` |
| Course description | `PATCH /courses/{id}` by an assigned lecturer | `courses.description` | `course.update` (old/new) |
Everything else on courses is read-only through the API.

## Rules and where they are enforced
| Rule | Service | Database |
|---|---|---|
| No duplicate enrollment (FR-COURSE-04) | pre-check → 409/Conflict | `UNIQUE(course_id, student_id)` |
| Unique course per offering | pre-check | `UNIQUE(course_code, academic_year, semester)` |
| Only active students enroll, only into active courses | validated | trigger `trg_enrollment_rules` |
| Only active lecturers assigned; no duplicates | validated | trigger + `UNIQUE(course_id, lecturer_id)` |
| Students see only enrolled courses; lecturers only assigned (FR-COURSE-02/03) | `assert_course_access` | RLS on, no client policies |
| Withdraw never deletes history | status change | FKs `ON DELETE RESTRICT` |
| Inactive courses hidden from students; archived/inactive read-only | `assert_course_access`, `ensure_course_writable` | – |
| Keys of enrollment/assignment immutable | – | triggers |

## Endpoints
`GET /courses`, `GET /courses/{id}`, `PATCH /courses/{id}`, `GET /courses/{id}/students` — details in `docs/API.md`.

## Set up courses and enrollments
```powershell
cd backend
venv\Scripts\activate
python ..\scripts\manage_academic.py create-course --code "CIT 3253" --name "Network Administration" --year 2026/2027 --semester "Semester 1" --credits 3
python ..\scripts\manage_academic.py assign-lecturer --course "CIT 3253" --staff-number LEC001
python ..\scripts\manage_academic.py enroll --course "CIT 3253" --reg STU001
python ..\scripts\manage_academic.py enroll-csv --course "CIT 3253" --file students.csv
python ..\scripts\manage_academic.py withdraw --course "CIT 3253" --reg STU001
python ..\scripts\manage_academic.py set-status --course "CIT 3253" --status archived
python ..\scripts\manage_academic.py list
```
Students and lecturers must already exist (`create_user.py`). If a code exists in several periods add `--year` and `--semester`.

## Apply to your environment
1. Run `db/migrations/0004_courses_enrollment.sql` once in the Supabase SQL editor (needs PostgreSQL 15+, which current Supabase projects have). Choose **Run and enable RLS** if prompted.
2. `pip install -r requirements.txt` then `pytest -q` (122 tests).
3. Run the manual checklist below against your live project.

## Manual checklist (live Supabase — the SQL cannot be exercised by the fake-database tests)
- [ ] Migration 0004 runs without error.
- [ ] Views are locked: in Supabase run `select has_table_privilege('anon','public.v_course_roster','select');` → `false` (also for `v_student_attendance_summary`).
- [ ] `insert into course_enrollments (course_id, student_id) values (<archived course>, <student>)` fails: "cannot enroll into a course that is not active".
- [ ] Enrolling the same student twice fails on the unique constraint.
- [ ] Swagger: log in as the student → `GET /courses` lists only enrolled courses; `GET /courses/{other}` → 404; `GET /courses/{id}/students` → 403.
- [ ] Log in as the lecturer → roster works with `?q=` and `?page_size=1&page=2`; `PATCH /courses/{id}` with `{"status":"archived"}` → 422.
- [ ] `audit_logs` has `course.update` and the setup actions.

## Decisions to confirm (SRS §22: flag, don't invent)
1. **Lecturer PATCH is description-only.** "Manage assigned courses" (FR-COURSE-03) is ambiguous; this is the smallest safe reading.
2. **No enrollment API.** No admin role exists in v1.0 and self-enrollment would break FR-COURSE-02, so enrollment is controlled setup via the script. If you want lecturers to enroll students in the UI later, it needs an explicit decision.
3. **Archived courses stay visible to students** (read-only history); **inactive ones are hidden**.
