-- Reporting helpers (read-only). Attendance % counts present + late + excused-excluded per policy:
-- default policy: (present + late) / (sessions - excused). Adjust once institution policy is confirmed.
create or replace view v_student_attendance_summary as
select s.course_id, r.student_id,
  count(*) filter (where r.status in ('present','late','absent')) as counted_sessions,
  count(*) filter (where r.status in ('present','late'))          as attended,
  count(*) filter (where r.status = 'excused')                    as excused,
  case when count(*) filter (where r.status in ('present','late','absent')) = 0 then null
       else round(100.0 * count(*) filter (where r.status in ('present','late'))
            / count(*) filter (where r.status in ('present','late','absent')), 2) end as attendance_pct
from attendance_records r join attendance_sessions s on s.id = r.session_id
group by s.course_id, r.student_id;

create or replace view v_student_course_total as
select a.course_id, m.student_id,
  round(sum(m.mark / a.max_marks * coalesce(a.weight,0)), 2) as weighted_total,
  sum(coalesce(a.weight,0)) as weight_covered
from assessment_marks m join assessments a on a.id = m.assessment_id
where a.published
group by a.course_id, m.student_id;
