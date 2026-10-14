# Phase 7 — Announcements & Notifications (backend)

Scope: backend only; no pages built or changed. Requirements: FR-NOT-01…04, FR-LEC-13, FR-STU-10, SRS workflows for communication, acceptance tests AT-17 and AT-18, SRS sections 9.2 and 15. (Dashboards that show announcements and the unread count are Phase 8. Email/SMS/push are future enhancements, SRS 2.3.)

## How data is collected and saved
| Step | What happens | Where it ends up |
|---|---|---|
| Write an announcement | Lecturer sends title, body and `published` (default false = draft) | `announcements` + audit row; when published, one `notifications` row per actively enrolled student, all in **one transaction** (`create_announcement`) |
| Publish / unpublish / edit | `PATCH /announcements/{id}` | The change + audit row (`update_announcement`); students are notified only on the **first** publication |
| Other events | A lecturer publishes an assignment or a material, publishes an assessment (marks released), or releases a grade | `notifications` rows created by the backend right after the change (best effort, never blocks the change) |
| Student reads | `GET /courses/{id}/announcements` (published only), `GET /notifications` | Read only; header `X-Unread-Count` for the bell badge |
| Mark read | `PATCH /notifications/{id}/read`, `POST /notifications/read-all` | `notifications.is_read` + `read_at` |

## Rules and where they are enforced
| Rule | API / service | Database |
|---|---|---|
| Only a lecturer assigned to the course writes announcements (FR-NOT-01, FR-LEC-13) | `LecturerDep` (403 for students) + `assert_course_lecturer` (404 otherwise) | `announcements_guard` (author must be assigned) |
| Title and body required (SRS 9.2) | schema (422: 1 to 200 and 1 to 5000 characters, trimmed) | CHECK `length(trim(...)) > 0` (0001) |
| Students see **published** announcements only, and only for their own enrolled course (FR-NOT-02, AT-17) | `list_announcements` | RLS on, no client policies |
| Publication state controls visibility (SRS 9.2) | `published` flag; unpublishing hides it | CHECK: published ⇒ `published_at` set |
| Important events create in-app notifications (FR-NOT-03, AT-18) | see the events table in `docs/API.md` | `notify_course_students` (only **active** enrolments) |
| An announcement and its notifications succeed or fail together | one function = one transaction | `create_announcement`, `update_announcement` |
| No duplicate noise | notified once per announcement (not on edit or re-publish); events only when something **becomes** visible | – |
| Users read and mark only their **own** notifications (FR-NOT-04) | no user id is accepted from the client; a foreign id is 404 | RLS on |
| Notification content never changes; read stays read | – | `notifications_guard`, CHECK `is_read = (read_at is not null)` |
| Announcements are corrected or hidden, never deleted | no delete endpoint | hard `DELETE` blocked by trigger |
| Read-only history | `ensure_course_writable` → 409 in archived/inactive courses (reading still works) | – |
| A failed notification must not undo academic work | `notification_service` logs and returns 0 | – |

## Endpoints (6) and event hooks (5)
`POST|GET /courses/{id}/announcements`, `PATCH /announcements/{id}`, `GET /notifications`, `PATCH /notifications/{id}/read`, `POST /notifications/read-all`. Notification events for announcements, assignments, materials, marks and grades are listed with their titles and links in `docs/API.md`. The browser can read the `X-Unread-Count` header because CORS now exposes it.

## Set up Phase 7 (step by step)
Run the commands in PowerShell from the project folder (`C:\Users\USER\OneDrive\Desktop\projects\smart-lecture-portal`).

**1. Save your work and start a branch** (do this before copying any file)
```powershell
git status
git checkout main
git pull
git checkout -b feat/phase7-backend
```
`git status` should be clean; if not, commit first (`git add .` then `git commit -m "chore: save work"`). Stop `uvicorn` and `npm run dev` with `Ctrl+C`. (Phase 6 should already be merged; `git pull` brings it in.)

**2. Extract the zip to a temporary folder and copy it in**
```powershell
$zip = "C:\Users\USER\Downloads\phase7-backend.zip"
$tmp = "$env:TEMP\phase7"
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
Test-Path db\migrations\0009_announcements_notifications.sql
Test-Path backend\app\services\announcement_service.py
Test-Path backend\app\services\notification_service.py
Test-Path backend\app\repositories\announcement_repository.py
Test-Path backend\app\repositories\notification_repository.py
Test-Path backend\app\schemas\announcement.py
Test-Path backend\app\api\v1\routes\announcements.py
Test-Path backend\app\api\v1\routes\notifications.py
Test-Path backend\tests\test_announcements_api.py
Test-Path backend\tests\test_notifications_api.py
Test-Path backend\tests\test_notification_events.py
Test-Path docs\PHASE7_BACKEND.md
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
Expect **796 passed**. No new package is needed.

**5. Run the new migration in Supabase**
```powershell
cd ..
Get-Content db\migrations\0009_announcements_notifications.sql -Raw | Set-Clipboard
```
In Supabase: **SQL Editor → New query**, paste (`Ctrl+V`), **Run** (choose **Run and enable RLS** if prompted). It must say **Success**. Run it only once.
It adds two CHECK constraints (announcements and notifications), three triggers and three functions. If you already have a published announcement without a publication time, or a notification with `is_read` and `read_at` out of step, the migration names the constraint it could not add: send me that message and the row. A fresh project has none.

**6. (Optional, Linux/macOS or CI) prove the SQL on a real database**
`python scripts/verify_database.py` (after `pip install pgserver`) applies all nine migrations to a throw-away PostgreSQL 16, loads the demo seed and runs 163 checks. It is part of CI (job "Database migrations"); it does not run on Windows, so skip it locally.

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
git commit -m "feat: phase 7 announcements and notifications backend"
git push -u origin feat/phase7-backend
```
On GitHub open the pull request into `main`, wait for **CI passed**, merge, then `git checkout main` and `git pull`.

