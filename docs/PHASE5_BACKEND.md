# Phase 5 — Grading & Marks (backend)

Scope: backend only; no pages built or changed. Requirements: FR-LEC-08, FR-LEC-11, FR-LEC-12, FR-ASG-08/09/10, FR-STU-07/08, FR-MARK-01…07, SRS workflows 5.3 (grading) and 5.6 (marks entry), acceptance tests AT-05, AT-10, AT-11, AT-12, AT-19, SRS sections 9.2, 13 and 15.

Two related but separate things are built here:
1. **Grading assignment submissions**: feedback and a mark on one student's submitted work (the part of Phase 4 the SRS roadmap assigns to "Grading & marks").
2. **Assessments and marks**: components of a course result (CAT, practical, exam, ...) with a maximum mark and a weight, marks entered per student, and a weighted total.
They are independent: nothing is copied automatically from one to the other, because the SRS defines no link.

## How data is collected and saved
| Step | What happens | Where it ends up |
|---|---|---|
| Grade a submission | Lecturer sends `mark` (+ `feedback`, `release`) | `submissions`: status `graded`, `mark`, `feedback`, `grade_released`, `graded_by`, `graded_at`, plus an audit row, in **one transaction** (`apply_grade`) |
| Release / hide a grade | `release` alone, or the bulk endpoint for the whole assignment | `submissions.grade_released` + audit row (`release_grades` for the bulk version) |
| Return for revision | `return_for_revision` + required feedback | status `returned`, mark and release cleared, feedback kept; the old mark stays in the audit row |
| Create an assessment | Lecturer sends name, type, maximum mark, optional weight | `assessments` (always created **unpublished**) + audit row |
| Enter marks | One bulk request per assessment (up to 500 students) | `assessment_marks` (one row per student) + one audit row per created/changed mark, in **one transaction** (`upsert_assessment_marks`) |
| Publish | `PATCH published=true` | `assessments.published`; students then see the assessment and their own mark |
| Student views | `GET /courses/{id}/marks/me`, `GET /assignments/{id}/submissions/me` | Read only; totals computed by `marks_calc.py` |

## Rules and where they are enforced
| Rule | API / service | Database |
|---|---|---|
| Only a lecturer assigned to the course grades or enters marks (FR-ASG-08, FR-LEC-11) | `LecturerDep` (403 for students) + `assert_course_lecturer` (404 otherwise) | `submissions_grader`, `assessments_guard`, `assessment_marks_guard` |
| Mark within range (FR-ASG-09, AT-11): `0 ≤ mark ≤ max` | `MARK_OUT_OF_RANGE` (400); whole batch rejected | `trg_check_submission_mark`, `assessment_marks_range` |
| A graded submission has a mark and a grader; nothing else has a mark | `grading_service` | `submissions_grading_consistency` CHECK |
| Grade hidden until released (FR-ASG-10, AT-12) | `student_view` | – |
| Returned work: feedback visible, no mark | `student_view`, `_return_for_revision` | CHECK (no mark unless graded) |
| Marks only for actively enrolled students | batch pre-check lists every offending row | `assessment_marks_guard` + function re-check |
| One mark per student and assessment (AT-19) | upsert | `UNIQUE(assessment_id, student_id)` |
| Students see only published assessments and their own marks (FR-MARK-06, AT-05, AT-12) | `my_marks` (no student id is ever accepted from the client) | RLS on, no client policies |
| Who changed a mark and when (FR-MARK-07) | `entered_by`, `updated_at`, audit rows with old/new values | written in the same transaction |
| Weights add up to at most 100 | 409 with the budget | `assessments_guard` |
| `max_marks` cannot drop below a mark already given | 409 | guards on `assignments` and `assessments` |
| Marks and grades are corrected, never deleted (SRS 15) | no delete endpoints | hard `DELETE` blocked by triggers |
| Read-only history | `ensure_course_writable` → 409 in archived/inactive courses | – |

## Endpoints (8)
`PATCH /submissions/{id}/grade`, `POST /assignments/{id}/grades/release`, `POST|GET /courses/{id}/assessments`, `PATCH /assessments/{id}`, `GET|PUT /assessments/{id}/marks`, `GET /courses/{id}/marks/me`. Full contract, request bodies, errors and the weighted-total formula are in `docs/API.md`.

