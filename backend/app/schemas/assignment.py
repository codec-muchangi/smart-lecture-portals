from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

TITLE_MIN, TITLE_MAX = 2, 200
DESCRIPTION_MAX, INSTRUCTIONS_MAX = 2000, 10000
MAX_MARKS_LIMIT = 1000

AssignmentState = Literal["draft", "open", "closed"]
AssignmentStateFilter = Literal["draft", "open", "closed", "all"]
SubmissionStatus = Literal["submitted", "late", "graded", "returned"]
SubmissionStatusFilter = Literal["submitted", "late", "graded", "returned", "all"]


def _check_max_marks(v):
    if isinstance(v, bool) or not isinstance(v, int | float):
        raise ValueError("must be a number")
    if not (0 < v <= MAX_MARKS_LIMIT):
        raise ValueError(f"must be greater than 0 and at most {MAX_MARKS_LIMIT}")
    if abs(v * 100 - round(v * 100)) > 1e-6:
        raise ValueError("at most 2 decimal places")
    return float(v)


class AssignmentCreate(BaseModel):
    """SRS 4.6 / FR-LEC-06: title, instructions, deadline, maximum marks, publication status.

    The deadline must carry a timezone (e.g. 2026-10-31T17:00:00+03:00); it is stored as UTC.
    Whether it lies in the future is a business rule checked by the service.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=TITLE_MIN, max_length=TITLE_MAX)
    description: str | None = Field(None, max_length=DESCRIPTION_MAX)
    instructions: str | None = Field(None, max_length=INSTRUCTIONS_MAX)
    due_at: AwareDatetime
    max_marks: float = Field(allow_inf_nan=False)
    allow_late: bool = False
    published: bool = False

    @field_validator("max_marks", mode="before")
    @classmethod
    def _marks(cls, v):
        return _check_max_marks(v)

    @field_validator("due_at")
    @classmethod
    def _utc(cls, v: datetime) -> datetime:
        return v.astimezone(UTC)

    @field_validator("description", "instructions")
    @classmethod
    def _blank_to_none(cls, v):
        return v or None


class AssignmentUpdate(BaseModel):
    """Any subset of the editable fields. description/instructions may be cleared with null or blank;
    all other fields may not be null. Course, creator and attachment are managed elsewhere."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str | None = Field(None, min_length=TITLE_MIN, max_length=TITLE_MAX)
    description: str | None = Field(None, max_length=DESCRIPTION_MAX)
    instructions: str | None = Field(None, max_length=INSTRUCTIONS_MAX)
    due_at: AwareDatetime | None = None
    max_marks: float | None = Field(None, allow_inf_nan=False)
    allow_late: bool | None = None
    published: bool | None = None
    closed: bool | None = None

    @field_validator("title", "due_at", "max_marks", "allow_late", "published", "closed", mode="before")
    @classmethod
    def _not_null(cls, v):
        if v is None:
            raise ValueError("cannot be null")
        return v

    @field_validator("max_marks", mode="before")
    @classmethod
    def _marks(cls, v):
        return _check_max_marks(v)

    @field_validator("due_at")
    @classmethod
    def _utc(cls, v: datetime) -> datetime:
        return v.astimezone(UTC)

    @field_validator("description", "instructions")
    @classmethod
    def _blank_to_none(cls, v):
        return v or None


class SubmissionOut(BaseModel):
    """A submission as the owning student (or a lecturer) sees it. For students, mark and feedback are
    withheld until the lecturer releases the grade (SRS 5.3, FR-ASG-10)."""

    id: UUID
    assignment_id: UUID
    student_id: UUID
    file_name: str
    mime_type: str
    file_size: int
    status: str
    submitted_at: datetime
    mark: float | None = None
    feedback: str | None = None
    grade_released: bool = False


class SubmissionListItem(SubmissionOut):
    student_name: str
    registration_number: str
    email: str


class AssignmentOut(BaseModel):
    id: UUID
    course_id: UUID
    title: str
    description: str | None = None
    instructions: str | None = None
    due_at: datetime
    max_marks: float
    allow_late: bool
    published: bool
    closed: bool
    state: AssignmentState
    submissions_open: bool  # can a student submit right now?
    has_attachment: bool
    attachment_name: str | None = None
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    my_submission: SubmissionOut | None = None  # students only


class AssignmentDetailOut(AssignmentOut):
    submission_counts: dict[str, int] | None = (
        None  # lecturers only: {submitted, late, graded, returned, total}
    )
