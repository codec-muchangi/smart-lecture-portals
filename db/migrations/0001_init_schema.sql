-- Smart Lecture Portal — baseline schema (SRS v1.0 §9). Target: Supabase PostgreSQL.
-- Access model: ALL business access goes through FastAPI using the service-role key.
-- RLS is enabled on every table with NO policies => anon/authenticated clients get nothing directly.
begin;
create extension if not exists "pgcrypto";

-- ---------- Enums ----------
create type user_role         as enum ('student','lecturer');
create type person_status     as enum ('active','inactive','suspended');
create type course_status     as enum ('active','archived','inactive');
create type enrollment_status as enum ('active','withdrawn','completed');
create type submission_status as enum ('submitted','late','graded','returned');
create type attendance_status as enum ('present','absent','late','excused');
create type assessment_type   as enum ('cat','assignment','practical','exam','other');
create type material_category as enum ('lecture_notes','slides','reading','lab','past_paper','other');
create type notification_type as enum ('assignment_published','marks_released','material_added','announcement','grade_released','general');

-- ---------- Helpers ----------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- Identity ----------
create table profiles (
  id          uuid primary key references auth.users(id) on delete restrict,
  role        user_role not null,
  full_name   text not null check (length(trim(full_name)) > 0),
  email       text not null unique,
  phone       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table students (
  id                  uuid primary key references profiles(id) on delete restrict,
  registration_number text not null unique,
  program             text,
  year_of_study       smallint check (year_of_study between 1 and 8),
  status              person_status not null default 'active'
);
create table lecturers (
  id           uuid primary key references profiles(id) on delete restrict,
  staff_number text not null unique,
  department   text,
  title        text,
  status       person_status not null default 'active'
);

-- ---------- Courses ----------
create table courses (
  id            uuid primary key default gen_random_uuid(),
  course_code   text not null,
  course_name   text not null,
  description   text,
  credit_hours  smallint check (credit_hours > 0),
  academic_year text not null,          -- e.g. '2026/2027'
  semester      text not null,          -- e.g. 'Semester 1'
  status        course_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (course_code, academic_year, semester)
);
create table course_lecturers (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id) on delete restrict,
  lecturer_id uuid not null references lecturers(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  unique (course_id, lecturer_id)
);
create table course_enrollments (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id) on delete restrict,
  student_id  uuid not null references students(id) on delete restrict,
  enrolled_at timestamptz not null default now(),
  status      enrollment_status not null default 'active',
  unique (course_id, student_id)
);

