from datetime import date, time
from uuid import UUID

from pydantic import BaseModel


class TimetableItem(BaseModel):
    """One dated class: a weekly slot expanded onto a day, or a one-off session."""

    entry_id: UUID
    course_id: UUID
    course_code: str
    course_name: str
    date: date
    day_of_week: int  # 1 = Monday ... 7 = Sunday
    start_time: time
    end_time: time
    room: str | None = None
    notes: str | None = None
    recurring: bool


class TimetableOut(BaseModel):
    date_from: date
    date_to: date
    items: list[TimetableItem]
