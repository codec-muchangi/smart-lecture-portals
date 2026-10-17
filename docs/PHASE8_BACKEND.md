# Phase 8 — Dashboards & Reports (backend)

Scope: backend only; no pages built or changed. Requirements: FR-STU-01, FR-LEC-01, FR-LEC-14, FR-REP-01…05, FR-TIME-01…03, FR-STU-11, FR-LEC-15, acceptance tests AT-01, AT-02 and AT-20, NFR-PERF-01, SRS sections 4.10, 4.11 and 15. Nothing on a dashboard or report is stored or hard-coded: it is computed from the real records on every request.

## How data is collected and saved
| Step | What happens | Where it comes from |
|---|---|---|
| Open the dashboard | `GET /dashboard` returns the student's or the lecturer's view, chosen by the login role | Courses, assignments, submissions, attendance, assessments and marks, announcements and notifications, read in bulk (a fixed number of queries) |
| Open the timetable | `GET /timetable?from=&to=` expands weekly and one-off entries into dated classes | `timetable_entries` of the caller's own active courses |
| Run a report | `GET /courses/{id}/reports/attendance\|submissions\|performance` | Attendance records, submissions and marks of the course's active students |
| Nothing is written | All Phase 8 routes are read-only | Only migration 0010 adds integrity rules and indexes |

## Rules and where they are enforced
| Rule | API / service | Database |
|---|---|---|
| Dashboards show only the caller's own data (FR-STU-01, FR-LEC-01) | the user id and role come from the token, never from the request | RLS on, no client policies |
| Reports only for a lecturer assigned to the course (FR-REP-04/05) | `LecturerDep` (403 for students) + `assert_course_lecturer` (404 otherwise) | – |
| Student- and course-level filtering (FR-REP-04) | `student_id`, `assignment_id`, `from`, `to`; a student outside the active class is 404, `to` before `from` is 400 | – |
| Totals match the source records (AT-20) | per-student, per-session and summary figures come from the same rows and are tested to add up | views `v_student_attendance_summary` and `v_student_course_total` agree (checked in `verify_database.py`) |
| Same attendance and marks policy everywhere | `attendance_calc` and `marks_calc` are the only calculators | ERD note 4 |
| Students see released results only | recent marks use released grades and published assessments | – |
| Fast dashboards (NFR-PERF-01) | lists are fetched in bulk and grouped in memory; a test proves the query count does not grow with class size | indexes in 0010 |
| Complete totals past Supabase's 1000-row limit | `utils/paging.fetch_all` reads every page | – |
| Only active courses on dashboards and timetable | archived/inactive courses are hidden (reports of an archived course stay readable) | – |
| Timetable rows are well formed (FR-TIME-01) | recurrence parsed defensively | CHECKs and a trigger in 0010 |

## Endpoints (5)
`GET /dashboard`, `GET /timetable`, `GET /courses/{id}/reports/attendance`, `GET /courses/{id}/reports/submissions`, `GET /courses/{id}/reports/performance`. Parameters and response shapes are in `docs/API.md`.

## Set up Phase 8 (step by step)
Run the commands in PowerShell from the project folder (`C:\Users\USER\OneDrive\Desktop\projects\smart-lecture-portal`).

**1. Save your work and start a branch** (do this before copying any file)
```powershell
git status
git checkout main
git pull
git checkout -b feat/phase8-backend
```
`git status` should be clean; if not, commit first (`git add .` then `git commit -m "chore: save work"`). Stop `uvicorn` and `npm run dev` with `Ctrl+C`. (Phase 7 should already be merged; `git pull` brings it in.)

**2. Extract the zip to a temporary folder and copy it in**
```powershell
$zip = "C:\Users\USER\Downloads\phase8-backend.zip"
$tmp = "$env:TEMP\phase8"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Expand-Archive -Path $zip -DestinationPath $tmp
$src = $tmp
if (-not (Test-Path "$src\backend")) { $src = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName }
dir $src
```
`dir $src` must list `backend`, `db`, `docs`, `scripts` and `README.md`. Then copy:
```powershell
robocopy "$src\backend" "backend" /E
robocopy "$src\db" "db" /E
robocopy "$src\docs" "docs" /E
robocopy "$src\scripts" "scripts" /E
Copy-Item -Force "$src\README.md" "README.md"
Remove-Item -Recurse -Force $tmp
```
`robocopy` prints summary tables; exit codes 0 to 7 mean success. Your `backend\.env` and `venv` are not in the zip, so they are untouched. This phase does not change `.github`.

**3. Check the files are in place** (all lines must print `True`)
```powershell
Test-Path db\migrations\0010_timetable_reporting.sql
Test-Path backend\app\utils\paging.py
Test-Path backend\app\services\report_service.py
Test-Path backend\app\services\dashboard_service.py
Test-Path backend\app\services\timetable_service.py
Test-Path backend\app\repositories\report_repository.py
Test-Path backend\app\schemas\report.py
Test-Path backend\app\schemas\dashboard.py
Test-Path backend\app\schemas\timetable.py
Test-Path backend\app\api\v1\routes\reports.py
Test-Path backend\app\api\v1\routes\dashboard.py
Test-Path backend\tests\test_reports_api.py
Test-Path backend\tests\test_dashboard_api.py
Test-Path backend\tests\test_timetable_api.py
Test-Path backend\tests\test_paging_util.py
Test-Path docs\PHASE8_BACKEND.md
git status
```
`git status` must not list a `.env` file or a stray `app`/`tests` folder at the project root.

