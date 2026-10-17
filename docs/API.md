# Smart Lecture Portal — REST API Specification (v1)

Base URL: `/api/v1` · JSON unless stated · Auth: `Authorization: Bearer <Supabase access token>` on every endpoint except health.
Interactive docs: FastAPI `/docs` (OpenAPI). This file is the contract baseline (SRS §10); route names may be refined only via documented change.

## Conventions
- Timestamps ISO 8601 UTC. IDs are UUIDs.
- **Pagination:** `?page=1&page_size=20` (max 100) → `{ "items": [...], "page": 1, "page_size": 20, "total": 135 }`.
- **Errors:** `{ "code": "FORBIDDEN", "message": "…", "details": {…} }` — never stack traces.
- **Status codes:** 200/201 success · 204 no body · 400 bad request · 401 unauthenticated · 403 forbidden · 404 not found · 409 conflict · 422 schema validation · 500 unexpected.
- **Existence policy:** resources in a course the caller has no access to return **404** (no existence leak); role-mismatch on a role-only endpoint returns **403**.
- Codes: `UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, CONFLICT, FILE_TOO_LARGE, FILE_TYPE_NOT_ALLOWED, DEADLINE_PASSED, RATE_LIMITED, SERVICE_UNAVAILABLE, INTERNAL_ERROR` (`MARK_OUT_OF_RANGE` since Phase 5).

Access legend: **S** = student (enrolled), **L** = lecturer (assigned), **A** = any authenticated.

## Health
| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/health` | public | Liveness (outside `/api/v1`) |

## Auth (thin wrappers over Supabase Auth) — implemented in Phase 1
| Method | Path | Access | Request | Response |
|---|---|---|---|---|
| POST | `/auth/login` | public, rate-limited (10/min/IP) | `{email,password}` | 200 `{access_token,refresh_token,token_type,expires_in,user:{id,role,full_name}}`. 401 identical message for wrong password and unknown email; 403 if no profile or account not `active` (no tokens issued); 503 if the auth provider is down; 429 + `Retry-After` when limited |
| POST | `/auth/logout` | A | – | 204; revokes the user's refresh tokens at the provider; the access token is rejected on later calls |
| POST | `/auth/password/change` | A | `{current_password,new_password}` | 204; 400 with `details.current_password` if wrong; 400 with `details.new_password` if policy fails (≥8 chars, letters+digits, different from current) or the provider rejects it |
| POST | `/auth/password/reset` | public, rate-limited (5/15 min/IP) | `{email}` | 202 always, same body for known/unknown emails (no account enumeration) |

Note: the React app currently signs in directly with Supabase; the backend still authenticates every request from the bearer token. `/auth/login` exists for API clients and the SRS contract.

## Profile — implemented in Phase 1
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/me` | A | `{id,role,full_name,email,phone,avatar_url,created_at,updated_at,details}`; `details` = student (`registration_number,program,year_of_study,status`) or lecturer (`staff_number,department,title,status`) |
| PATCH | `/me` | A | Allowed: `full_name` (2-120, no control chars), `phone` (7-20 chars: digits, space, `+ - ( )`; `null` clears), `avatar_url` (https only; `null` clears). Any other field (role, email, id, registration/staff number, status) ⇒ 422. Empty body ⇒ 400. Only changed fields are written and audited (`profile.update`, old/new values) |