## Set up Phase 5 (step by step)
Run the commands in PowerShell from the project folder (`C:\Users\USER\OneDrive\Desktop\projects\smart-lecture-portal`).

**1. Save your work and start a branch** (do this before copying any file)
```powershell
git status
git checkout main
git pull
git checkout -b feat/phase5-backend
```
`git status` should be clean; if not, commit first (`git add .` then `git commit -m "chore: save work"`). Stop `uvicorn` and `npm run dev` with `Ctrl+C`.

**2. Extract the zip to a temporary folder and copy it in**
```powershell
$zip = "C:\Users\USER\Downloads\phase5-backend.zip"
$tmp = "$env:TEMP\phase5"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Expand-Archive -Path $zip -DestinationPath $tmp
dir $tmp
robocopy "$tmp\backend" "backend" /E
robocopy "$tmp\db" "db" /E
robocopy "$tmp\docs" "docs" /E
robocopy "$tmp\scripts" "scripts" /E
robocopy "$tmp\.github\workflows" ".github\workflows" /E
Copy-Item -Force "$tmp\README.md" "README.md"
Remove-Item -Recurse -Force $tmp
```
`dir $tmp` must list `backend`, `db`, `docs`, `scripts`, `README.md` and a hidden `.github` folder (use `dir $tmp -Force` to see it) (if it shows one extra wrapper folder, point `$tmp` at that inner folder). `robocopy` prints summary tables; exit codes 0 to 7 mean success. Your `backend\.env` and `venv` are not in the zip, so they are untouched; of `.github` only `workflows\ci.yml` is replaced (it gains the new database job), so your Dependabot settings stay as they are.

**3. Check the files are in place** (all lines must print `True`)
```powershell
Test-Path db\migrations\0007_grading_marks.sql
Test-Path backend\app\services\grading_service.py
Test-Path backend\app\services\assessment_service.py
Test-Path backend\app\services\marks_calc.py
Test-Path backend\app\api\v1\routes\marks.py
Test-Path scripts\verify_database.py
Test-Path docs\PHASE5_BACKEND.md
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
Expect **614 passed**. No new package is needed.

**5. Run the new migration in Supabase**
```powershell
cd ..
Get-Content db\migrations\0007_grading_marks.sql -Raw | Set-Clipboard
```
In Supabase: **SQL Editor → New query**, paste (`Ctrl+V`), **Run** (choose **Run and enable RLS** if prompted). It must say **Success**. Run it only once.
It adds a CHECK constraint to `submissions`. If you created test submissions in earlier phases they are `submitted`/`late` with no mark, so they satisfy it. If the migration reports that constraint `submissions_grading_consistency` is violated, tell me the row(s) it names.

**6. (Optional, Linux/macOS or CI) prove the SQL on a real database**
`python scripts/verify_database.py` (after `pip install pgserver`) applies all seven migrations to a throw-away PostgreSQL 16 and runs 85 checks. It is already part of CI (job "Database migrations"). It does not run on Windows; skip it locally.

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
git commit -m "feat: phase 5 grading and marks backend"
git push -u origin feat/phase5-backend
```
On GitHub open the pull request into `main`, wait for **CI passed** (now five jobs, including "Database migrations"), merge, then `git checkout main` and `git pull`.

## Manual checklist (live Supabase)
Use a lecturer token and a student token (log in at `POST /auth/login`, copy `access_token`, click **Authorize**; log out of Authorize before switching user). You need a course the lecturer is assigned to and the student is enrolled in (`GET /courses`), and a published assignment with a submission from the student (Phase 4 checklist).

**Database**
- [ ] Migration 0007 runs without error.
- [ ] `select has_function_privilege('anon','apply_grade(uuid,uuid,text,submission_status,numeric,text,boolean,boolean)','execute');` → `false` (same for `release_grades`, `upsert_assessment_marks`).
- [ ] `delete from assessment_marks;` and `delete from submissions;` fail with "never hard-deleted" (only run when you are happy for the statement to fail; it deletes nothing).