**4. Install and run the tests**
```powershell
cd backend
venv\Scripts\activate
pip install -r requirements.txt
pytest -q
```
Expect **839 passed**. No new package is needed.

**5. Run the new migration in Supabase**
```powershell
cd ..
Get-Content db\migrations\0010_timetable_reporting.sql -Raw | Set-Clipboard
```
In Supabase: **SQL Editor → New query**, paste (`Ctrl+V`), **Run** (choose **Run and enable RLS** if prompted). It must say **Success**. Run it only once.
It adds two CHECK constraints, one trigger and two indexes to the timetable and enrolment tables; it changes no rows and creates no table. If your `timetable_entries` table already holds a row that is both weekly and one-off (or neither), or a malformed `recurrence`, the migration names the constraint it could not add: send me that message. A fresh project has none, and the demo seed is fine.

**6. (Optional, Linux/macOS or CI) prove the SQL on a real database**
`python scripts/verify_database.py` (after `pip install pgserver`) applies all ten migrations to a throw-away PostgreSQL 16, loads the demo seed and runs 174 checks. It is part of CI (job "Database migrations"); it does not run on Windows, so skip it locally.

**7. Start the backend and do the live checks**
```powershell
cd backend
uvicorn app.main:app --reload
```
Open http://127.0.0.1:8000/docs and follow the checklist below. Stop the server with `Ctrl+C` when done.

**8. Commit, push, merge**
```powershell
cd ..
git add .
git commit -m "feat: phase 8 dashboards and reports backend"
git push -u origin feat/phase8-backend
```
On GitHub open the pull request into `main`, wait for **CI passed**, merge, then `git checkout main` and `git pull`.

## Manual checklist (live Supabase)
Use a lecturer token and a student token (log in at `POST /auth/login`, copy `access_token`, click **Authorize**; log out of Authorize before switching user). Use the demo data (`python scripts/seed_demo.py` / `db/seed/seed_demo.sql`) or your own course with a few assignments, sessions and marks.

**Database**
- [ ] Migration 0010 runs without error and says **Success**.
- [ ] `select indexname from pg_indexes where indexname in ('timetable_course_day_idx','course_enrollments_active_idx');` returns both.

**Dashboards**
- [ ] Student `GET /dashboard` → `role: "student"`, your enrolled courses, upcoming assignments with `submission_status`, attendance per course, recent released marks, latest announcements, `unread_notifications` (AT-01).
- [ ] Submit an assignment, call again → that assignment shows `submitted`. Mark a notification read → the unread count drops.
- [ ] Lecturer `GET /dashboard` → `role: "lecturer"`, assigned courses with `enrolled_count`, `pending_grading`, `upcoming_deadlines`, attendance and performance summaries (AT-02).
- [ ] Grade one pending submission → `pending_grading.total` drops by one.
- [ ] No token → **401**. Each user sees only their own courses.

**Timetable**
- [ ] `GET /timetable` → the next 7 days of your classes (the demo seed has a Monday 08:00 to 10:00 class).
- [ ] `GET /timetable?from=2026-10-01&to=2026-10-31` → every Monday in October.
- [ ] `from` after `to` → **400**; a range over 93 days → **400**; `from=banana` → **422**.

**Reports (lecturer)**
- [ ] `GET /courses/{id}/reports/attendance` → per-student percentages, per-session counts and a summary; the counts add up (AT-20). Add `?student_id=...` and `?from=...&to=...` and check the filters.
- [ ] `GET /courses/{id}/reports/submissions` → per-assignment submitted/late/graded/returned/not_submitted/missing; add `?assignment_id=...`.
- [ ] `GET /courses/{id}/reports/performance` → per-assessment statistics and per-student weighted totals (published assessments only).
- [ ] Student token on any report → **403**. Lecturer of another course → **404**. A student that is not enrolled → **404**.
- [ ] The percentage in the attendance report equals the student's own `GET /courses/{id}/attendance/me` figure.

## Decisions to confirm (SRS §22: flag, don't invent)
1. **Reports are lecturer-only.** A student's own view is their dashboard and `/courses/{id}/attendance/me`, `/courses/{id}/marks/me`, so students never see class-wide data.
2. **Reports cover actively enrolled students.** Withdrawn students are left out of every figure (their records stay stored).
3. **The timetable is read-only.** The SRS leaves open whether lecturers enter it (§22), so no `POST` was invented; entries are seeded or loaded by the institution. Say if lecturers should create them.
4. **Dashboards and the timetable show active courses only**; archived courses disappear from them but their reports stay readable.
5. **Per-student performance totals use published assessments only**, matching what students are allowed to see; the per-assessment table lists all assessments with a `published` flag.
6. **The student dashboard's recent marks show released or published items only.**
7. **Attendance percentage in reports is pooled** (all present + late over all counted records), and `unmarked` shows missing records separately.
8. **`missing` submissions are counted only after the deadline.**
9. **Reports are not paginated**: they are class-sized lists, complete so totals always add up.
10. **Supabase answers at most 1000 rows per request.** Phase 8 fixed Phase 5 and 6 queries that could have silently cut off large classes (`fetch_all`).
11. **Next:** Phase 9 is hardening and Phase 10 deployment.
