"""Role dashboards (SRS FR-STU-01, FR-LEC-01; AT-01, AT-02; NFR-PERF-01).

Everything on a dashboard is computed from real records (never hard-coded) with a fixed, small number of
queries however big the class is: lists are fetched in bulk and grouped in memory, never student by student.
A dashboard covers the user's ACTIVE courses (archived ones are history, inactive ones are hidden).
"""

from collections import defaultdict
from decimal import Decimal

from app.repositories import course_repository, notification_repository
from app.repositories import report_repository as repo
from app.schemas.common import CurrentUser
from app.services import attendance_calc, marks_calc
from app.services.marks_calc import d
from app.services.report_service import _mean, student_totals
from app.utils import clock

UPCOMING_LIMIT = 10
PENDING_LIMIT = 10
DEADLINE_LIMIT = 10
RECENT_MARKS_LIMIT = 5
ANNOUNCEMENT_LIMIT = 5
PREVIEW_CHARS = 200


def _active_courses(user: CurrentUser) -> list[dict]:
    ids = course_repository.course_ids_for_user(user.role, user.id)
    courses = repo.courses_by_ids(ids) if ids else []
    return [c for c in courses if c["status"] == "active"]


def get_dashboard(user: CurrentUser) -> dict:
    return student_dashboard(user) if user.role == "student" else lecturer_dashboard(user)


def _open_assignments(assignments: list[dict], now) -> list[dict]:
    """Published, not closed, deadline still ahead: soonest first."""
    return [a for a in assignments if not a["closed"] and clock.parse_ts(a["due_at"]) > now]


# =============================== student ===============================
def student_dashboard(user: CurrentUser) -> dict:
    courses = _active_courses(user)
    ids = [c["id"] for c in courses]
    code = {c["id"]: c["course_code"] for c in courses}
    now = clock.utcnow()
    unread = notification_repository.count_unread(user.id)
    if not courses:
        return {
            "role": "student",
            "courses": [],
            "upcoming_assignments": [],
            "attendance_summary": [],
            "recent_marks": [],
            "announcements": [],
            "unread_notifications": unread,
        }

    # upcoming assignments, each with the student's own submission status
    upcoming = _open_assignments(repo.assignments_for_courses(ids), now)[:UPCOMING_LIMIT]
    status = {
        s["assignment_id"]: s["status"]
        for s in repo.submissions_of_student(user.id, [a["id"] for a in upcoming])
    }
    upcoming_out = [
        {
            "assignment_id": a["id"],
            "course_id": a["course_id"],
            "course_code": code[a["course_id"]],
            "title": a["title"],
            "due_at": a["due_at"],
            "max_marks": a["max_marks"],
            "submission_status": status.get(a["id"], "not_submitted"),
        }
        for a in upcoming
    ]

    # attendance per course (same policy as /attendance/me)
    sessions = repo.sessions_for_courses(ids)
    course_of_session = {s["id"]: s["course_id"] for s in sessions}
    statuses: dict[str, list[str]] = defaultdict(list)
    for r in repo.records_of_student(user.id, list(course_of_session)):
        statuses[course_of_session[r["session_id"]]].append(r["status"])
    attendance = [
        {
            "course_id": c["id"],
            "course_code": c["course_code"],
            **attendance_calc.summarize(statuses[c["id"]]),
        }
        for c in courses
    ]

    # recent released marks: released assignment grades + published assessment marks
    recent: list[dict] = []
    released = repo.released_grades(user.id)
    assignments = repo.assignments_by_ids([r["assignment_id"] for r in released])
    for r in released:
        a = assignments.get(r["assignment_id"])
        if a is None or a["course_id"] not in code or r["mark"] is None:
            continue
        recent.append(
            {
                "kind": "assignment",
                "course_id": a["course_id"],
                "course_code": code[a["course_id"]],
                "title": a["title"],
                "mark": r["mark"],
                "max_marks": a["max_marks"],
                "percentage": marks_calc.percentage(r["mark"], a["max_marks"]),
                "date": r["graded_at"],
            }
        )
    published = repo.assessments_for_courses(ids, published_only=True)
    own_marks = {m["assessment_id"]: m for m in repo.marks_of_student(user.id, [a["id"] for a in published])}
    for a in published:
        m = own_marks.get(a["id"])
        if m is None:
            continue
        recent.append(
            {
                "kind": "assessment",
                "course_id": a["course_id"],
                "course_code": code[a["course_id"]],
                "title": a["name"],
                "mark": m["mark"],
                "max_marks": a["max_marks"],
                "percentage": marks_calc.percentage(m["mark"], a["max_marks"]),
                "date": m["updated_at"],
            }
        )
    recent.sort(
        key=lambda i: clock.parse_ts(i["date"]) if i["date"] else clock.parse_ts("1970-01-01T00:00:00+00:00"),
        reverse=True,
    )

    announcements = [
        {
            "id": a["id"],
            "course_id": a["course_id"],
            "course_code": code[a["course_id"]],
            "title": a["title"],
            "preview": a["body"][:PREVIEW_CHARS],
            "published_at": a["published_at"],
        }
        for a in repo.latest_announcements(ids, ANNOUNCEMENT_LIMIT)
    ]
    return {
        "role": "student",
        "courses": [{**c, "enrolled_count": None} for c in courses],
        "upcoming_assignments": upcoming_out,
        "attendance_summary": attendance,
        "recent_marks": recent[:RECENT_MARKS_LIMIT],
        "announcements": announcements,
        "unread_notifications": unread,
    }