## Courses & enrollment — implemented in Phase 2
Course scope rule (applies to every course-owned resource in later phases): lecturer ⇒ assigned to the course; student ⇒ **active** enrollment and course not `inactive`. Otherwise **404** (never 403) so other courses' existence is not revealed. A wrong-role call on a lecturer-only endpoint is **403**.

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/courses` | A | Paginated `{items,page,page_size,total}`. Only the caller's courses. Filters: `status` = `active` (default) \| `archived` \| `inactive` \| `all`; `q` (code/name, case-insensitive); `academic_year`; `semester`; `page`, `page_size` (≤100). Inactive courses never appear for students |
| GET | `/courses/{course_id}` | S,L | Course fields + `lecturers:[{id,full_name,email,title,department}]`. `enrolled_count` (active) is returned to lecturers only (null for students) |
| PATCH | `/courses/{course_id}` | L | **Description only** (≤2000 chars; blank clears). Code, name, credits, period, status ⇒ 422 (owned by academic setup). Audited as `course.update` |
| GET | `/courses/{course_id}/students` | L | Roster, paginated, sorted by name. `status` = `active` (default) \| `withdrawn` \| `completed` \| `all`; `q` searches name, registration number, email. Fields: `student_id, full_name, email, registration_number, program, year_of_study, enrollment_status, enrolled_at` (no phone/avatar) |

Course creation, lecturer assignment and student enrollment are **not API endpoints** in v1.0: the SRS has no administrator role and treats provisioning as controlled setup (SRS 1.3, 24). They are done with `scripts/manage_academic.py` (see `docs/PHASE2_BACKEND.md`).

## Materials — implemented in Phase 3
Course scope rule as for Courses. Lecturer-only endpoints return **403** to students before looking anything up. Writes (upload, edit, delete) are blocked with **409** when the course is `archived` or `inactive` (read-only history). Students see **published** materials only; a draft or deleted material is **404** to them.

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/courses/{course_id}/materials` | S,L | Paginated `{items,page,page_size,total}`, newest first. Filters: `q` (title/description), `category`, `page`, `page_size` (≤100). Items: `id, course_id, title, description, category, file_name, mime_type, file_size, published, uploaded_by, uploader_name, created_at, updated_at` (never the storage path) |
| POST | `/courses/{course_id}/materials` | L | `multipart/form-data`: `file` (required), `title` (2-200, required), `description` (≤2000), `category` (`lecture_notes`\|`slides`\|`reading`\|`lab`\|`past_paper`\|`other`, default `other`), `published` (default `true`). 201 + material. See Upload rules |
| GET | `/materials/{material_id}/download` | S,L | `{url, expires_in, file_name}`: a signed URL valid for `SIGNED_URL_TTL_SECONDS` (default 120) that forces a download. Issued only after the course-access check |
| PATCH | `/materials/{material_id}` | L | `title`, `description` (blank clears), `category`, `published`. File name/path/size/type, course and uploader cannot be changed (422). Only changed fields are written and audited |
| DELETE | `/materials/{material_id}` | L | 204. Soft delete (row kept, hidden everywhere) and the stored file is removed; see Retention |

**Retention rule (FR-MAT-05):** deleting a material hides it immediately, keeps its metadata row for history, and removes the stored file. If storage is unavailable at that moment the delete still succeeds, `file_removed_at` stays empty and `scripts/purge_deleted_materials.py` removes the leftover file later.

## Assignments & submissions — implemented in Phase 4
Course scope rule as for Courses. Lecturer-only endpoints return **403** to students before any lookup. Students only see **published** assignments (a draft is 404 to them). Writes are blocked with **409** when the course is `archived` (read-only); `inactive` courses are hidden from students (404). Assignments are **never deleted**; close them instead.

