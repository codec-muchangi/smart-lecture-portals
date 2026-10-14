# Phase 6 — Attendance (backend)

Scope: backend only; no pages built or changed. Requirements: FR-ATT-01…06, FR-LEC-09, FR-LEC-10, FR-STU-09, SRS workflow 5.4, acceptance tests AT-13, AT-14, AT-19, SRS sections 9.2 and 15. (Attendance *reports* are Phase 8; notifications are Phase 7.)

## How data is collected and saved
| Step | What happens | Where it ends up |
|---|---|---|
| Create a session | Lecturer sends date, start/end time, optional topic | `attendance_sessions` + audit row `attendance.session_create`; **no records are pre-generated** |
| Open the roster | `GET /attendance/sessions/{id}` | Read only: the course's actively enrolled students, each with their current status (or "not marked") |
| Mark students | One request per session (1 to 500 rows) | `attendance_records` (one row per student) + one audit row per first mark (`attendance.mark`) or correction (`attendance.correct`), in **one transaction** (`upsert_attendance_records`) |
| Student views | `GET /courses/{id}/attendance/me` | Read only: own records and the calculated percentage (`attendance_calc.py`) |

## Rules and where they are enforced
| Rule | API / service | Database |
|---|---|---|
| Only a lecturer assigned to the course creates sessions and marks (FR-LEC-09/10) | `LecturerDep` (403 for students) + `assert_course_lecturer` (404 otherwise) | `attendance_sessions_guard`, `attendance_records_guard` |
| No duplicate session for the same course, date and start time (FR-ATT-06) | 409 (pre-check, plus the database race is mapped to 409 too) | `UNIQUE(course_id, session_date, start_time)` |
| End time after start time | schema (422) | CHECK `end_time > start_time` |
| Only actively enrolled students get records (SRS 9.2) | every offending row is listed (400), nothing saved | `attendance_records_guard` + function |
| Valid status values only: present, absent, late, excused (FR-ATT-03) | schema (422) | `attendance_status` enum |
| One record per student per session (AT-19) | upsert | `UNIQUE(session_id, student_id)` |
| A student cannot edit attendance (FR-ATT-04); sees only their own (AT-14) | the endpoint has no write methods (405) and never accepts a student id | RLS on, no client policies |
| Attendance percentage from applicable sessions (FR-ATT-05) | `attendance_calc.py` | view `v_student_attendance_summary` uses the same policy |
| Corrections are audited with who, when, old and new (FR-LEC-10, SRS 15) | `marked_by`, `marked_at`, audit rows | written in the same transaction |
| Whole batch or nothing | rows validated first; the function is one transaction | function |
| Attendance is corrected, never deleted | no delete endpoints | hard `DELETE` blocked by triggers |
| Cannot mark a session that has not happened | 409 if the session date is more than 1 day after today (UTC) | – |
| Read-only history | `ensure_course_writable` → 409 in archived/inactive courses (reading still works) | – |

## Endpoints (5)
`POST|GET /courses/{id}/attendance/sessions`, `GET /attendance/sessions/{id}`, `POST /attendance/sessions/{id}/records`, `GET /courses/{id}/attendance/me`. Full contract and errors are in `docs/API.md`.

## Set up Phase 6 (step by step)
Run the commands in PowerShell from the project folder (`C:\Users\USER\OneDrive\Desktop\projects\smart-lecture-portal`).

**1. Save your work and start a branch** (do this before copying any file)
```powershell
git status
git checkout main
git pull
git checkout -b feat/phase6-backend
```
`git status` should be clean; if not, commit first (`git add .` then `git commit -m "chore: save work"`). Stop `uvicorn` and `npm run dev` with `Ctrl+C`.

**2. Extract the zip to a temporary folder and copy it in**
```powershell
$zip = "C:\Users\USER\Downloads\phase6-backend.zip"
$tmp = "$env:TEMP\phase6"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Expand-Archive -Path $zip -DestinationPath $tmp
dir $tmp
robocopy "$tmp\backend" "backend" /E
robocopy "$tmp\db" "db" /E
robocopy "$tmp\docs" "docs" /E
robocopy "$tmp\scripts" "scripts" /E
Copy-Item -Force "$tmp\README.md" "README.md"
Remove-Item -Recurse -Force $tmp
```
`dir $tmp` must list `backend`, `db`, `docs`, `scripts` and `README.md` (if it shows one extra wrapper folder, point `$tmp` at that inner folder). `robocopy` prints summary tables; exit codes 0 to 7 mean success. Your `backend\.env` and `venv` are not in the zip, so they are untouched. This phase does not change `.github`, so CI settings stay as they are.

