from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

CourseStatusFilter = Literal["active", "archived", "inactive", "all"]
EnrollmentStatusFilter = Literal["active", "withdrawn", "completed", "all"]


class CourseOut(BaseModel):
    id: UUID
    course_code: str
    course_name: str
    description: str | None = None
    credit_hours: int | None = None
    academic_year: str
    semester: str
    status: str
    created_at: datetime
    updated_at: datetime


class LecturerBrief(BaseModel):
    id: UUID
    full_name: str
    email: str
    title: str | None = None
    department: str | None = None


class CourseDetailOut(CourseOut):
    lecturers: list[LecturerBrief]
    enrolled_count: int | None = None  # lecturers only; students never see class size


class RosterItem(BaseModel):
    student_id: UUID
    full_name: str
    email: str
    registration_number: str
    program: str | None = None
    year_of_study: int | None = None
    enrollment_status: str
    enrolled_at: datetime


class CourseUpdate(BaseModel):
    """Lecturers may edit only the description of a course they are assigned to (FR-COURSE-03).
    Code, name, credits, period and status belong to the academic setup, not to lecturers."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    description: str | None = Field(None, max_length=2000)

    @field_validator("description")
    @classmethod
    def _blank_to_none(cls, v):
        return v or None
