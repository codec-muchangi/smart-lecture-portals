"""Timetable (SRS 4.10: FR-TIME-01..03, FR-STU-11, FR-LEC-15).

Students see the classes of the courses they are enrolled in, lecturers those of the courses they teach, only
for ACTIVE courses. A stored entry is either a weekly slot (`day_of_week`, 1 = Monday, optionally limited by
`recurrence.from` / `recurrence.until` dates) or a one-off `specific_date`; this service expands them into
dated classes inside the requested window. Timetable data is seeded or loaded by the institution: the SRS does
not define a lecturer entry workflow (see docs/PHASE8_BACKEND.md, decisions).
"""

from datetime import date, timedelta

from app.core.errors import ValidationFailed
from app.repositories import course_repository
from app.repositories import report_repository as repo
from app.schemas.common import CurrentUser
from app.utils import clock

DEFAULT_DAYS = 7
MAX_DAYS = 93  # about one semester month-quarter: keeps a single request small


def _window(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    if date_from is None and date_to is None:
        date_from = clock.utcnow().date()
    if date_from is None:
        date_from = date_to - timedelta(days=DEFAULT_DAYS - 1)
    if date_to is None:
        date_to = date_from + timedelta(days=DEFAULT_DAYS - 1)
    if date_to < date_from:
        raise ValidationFailed("'to' cannot be before 'from'")
    if (date_to - date_from).days + 1 > MAX_DAYS:
        raise ValidationFailed(f"Ask for at most {MAX_DAYS} days at a time")
    return date_from, date_to


def _iso(value) -> date | None:
    """A date from a database value; None when absent or malformed (the database guards its own shape)."""
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def get_timetable(user: CurrentUser, date_from: date | None, date_to: date | None) -> dict:
    start, end = _window(date_from, date_to)
    ids = course_repository.course_ids_for_user(user.role, user.id)
    courses = {c["id"]: c for c in (repo.courses_by_ids(ids) if ids else []) if c["status"] == "active"}
    entries = repo.timetable_entries(list(courses)) if courses else []

    items = []
    for e in entries:
        course = courses[e["course_id"]]
        base = {
            "entry_id": e["id"],
            "course_id": e["course_id"],
            "course_code": course["course_code"],
            "course_name": course["course_name"],
            "start_time": e["start_time"],
            "end_time": e["end_time"],
            "room": e["room"],
            "notes": e["notes"],
        }
        if e["specific_date"]:
            on = _iso(e["specific_date"])
            if on and start <= on <= end:
                items.append({**base, "date": on, "day_of_week": on.isoweekday(), "recurring": False})
            continue
        recurrence = e["recurrence"] or {}
        first, last = _iso(recurrence.get("from")), _iso(recurrence.get("until"))
        day = start
        while day <= end:
            if (
                day.isoweekday() == e["day_of_week"]
                and (first is None or day >= first)
                and (last is None or day <= last)
            ):
                items.append({**base, "date": day, "day_of_week": day.isoweekday(), "recurring": True})
            day += timedelta(days=1)
    items.sort(key=lambda i: (i["date"], str(i["start_time"]), i["course_code"]))
    return {"date_from": start, "date_to": end, "items": items}