States: `draft` (unpublished) → `open` (published, not closed) → `closed`. `submissions_open` tells a client whether a student can submit right now (published, not closed, and before the deadline or `allow_late`).

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/courses/{course_id}/assignments` | S,L | Paginated, latest deadline first. Filters: `state` = `draft`\|`open`\|`closed`\|`all` (default), `q` (title), `page`, `page_size` (≤100). Items: `id, course_id, title, description, instructions, due_at, max_marks, allow_late, published, closed, state, submissions_open, has_attachment, attachment_name, created_by, created_at, updated_at, my_submission`. Students get their own `my_submission` (status; mark/feedback only once released) |
| POST | `/courses/{course_id}/assignments` | L | JSON `{title (2-200), description?, instructions?, due_at, max_marks, allow_late?=false, published?=false}` → 201 + detail. `due_at` must include a timezone (stored UTC), be in the future and at most `ASSIGNMENT_MAX_DUE_DAYS` (366) ahead; `max_marks` in (0, 1000] with at most 2 decimals. Drafts are the default (FR-ASG-01) |
| GET | `/assignments/{assignment_id}` | S,L | Detail. Lecturers also get `submission_counts` `{submitted, late, graded, returned, total}`; students get `my_submission` and never see class counts |
| PATCH | `/assignments/{assignment_id}` | L | Any of `title, description, instructions, due_at, max_marks, allow_late, published, closed` (blank description/instructions clear them; others cannot be null). Rules: a **new** deadline must be in the future; a draft can only be published with a future deadline; an assignment with submissions cannot be unpublished (close it); only a published assignment can be closed; `max_marks` cannot drop below a mark already awarded; course, creator, attachment cannot be changed (422). Audited with old/new values |
| PUT | `/assignments/{assignment_id}/attachment` | L | `multipart/form-data` `file` (optional brief for students). Replaces any existing attachment. Same upload rules. Returns the assignment |
| DELETE | `/assignments/{assignment_id}/attachment` | L | Removes the attachment (404 if none). Returns the assignment |
| GET | `/assignments/{assignment_id}/attachment` | S,L | `{url, expires_in, file_name}` signed link (students: published assignments only) |
| POST | `/assignments/{assignment_id}/submissions` | S | `multipart/form-data` `file`. **201** first submission, **200** when it replaces the student's previous file. See Submission rules |
| GET | `/assignments/{assignment_id}/submissions` | L | Paginated, newest first. Filters: `status` = `submitted`\|`late`\|`graded`\|`returned`\|`all` (default), `q` (student name / registration number). Items: submission fields + `student_name, registration_number, email`; lecturers always see `mark`, `feedback` |
| GET | `/assignments/{assignment_id}/submissions/me` | S | Own submission (404 if none). `mark`/`feedback` are `null` until the lecturer releases the grade |
| GET | `/submissions/{submission_id}/download` | L (course) / S (own) | `{url, expires_in, file_name}` signed link; another student's submission is 404 |
| PATCH | `/submissions/{submission_id}/grade` | L | **Grading (Phase 5).** Body (strict, unknown fields ⇒ 422): `mark` (0 ≤ mark ≤ the assignment's `max_marks`, ≤ 2 decimals), `feedback` (≤ 2000, blank clears), `release` (strict true/false), `return_for_revision` (strict true/false). **Grade:** send `mark` (+ optional `feedback`, `release`) ⇒ status `graded`, grader and time recorded; a mark above the maximum ⇒ **400 `MARK_OUT_OF_RANGE`**. **Regrade:** send a new `mark`/`feedback`; omitted fields keep their value. **Release/hide only:** send `release` alone on a graded submission. **Return for revision:** `return_for_revision: true` + required `feedback` (no `mark`, no `release`) ⇒ status `returned`, any mark and release cleared. Sending nothing ⇒ 400; `release`/`feedback` alone on an ungraded submission ⇒ 409. Returns the lecturer view of the submission. The change and its audit row are written in one database transaction. Blocked with 409 when the course is archived |
| POST | `/assignments/{assignment_id}/grades/release` | L | **Phase 5.** `{"released": true\|false}` shows (or hides) every **graded** submission of the assignment at once; ungraded work is never touched. Returns `{"updated": n}` (rows that changed; repeating it returns 0). One audit row `grades.release_all` / `grades.hide_all` |

Route changes from the SRS baseline (allowed by SRS section 10, "route names may be refined"): the optional assignment attachment has its own `PUT/DELETE/GET .../attachment` endpoints instead of multipart on create/update, which keeps create/update plain JSON; and `GET /assignments/{id}/submissions/me` and `GET /submissions/{id}/download` were added for FR-STU-07 and FR-LEC-07.

### Submission rules (checked in this order)
1. Caller is a **student actively enrolled** in the assignment's course and the assignment is **published**, else 404 (AT-06). Lecturers get 403.
2. Course is `active` (409 if archived) and the assignment is not `closed` (409).
3. **Deadline (FR-ASG-04/07):** after `due_at` the submission is refused with `DEADLINE_PASSED` (400) unless the lecturer set `allow_late`, in which case it is stored with status `late`. The deadline instant itself counts as on time.
4. A **graded** submission can no longer be replaced (409); a submission **returned for revision** can be. `submitted`, `late` and `returned` ones can be replaced while the deadline rules still allow it. One row per student per assignment (a replacement updates it; the timestamp and status are refreshed).
5. The file passes the shared **upload rules** (type, content, size; AT-09), else 400.

Storage layout: `submissions/{course_id}/{assignment_id}/{student_id}/{upload_id}/{sanitised_name}`. For a first submission `upload_id` equals the submission id (exactly as SRS 14); each replacement gets a fresh `upload_id` folder so it can never collide with the file it replaces, and the old file is then removed. Assignment attachments live in the private `materials` bucket at `{course_id}/assignments/{assignment_id}/{upload_id}/{sanitised_name}`.

## Attendance — implemented in Phase 6
Lecturer endpoints return **403** to students before any lookup; a lecturer not assigned to the course gets **404** (never reveals other courses). A student sees only their own records of a course they are actively enrolled in. Creating sessions and marking are blocked with **409** when the course is `archived`/`inactive`; reading history is not. Validation errors found by the service (not the schema) are `400 VALIDATION_ERROR`; malformed bodies are `422`.

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/courses/{course_id}/attendance/sessions` | L | Body (strict): `session_date` (`YYYY-MM-DD`, from 2000-01-01, at most 365 days ahead), `start_time`, `end_time` (`HH:MM`[`:SS`], no time zone, end after start), `topic?` (≤ 200, blank = none). **409** if the course already has a session on that date starting at that time (FR-ATT-06). Pre-generates no records. Returns the session with `records_marked: 0` (201). Audit `attendance.session_create` |
| GET | `/courses/{course_id}/attendance/sessions` | L | Paginated (`page`, `page_size` ≤ 100), newest first (date, then start time); each item has `records_marked` |
| GET | `/attendance/sessions/{session_id}` | L | The session plus `summary` (`present`, `absent`, `late`, `excused`, `unmarked` among **actively enrolled** students) and `roster`: a page (`page`, `page_size` ≤ 200 default 100, `q` search by name/registration/email) of actively enrolled students with `status` (null = not marked yet), `note`, `marked_at`, `marked_by` |
| POST | `/attendance/sessions/{session_id}/records` | L | Body (strict): `records: [{student_id, status, note?}]`, 1 to 500 rows, `status` one of `present`, `absent`, `late`, `excused`, `note` ≤ 500. Every row is validated first and **all problems are listed** (`details.rows`: `index`, `student_id`, `message`); a student not actively enrolled or repeated in the request ⇒ **400 `VALIDATION_ERROR`** and nothing is saved. Otherwise one transaction saves every record and one audit row per change: a first mark is `attendance.mark`, a change of status or note is `attendance.correct` (old and new values). Re-sending identical data changes nothing. Returns `{created, updated, unchanged, total}`. A session dated more than one day after today (UTC) ⇒ **409** (cannot mark the future; the day of grace covers time zones). A database-rule rejection because data changed meanwhile ⇒ 409 "reload and try again" |
| GET | `/courses/{course_id}/attendance/me` | S | Read-only. `items`: the student's own records, newest session first (`session_id`, `session_date`, `start_time`, `end_time`, `topic`, `status`, `note`, `marked_at`); `summary`: `present`, `absent`, `late`, `excused`, `attended`, `counted_sessions`, `attendance_pct` |