**3. Check the files are in place** (all lines must print `True`)
```powershell
Test-Path db\migrations\0008_attendance.sql
Test-Path backend\app\services\attendance_service.py
Test-Path backend\app\services\attendance_calc.py
Test-Path backend\app\repositories\attendance_repository.py
Test-Path backend\app\schemas\attendance.py
Test-Path backend\app\api\v1\routes\attendance.py
Test-Path backend\tests\test_attendance_api.py
Test-Path docs\PHASE6_BACKEND.md
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
Expect **700 passed**. No new package is needed.

**5. Run the new migration in Supabase**
```powershell
cd ..
Get-Content db\migrations\0008_attendance.sql -Raw | Set-Clipboard
```
In Supabase: **SQL Editor → New query**, paste (`Ctrl+V`), **Run** (choose **Run and enable RLS** if prompted). It must say **Success**. Run it only once. It adds two guard triggers and one function; it changes no existing rows.

**6. (Optional, Linux/macOS or CI) prove the SQL on a real database**
`python scripts/verify_database.py` (after `pip install pgserver`) applies all eight migrations to a throw-away PostgreSQL 16 and runs 118 checks (including loading the demo seed). It is part of CI (job "Database migrations"). It does not run on Windows; skip it locally.

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
git commit -m "feat: phase 6 attendance backend"
git push -u origin feat/phase6-backend
```
On GitHub open the pull request into `main`, wait for **CI passed**, merge, then `git checkout main` and `git pull`.

## Manual checklist (live Supabase)
Use a lecturer token and a student token (log in at `POST /auth/login`, copy `access_token`, click **Authorize**; log out of Authorize before switching user). You need a course the lecturer is assigned to and the student is enrolled in (`GET /courses`).

**Database**
- [ ] Migration 0008 runs without error.
- [ ] `select has_function_privilege('anon','upsert_attendance_records(uuid,uuid,jsonb)','execute');` → `false`.
- [ ] `delete from attendance_records;` and `delete from attendance_sessions;` fail with "never hard-deleted" (they delete nothing).

**Sessions (lecturer)**
- [ ] `POST /courses/{id}/attendance/sessions` with `{"session_date":"2026-10-05","start_time":"09:00","end_time":"11:00","topic":"Week 6"}` → **201**, `records_marked: 0`. Note the session `id`.
- [ ] The same body again → **409**. The same date with `"start_time":"14:00","end_time":"16:00"` → 201.
- [ ] `"end_time":"08:00"` → **422**. `"session_date":"05/10/2026"` → **422**.
- [ ] `GET /courses/{id}/attendance/sessions` lists both, newest first.

**Marking (lecturer)**
- [ ] `GET /attendance/sessions/{session_id}` lists the enrolled students with `status: null` and `summary.unmarked` equal to the class size.
- [ ] `POST /attendance/sessions/{session_id}/records` with `{"records":[{"student_id":"<student id>","status":"present"}]}` → `{"created":1,"updated":0,"unchanged":0,"total":1}`.
- [ ] Repeat it → `{"unchanged":1,...}`. Change to `"status":"late","note":"Bus delay"` → `{"updated":1,...}`.
- [ ] `"status":"sleeping"` → **422**. A student who is not enrolled, or the same student twice → **400** listing the bad row; nothing is saved.
- [ ] Supabase → Table Editor → `audit_logs` shows `attendance.session_create`, `attendance.mark` and `attendance.correct` (with old and new status).
- [ ] A session dated next week → marking it returns **409**.

**Student's view**
- [ ] `GET /courses/{id}/attendance/me` → the student's records, newest first, and `summary.attendance_pct` (for example one `late` and one `absent` → `50.0`).
- [ ] `POST /courses/{id}/attendance/me` → **405**. The student calling any lecturer attendance endpoint → **403**.
- [ ] A second student never sees the first student's records (AT-14).

## Decisions to confirm (SRS §22: flag, don't invent)
1. **Percentage policy** (SRS leaves it to the institution): `(present + late) / (present + late + absent)`, excused left out. Changing it means editing `attendance_calc.py` and the view `v_student_attendance_summary`.
2. **All four statuses are enabled** (FR-ATT-03 says "if these statuses are enabled").
3. **Controlled marking interface, no pre-generated records** (FR-ATT-02 allows either): the roster is computed from active enrolments, and unmarked students have no row (shown as "not marked", never counted).
4. **Students see the lecturer's note** on their own record (useful for "excused: medical letter"). If notes should be private to lecturers, say so and I will hide it.
5. **Marking the future is blocked** (a session dated more than 1 day ahead, UTC, so a morning session in Kenya can still be marked); old sessions can always be marked or corrected, audited.
6. **No session edit or delete endpoint** (not in the SRS API list; sessions are history). A wrongly created session stays; fix it by marking it correctly. A "cancel session" feature would need your decision.
7. **A student who withdraws** keeps their past records but leaves the roster and marking; their percentage is no longer visible to them because course access ends (Phase 2 rule).
8. **Notifications** and attendance **reports** (FR-REP-01, `GET /courses/{id}/reports/attendance`) are Phases 7 and 8.
