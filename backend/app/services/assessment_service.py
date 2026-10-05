"""Assessments and marks (SRS 4.8: FR-MARK-01..07, FR-LEC-11/12, FR-STU-08; workflow 5.6).

Acceptance tests covered: AT-05, AT-11, AT-12, AT-19.

An assessment is one component of a course result (CAT, exam, ...) with a maximum mark and an optional
weight, a percentage of the course total (the weights of a course add up to at most 100). Marks are entered
per student in bulk, atomically, together with their audit rows. Students see only PUBLISHED assessments and
only their own marks.
"""

import logging
import uuid
from decimal import Decimal
from uuid import UUID

from app.core.errors import Conflict, MarkOutOfRange, NotFound, ValidationFailed
from app.core.security import assert_course_access, assert_course_lecturer, ensure_course_writable
from app.repositories import assessment_repository as repo
from app.repositories import course_repository
from app.schemas.common import CurrentUser
from app.schemas.marks import AssessmentCreate, MarksBulkRequest
from app.services import audit_service, marks_calc
from app.services.marks_calc import d
from app.utils.search import safe_search

log = logging.getLogger("app.marks")


# ---------- loading with authorization ----------
def _load_for_lecturer(user: CurrentUser, assessment_id: UUID) -> tuple[dict, dict]:
    assessment = repo.get(assessment_id)
    if assessment is None:
        raise NotFound("Assessment not found")
    course = assert_course_lecturer(user, UUID(str(assessment["course_id"])))
    return assessment, course


def _out(row: dict, marks_entered: int | None = None) -> dict:
    return {**row, "marks_entered": marks_entered}


def _check_weight_budget(course_id: UUID, new_weight: float, exclude_id: UUID | None = None) -> None:
    """Weights are percentages of the course total, so they may not add up to more than 100."""
    others = sum((d(w) for w in repo.other_weights(course_id, exclude_id)), Decimal(0))
    total = others + d(new_weight)
    if total > 100:
        raise Conflict(
            f"The weights of this course's assessments would add up to {total:g}%, which is more than 100%",
            {"other_weights": float(others), "this_weight": new_weight},
        )


# ---------- assessments ----------
def create_assessment(user: CurrentUser, course_id: UUID, body: AssessmentCreate) -> dict:
    course = assert_course_lecturer(user, course_id)
    ensure_course_writable(course)
    if body.weight is not None:
        _check_weight_budget(course_id, body.weight)
    row = repo.insert(
        {
            "id": str(uuid.uuid4()),
            "course_id": str(course["id"]),
            "name": body.name,
            "type": body.type,
            "max_marks": body.max_marks,
            "weight": body.weight,
            "published": False,  # marks stay private until the lecturer publishes (FR-MARK-05)
            "created_by": str(user.id),
        }
    )
    audit_service.record(
        user.id,
        "assessment.create",
        "assessment",
        row["id"],
        new={
            "course_id": str(course["id"]),
            "name": body.name,
            "type": body.type,
            "max_marks": body.max_marks,
            "weight": body.weight,
        },
    )
    return _out(row, 0)


def list_assessments(user: CurrentUser, course_id: UUID, *, page: int, page_size: int) -> dict:
    assert_course_access(user, course_id)
    rows, total = repo.list_for_course(
        course_id, published_only=user.role == "student", page=page, page_size=page_size
    )
    counts = repo.mark_counts([r["id"] for r in rows]) if user.role == "lecturer" else {}
    items = [_out(r, counts.get(r["id"], 0) if user.role == "lecturer" else None) for r in rows]
    return {"items": items, "page": page, "page_size": page_size, "total": total}


def _differs(field: str, old, new) -> bool:
    if field in ("max_marks", "weight"):
        return (old is None) != (new is None) or (old is not None and d(old) != d(new))
    return old != new


def update_assessment(user: CurrentUser, assessment_id: UUID, requested: dict) -> dict:
    assessment, course = _load_for_lecturer(user, assessment_id)
    ensure_course_writable(course)
    changes = {k: v for k, v in requested.items() if _differs(k, assessment[k], v)}
    if changes:
        if changes.get("weight") is not None:
            _check_weight_budget(UUID(str(assessment["course_id"])), changes["weight"], assessment_id)
        if "max_marks" in changes:
            top = repo.highest_mark(assessment_id)
            if top is not None and d(changes["max_marks"]) < d(top):
                raise Conflict(f"Maximum marks cannot be lower than a mark already entered ({top:g})")
        old = {k: assessment[k] for k in changes}
        assessment = repo.update(assessment_id, changes)
        audit_service.record(user.id, "assessment.update", "assessment", assessment_id, old=old, new=changes)
    return _out(assessment, repo.mark_counts([str(assessment_id)]).get(str(assessment_id), 0))


