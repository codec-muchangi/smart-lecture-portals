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

## Auth (thin wrappers over Supabase Auth)
| Method | Path | Access | Request | Response |
|---|---|---|---|---|
| POST | `/auth/login` | public | `{email,password}` | `{access_token,refresh_token,expires_in,user:{id,role,full_name}}`; 401 generic message on failure; rate-limited |
| POST | `/auth/logout` | A | – | 204 |
| POST | `/auth/password/change` | A | `{current_password,new_password}` | 204; 400 if current wrong |
| POST | `/auth/password/reset` | public | `{email}` | 202 always (no account enumeration) |

## Profile
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/me` | A | Profile + role-specific block (student/lecturer) |
| PATCH | `/me` | A | Allowed: `full_name, phone, avatar_url`. Role, email, reg/staff numbers are not editable |

## Courses
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/courses` | A | Only enrolled (S) / assigned (L) courses. Filters: `status, q, academic_year, semester` |
| GET | `/courses/{course_id}` | S,L | Details + lecturers list |
| GET | `/courses/{course_id}/students` | L | Enrolled students; `q`, pagination |

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
