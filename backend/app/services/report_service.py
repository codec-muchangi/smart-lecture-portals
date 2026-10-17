"""Course reports for lecturers (SRS 4.11: FR-REP-01..05, FR-LEC-14; acceptance test AT-20).

Three read-only reports: attendance, assignment submissions, assessment performance. Each one
- is limited to a lecturer ASSIGNED to the course (404 otherwise, never another course's data: FR-REP-05),
- covers the course's ACTIVELY enrolled students only (withdrawn students keep their records but leave the
  class lists, so a report always describes the current class),
- can be narrowed to one student with `student_id` (FR-REP-04),
- is built from the same calculators the students' own views use (`attendance_calc`, `marks_calc`), and
  its rows, sessions and summary are derived from one set of source records so the totals reconcile (AT-20).
"""

from datetime import date
from decimal import Decimal
from uuid import UUID

from app.core.errors import NotFound, ValidationFailed
from app.core.security import assert_course_lecturer
from app.repositories import report_repository as repo
from app.schemas.common import CurrentUser
from app.services import attendance_calc, marks_calc
from app.services.marks_calc import d, q2
from app.utils import clock


def _students_in_scope(course_id: UUID, student_id: UUID | None) -> list[dict]:
    """The actively enrolled students the report covers: the whole class, or the one requested."""
    roster = repo.active_roster(course_id)
    if student_id is None:
        return roster
    chosen = [s for s in roster if str(s["student_id"]) == str(student_id)]
    if not chosen:
        raise NotFound("Student not found in this course")
    return chosen


def _mean(values: list[float]) -> float | None:
    if not values:
        return None
    return float(q2(sum((d(v) for v in values), Decimal(0)) / len(values)))