**Percentage policy (FR-ATT-05; default until the institution confirms its own):** `attendance_pct = (present + late) / (present + late + absent) × 100`, rounded half-up to 2 decimals; `excused` sessions are left out; `null` while nothing counts. One calculator (`services/attendance_calc.py`) is used by the API and mirrored by the SQL view `v_student_attendance_summary`.

## Marks & grading — implemented in Phase 5
Course scope rule as for Courses. Lecturer-only endpoints return **403** to students before any lookup; students only ever see **published** assessments and **their own** marks (AT-05, AT-12). Writes are blocked with **409** when the course is `archived`/`inactive`.

An **assessment** is one component of a course result (CAT, practical, exam, ...). Its `weight` is a percentage of the course total; the weights of one course may add up to at most 100 (409 otherwise). **Marks are never deleted**: correct a wrong value by entering the right one (every change is audited with the old and new value).

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/courses/{course_id}/assessments` | L | `{name (2-100), type (cat\|assignment\|practical\|exam\|other), max_marks (0,1000], weight? (0,100]}` → 201. Created **unpublished** (FR-MARK-05). 409 if the weights would exceed 100 |
| GET | `/courses/{course_id}/assessments` | S,L | Paginated (`page`, `page_size` ≤ 100), oldest first. Students see published only. Lecturers also get `marks_entered` (how many students have a mark) |
| PATCH | `/assessments/{assessment_id}` | L | `name, type, max_marks, weight (null removes it), published`. `max_marks` cannot drop below a mark already entered (409); the weight budget is re-checked (409). `published` shows/hides the assessment and all its marks to students. Course/creator cannot change (422). Audited |
| GET | `/assessments/{assessment_id}/marks` | L | The roster for entering marks: actively enrolled students with their current `mark`, `feedback`, `updated_at` (null when not marked), sorted by name. `q` (name/registration number/email), `page`, `page_size` ≤ 200 (default 50) |
| PUT | `/assessments/{assessment_id}/marks` | L | `{"marks":[{"student_id","mark","feedback?"}, ...]}` (1-500 rows). **All or nothing:** every row is checked first (0 ≤ mark ≤ `max_marks`, student actively enrolled, no student twice); any problem rejects the whole batch with **400** (`MARK_OUT_OF_RANGE` if any mark is too high, otherwise `VALIDATION_ERROR`) and `details.rows = [{index, student_id, message}]` listing **every** problem. Success: `{created, updated, unchanged, total}`. Saved in one database transaction together with one audit row per created/changed mark (`mark.create` / `mark.update`, old and new values, the lecturer who changed it). One row per student and assessment |
| GET | `/courses/{course_id}/marks/me` | S | Own marks for **published** assessments: `items:[{assessment_id, name, type, max_marks, weight, mark (null = not marked yet), percentage, feedback}]` and `totals` |

**Weighted result (FR-MARK-04), `totals`:** every weighted, published, marked assessment contributes `mark / max_marks × weight` points.
`weighted_total` = points earned so far · `weight_graded` = weight of the marked assessments · `weight_published` = weight of all published weighted assessments · `weighted_percent` = `weighted_total / weight_graded × 100` (null if nothing is marked) · `marks_total` / `max_total` = raw sums over the marked assessments (unweighted ones included). Rounded half-up to 2 decimals using exact decimal arithmetic. Unpublished assessments never count.
Example: CAT 1 (24/30, weight 15) and CAT 2 (40/50, weight 25) with an unmarked exam (weight 60) ⇒ `weighted_total 32.0`, `weight_graded 40`, `weight_published 100`, `weighted_percent 80.0`.

Assignment grades and assessment marks are **separate**: an assignment grade (above) is feedback on one submission; an assessment mark feeds the course result. Nothing is copied automatically between them (the SRS defines no link, so none was invented).

## Announcements — implemented in Phase 7
Same course-scope rules as the other course resources: a lecturer must be assigned to the course (404 otherwise), a student actively enrolled (404 otherwise); writing endpoints return **403** to students and **409** when the course is `archived`/`inactive` (reading still works).

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/courses/{course_id}/announcements` | L | Body (strict): `title` (1 to 200, trimmed, required), `body` (1 to 5000, required), `published` (strict true/false, default **false** = draft). 201 + the announcement; `notified` = students told. Publishing on create notifies every actively enrolled student **in the same database transaction** as the announcement and its audit row (`announcement.create`, or `announcement.publish` when published) |
| GET | `/courses/{course_id}/announcements` | S,L | Paginated (`page`, `page_size` ≤ 100). **Students see published announcements only**, most recently published first; lecturers see everything including drafts, newest first |
| PATCH | `/announcements/{announcement_id}` | L | Any of `title`, `body`, `published` (none can be null; an empty body ⇒ 400). `published: true` on a draft sets `published_at` and **notifies the students once**; unpublishing hides it from students but keeps `published_at`; re-publishing later does **not** notify again; editing never notifies. Sending identical values changes and audits nothing. Audit actions `announcement.update`, `announcement.publish`, `announcement.unpublish` with old and new values. Response `notified` = students told by this call |

