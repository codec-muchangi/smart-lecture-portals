# Smart Lecture Portal — REST API Specification (v1)

Base URL: `/api/v1` · JSON unless stated · Auth: `Authorization: Bearer <Supabase access token>` on every endpoint except health.
Interactive docs: FastAPI `/docs` (OpenAPI). This file is the contract baseline (SRS §10); route names may be refined only via documented change.

## Conventions
- Timestamps ISO 8601 UTC. IDs are UUIDs.
- **Pagination:** `?page=1&page_size=20` (max 100) → `{ "items": [...], "page": 1, "page_size": 20, "total": 135 }`.
- **Errors:** `{ "code": "FORBIDDEN", "message": "…", "details": {…} }` — never stack traces.
- **Status codes:** 200/201 success · 204 no body · 400 bad request · 401 unauthenticated · 403 forbidden · 404 not found · 409 conflict · 422 schema validation · 500 unexpected.
- **Existence policy:** resources in a course the caller has no access to return **404** (no existence leak); role-mismatch on a role-only endpoint returns **403**.
- Codes: `UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, CONFLICT, FILE_TOO_LARGE, FILE_TYPE_NOT_ALLOWED, DEADLINE_PASSED, MARK_OUT_OF_RANGE, INTERNAL_ERROR`.

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

## Materials
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/courses/{course_id}/materials` | S,L | S sees `published` only; `q, category` |
| POST | `/courses/{course_id}/materials` | L | `multipart/form-data`: `title, description?, category?, published?, file`. Validates type/size → 201 |
| GET | `/materials/{material_id}/download` | S,L | `{url, expires_in}` short-lived signed URL after authz |
| PATCH | `/materials/{material_id}` | L | `title, description, category, published` |
| DELETE | `/materials/{material_id}` | L | Soft delete; storage object removed per retention rule; 204 |

## Assignments & submissions
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/courses/{course_id}/assignments` | S,L | S sees published only, plus own submission status |
| POST | `/courses/{course_id}/assignments` | L | `{title,description?,instructions?,due_at,max_marks,allow_late?,published?}`; multipart if attachment |
| GET | `/assignments/{assignment_id}` | S,L | Details (+ own submission for S) |
| PATCH | `/assignments/{assignment_id}` | L | Update / publish / close. `max_marks` cannot drop below an existing awarded mark |
| POST | `/assignments/{assignment_id}/submissions` | S | multipart `file`. 403/404 if not enrolled; `DEADLINE_PASSED` 400 unless `allow_late`; late ⇒ `status=late`; resubmit allowed only while `submitted` (before grading) or `returned` |
| GET | `/assignments/{assignment_id}/submissions` | L | Paginated; `status` filter |
| GET | `/submissions/{submission_id}/download` | L (course) / S (own) | Signed URL |
| PATCH | `/submissions/{submission_id}/grade` | L | `{mark, feedback?, release?:bool, return_for_revision?:bool}`; `0 ≤ mark ≤ max_marks`; audited |
| GET | `/assignments/{assignment_id}/submissions/me` | S | Own submission; mark/feedback only if `grade_released` |

## Attendance
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/courses/{course_id}/attendance/sessions` | L | `{session_date,start_time,end_time,topic?}`; 409 on duplicate; pre-generates no records (marking UI loads roster) |
| GET | `/courses/{course_id}/attendance/sessions` | L | Paginated |
| GET | `/attendance/sessions/{session_id}` | L | Session + roster with current statuses |
| POST | `/attendance/sessions/{session_id}/records` | L | `{records:[{student_id,status,note?}]}` upsert in one transaction; only enrolled students; corrections write audit rows |
| GET | `/courses/{course_id}/attendance/me` | S | History + `attendance_pct` |

## Marks
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/courses/{course_id}/assessments` | L | `{name,type,max_marks,weight?}` |
| GET | `/courses/{course_id}/assessments` | S,L | S sees published only |
| PATCH | `/assessments/{assessment_id}` | L | Edit / publish / unpublish |
| GET | `/assessments/{assessment_id}/marks` | L | Roster with marks |
| PUT | `/assessments/{assessment_id}/marks` | L | `{marks:[{student_id,mark,feedback?}]}` bulk upsert, atomic; any out-of-range ⇒ whole request 400 `MARK_OUT_OF_RANGE` with per-row details; audited |
| GET | `/courses/{course_id}/marks/me` | S | Own published marks + weighted total |

## Announcements
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/courses/{course_id}/announcements` | S,L | S sees published only |
| POST | `/courses/{course_id}/announcements` | L | `{title,body,published?}`; publishing creates notifications |
| PATCH | `/announcements/{announcement_id}` | L | Edit / publish / unpublish |

## Notifications
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/notifications` | A | Own only; `is_read`, pagination; header `X-Unread-Count` |
| PATCH | `/notifications/{id}/read` | A | Own only |
| POST | `/notifications/read-all` | A | Convenience |

## Timetable
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/timetable` | A | Authorised courses only; `from`, `to` |
| POST | `/courses/{course_id}/timetable` | L | *Pending decision* (Pre-Coding Checklist: seeded vs lecturer-entered). Implement only after decision |

## Dashboards & reports
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/dashboard` | A | Role-specific aggregate (see below) |
| GET | `/courses/{course_id}/reports/attendance` | L | Per-student %, per-session counts; `student_id` filter |
| GET | `/courses/{course_id}/reports/performance` | L | Per-assessment stats, per-student weighted totals |
| GET | `/courses/{course_id}/reports/submissions` | L | Per-assignment submitted/late/graded/missing counts |

`/dashboard` (student): `{courses, upcoming_assignments, attendance_summary, recent_marks, announcements, unread_notifications}`.
`/dashboard` (lecturer): `{courses, pending_grading, upcoming_deadlines, attendance_summary, performance_summary}`.
*Note:* `/dashboard` and the three-way reports split are the only additions beyond the SRS §10 table (needed by FR-STU-01, FR-LEC-01, FR-REP-02).

## Authorization rules (centralised in `app/core/permissions.py`)
1. `get_current_user` verifies the token with Supabase, loads `profiles` row; user IDs are **never** taken from the client body.
2. `require_role(role)` → 403.
3. `require_course_lecturer(course_id)` — row in `course_lecturers`.
4. `require_course_student(course_id)` — active row in `course_enrollments`.
5. Child resources (material, assignment, submission, assessment, session, announcement) resolve to `course_id` first, then rule 3/4. Students accessing submissions/marks/attendance are additionally restricted to `student_id == me`.

## Upload rules
Config-driven (`ALLOWED_FILE_TYPES`, `MAX_UPLOAD_MB`): default PDF, DOCX, PPTX, XLSX, CSV, PNG, JPG/JPEG, ZIP; default 25 MB. Extension **and** sniffed content-type must agree; filenames sanitised; paths generated server-side per SRS §14.

## Notification events
`assignment_published`, `marks_released`, `grade_released`, `material_added`, `announcement` → fan-out to active enrolled students in the same transaction as the triggering change.
