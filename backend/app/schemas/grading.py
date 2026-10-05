from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

FEEDBACK_MAX = 2000
MARK_MAX = 1000


def check_mark(v):
    """Shared by grading and assessment marks: a number, 0 <= v <= 1000, at most 2 decimals.
    The upper bound for a specific assignment/assessment is a business rule checked by the service."""
    if isinstance(v, bool) or not isinstance(v, int | float):
        raise ValueError("must be a number")
    if not (0 <= v <= MARK_MAX):
        raise ValueError(f"must be between 0 and {MARK_MAX}")
    if abs(v * 100 - round(v * 100)) > 1e-6:
        raise ValueError("at most 2 decimal places")
    return float(v)


class GradeRequest(BaseModel):
    """PATCH /submissions/{id}/grade (SRS 10, 5.3).

    - `mark` (+ optional `feedback`, `release`): grade or regrade. 0 <= mark <= the assignment's maximum.
    - `release` alone: show or hide the grade of an already graded submission.
    - `return_for_revision`: send the work back with required `feedback`; clears any mark.
    Omitted `feedback`/`release` keep their current values; blank feedback clears it.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    mark: float | None = Field(None, allow_inf_nan=False)
    feedback: str | None = Field(None, max_length=FEEDBACK_MAX)
    release: StrictBool | None = None  # strict: a grade is only shown/hidden on an explicit true/false
    return_for_revision: StrictBool = False

    @field_validator("mark", mode="before")
    @classmethod
    def _mark(cls, v):
        return None if v is None else check_mark(v)

    @field_validator("feedback")
    @classmethod
    def _blank_to_none(cls, v):
        return v or None


class ReleaseRequest(BaseModel):
    """POST /assignments/{id}/grades/release: show (true) or hide (false) every graded submission."""

    model_config = ConfigDict(extra="forbid")
    released: StrictBool


class ReleaseResult(BaseModel):
    updated: int