Announcements are never hard-deleted; unpublish one to hide it.

## Notifications — implemented in Phase 7
Every user (student or lecturer) has their own inbox. No user id is ever accepted from the client: another user's notification is simply **404**.

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/notifications` | A | Own notifications, newest first. Query: `is_read` (true/false), `page`, `page_size` ≤ 100. Item: `id`, `type`, `title`, `message`, `link` (an app route such as `/student/assignments/{id}`), `is_read`, `created_at`, `read_at`. The response header **`X-Unread-Count`** is the caller's total unread count, independent of the filter and page (it is exposed to browsers through CORS) |
| PATCH | `/notifications/{id}/read` | A | Marks one as read (FR-NOT-04); already-read keeps its original `read_at`. 404 if it is not yours |
| POST | `/notifications/read-all` | A | Marks all of the caller's unread notifications; returns `{updated: n}` |

## Timetable — implemented in Phase 8
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/timetable` | A | Classes of the caller's own **active** courses (student: enrolled; lecturer: assigned). Query `from`, `to` (ISO dates). |

- Default window: today (UTC) to today + 6 days. Only `from` → 7 days from it; only `to` → the 7 days ending on it. `to` before `from` → **400**; more than 93 days → **400**; a malformed date → **422**.
- Response: `{date_from, date_to, items: [{entry_id, course_id, course_code, course_name, date, day_of_week (1=Mon..7=Sun), start_time, end_time, room, notes, recurring}]}`, sorted by date then start time.
- A stored weekly entry (optionally limited by `recurrence.from` / `recurrence.until`) is expanded into one item per matching date; a one-off entry (`specific_date`) appears once.
- The timetable is **read-only**: it is seeded or loaded by the institution (SRS §22 leaves lecturer entry open), so there is no `POST` route.