**Grading (lecturer)**
- [ ] `GET /assignments/{id}/submissions` → note a submission `id`.
- [ ] `PATCH /submissions/{id}/grade` with `{"mark": 15, "feedback": "Good structure"}` → 200, `status: graded`, `grade_released: false`.
- [ ] Same call with `{"mark": 999}` → **400 `MARK_OUT_OF_RANGE`** (use a value above the assignment's maximum), and the submission is unchanged. `{"mark": -1}` → **422**.
- [ ] `{}` → 400. `{"release": true}` on a still-ungraded submission → 409.

**Release policy (student)**
- [ ] As the student, `GET /assignments/{id}/submissions/me` → `status: graded` but `mark: null`, `feedback: null` (not released).
- [ ] As the lecturer, `PATCH .../grade` with `{"release": true}`; as the student the same call now shows `mark: 15` and the feedback.
- [ ] Lecturer `POST /assignments/{id}/grades/release` with `{"released": false}` → `{"updated": 1}`; the student's mark disappears again. Then `{"released": true}` brings it back.

**Return for revision**
- [ ] `{"return_for_revision": true}` without feedback → 400; with `"feedback": "Add references"` → `status: returned`, `mark: null`. The student sees the feedback; resubmitting (`POST .../submissions`) works and the status becomes `submitted`.

**Assessments and marks (lecturer)**
- [ ] `POST /courses/{id}/assessments` `{"name":"CAT 1","type":"cat","max_marks":30,"weight":15}` → 201, `published: false`. Add `{"name":"Exam","type":"exam","max_marks":100,"weight":86}` → **409** (weights above 100).
- [ ] `GET /assessments/{id}/marks` lists the enrolled students with `mark: null`.
- [ ] `PUT /assessments/{id}/marks` `{"marks":[{"student_id":"<id>","mark":24,"feedback":"Good"}]}` → `{"created":1,...}`. Repeat it → `{"unchanged":1,...}`. Change the mark to 26 → `{"updated":1,...}`.
- [ ] Send two rows where one mark is above 30 → **400 `MARK_OUT_OF_RANGE`** listing the bad row, and **neither** row is saved (check `GET .../marks`).
- [ ] Put the same student in twice, or use a student who is not enrolled → 400 with the row listed.
- [ ] Supabase → Table Editor → `audit_logs` shows `mark.create`, `mark.update` (old and new values) and the grading actions.

**Student's view**
- [ ] `GET /courses/{id}/marks/me` → `items: []` while the assessment is unpublished (AT-12).
- [ ] Lecturer `PATCH /assessments/{id}` `{"published": true}`; the student now sees `mark: 26`, `percentage: 86.67`, and `totals.weighted_total: 13` (26/30 × 15). Unpublish → it disappears again.
- [ ] A second student never sees the first student's mark (AT-05), and a student calling `GET /assessments/{id}/marks` gets **403**.

## Decisions to confirm (SRS §22: flag, don't invent)
1. **Weights are percentages of the course total and may add up to at most 100.** The SRS says "optional weight" and "weighted results according to the configured scheme" without defining the scheme; this is the simplest meaningful reading.
2. **Weighted total** = Σ mark/max × weight over published, weighted, marked assessments, with `weighted_percent` relative to the weight marked so far. Unmarked assessments do not count as zero.
3. **Assessments start unpublished**; marks are visible to students only after the lecturer publishes (FR-MARK-05). Marks can still be corrected after publishing (audited).
4. **No deletion of marks, grades or assessments** (SRS 15). A wrong mark is corrected by entering the right one; the old value stays in the audit log. If you need "remove this student's mark", it needs an explicit decision.
5. **Returned submissions**: the student sees the feedback but never a mark; returning a graded submission clears its mark (kept in the audit trail).
6. **Assignment grades and assessment marks are not linked** (an assignment-type assessment is entered by hand). An "import grades from an assignment" feature would be an addition to the SRS.
7. **Notifications** for released grades and marks (FR-NOT-03) are Phase 7. The hook points are `grading_service.release_all`, the release branch of `grade_submission`, and publishing in `assessment_service.update_assessment`.
8. **CI gained a real-database job** (`scripts/verify_database.py`). If it fails on GitHub, open the job log and send it to me.