# ---------- entering marks ----------
def list_marks(user: CurrentUser, assessment_id: UUID, *, q: str | None, page: int, page_size: int) -> dict:
    """The roster of actively enrolled students with their current mark (workflow 5.6: 'system loads
    enrolled students')."""
    assessment, _ = _load_for_lecturer(user, assessment_id)
    students, total = course_repository.roster(
        assessment["course_id"], status="active", q=safe_search(q), page=page, page_size=page_size
    )
    marks = repo.marks_for_assessment(assessment_id, [s["student_id"] for s in students])
    items = []
    for s in students:
        m = marks.get(s["student_id"])
        items.append(
            {
                "student_id": s["student_id"],
                "full_name": s["full_name"],
                "registration_number": s["registration_number"],
                "email": s["email"],
                "mark": m["mark"] if m else None,
                "feedback": m["feedback"] if m else None,
                "updated_at": m["updated_at"] if m else None,
            }
        )
    return {"items": items, "page": page, "page_size": page_size, "total": total}


def _validate_rows(body: MarksBulkRequest, maximum: Decimal, enrolled: set[str]) -> tuple[list[dict], bool]:
    """Check every row, collecting ALL problems so the lecturer can fix them in one go.
    Returns (errors, any_range_error)."""
    errors: list[dict] = []
    seen: set[str] = set()
    out_of_range = False
    for index, entry in enumerate(body.marks):
        sid = str(entry.student_id)

        def problem(message: str, _index=index, _sid=sid) -> None:
            errors.append({"index": _index, "student_id": _sid, "message": message})

        if sid in seen:
            problem("This student appears more than once in the request")
        seen.add(sid)
        if sid not in enrolled:
            problem("This student is not actively enrolled in the course")
        if d(entry.mark) > maximum:
            out_of_range = True
            problem(f"Mark {entry.mark:g} is higher than the maximum of {maximum:g}")
    return errors, out_of_range


def enter_marks(user: CurrentUser, assessment_id: UUID, body: MarksBulkRequest) -> dict:
    assessment, course = _load_for_lecturer(user, assessment_id)
    ensure_course_writable(course)
    student_ids = [str(e.student_id) for e in body.marks]
    enrolled = repo.enrolled_student_ids(course["id"], student_ids)
    errors, out_of_range = _validate_rows(body, d(assessment["max_marks"]), enrolled)
    if errors:  # all-or-nothing: nothing has been written
        if out_of_range:
            maximum = d(assessment["max_marks"])
            raise MarkOutOfRange(
                f"Some marks are higher than the maximum of {maximum:g}; nothing was saved", {"rows": errors}
            )
        raise ValidationFailed("Some rows are invalid; nothing was saved", {"rows": errors})

    rows = [{"student_id": str(e.student_id), "mark": e.mark, "feedback": e.feedback} for e in body.marks]
    try:
        result = repo.upsert_marks(assessment_id, user.id, rows)
    except Exception as exc:
        if "23514" in str(exc):  # a database rule rejected the batch: the data changed since we looked
            raise Conflict(
                "The marks could not be saved because the data changed. Please reload and try again."
            ) from exc
        raise
    return {**result, "total": len(rows)}


# ---------- a student's own marks ----------
def my_marks(user: CurrentUser, course_id: UUID) -> dict:
    """Only PUBLISHED assessments, only the caller's own marks (FR-MARK-06, AT-05, AT-12)."""
    assert_course_access(user, course_id)
    assessments = repo.published_for_course(course_id)
    marks = repo.marks_for_student(user.id, [a["id"] for a in assessments])
    items = []
    for a in assessments:
        m = marks.get(a["id"])
        mark = m["mark"] if m else None
        items.append(
            {
                "assessment_id": a["id"],
                "name": a["name"],
                "type": a["type"],
                "max_marks": a["max_marks"],
                "weight": a["weight"],
                "mark": mark,
                "percentage": marks_calc.percentage(mark, a["max_marks"]),
                "feedback": m["feedback"] if m else None,
            }
        )
    totals = marks_calc.compute_totals(items)
    return {"course_id": course_id, "items": items, "totals": totals}