## Dashboards — implemented in Phase 8
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/dashboard` | A | Role-specific overview of the caller's **active** courses (archived/inactive are hidden). Computed from live records on every call. |

`/dashboard` (student, `role: "student"`):
- `courses`; `upcoming_assignments` (published, not closed, deadline ahead, soonest first, max 10, each with the student's own `submission_status`: `not_submitted|submitted|late|graded|returned`);
- `attendance_summary` (one row per course, same policy as `/courses/{id}/attendance/me`); `recent_marks` (max 5, newest first, **released** assignment grades and **published** assessment marks only);
- `announcements` (latest 5 published, 200-character `preview`); `unread_notifications`.

`/dashboard` (lecturer, `role: "lecturer"`):
- `courses` (with `enrolled_count`); `pending_grading` `{total, items}` (submitted or late work from actively enrolled students; max 10 items); `upcoming_deadlines` (max 10, with `enrolled` and `submitted`);
- `attendance_summary` (sessions, `last_session_date`, pooled `attendance_pct`); `performance_summary` (published assessments, `students_without_marks`, `average_weighted_percent`).

The number of database queries is fixed (lists are fetched in bulk), so the dashboard does not slow down as classes grow (NFR-PERF-01).

## Reports — implemented in Phase 8
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/courses/{course_id}/reports/attendance` | L | `student_id`, `from`, `to` filters. `{summary, students[], sessions[]}` |
| GET | `/courses/{course_id}/reports/submissions` | L | `student_id`, `assignment_id` filters. `{summary, assignments[]}` |
| GET | `/courses/{course_id}/reports/performance` | L | `student_id` filter. `{summary, assessments[], students[]}` |