# =============================== attendance ===============================
def attendance_report(
    user: CurrentUser,
    course_id: UUID,
    *,
    student_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    assert_course_lecturer(user, course_id)
    if date_from and date_to and date_to < date_from:
        raise ValidationFailed("'to' cannot be before 'from'")
    students = _students_in_scope(course_id, student_id)
    in_scope = {str(s["student_id"]) for s in students}
    sessions = repo.sessions_in_range(
        course_id, date_from.isoformat() if date_from else None, date_to.isoformat() if date_to else None
    )
    records = [
        r for r in repo.records_for_sessions([s["id"] for s in sessions]) if str(r["student_id"]) in in_scope
    ]
    by_student: dict[str, list[str]] = {sid: [] for sid in in_scope}
    by_session: dict[str, list[str]] = {s["id"]: [] for s in sessions}
    for r in records:
        by_student[str(r["student_id"])].append(r["status"])
        by_session[r["session_id"]].append(r["status"])

    student_rows = []
    for s in students:
        statuses = by_student[str(s["student_id"])]
        student_rows.append(
            {
                "student_id": s["student_id"],
                "full_name": s["full_name"],
                "registration_number": s["registration_number"],
                **attendance_calc.summarize(statuses),
                "unmarked": len(sessions) - len(statuses),
            }
        )
    session_rows = []
    for s in sessions:
        statuses = by_session[s["id"]]
        session_rows.append(
            {
                "session_id": s["id"],
                "session_date": s["session_date"],
                "start_time": s["start_time"],
                "end_time": s["end_time"],
                "topic": s["topic"],
                **attendance_calc.summarize(statuses),
                "unmarked": len(students) - len(statuses),
            }
        )
    totals = attendance_calc.summarize(r["status"] for r in records)
    summary = {
        "students": len(students),
        "sessions": len(sessions),
        **{k: totals[k] for k in attendance_calc.STATUSES},
        "unmarked": len(students) * len(sessions) - len(records),
        "attended": totals["attended"],
        "counted_records": totals["counted_sessions"],
        "attendance_pct": totals["attendance_pct"],
    }
    return {
        "course_id": course_id,
        "student_id": student_id,
        "date_from": date_from,
        "date_to": date_to,
        "summary": summary,
        "students": student_rows,
        "sessions": session_rows,
    }


# =============================== submissions ===============================
def submissions_report(
    user: CurrentUser,
    course_id: UUID,
    *,
    student_id: UUID | None = None,
    assignment_id: UUID | None = None,
) -> dict:
    assert_course_lecturer(user, course_id)
    students = _students_in_scope(course_id, student_id)
    in_scope = {str(s["student_id"]) for s in students}
    assignments = repo.assignments_for_courses([str(course_id)])  # published only
    if assignment_id is not None:
        assignments = [a for a in assignments if str(a["id"]) == str(assignment_id)]
        if not assignments:
            raise NotFound("Assignment not found")
    submissions = [
        s
        for s in repo.submissions_for_assignments([a["id"] for a in assignments])
        if str(s["student_id"]) in in_scope
    ]
    by_assignment: dict[str, list[dict]] = {a["id"]: [] for a in assignments}
    for s in submissions:
        by_assignment[s["assignment_id"]].append(s)

    now = clock.utcnow()
    rows = []
    for a in assignments:
        subs = by_assignment[a["id"]]
        count = {
            k: sum(1 for s in subs if s["status"] == k) for k in ("submitted", "late", "graded", "returned")
        }
        marks = [d(s["mark"]) for s in subs if s["status"] == "graded" and s["mark"] is not None]
        not_submitted = len(students) - len(subs)
        due_passed = clock.parse_ts(a["due_at"]) < now
        average = sum(marks, Decimal(0)) / len(marks) if marks else None
        rows.append(
            {
                "assignment_id": a["id"],
                "title": a["title"],
                "due_at": a["due_at"],
                "max_marks": a["max_marks"],
                "closed": a["closed"],
                "enrolled": len(students),
                **count,
                "total_submissions": len(subs),
                "not_submitted": not_submitted,
                "missing": not_submitted if due_passed else 0,
                "released": sum(1 for s in subs if s["status"] == "graded" and s["grade_released"]),
                "average_mark": float(q2(average)) if average is not None else None,
                "highest_mark": float(max(marks)) if marks else None,
                "lowest_mark": float(min(marks)) if marks else None,
                "average_percent": marks_calc.percentage(average, a["max_marks"])
                if average is not None
                else None,
            }
        )
    handed_in = sum(r["total_submissions"] for r in rows)
    possible = len(students) * len(rows)
    summary = {
        "assignments": len(rows),
        "students": len(students),
        "total_submissions": handed_in,
        **{
            k: sum(r[k] for r in rows)
            for k in ("submitted", "late", "graded", "returned", "not_submitted", "missing")
        },
        "submission_rate_pct": float(q2(Decimal(handed_in) * 100 / possible)) if possible else None,
    }
    return {
        "course_id": course_id,
        "student_id": student_id,
        "assignment_id": assignment_id,
        "summary": summary,
        "assignments": rows,
    }


# =============================== performance ===============================
def student_totals(
    published: list[dict], by_assessment: dict[str, dict[str, Decimal]], student_id: str
) -> dict:
    """One student's weighted result over the published assessments (shared with the lecturer dashboard)."""
    items = [
        {"max_marks": a["max_marks"], "weight": a["weight"], "mark": by_assessment[a["id"]].get(student_id)}
        for a in published
    ]
    return {
        "marks_entered": sum(1 for i in items if i["mark"] is not None),
        **marks_calc.compute_totals(items),
    }


def performance_report(user: CurrentUser, course_id: UUID, *, student_id: UUID | None = None) -> dict:
    assert_course_lecturer(user, course_id)
    students = _students_in_scope(course_id, student_id)
    in_scope = {str(s["student_id"]) for s in students}
    assessments = repo.assessments_for_courses([str(course_id)], published_only=False)
    marks = [
        m
        for m in repo.marks_for_assessments([a["id"] for a in assessments])
        if str(m["student_id"]) in in_scope
    ]
    by_assessment: dict[str, dict[str, Decimal]] = {a["id"]: {} for a in assessments}
    for m in marks:
        by_assessment[m["assessment_id"]][str(m["student_id"])] = d(m["mark"])

    assessment_rows = []
    for a in assessments:
        values = list(by_assessment[a["id"]].values())
        average = sum(values, Decimal(0)) / len(values) if values else None
        assessment_rows.append(
            {
                "assessment_id": a["id"],
                "name": a["name"],
                "type": a["type"],
                "max_marks": a["max_marks"],
                "weight": a["weight"],
                "published": a["published"],
                "students": len(students),
                "marks_entered": len(values),
                "average": float(q2(average)) if average is not None else None,
                "highest": float(max(values)) if values else None,
                "lowest": float(min(values)) if values else None,
                "average_percent": marks_calc.percentage(average, a["max_marks"])
                if average is not None
                else None,
            }
        )

    # Per-student totals use the PUBLISHED assessments only: exactly what the student sees in /marks/me.
    published = [a for a in assessments if a["published"]]
    student_rows = [
        {
            "student_id": s["student_id"],
            "full_name": s["full_name"],
            "registration_number": s["registration_number"],
            **student_totals(published, by_assessment, str(s["student_id"])),
        }
        for s in students
    ]
    percents = [r["weighted_percent"] for r in student_rows if r["weighted_percent"] is not None]
    summary = {
        "students": len(students),
        "assessments": len(assessments),
        "published_assessments": len(published),
        "students_without_marks": sum(1 for r in student_rows if r["marks_entered"] == 0),
        "average_weighted_percent": _mean(percents),
        "highest_weighted_percent": max(percents) if percents else None,
        "lowest_weighted_percent": min(percents) if percents else None,
    }
    return {
        "course_id": course_id,
        "student_id": student_id,
        "summary": summary,
        "assessments": assessment_rows,
        "students": student_rows,
    }