## Manual checklist (live Supabase)
Use a lecturer token and a student token (log in at `POST /auth/login`, copy `access_token`, click **Authorize**; log out of Authorize before switching user). You need a course the lecturer is assigned to and the student is enrolled in (`GET /courses`).

**Database**
- [ ] Migration 0009 runs without error.
- [ ] `select has_function_privilege('anon','create_announcement(uuid,uuid,text,text,boolean)','execute');` → `false` (same for `update_announcement(uuid,uuid,jsonb)` and `notify_course_students(uuid,notification_type,text,text,text)`).
- [ ] `delete from announcements;` fails with "never hard-deleted" (it deletes nothing).

**Announcements (lecturer)**
- [ ] `POST /courses/{id}/announcements` with `{"title":"Quiz on Friday","body":"Chapters 1 to 3."}` → **201**, `published: false`, `notified: 0`. Note the `id`.
- [ ] As the student, `GET /courses/{id}/announcements` does **not** show it (draft); as the lecturer it does.
- [ ] `PATCH /announcements/{id}` with `{"published": true}` → `published: true`, `published_at` set, `notified: 1` (or the class size).
- [ ] As the student the announcement now appears (AT-17), and `GET /notifications` shows `New announcement: Quiz on Friday` with a `link`.
- [ ] `PATCH` with `{"published": false}` → the student no longer sees it; `{"published": true}` again → `notified: 0` (no second notification).
- [ ] `PATCH` with `{"body": "Moved to Monday"}` → 200, `notified: 0`. `PATCH` with `{}` → **400**. `{"title": ""}` → **422**.
- [ ] A student calling `POST` or `PATCH` → **403**. A lecturer not assigned to the course → **404**.
- [ ] `audit_logs` shows `announcement.create`, `announcement.publish`, `announcement.unpublish`, `announcement.update` (with old and new values).

**Event notifications (AT-18)** (student token for the checks, lecturer token for the actions)
- [ ] Lecturer creates an assignment with `"published": true` → the student gets `New assignment: ...` linking to `/student/assignments/{id}`. A draft assignment sends nothing; publishing it later sends one.
- [ ] Lecturer uploads a material (published) → `New material: ...`.
- [ ] Lecturer publishes an assessment (`PATCH /assessments/{id}` `{"published": true}`) → `Marks released: ...`.
- [ ] Lecturer grades a submission with `"release": true` (or releases it later) → `Grade released: ...` for that student only. Re-grading an already visible grade sends nothing.

**Reading and marking (student)**
- [ ] `GET /notifications` → items newest first; open the response **headers** and check `x-unread-count` equals the number of unread.
- [ ] `GET /notifications?is_read=false` → only unread; the header is unchanged.
- [ ] `PATCH /notifications/{id}/read` → `is_read: true`, `read_at` set; the header drops by one. Repeat it → same `read_at`.
- [ ] `POST /notifications/read-all` → `{"updated": n}`; the header becomes `0`.
- [ ] Using another user's notification id → **404**. No token → **401**.

## Decisions to confirm (SRS §22: flag, don't invent)
1. **Announcements start as drafts** (`published` defaults to false), so a lecturer can finish writing before students are told. Say if you want them published by default.
2. **Students are notified once per announcement**, on its first publication. Editing, or un-publishing and re-publishing, does not notify again.
3. **Event notifications are best effort**, except announcements (same transaction). If a notification fails it is logged and the lecturer's change stands. Making them all transactional would mean the lecturer's action fails when only the notification failed.
4. **Only students are notified in this version** (FR-NOT-03 lists student-facing events). Lecturer events (for example a new submission) would be an addition.
5. **Withdrawn students get no new notifications**; notifications already received stay in their inbox.
6. **Grade notifications fire only when a grade becomes visible** to the student (including hide then show again), not on re-marking an already visible grade, and not when a submission is returned for revision.
7. **Notification links are front-end routes** from `docs/FRONTEND.md` (for example `/student/assignments/{id}`). If your page routes change, the links change in one place per event.
8. **No notification deletion or expiry** yet. A retention rule (for example delete read notifications after 90 days) can be added in Phase 9 (hardening).
9. **Unpublishing an announcement does not retract notifications already sent**; the link then shows nothing to the student.