- Lecturer assigned to the course only: a student gets **403**, a lecturer of another course **404**. Archived courses stay readable.
- Reports cover the **actively enrolled** students. `student_id` of someone not in the class (or unknown) → **404**; `to` before `from` → **400**.
- Totals reconcile with the source records (AT-20): per-student and per-session counts add up to the summary; `submitted + late + graded + returned + not_submitted = assignments x students`.
- Attendance percentage = (present + late) / (present + late + absent), excused excluded, 2 decimals; `unmarked` counts students with no record for a session. Submissions: `missing` = not submitted after the deadline. Performance: per-student totals use **published** assessments only; `marks_entered` counts the marks recorded.
- Lists are complete (not paginated): they are class-sized.

## Authorization rules (centralised in `app/core/permissions.py`)
1. `get_current_user` verifies the token with Supabase, loads `profiles` row; user IDs are **never** taken from the client body.
2. `require_role(role)` → 403.
3. `require_course_lecturer(course_id)` — row in `course_lecturers`.
4. `require_course_student(course_id)` — active row in `course_enrollments`.
5. Child resources (material, assignment, submission, assessment, session, announcement) resolve to `course_id` first, then rule 3/4. Students accessing submissions/marks/attendance are additionally restricted to `student_id == me`.

## Upload rules (implemented in Phase 3; shared by materials, assignment attachments and submissions)
- **Allowed types** (configurable via `ALLOWED_FILE_EXTENSIONS`; default): PDF, DOCX, PPTX, XLSX, CSV, PNG, JPG/JPEG, ZIP. Types the server cannot verify by content (for example SVG, HTML, EXE, legacy DOC/PPT) cannot be enabled by configuration.
- **Size:** `MAX_UPLOAD_MB` (default 25). Enforced three times: from the `Content-Length` header before the body is read, exactly after reading (at most limit+1 bytes are read), and by the Supabase bucket limit.
- **Type check:** the extension must be allowed AND the content must match it (magic bytes; Office files must contain the correct internal parts; CSV must be text). The client's `Content-Type` is ignored; the stored MIME type comes from the verified extension.
- **File names:** sanitised to `A-Z a-z 0-9 _ -` plus one lower-case extension (no paths, dots, spaces, `&`, quotes or control characters); non-ASCII letters are transliterated or dropped. Storage path is generated by the server: `materials/{course_id}/{material_id}/{sanitised_name}`.
- **Errors (HTTP 400, per SRS 10.1):** `FILE_TYPE_NOT_ALLOWED` (details: `allowed_types`), `FILE_TOO_LARGE` (details: `max_mb`), `VALIDATION_ERROR` for an empty file; `SERVICE_UNAVAILABLE` (503) if storage is down.
- Files are served only through signed URLs with `Content-Disposition: attachment`, so uploaded content is never rendered inline.
- No malware scanning in v1.0 (SRS 14 says to consider it before production): treat ZIP/Office downloads as untrusted by students' devices, and add a scanner (for example ClamAV) before going live.

## Notification events (FR-NOT-03, AT-18)
Notifications go to the **actively enrolled** students of the course; withdrawn students and other courses' students get none. The event is raised only when something **becomes visible**, never for drafts, edits, hiding or repeats:

| Type | Raised when | Title | Link |
|---|---|---|---|
| `announcement` | an announcement is published for the first time (create with `published: true`, or first `PATCH published: true`) | `New announcement: {title}` (message = first 200 characters) | `/student/courses/{course_id}` |
| `assignment_published` | an assignment is created published, or a draft is published | `New assignment: {title}` (message = due date, UTC) | `/student/assignments/{id}` |
| `material_added` | a material is uploaded published, or a draft is published | `New material: {title}` | `/student/courses/{course_id}/materials` |
| `marks_released` | an assessment is published | `Marks released: {name}` | `/student/marks` |
| `grade_released` | a submission's grade becomes visible to its student (single release, or bulk release: only the students it reveals) | `Grade released: {assignment title}` | `/student/assignments/{id}` |

**Delivery guarantees:** announcement notifications are written in the same transaction as the announcement. The other four are **best effort**: they are created right after the lecturer's change is saved, and a failure is logged but never blocks or undoes the change. Notifications are not created for lecturers in this version, and none are sent by email/SMS/push (future enhancement, SRS 2.3).
