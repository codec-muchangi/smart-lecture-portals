# Smart Lecture Portal — Frontend Page & Workflow Specification

Stack: React + Vite, React Router, TanStack Query, CSS Modules. Responsive (mobile ≥360px, tablet, desktop). Role guards are UX only; the backend enforces authorization.

## Application shell
`AppShell`: sidebar (collapses to drawer on mobile) · top bar (page title, breadcrumbs, notification bell with unread count, user menu) · content area. Nav items differ per role; unavailable controls are not rendered.
Every async screen has **loading, empty, error (with retry), success** states. Destructive actions use `ConfirmDialog`. Forms show field-level errors from `422/400` `details`.

## Route map
| Route | Page | Role | Backend |
|---|---|---|---|
| `/` | Landing | public | – |
| `/login` | Login | public | `POST /auth/login` |
| `/forgot-password`, `/reset-password` | Reset flow | public | `/auth/password/reset` |
| `/student` | StudentDashboard | S | `GET /dashboard` |
| `/student/courses` | MyCourses | S | `GET /courses` |
| `/student/courses/:courseId` | CourseDetails (tabs: Overview, Materials, Assignments, Attendance, Marks, Announcements) | S | `GET /courses/{id}` |
| `/student/courses/:courseId/materials` | Materials | S | materials list/download |
| `/student/courses/:courseId/assignments` | Assignments | S | assignments list |
| `/student/assignments/:assignmentId` | AssignmentSubmission | S | assignment detail, submit, `/submissions/me` |
| `/student/attendance` | Attendance (all courses) | S | `/courses/{id}/attendance/me` |
| `/student/marks` | MarksResults | S | `/courses/{id}/marks/me` |
| `/student/announcements` | Announcements | S | announcements |
| `/student/notifications` | Notifications | S | notifications |
| `/student/timetable` | Timetable | S | `GET /timetable` |
| `/student/profile`, `/student/settings` | Profile, Settings (change password) | S | `/me`, password change |
| `/lecturer` | LecturerDashboard | L | `GET /dashboard` |
| `/lecturer/courses` | MyCourses | L | `GET /courses` |
| `/lecturer/courses/:courseId` | CourseDetails (tabs: Overview, Students, Materials, Assignments, Attendance, Marks, Announcements, Reports) | L | course endpoints |
| `/lecturer/courses/:courseId/students` | Students | L | `/students` |
| `/lecturer/courses/:courseId/materials` | MaterialsManagement | L | materials CRUD |
| `/lecturer/courses/:courseId/assignments` | AssignmentManagement | L | assignments CRUD |
| `/lecturer/assignments/:assignmentId/submissions` | SubmissionReview | L | submissions list, grade |
| `/lecturer/courses/:courseId/attendance` | AttendanceManagement | L | sessions, records |
| `/lecturer/courses/:courseId/marks` | MarksManagement | L | assessments, marks |
| `/lecturer/courses/:courseId/announcements` | Announcements | L | announcements |
| `/lecturer/courses/:courseId/reports` | Reports | L | reports |
| `/lecturer/notifications`, `/lecturer/timetable`, `/lecturer/profile`, `/lecturer/settings` | shared pages | L | – |
| `/403`, `*` | Forbidden, NotFound | any | – |

**Guards:** `RequireAuth` (→ `/login?next=`), `RequireRole` (wrong role → redirect to own dashboard). After login, route by `user.role`. On `401` from API: try refresh once, else clear session, redirect to `/login` preserving unsaved-form drafts in `sessionStorage`.

## Page specifications (key content)
- **StudentDashboard:** cards — enrolled courses, upcoming assignments (due soonest, status chip), attendance % per course (warning colour under threshold), recent released marks, latest announcements, unread notifications. All from `/dashboard`.
- **LecturerDashboard:** assigned courses, pending grading count, upcoming deadlines, attendance summary, performance summary.
- **Materials (S):** searchable/filterable list (title, category, date, size), download button → signed URL. **(L):** table + upload dialog (title, description, category, file with client-side type/size pre-check, progress bar), edit metadata, publish toggle, delete with confirm.
- **AssignmentSubmission (S):** instructions, due date with countdown, max marks, status; file dropzone; disabled with reason after deadline (unless late allowed → “will be marked late” banner); shows grade/feedback only when released.
- **AssignmentManagement (L):** list with status (draft/published/closed); create/edit form (validation: title, due date in future at creation, max_marks > 0); publish/close actions.
- **SubmissionReview (L):** paginated table (student, submitted at, late flag, status), row → drawer with download, mark input (0…max), feedback, “release grade”, “return for revision”.
- **AttendanceManagement (L):** sessions list; create-session form; roster grid with status segmented control per student, “mark all present”, save (single request), corrections show “edited” badge.
- **Attendance (S):** per-course % gauge + history table; read-only.
- **MarksManagement (L):** assessments list (name, type, max, weight, published); roster entry grid with inline validation, bulk save, publish/unpublish toggle, totals column.
- **MarksResults (S):** per course table of published assessments, mark/max, feedback, weighted total.
- **Announcements:** feed (S read-only); (L) create/edit with draft/publish.
- **Notifications:** list, unread styling, mark read / mark all read, click → deep link.
- **Timetable:** week grid (desktop) / day list (mobile).
- **Reports (L):** tabs Attendance / Performance / Submissions; course-level tables + per-student filter; totals must reconcile with source records.
- **Profile/Settings:** editable allowed fields, read-only identifiers, change-password form.

## Workflows (UI level)
1. **Login:** form → call login → store session (in-memory + Supabase persisted session) → `/me` → route by role.
2. **Submit assignment:** course → Assignments → assignment → choose file → client checks type/size → upload with progress → success toast + status chip “Submitted” (or “Late”).
3. **Grade:** Assignments → Submissions → open row → enter mark/feedback → Save → optimistic update, rollback on error → optional Release.
4. **Attendance:** Course → Attendance → New session → roster → set statuses → Save → summary.
5. **Upload material:** Course → Materials → Upload → validate → progress → list refresh, students notified.
6. **Marks entry:** Marks → assessment → grid → validate → Save → totals refresh → Publish.

## Frontend architecture
`src/services/apiClient.js` (fetch wrapper: base URL, bearer token, error normalisation to `{code,message,details}`, 401 refresh) · `src/features/<domain>/{api.js, hooks.js, components/}` · `src/pages/<role>/…` composes features · `src/app/` router, providers, guards · `src/types/` JSDoc typedefs matching API schemas.
Environment: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` only (no service key).
Accessibility: labelled inputs, visible focus, semantic landmarks, dialog focus trapping, colour is never the sole status indicator.
