from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.grading import check_mark

AssessmentType = Literal["cat", "assignment", "practical", "exam", "other"]
NAME_MIN, NAME_MAX = 2, 100
MAX_MARKS_LIMIT = 1000
MAX_ROWS_PER_REQUEST = 500
MARK_FEEDBACK_MAX = 1000


def _check_max_marks(v):
    if isinstance(v, bool) or not isinstance(v, int | float):
        raise ValueError("must be a number")
    if not (0 < v <= MAX_MARKS_LIMIT):
        raise ValueError(f"must be greater than 0 and at most {MAX_MARKS_LIMIT}")
    if abs(v * 100 - round(v * 100)) > 1e-6:
        raise ValueError("at most 2 decimal places")
    return float(v)


def _check_weight(v):
    if isinstance(v, bool) or not isinstance(v, int | float):
        raise ValueError("must be a number")
    if not (0 < v <= 100):
        raise ValueError("must be greater than 0 and at most 100 (a percentage of the course total)")
    if abs(v * 100 - round(v * 100)) > 1e-6:
        raise ValueError("at most 2 decimal places")
    return float(v)


class AssessmentCreate(BaseModel):
    """FR-MARK-01/02: a component (CAT, assignment, practical, exam...) with a maximum mark and an optional
    weight, expressed as a percentage of the course total."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=NAME_MIN, max_length=NAME_MAX)
    type: AssessmentType
    max_marks: float = Field(allow_inf_nan=False)
    weight: float | None = Field(None, allow_inf_nan=False)

    @field_validator("max_marks", mode="before")
    @classmethod
    def _marks(cls, v):
        return _check_max_marks(v)

    @field_validator("weight", mode="before")
    @classmethod
    def _weight(cls, v):
        return None if v is None else _check_weight(v)


class AssessmentUpdate(BaseModel):
    """Any subset of the editable fields. `weight: null` removes the weight; the other fields cannot be null.
    Publishing (`published`) controls whether students can see the assessment and its marks (FR-MARK-05)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(None, min_length=NAME_MIN, max_length=NAME_MAX)
    type: AssessmentType | None = None
    max_marks: float | None = Field(None, allow_inf_nan=False)
    weight: float | None = Field(None, allow_inf_nan=False)
    published: bool | None = None

    @field_validator("name", "type", "max_marks", "published", mode="before")
    @classmethod
    def _not_null(cls, v):
        if v is None:
            raise ValueError("cannot be null")
        return v

    @field_validator("max_marks", mode="before")
    @classmethod
    def _marks(cls, v):
        return _check_max_marks(v)

    @field_validator("weight", mode="before")
    @classmethod
    def _weight(cls, v):
        return None if v is None else _check_weight(v)


class MarkEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    student_id: UUID
    mark: float = Field(allow_inf_nan=False)
    feedback: str | None = Field(None, max_length=MARK_FEEDBACK_MAX)

    @field_validator("mark", mode="before")
    @classmethod
    def _mark(cls, v):
        return check_mark(v)

    @field_validator("feedback")
    @classmethod
    def _blank_to_none(cls, v):
        return v or None


class MarksBulkRequest(BaseModel):
    """PUT /assessments/{id}/marks: all rows are validated first; one bad row rejects the whole batch."""

    model_config = ConfigDict(extra="forbid")
    marks: list[MarkEntry] = Field(min_length=1, max_length=MAX_ROWS_PER_REQUEST)


class MarksBulkResult(BaseModel):
    created: int
    updated: int
    unchanged: int
    total: int


class AssessmentOut(BaseModel):
    id: UUID
    course_id: UUID
    name: str
    type: str
    max_marks: float
    weight: float | None = None
    published: bool
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    marks_entered: int | None = None  # lecturers only: how many students have a mark


class MarkRosterItem(BaseModel):
    student_id: UUID
    full_name: str
    registration_number: str
    email: str
    mark: float | None = None
    feedback: str | None = None
    updated_at: datetime | None = None


class MyMarkItem(BaseModel):
    assessment_id: UUID
    name: str
    type: str
    max_marks: float
    weight: float | None = None
    mark: float | None = None  # null: published but not marked yet
    percentage: float | None = None
    feedback: str | None = None


class MyMarkTotals(BaseModel):
    """Weighted result (FR-MARK-04): sum of mark/max x weight over published, weighted, marked assessments."""

    weighted_total: float  # points earned so far, out of `weight_graded`
    weight_graded: float  # total weight of the assessments that have a mark
    weight_published: float  # total weight of all published weighted assessments
    weighted_percent: float | None = None  # weighted_total / weight_graded x 100
    marks_total: float  # raw sum of marks (assessments that have one)
    max_total: float  # raw sum of the maximums of those assessments


class MyMarksOut(BaseModel):
    course_id: UUID
    items: list[MyMarkItem]
    totals: MyMarkTotals
