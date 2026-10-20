from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.common import Page

AttendanceStatus = Literal["present", "absent", "late", "excused"]
TOPIC_MAX = 200
NOTE_MAX = 500
MAX_ROWS_PER_REQUEST = 500
EARLIEST_DATE = date(2000, 1, 1)


def _clean_time(v: time) -> time:
    if v.tzinfo is not None:
        raise ValueError("must not include a time zone")
    return v.replace(microsecond=0)


class SessionCreate(BaseModel):
    """FR-ATT-01: course (from the URL), date, start/end time and an optional topic."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    session_date: date
    start_time: time
    end_time: time
    topic: str | None = Field(None, max_length=TOPIC_MAX)

    @field_validator("start_time", "end_time")
    @classmethod
    def _times(cls, v: time) -> time:
        return _clean_time(v)

    @field_validator("session_date")
    @classmethod
    def _date(cls, v: date) -> date:
        if v < EARLIEST_DATE:
            raise ValueError("is not a plausible session date")
        return v

    @field_validator("topic")
    @classmethod
    def _blank_to_none(cls, v):
        return v or None

    @model_validator(mode="after")
    def _order(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class RecordEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    student_id: UUID
    status: AttendanceStatus
    note: str | None = Field(None, max_length=NOTE_MAX)

    @field_validator("note")
    @classmethod
    def _blank_to_none(cls, v):
        return v or None


class RecordsBulkRequest(BaseModel):
    """POST /attendance/sessions/{id}/records: validated as a whole, saved all-or-nothing."""

    model_config = ConfigDict(extra="forbid")
    records: list[RecordEntry] = Field(min_length=1, max_length=MAX_ROWS_PER_REQUEST)


class RecordsBulkResult(BaseModel):
    created: int
    updated: int
    unchanged: int
    total: int


class SessionOut(BaseModel):
    id: UUID
    course_id: UUID
    session_date: date
    start_time: time
    end_time: time
    topic: str | None = None
    created_by: UUID
    created_at: datetime
    records_marked: int | None = None  # how many students have a record (list view)


class StatusCounts(BaseModel):
    present: int
    absent: int
    late: int
    excused: int
    unmarked: int  # actively enrolled students with no record yet


class RosterItem(BaseModel):
    student_id: UUID
    full_name: str
    registration_number: str
    email: str
    status: AttendanceStatus | None = None  # null: not marked yet
    note: str | None = None
    marked_at: datetime | None = None
    marked_by: UUID | None = None


class SessionDetail(SessionOut):
    summary: StatusCounts
    roster: Page[RosterItem]


class MyAttendanceItem(BaseModel):
    session_id: UUID
    session_date: date
    start_time: time
    end_time: time
    topic: str | None = None
    status: AttendanceStatus
    note: str | None = None
    marked_at: datetime


class MyAttendanceSummary(BaseModel):
    present: int
    absent: int
    late: int
    excused: int
    attended: int  # present + late
    counted_sessions: int  # present + late + absent (excused are left out)
    attendance_pct: float | None = None  # attended / counted_sessions x 100; null until a session counts


class MyAttendanceOut(BaseModel):
    course_id: UUID
    items: list[MyAttendanceItem]
    summary: MyAttendanceSummary
