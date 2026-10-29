-- Demo timetable entries for Smart Lecture Portal (SRS Appendix A).
-- Run in the Supabase SQL Editor. Safe to run once; running it again adds duplicate rows.
-- day_of_week uses ISO numbering: 1 = Monday ... 7 = Sunday.

insert into timetable_entries (course_id, day_of_week, start_time, end_time, room, notes, recurrence)
select c.id, v.dow, v.st::time, v.et::time, v.room, v.notes,
        '{"from":"2026-09-01","until":"2026-12-18"}'::jsonb
from (values
    ('CIT 3255', 2, '09:00', '11:00', 'Lab 3',  'Lecture'),
    ('CIT 3255', 4, '14:00', '16:00', 'Room 12', 'Tutorial'),
    ('CIT 3253', 1, '08:00', '10:00', 'Room 5',  'Lecture'),
    ('CIT 3254', 3, '11:00', '13:00', 'Room 7',  'Lecture')
) as v(code, dow, st, et, room, notes)
join courses c on c.course_code = v.code;