-- ---------- Materials ----------
create table materials (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references courses(id) on delete restrict,
  title        text not null check (length(trim(title)) > 0),
  description  text,
  category     material_category not null default 'other',
  storage_path text not null,
  file_name    text not null,
  mime_type    text not null,
  file_size    bigint not null check (file_size > 0),
  uploaded_by  uuid not null references lecturers(id) on delete restrict,
  published    boolean not null default true,
  deleted_at   timestamptz,                       -- soft delete (SRS §15)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- Assignments & submissions ----------
create table assignments (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references courses(id) on delete restrict,
  title           text not null check (length(trim(title)) > 0),
  description     text,
  instructions    text,
  due_at          timestamptz not null,
  max_marks       numeric(6,2) not null check (max_marks > 0),
  allow_late      boolean not null default false,
  published       boolean not null default false,
  closed          boolean not null default false,
  attachment_path text,
  created_by      uuid not null references lecturers(id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create table submissions (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references assignments(id) on delete restrict,
  student_id     uuid not null references students(id) on delete restrict,
  storage_path   text not null,
  file_name      text not null,
  file_size      bigint not null check (file_size > 0),
  submitted_at   timestamptz not null default now(),
  status         submission_status not null default 'submitted',
  mark           numeric(6,2) check (mark >= 0),
  feedback       text,
  grade_released boolean not null default false,   -- release policy (SRS §5.3, FR-ASG-10)
  graded_by      uuid references lecturers(id) on delete restrict,
  graded_at      timestamptz,
  updated_at     timestamptz not null default now(),
  unique (assignment_id, student_id)
);

-- ---------- Attendance ----------
create table attendance_sessions (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references courses(id) on delete restrict,
  session_date date not null,
  start_time   time not null,
  end_time     time not null,
  topic        text,
  created_by   uuid not null references lecturers(id) on delete restrict,
  created_at   timestamptz not null default now(),
  check (end_time > start_time),
  unique (course_id, session_date, start_time)     -- FR-ATT-06
);
create table attendance_records (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references attendance_sessions(id) on delete restrict,
  student_id uuid not null references students(id) on delete restrict,
  status     attendance_status not null,
  marked_at  timestamptz not null default now(),
  marked_by  uuid not null references lecturers(id) on delete restrict,
  note       text,
  unique (session_id, student_id)
);

-- ---------- Marks ----------
create table assessments (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references courses(id) on delete restrict,
  name       text not null check (length(trim(name)) > 0),
  type       assessment_type not null,
  max_marks  numeric(6,2) not null check (max_marks > 0),
  weight     numeric(5,2) check (weight is null or (weight > 0 and weight <= 100)),
  published  boolean not null default false,
  created_by uuid not null references lecturers(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table assessment_marks (
  id            uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete restrict,
  student_id    uuid not null references students(id) on delete restrict,
  mark          numeric(6,2) not null check (mark >= 0),
  feedback      text,
  entered_by    uuid not null references lecturers(id) on delete restrict,
  entered_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (assessment_id, student_id)
);

-- ---------- Communication ----------
create table announcements (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references courses(id) on delete restrict,
  title        text not null check (length(trim(title)) > 0),
  body         text not null check (length(trim(body)) > 0),
  published    boolean not null default false,
  published_at timestamptz,
  created_by   uuid not null references lecturers(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,  -- transient data, cascade is deliberate
  type       notification_type not null default 'general',
  title      text not null,
  message    text not null,
  link       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

-- ---------- Timetable ----------
create table timetable_entries (
  id             uuid primary key default gen_random_uuid(),
  course_id      uuid not null references courses(id) on delete restrict,
  day_of_week    smallint check (day_of_week between 1 and 7),   -- 1=Mon (recurring)
  specific_date  date,                                            -- one-off
  start_time     time not null,
  end_time       time not null,
  room           text,
  notes          text,
  recurrence     jsonb,                                           -- optional metadata e.g. {"until":"2026-12-01"}
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_time > start_time),
  check (day_of_week is not null or specific_date is not null)
);

-- ---------- Audit (append-only) ----------
create table audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid references profiles(id) on delete set null,
  action        text not null,             -- e.g. 'mark.update','attendance.correct','submission.grade'
  entity_type   text not null,
  entity_id     uuid,
  old_value     jsonb,
  new_value     jsonb,
  created_at    timestamptz not null default now()
);

-- ---------- Integrity triggers ----------
create or replace function trg_check_assessment_mark() returns trigger language plpgsql as $$
declare m numeric;
begin
  select max_marks into m from assessments where id = new.assessment_id;
  if new.mark > m then raise exception 'mark % exceeds max_marks %', new.mark, m using errcode = '23514'; end if;
  return new;
end $$;
create trigger assessment_marks_range before insert or update on assessment_marks
  for each row execute function trg_check_assessment_mark();

create or replace function trg_check_submission_mark() returns trigger language plpgsql as $$
declare m numeric;
begin
  if new.mark is null then return new; end if;
  select max_marks into m from assignments where id = new.assignment_id;
  if new.mark > m then raise exception 'mark % exceeds max_marks %', new.mark, m using errcode = '23514'; end if;
  return new;
end $$;
create trigger submissions_mark_range before insert or update on submissions
  for each row execute function trg_check_submission_mark();

create or replace function trg_audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_logs is append-only'; end $$;
create trigger audit_logs_no_update before update or delete on audit_logs
  for each row execute function trg_audit_immutable();

-- updated_at triggers
do $$ declare t text; begin
  foreach t in array array['profiles','courses','materials','assignments','submissions','assessments','assessment_marks','announcements','timetable_entries']
  loop execute format('create trigger set_updated_at before update on %I for each row execute function set_updated_at()', t); end loop;
end $$;

-- ---------- Indexes (FK + hot paths) ----------
create index on course_lecturers (lecturer_id);
create index on course_enrollments (student_id);
create index on materials (course_id) where deleted_at is null;
create index on assignments (course_id, due_at);
create index on submissions (student_id);
create index on attendance_sessions (course_id, session_date);
create index on attendance_records (student_id);
create index on assessments (course_id);
create index on assessment_marks (student_id);
create index on announcements (course_id, published_at desc);
create index on notifications (user_id, is_read, created_at desc);
create index on timetable_entries (course_id);
create index on audit_logs (entity_type, entity_id);
create index on audit_logs (actor_user_id, created_at desc);

-- ---------- Row Level Security: deny-all for client roles ----------
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop execute format('alter table %I enable row level security', t); end loop;
end $$;

-- ---------- Storage buckets (private) ----------
insert into storage.buckets (id, name, public) values ('materials','materials',false), ('submissions','submissions',false)
on conflict (id) do nothing;
commit;
