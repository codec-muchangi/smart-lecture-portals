-- Demo seed (Appendix A). Requires auth users to exist first: run scripts/seed_demo.py, which creates
-- auth users through the Supabase Admin API and then inserts this data. No real student data.
-- Placeholders :student_id and :lecturer_id are substituted by the script.
insert into profiles (id, role, full_name, email) values
  (:'student_id','student','Demo Student','student@demo.test'),
  (:'lecturer_id','lecturer','Demo Lecturer','lecturer@demo.test');
insert into students  (id, registration_number, program, year_of_study) values (:'student_id','STU001','BSc Computer Science',3);
insert into lecturers (id, staff_number, department, title) values (:'lecturer_id','LEC001','Computer Science','Dr.');
insert into courses (id, course_code, course_name, credit_hours, academic_year, semester) values
  ('00000000-0000-0000-0000-000000003253','CIT 3253','Network Administration',3,'2026/2027','Semester 1'),
  ('00000000-0000-0000-0000-000000003254','CIT 3254','Database Systems',3,'2026/2027','Semester 1');
insert into course_lecturers (course_id, lecturer_id) select id, :'lecturer_id' from courses;
insert into course_enrollments (course_id, student_id) select id, :'student_id' from courses;
insert into assignments (course_id, title, instructions, due_at, max_marks, published, created_by)
  values ('00000000-0000-0000-0000-000000003253','Assignment 1 - Introduction','Read chapter 1 and answer the questions.', now() + interval '14 days', 20, true, :'lecturer_id');
insert into assessments (course_id, name, type, max_marks, weight, created_by)
  values ('00000000-0000-0000-0000-000000003253','CAT 1','cat',30,15,:'lecturer_id');
insert into attendance_sessions (course_id, session_date, start_time, end_time, topic, created_by)
  select '00000000-0000-0000-0000-000000003253', current_date - g*7, '08:00', '10:00', 'Lecture '||(4-g), :'lecturer_id' from generate_series(1,3) g;
insert into announcements (course_id, title, body, published, published_at, created_by)
  values ('00000000-0000-0000-0000-000000003253','Welcome','Welcome to Network Administration.', true, now(), :'lecturer_id');
insert into timetable_entries (course_id, day_of_week, start_time, end_time, room)
  values ('00000000-0000-0000-0000-000000003253', 1, '08:00','10:00','Lab 2');
