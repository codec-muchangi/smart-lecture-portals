# Phase 4 — Assignments & Submissions (backend)

Scope: backend only; no pages built or changed. Requirements: FR-ASG-01…07, FR-LEC-05/06/07, FR-STU-05/06/07, NFR-SEC-03/04/06, NFR-REL-01, acceptance tests AT-06, AT-07, AT-08, AT-09 and AT-16, SRS workflow 5.2 (student submission) and sections 12–15.
Grading (FR-ASG-08/09/10, AT-10/11/12) is **Phase 5** in the SRS roadmap ("Grading & marks"); Phase 4 already stores, protects and correctly hides the `mark`, `feedback` and `grade_released` fields it will use.

## How data is collected and saved
| Step | What happens | Where it ends up |
|---|---|---|
| Create assignment | Lecturer sends JSON (title, instructions, deadline, max marks, late policy, publish flag) | Table `assignments` (a draft unless `published=true`); deadline normalised to UTC |
| Publish / edit / close | `PATCH` with any editable field | `assignments` (changed fields only) + audit row with old/new values |
| Attachment (optional) | Lecturer uploads one reference file | File in private bucket `materials` at `{course}/assignments/{assignment}/{upload_id}/{name}`; its path in `assignments.attachment_path` |
| Student submits | Student uploads one file | **File** in private bucket `submissions` at `{course}/{assignment}/{student}/{upload_id}/{name}`; **record** (file name, size, `submitted_at`, status `submitted` or `late`) in `submissions` |
| Resubmit | Same endpoint | Same row updated, fresh upload folder, old file removed, audit `submission.replace` |
| Lecturer review | List and download | Read only (signed links, short-lived) |
| Audit | `assignment.create/update`, `assignment.attachment_set/remove`, `submission.create/replace` | `audit_logs` |

## Rules and where they are enforced
| Rule | API/service | Database |
|---|---|---|
| Only assigned lecturers create/edit (FR-LEC-05) | `LecturerDep` (403) + `assert_course_lecturer` (404) | `assignments_guard`: creator must be assigned |
| Students see published assignments of their enrolled courses only (FR-ASG-02, AT-06) | `load_for_user` (404) | RLS on, no client policies |
| Valid deadline (FR-ASG-03): future, timezone-aware, ≤ 366 days | `_check_deadline`, `AwareDatetime` | `due_at not null` |
| Marks bounds: 0 < max ≤ 1000, 2 decimals | `AssignmentCreate/Update` | `max_marks > 0` check |
| Cannot lower max below an awarded mark; cannot unpublish with submissions | `update_assignment` (409) | `assignments_guard` |
| Late policy (FR-ASG-07): refuse after deadline unless `allow_late`; then status `late` | `submit` (`DEADLINE_PASSED`) | `check_submission_window` |
| Only enrolled students submit (FR-ASG-06) | `load_for_user` + `StudentDep` | `check_submission_window` |
| One submission per student; graded work cannot be replaced | `submit` (409) | `UNIQUE(assignment_id, student_id)` + `submissions_guard` |
| File rules (AT-09): type, content, size | `upload_service.read_and_validate` (shared) | Bucket: 25 MB, 8 MIME types |
| Own files only (AT-16) | `get_download` (404 for other students) | – |
| Grades hidden until released | `student_view` | – |
| Never delete academic history | no delete endpoints | hard `DELETE` blocked by triggers |
| Storage and database stay consistent | compensating deletes on every failure path | `UNIQUE(storage_path)` |
| Read-only history | `ensure_course_writable` → 409 | – |

## Endpoints
11 endpoints; full contract in `docs/API.md`: list/create assignments, detail/update, attachment PUT/DELETE/GET, submit, list submissions, my submission, download submission.

## Apply to your environment
1. Back up and branch **first**: `git checkout -b feat/phase4-backend`.
2. Extract `phase4-backend.zip` into a temporary folder, then copy `backend`, `db`, `docs`, `scripts` and `README.md` into the project root with `robocopy` (same method as before). Do not extract it inside `backend`.
3. Run `db/migrations/0006_assignments_submissions.sql` once in the Supabase SQL editor (choose **Run and enable RLS** if prompted).
4. `cd backend`, activate the venv, `pip install -r requirements.txt`, then `pytest -q` → **420 passed**.
5. Optional `.env` addition (default exists): `ASSIGNMENT_MAX_DUE_DAYS=366`.
6. Work through the checklist below.
7. Commit, push, open a pull request, wait for **CI passed**, merge.