# =============================== lecturer ===============================
def lecturer_dashboard(user: CurrentUser) -> dict:
    courses = _active_courses(user)
    ids = [c["id"] for c in courses]
    empty = {
        "role": "lecturer",
        "courses": [],
        "pending_grading": {"total": 0, "items": []},
        "upcoming_deadlines": [],
        "attendance_summary": [],
        "performance_summary": [],
    }
    if not courses:
        return empty
    now = clock.utcnow()
    code = {c["id"]: c["course_code"] for c in courses}

    active: dict[str, set[str]] = defaultdict(set)  # course -> actively enrolled students
    for e in repo.active_enrollments(ids):
        active[e["course_id"]].add(e["student_id"])

    assignments = repo.assignments_for_courses(ids)
    course_of_assignment = {a["id"]: a["course_id"] for a in assignments}

    # pending grading: submitted or late, not graded yet, from students still in the class
    pending: dict[str, int] = defaultdict(int)
    for s in repo.submissions_for_assignments(list(course_of_assignment), ["submitted", "late"]):
        if s["student_id"] in active[course_of_assignment[s["assignment_id"]]]:
            pending[s["assignment_id"]] += 1
    pending_items = [
        {
            "assignment_id": a["id"],
            "course_id": a["course_id"],
            "course_code": code[a["course_id"]],
            "title": a["title"],
            "due_at": a["due_at"],
            "pending": pending[a["id"]],
        }
        for a in assignments
        if pending[a["id"]]
    ]

    # upcoming deadlines with how many students have handed in
    upcoming = _open_assignments(assignments, now)[:DEADLINE_LIMIT]
    handed_in: dict[str, set[str]] = defaultdict(set)
    for s in repo.submissions_for_assignments([a["id"] for a in upcoming]):
        if s["student_id"] in active[course_of_assignment[s["assignment_id"]]]:
            handed_in[s["assignment_id"]].add(s["student_id"])
    deadlines = [
        {
            "assignment_id": a["id"],
            "course_id": a["course_id"],
            "course_code": code[a["course_id"]],
            "title": a["title"],
            "due_at": a["due_at"],
            "enrolled": len(active[a["course_id"]]),
            "submitted": len(handed_in[a["id"]]),
        }
        for a in upcoming
    ]

    # attendance per course, pooled over all sessions and the current class
    sessions = repo.sessions_for_courses(ids)
    course_of_session = {s["id"]: s["course_id"] for s in sessions}
    statuses: dict[str, list[str]] = defaultdict(list)
    for r in repo.records_for_sessions(list(course_of_session)):
        course = course_of_session[r["session_id"]]
        if r["student_id"] in active[course]:
            statuses[course].append(r["status"])
    today = now.date().isoformat()
    attendance = []
    for c in courses:
        mine = [s for s in sessions if s["course_id"] == c["id"]]
        held = [s["session_date"] for s in mine if str(s["session_date"]) <= today]
        attendance.append(
            {
                "course_id": c["id"],
                "course_code": c["course_code"],
                "sessions": len(mine),
                "last_session_date": max(held) if held else None,
                "attendance_pct": attendance_calc.summarize(statuses[c["id"]])["attendance_pct"],
            }
        )

    # performance per course: class average of the weighted results of the published assessments
    all_assessments = repo.assessments_for_courses(ids, published_only=True)
    marks_by: dict[str, dict[str, Decimal]] = defaultdict(dict)
    for m in repo.marks_for_assessments([a["id"] for a in all_assessments]):
        marks_by[m["assessment_id"]][m["student_id"]] = d(m["mark"])
    performance = []
    for c in courses:
        published = [a for a in all_assessments if a["course_id"] == c["id"]]
        totals = [student_totals(published, marks_by, sid) for sid in active[c["id"]]]
        performance.append(
            {
                "course_id": c["id"],
                "course_code": c["course_code"],
                "published_assessments": len(published),
                "students_without_marks": sum(1 for t in totals if t["marks_entered"] == 0),
                "average_weighted_percent": _mean(
                    [t["weighted_percent"] for t in totals if t["weighted_percent"] is not None]
                ),
            }
        )
    return {
        "role": "lecturer",
        "courses": [{**c, "enrolled_count": len(active[c["id"]])} for c in courses],
        "pending_grading": {"total": sum(pending.values()), "items": pending_items[:PENDING_LIMIT]},
        "upcoming_deadlines": deadlines,
        "attendance_summary": attendance,
        "performance_summary": performance,
    }
