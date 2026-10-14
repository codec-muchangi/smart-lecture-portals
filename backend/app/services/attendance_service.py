"""Attendance (SRS 4.7: FR-ATT-01..06, FR-LEC-09/10, FR-STU-09; workflow 5.4).

Acceptance tests covered: AT-13, AT-14, AT-19.

A lecturer creates a session for a course they teach, then marks the course's actively enrolled students in
bulk, atomically, together with the audit rows (a first mark is `attendance.mark`, a change is
`attendance.correct`). Students see only their own history and percentage and can never edit them.
The percentage policy lives in `attendance_calc`.
"""

import logging
import uuid
from datetime import date, timedelta
from uuid import UUID

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.security import assert_course_access, assert_course_lecturer, ensure_course_writable
from app.repositories import attendance_repository as repo
from app.repositories import course_repository
from app.schemas.attendance import RecordsBulkRequest, SessionCreate
from app.schemas.common import CurrentUser
from app.services import attendance_calc, audit_service
from app.utils import clock
from app.utils.search import safe_search

log = logging.getLogger("app.attendance")

MAX_DAYS_AHEAD = 365  # sessions may be planned ahead, but not years in advance
MARKING_GRACE_DAYS = 1  # time zones: a session dated "today" locally may still be "tomorrow" in UTC


def _today():
    return clock.utcnow().date()


def _load_for_lecturer(user: CurrentUser, session_id: UUID) -> tuple[dict, dict]:
    session = repo.get_session(session_id)
    if session is None:
        raise NotFound("Attendance session not found")
    course = assert_course_lecturer(user, UUID(str(session["course_id"])))
    return session, course


# ---------- sessions ----------
def create_session(user: CurrentUser, course_id: UUID, body: SessionCreate) -> dict:
    course = assert_course_lecturer(user, course_id)
    ensure_course_writable(course)
    if body.session_date > _today() + timedelta(days=MAX_DAYS_AHEAD):
        raise ValidationFailed("The session date is too far in the future")
    date_s, start_s, end_s = (
        body.session_date.isoformat(),
        body.start_time.isoformat(),
        body.end_time.isoformat(),
    )
    duplicate_message = "This course already has a session on that date starting at that time"
    if repo.find_duplicate(course_id, date_s, start_s):  # FR-ATT-06
        raise Conflict(duplicate_message)
    try:
        row = repo.insert_session(
            {
                "id": str(uuid.uuid4()),
                "course_id": str(course["id"]),
                "session_date": date_s,
                "start_time": start_s,
                "end_time": end_s,
                "topic": body.topic,
                "created_by": str(user.id),
            }
        )
    except Exception as exc:
        if "23505" in str(exc):  # created by someone else between our check and the insert
            raise Conflict(duplicate_message) from exc
        raise
    audit_service.record(
        user.id,
        "attendance.session_create",
        "attendance_session",
        row["id"],
        new={
            "course_id": str(course["id"]),
            "session_date": date_s,
            "start_time": start_s,
            "end_time": end_s,
            "topic": body.topic,
        },
    )
    return {**row, "records_marked": 0}


def list_sessions(user: CurrentUser, course_id: UUID, *, page: int, page_size: int) -> dict:
    assert_course_lecturer(user, course_id)
    rows, total = repo.list_sessions(course_id, page=page, page_size=page_size)
    counts = repo.record_counts([r["id"] for r in rows])
    items = [{**r, "records_marked": counts.get(r["id"], 0)} for r in rows]
    return {"items": items, "page": page, "page_size": page_size, "total": total}


def get_session_detail(
    user: CurrentUser, session_id: UUID, *, q: str | None, page: int, page_size: int
) -> dict:
    """The session with the roster of actively enrolled students and their current statuses
    (workflow 5.4: 'system identifies enrolled students')."""
    session, course = _load_for_lecturer(user, session_id)
    students, total = course_repository.roster(
        course["id"], status="active", q=safe_search(q), page=page, page_size=page_size
    )
    records = repo.records_for_students(session_id, [s["student_id"] for s in students])
    roster = []
    for s in students:
        r = records.get(s["student_id"])
        roster.append(
            {
                "student_id": s["student_id"],
                "full_name": s["full_name"],
                "registration_number": s["registration_number"],
                "email": s["email"],
                "status": r["status"] if r else None,
                "note": r["note"] if r else None,
                "marked_at": r["marked_at"] if r else None,
                "marked_by": r["marked_by"] if r else None,
            }
        )
    active = repo.active_student_ids(course["id"])
    of_active = [r for r in repo.records_for_session(session_id) if r["student_id"] in active]
    counts = attendance_calc.summarize(r["status"] for r in of_active)
    summary = {
        **{k: counts[k] for k in attendance_calc.STATUSES},
        "unmarked": len(active) - len(of_active),
    }
    return {
        **session,
        "records_marked": len(of_active),
        "summary": summary,
        "roster": {"items": roster, "page": page, "page_size": page_size, "total": total},
    }


# ---------- marking ----------
def _validate_rows(body: RecordsBulkRequest, enrolled: set[str]) -> list[dict]:
    """Check every row, collecting ALL problems so the lecturer can fix them in one go."""
    errors: list[dict] = []
    seen: set[str] = set()
    for index, entry in enumerate(body.records):
        sid = str(entry.student_id)
        if sid in seen:
            errors.append(
                {
                    "index": index,
                    "student_id": sid,
                    "message": "This student appears more than once in the request",
                }
            )
        seen.add(sid)
        if sid not in enrolled:
            errors.append(
                {
                    "index": index,
                    "student_id": sid,
                    "message": "This student is not actively enrolled in the course",
                }
            )
    return errors


def mark_records(user: CurrentUser, session_id: UUID, body: RecordsBulkRequest) -> dict:
    session, course = _load_for_lecturer(user, session_id)
    ensure_course_writable(course)
    if date.fromisoformat(str(session["session_date"])) > _today() + timedelta(days=MARKING_GRACE_DAYS):
        raise Conflict("Attendance cannot be marked for a session that has not happened yet")
    errors = _validate_rows(body, repo.active_student_ids(course["id"]))
    if errors:  # all-or-nothing: nothing has been written
        raise ValidationFailed("Some rows are invalid; nothing was saved", {"rows": errors})

    rows = [{"student_id": str(e.student_id), "status": e.status, "note": e.note} for e in body.records]
    try:
        result = repo.upsert_records(session_id, user.id, rows)
    except Exception as exc:
        if "23514" in str(exc):  # a database rule rejected the batch: the data changed since we looked
            raise Conflict(
                "The attendance could not be saved because the data changed. Please reload and try again."
            ) from exc
        raise
    return {**result, "total": len(rows)}


# ---------- a student's own attendance ----------
def my_attendance(user: CurrentUser, course_id: UUID) -> dict:
    """Only the caller's own records (FR-ATT-04, AT-14); read-only."""
    assert_course_access(user, course_id)
    sessions = {s["id"]: s for s in repo.all_sessions(course_id)}
    records = repo.records_for_student(user.id, list(sessions))
    items = []
    for r in records:
        s = sessions[r["session_id"]]
        items.append(
            {
                "session_id": s["id"],
                "session_date": s["session_date"],
                "start_time": s["start_time"],
                "end_time": s["end_time"],
                "topic": s["topic"],
                "status": r["status"],
                "note": r["note"],
                "marked_at": r["marked_at"],
            }
        )
    items.sort(key=lambda i: (i["session_date"], i["start_time"]), reverse=True)
    return {
        "course_id": course_id,
        "items": items,
        "summary": attendance_calc.summarize(i["status"] for i in items),
    }
