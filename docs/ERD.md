# Smart Lecture Portal — Database ERD (SRS v1.0 §9)

Schema source of truth: `db/migrations/0001_init_schema.sql`. Any change requires a new numbered migration and an update here.

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "id"
  PROFILES ||--o| STUDENTS : "1-1 (role=student)"
  PROFILES ||--o| LECTURERS : "1-1 (role=lecturer)"
  PROFILES ||--o{ NOTIFICATIONS : receives
  PROFILES ||--o{ AUDIT_LOGS : "actor"

  COURSES ||--o{ COURSE_LECTURERS : has
  LECTURERS ||--o{ COURSE_LECTURERS : teaches
  COURSES ||--o{ COURSE_ENROLLMENTS : has
  STUDENTS ||--o{ COURSE_ENROLLMENTS : enrolls

  COURSES ||--o{ MATERIALS : has
  LECTURERS ||--o{ MATERIALS : uploads
  COURSES ||--o{ ASSIGNMENTS : has
  LECTURERS ||--o{ ASSIGNMENTS : creates
  ASSIGNMENTS ||--o{ SUBMISSIONS : receives
  STUDENTS ||--o{ SUBMISSIONS : submits

  COURSES ||--o{ ATTENDANCE_SESSIONS : has
  ATTENDANCE_SESSIONS ||--o{ ATTENDANCE_RECORDS : has
  STUDENTS ||--o{ ATTENDANCE_RECORDS : "marked for"

  COURSES ||--o{ ASSESSMENTS : has
  ASSESSMENTS ||--o{ ASSESSMENT_MARKS : has
  STUDENTS ||--o{ ASSESSMENT_MARKS : earns

  COURSES ||--o{ ANNOUNCEMENTS : has
  COURSES ||--o{ TIMETABLE_ENTRIES : scheduled

  PROFILES { uuid id PK "= auth.users.id" user_role role text full_name text email UK text phone text avatar_url }
  STUDENTS { uuid id PK_FK text registration_number UK text program smallint year_of_study person_status status }
  LECTURERS { uuid id PK_FK text staff_number UK text department text title person_status status }
  COURSES { uuid id PK text course_code text course_name text academic_year text semester course_status status "UK(code,year,semester)" }
  COURSE_LECTURERS { uuid id PK uuid course_id FK uuid lecturer_id FK "UK(course,lecturer)" }
  COURSE_ENROLLMENTS { uuid id PK uuid course_id FK uuid student_id FK enrollment_status status "UK(course,student)" }
  MATERIALS { uuid id PK uuid course_id FK text storage_path text mime_type bigint file_size uuid uploaded_by FK bool published timestamptz deleted_at }
  ASSIGNMENTS { uuid id PK uuid course_id FK timestamptz due_at numeric max_marks bool allow_late bool published bool closed uuid created_by FK }
  SUBMISSIONS { uuid id PK uuid assignment_id FK uuid student_id FK submission_status status numeric mark bool grade_released uuid graded_by FK "UK(assignment,student)" }
  ATTENDANCE_SESSIONS { uuid id PK uuid course_id FK date session_date time start_time time end_time "UK(course,date,start)" }
  ATTENDANCE_RECORDS { uuid id PK uuid session_id FK uuid student_id FK attendance_status status uuid marked_by FK "UK(session,student)" }
  ASSESSMENTS { uuid id PK uuid course_id FK assessment_type type numeric max_marks numeric weight bool published }
  ASSESSMENT_MARKS { uuid id PK uuid assessment_id FK uuid student_id FK numeric mark uuid entered_by FK "UK(assessment,student)" }
  ANNOUNCEMENTS { uuid id PK uuid course_id FK text title text body bool published timestamptz published_at }
  NOTIFICATIONS { uuid id PK uuid user_id FK notification_type type bool is_read timestamptz read_at }
  TIMETABLE_ENTRIES { uuid id PK uuid course_id FK smallint day_of_week date specific_date time start_time time end_time text room }
  AUDIT_LOGS { uuid id PK uuid actor_user_id FK text action text entity_type uuid entity_id jsonb old_value jsonb new_value }
```

## Integrity rules → enforcement

| SRS §9.2 rule | Enforced by |
|---|---|
| role ∈ {student, lecturer} | `user_role` enum |
| unique registration/staff number | `UNIQUE` constraints |
| course code unique per offering | `UNIQUE (course_code, academic_year, semester)` |
| unique enrollment / lecturer assignment / attendance record / assessment mark | composite `UNIQUE` constraints |
| 0 ≤ mark ≤ max_marks | `CHECK mark >= 0` + `BEFORE INSERT/UPDATE` triggers (cross-table); also validated in services |
| max_marks > 0 | `CHECK` |
| attendance status set | `attendance_status` enum |
| no silent cascade of academic records | all academic FKs `ON DELETE RESTRICT`; only `notifications` cascades (transient) |
| audit history immutable | trigger blocks UPDATE/DELETE on `audit_logs` |
| soft-delete over destructive delete (§15) | `materials.deleted_at`; statuses on courses/enrollments |

## Design decisions / flagged ambiguities (SRS §22 “flag, don't invent”)

1. `submissions.grade_released` added — SRS §5.3/FR-ASG-10 require a release policy for grades but the §9 table has no field for it.
2. `submissions` is unique per (assignment, student): one submission row; resubmission after `returned` updates the row.
3. `courses` has no lecturer column — assignment is via `course_lecturers` only.
4. Attendance % default policy: `(present+late) / (present+late+absent)`, excused excluded. Confirm with institution (Pre-Coding Checklist).
5. Weighted total = Σ(mark / max_marks × weight) over **published** assessments only (`v_student_course_total`).
6. `materials.category` and `assignments.closed` added to satisfy FR-MAT-02 and “close” in §2.1.
7. Timestamps stored UTC (`timestamptz`); UI localises (Africa/Nairobi default configurable).
8. RLS enabled with no policies: the browser never touches tables directly; FastAPI (service role) is the only data path (SRS §7.3).

## Migration 0003 (Phase 1) — identity integrity
- `profiles.id` and `profiles.role` are immutable (trigger), so role escalation is impossible even if application code has a bug.
- `students` / `lecturers` rows can attach only to a profile with the matching role (trigger).
- `provision_profile(...)` creates the profile and role row in one transaction; execute is granted to `service_role` only.
- Supabase Auth user creation cannot join a SQL transaction, so `provisioning_service` creates the auth user first and **deletes it if the function fails** (no orphaned logins).

## Migration 0004 (Phase 2) — courses & enrollment integrity
- **Security fix:** the views from 0002 now use `security_invoker = true` and are revoked from `anon`/`authenticated`. Views run with their owner's rights and otherwise bypass RLS; Supabase exposes public-schema objects to the API roles by default.
- `v_course_roster` (security invoker, service-role only): joins enrollments, students and profiles so the roster can be filtered, searched and paginated in the database. Contains no phone numbers.
- `trg_enrollment_rules`: enrollment `course_id`/`student_id` are immutable; a row can become `active` only for an `active` course and an `active` student. Duplicates remain blocked by `UNIQUE(course_id, student_id)`.
- `trg_course_lecturer_rules`: assignment keys immutable; only `active` lecturers can be assigned.
- Withdrawal is a status change (`withdrawn`), never a delete, so marks/attendance/submissions are never orphaned. Re-enrolling reactivates the same row.
- Policy decisions: archived courses stay visible (read-only history) via `status=archived`; inactive courses are hidden from students; new academic writes in later phases must call `ensure_course_writable` (active courses only).
