"""Bulk, read-only queries for reports, dashboards and the timetable.

Every list is read completely with `fetch_all` (Supabase answers at most 1000 rows per request), and long
`in.(...)` filters are split into chunks, so a report's totals always reconcile with the source records."""

from collections.abc import Callable, Iterable
from uuid import UUID

from app.db.client import get_supabase
from app.repositories import assignment_repository, attendance_repository
from app.repositories.assessment_repository import COLS as ASSESSMENT_COLS
from app.utils.batching import chunked
from app.utils.paging import fetch_all

SUBMISSION_COLS = "id,assignment_id,student_id,status,mark,grade_released,submitted_at,graded_at"
COURSE_COLS = "id,course_code,course_name,academic_year,semester,status"
ANNOUNCEMENT_COLS = "id,course_id,title,body,published_at"
TIMETABLE_COLS = "id,course_id,day_of_week,specific_date,start_time,end_time,room,notes,recurrence"


def _table(name: str):
    return get_supabase().table(name)


def _in_chunks(
    table: str, cols: str, column: str, values: Iterable, where: Callable | None = None
) -> list[dict]:
    """Every row whose `column` is one of `values` (optionally narrowed by `where(query)`)."""
    rows: list[dict] = []
    for batch in chunked(list(values)):
        rows += fetch_all(
            lambda batch=batch: (where or (lambda q: q))(
                _table(table).select(cols).in_(column, list(batch))
            ).order("id")
        )
    return rows


# ---------- people ----------
def active_roster(course_id: UUID | str) -> list[dict]:
    """The course's actively enrolled students, alphabetical."""
    return fetch_all(
        lambda: _table("v_course_roster")
        .select("student_id,full_name,registration_number,email")
        .eq("course_id", str(course_id))
        .eq("enrollment_status", "active")
        .order("full_name")
        .order("student_id")
    )


def active_enrollments(course_ids: list[str]) -> list[dict]:
    return _in_chunks(
        "course_enrollments",
        "course_id,student_id",
        "course_id",
        course_ids,
        lambda q: q.eq("status", "active"),
    )


def courses_by_ids(course_ids: list[str]) -> list[dict]:
    rows = _in_chunks("courses", COURSE_COLS, "id", course_ids)
    return sorted(rows, key=lambda c: c["course_code"])


# ---------- attendance ----------
def sessions_in_range(course_id: UUID | str, date_from: str | None, date_to: str | None) -> list[dict]:
    """The course's sessions in chronological order, optionally limited to a date range (inclusive)."""

    def build():
        query = _table("attendance_sessions").select(attendance_repository.SESSION_COLS)
        query = query.eq("course_id", str(course_id))
        if date_from:
            query = query.gte("session_date", date_from)
        if date_to:
            query = query.lte("session_date", date_to)
        return query.order("session_date").order("start_time").order("id")

    return fetch_all(build)


def sessions_for_courses(course_ids: list[str]) -> list[dict]:
    return _in_chunks("attendance_sessions", attendance_repository.SESSION_COLS, "course_id", course_ids)


def records_for_sessions(session_ids: list[str]) -> list[dict]:
    return _in_chunks("attendance_records", attendance_repository.RECORD_COLS, "session_id", session_ids)


def records_of_student(student_id: UUID | str, session_ids: list[str]) -> list[dict]:
    return _in_chunks(
        "attendance_records",
        attendance_repository.RECORD_COLS,
        "session_id",
        session_ids,
        lambda q: q.eq("student_id", str(student_id)),
    )


# ---------- assignments and submissions ----------
def assignments_for_courses(course_ids: list[str]) -> list[dict]:
    """Published assignments (drafts are nobody's business but the author's), oldest deadline first."""
    rows = _in_chunks(
        "assignments",
        assignment_repository.COLS,
        "course_id",
        course_ids,
        lambda q: q.is_("published", "true"),
    )
    return sorted(rows, key=lambda a: (a["due_at"], a["id"]))


def submissions_for_assignments(assignment_ids: list[str], statuses: list[str] | None = None) -> list[dict]:
    where = (lambda q: q.in_("status", statuses)) if statuses else None
    return _in_chunks("submissions", SUBMISSION_COLS, "assignment_id", assignment_ids, where)


def submissions_of_student(student_id: UUID | str, assignment_ids: list[str]) -> list[dict]:
    return _in_chunks(
        "submissions",
        SUBMISSION_COLS,
        "assignment_id",
        assignment_ids,
        lambda q: q.eq("student_id", str(student_id)),
    )


def released_grades(student_id: UUID | str) -> list[dict]:
    """The student's graded submissions whose grade has been released, newest grading first."""
    rows = fetch_all(
        lambda: _table("submissions")
        .select(SUBMISSION_COLS)
        .eq("student_id", str(student_id))
        .eq("status", "graded")
        .is_("grade_released", "true")
        .order("id")
    )
    return sorted(rows, key=lambda r: r["graded_at"] or "", reverse=True)


def assignments_by_ids(assignment_ids: list[str]) -> dict[str, dict]:
    return {a["id"]: a for a in _in_chunks("assignments", assignment_repository.COLS, "id", assignment_ids)}


# ---------- marks ----------
def assessments_for_courses(course_ids: list[str], *, published_only: bool) -> list[dict]:
    where = (lambda q: q.is_("published", "true")) if published_only else None
    rows = _in_chunks("assessments", ASSESSMENT_COLS, "course_id", course_ids, where)
    return sorted(rows, key=lambda a: (a["created_at"], a["id"]))


def marks_for_assessments(assessment_ids: list[str]) -> list[dict]:
    return _in_chunks(
        "assessment_marks", "assessment_id,student_id,mark,updated_at", "assessment_id", assessment_ids
    )


def marks_of_student(student_id: UUID | str, assessment_ids: list[str]) -> list[dict]:
    return _in_chunks(
        "assessment_marks",
        "assessment_id,student_id,mark,updated_at",
        "assessment_id",
        assessment_ids,
        lambda q: q.eq("student_id", str(student_id)),
    )


# ---------- announcements and timetable ----------
def latest_announcements(course_ids: list[str], limit: int) -> list[dict]:
    """The newest published announcements across the courses."""
    found: list[dict] = []
    for batch in chunked(course_ids):
        found += (
            _table("announcements")
            .select(ANNOUNCEMENT_COLS)
            .in_("course_id", list(batch))
            .is_("published", "true")
            .order("published_at", desc=True)
            .limit(limit)
            .execute()
            .data
        )
    found.sort(key=lambda a: a["published_at"] or "", reverse=True)
    return found[:limit]


def timetable_entries(course_ids: list[str]) -> list[dict]:
    return _in_chunks("timetable_entries", TIMETABLE_COLS, "course_id", course_ids)