## Manual checklist (live Supabase: the automated tests use an in-memory fake, so these cover the real services and the SQL triggers)
**Database**
- [ ] Migration 0006 runs without error.
- [ ] `select public, file_size_limit, array_length(allowed_mime_types,1) from storage.buckets where id='submissions';` → `false`, `26214400`, `8`.
- [ ] `select has_table_privilege('anon','public.v_submission_overview','select');` → `false`.

**Swagger as the lecturer** (Authorize with a lecturer token; use a course id from `GET /courses`)
- [ ] `POST /courses/{id}/assignments` with `{"title":"Assignment 1 - Introduction","due_at":"<a future date with offset, e.g. 2026-12-01T17:00:00+03:00>","max_marks":20}` → **201**, `state: draft`.
- [ ] Same call with a past `due_at` → **400** `due_at`; `max_marks: 0` → **422**.
- [ ] `PATCH /assignments/{id}` with `{"published": true}` → `state: open`, `submissions_open: true`.
- [ ] `PUT /assignments/{id}/attachment` with a PDF → 200; Supabase Storage → `materials` shows the file under `{course}/assignments/{id}/…`.

**Swagger as the student** (log out, log in as the student, Authorize)
- [ ] `GET /courses/{id}/assignments` shows it with `my_submission: null`; a draft the lecturer created is **not** listed.
- [ ] `POST /assignments/{id}/submissions` with a real PDF → **201**, `status: submitted`; Storage → `submissions` has the file at `{course}/{assignment}/{student}/{upload}/{name}`.
- [ ] Upload a text file renamed to `.pdf` → **400** `FILE_TYPE_NOT_ALLOWED`; an `.exe` → **400**.
- [ ] Submit again → **200** (replaced); Storage shows only the new file.
- [ ] `GET /assignments/{id}/submissions/me` → your submission; `mark` is `null`.
- [ ] `GET /assignments/{id}/submissions` → **403**.
- [ ] `GET /assignments/{id}/attachment` → a link that downloads the file.

**Deadline and late policy (lecturer, then student)**
- [ ] Create an assignment, publish it, then `PATCH` its `due_at` to a time a minute or two ahead. Wait for it to pass. As the student: `POST .../submissions` → **400** `DEADLINE_PASSED`.
- [ ] Lecturer `PATCH {"allow_late": true}`. Student submits → **201**, `status: late`.
- [ ] Lecturer `PATCH {"closed": true}`. Student submits → **409**.

**Lecturer review**
- [ ] `GET /assignments/{id}/submissions` shows the student with name and registration number; `?status=late` and `?q=STU001` filter correctly.
- [ ] `GET /submissions/{id}/download` returns a link; open it: the file downloads; after `expires_in` seconds the link stops working.
- [ ] `PATCH /assignments/{id}` with `{"published": false}` → **409** (it has submissions).

**Database guards** (SQL editor, run only as a throw-away test, then roll back or clean up)
- [ ] `delete from submissions;` → fails "submissions are never hard-deleted". `delete from assignments;` → fails "assignments are never hard-deleted".
- [ ] `audit_logs` contains `assignment.create`, `assignment.update`, `submission.create`, `submission.replace`.

## Decisions to confirm (SRS §22: flag, don't invent)
1. **Grading is Phase 5**, as in the roadmap. The `PATCH /submissions/{id}/grade` endpoint, marks release and the `returned for revision` action arrive there.
2. **Notifications** for new assignments (FR-NOT-03) are Phase 7. The hook points are `create_assignment` and the publish branch of `update_assignment`.
3. **Deadline rules** (SRS 13: "due date must follow configured rules"): must be in the future, timezone-aware, at most 366 days ahead (`ASSIGNMENT_MAX_DUE_DAYS`).
4. **Assignments default to draft** (FR-ASG-01); lecturers publish explicitly.
5. **No delete endpoints** for assignments or submissions (SRS 15: avoid destructive deletion of academic history); lecturers close an assignment instead.
6. **Replacing a submission** is allowed until it is graded and only while the deadline rules allow it. Changing this (for example one attempt only) is a one-line decision.
7. **Attachment endpoints** replace "multipart on create" from the API baseline (see `docs/API.md`).
8. **Submissions are files only.** The SRS allows "file or configured response"; no text-response configuration exists in the data model, so none was invented.
