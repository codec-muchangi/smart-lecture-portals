"""Grading assignment submissions (SRS 4.6: FR-LEC-08, FR-ASG-08/09/10, FR-STU-07/08; workflow 5.3;
acceptance tests AT-10, AT-11, AT-12).

A submission moves submitted/late -> graded (mark + optional feedback) or -> returned (sent back with required
feedback, no mark). The grade is hidden from the student until `grade_released` is set (release policy, 5.3).
Every change is written together with its audit row in one database transaction (see apply_grade).
"""

import logging
from uuid import UUID

from app.core.errors import Conflict, MarkOutOfRange, NotFound, ValidationFailed
from app.core.security import assert_course_lecturer, ensure_course_writable
from app.repositories import assignment_repository
from app.repositories import submission_repository as repo
from app.schemas.common import CurrentUser
from app.schemas.grading import GradeRequest
from app.services import assignment_service
from app.services.marks_calc import d
from app.services.submission_view import lecturer_view

log = logging.getLogger("app.grading")


def _same_mark(a, b) -> bool:
    return (a is None and b is None) or (a is not None and b is not None and d(a) == d(b))


def _save(submission_id: UUID, user: CurrentUser, **values) -> None:
    try:
        repo.apply_grade(submission_id, user.id, **values)
    except Exception as exc:
        if "23514" in str(
            exc
        ):  # a database rule rejected it (for example the lecturer was unassigned meanwhile)
            raise Conflict(
                "The grade could not be saved because the data changed. Please reload and try again."
            ) from exc
        raise


def grade_submission(user: CurrentUser, submission_id: UUID, req: GradeRequest) -> dict:
    submission = repo.get(submission_id)
    if submission is None:
        raise NotFound("Submission not found")
    assignment = assignment_repository.get(submission["assignment_id"])
    if assignment is None:
        raise NotFound("Submission not found")
    course = assert_course_lecturer(user, UUID(str(assignment["course_id"])))  # FR-ASG-08
    ensure_course_writable(course)

    fields = req.model_fields_set
    if req.mark is None and req.release is None and "feedback" not in fields and not req.return_for_revision:
        raise ValidationFailed("Nothing to change: send a mark, feedback, release or return_for_revision")

    if req.return_for_revision:
        _return_for_revision(user, submission_id, submission, req)
    else:
        _grade(user, submission_id, submission, assignment, req, fields)
    return lecturer_view(repo.get_overview(submission_id))


def _return_for_revision(user: CurrentUser, submission_id: UUID, submission: dict, req: GradeRequest) -> None:
    if req.mark is not None:
        raise ValidationFailed("A submission returned for revision has no mark", {"mark": "Remove the mark"})
    if req.release:
        raise ValidationFailed("A returned submission has no grade to release", {"release": "Remove release"})
    if not req.feedback:
        raise ValidationFailed("Explain what the student should fix", {"feedback": "Feedback is required"})
    if submission["status"] == "returned" and submission["feedback"] == req.feedback:
        return  # already returned with exactly this feedback
    _save(
        submission_id,
        user,
        action="submission.return",
        status="returned",
        mark=None,
        feedback=req.feedback,
        release=False,
        regrade=False,
    )


def _grade(
    user: CurrentUser,
    submission_id: UUID,
    submission: dict,
    assignment: dict,
    req: GradeRequest,
    fields: set[str],
) -> None:
    was_graded = submission["status"] == "graded"
    if req.mark is None and not was_graded:
        raise Conflict("This submission has not been graded yet. Enter a mark first.")

    if req.mark is not None:
        maximum = d(assignment["max_marks"])
        if d(req.mark) > maximum:  # FR-ASG-09, AT-11
            raise MarkOutOfRange(
                f"The mark cannot be higher than the maximum of {maximum:g}",
                {"mark": req.mark, "max_marks": float(maximum)},
            )
        mark = req.mark
    else:
        mark = float(submission["mark"])
    # Omitted fields keep their value; a previous 'returned' comment is not a grade comment, so it is dropped.
    feedback = req.feedback if "feedback" in fields else (submission["feedback"] if was_graded else None)
    release = (
        req.release
        if req.release is not None
        else (bool(submission["grade_released"]) if was_graded else False)
    )

    mark_changed = not was_graded or not _same_mark(submission["mark"], mark)
    feedback_changed = (submission["feedback"] or None) != feedback
    release_changed = bool(submission["grade_released"]) != release
    if was_graded and not (mark_changed or feedback_changed or release_changed):
        return  # nothing to write, nothing to audit

    regrade = mark_changed or feedback_changed
    if regrade:
        action = "submission.grade"
    else:
        action = "submission.release" if release else "submission.hide"
    _save(
        submission_id,
        user,
        action=action,
        status="graded",
        mark=mark,
        feedback=feedback,
        release=release,
        regrade=regrade,
    )


def release_all(user: CurrentUser, assignment_id: UUID, released: bool) -> dict:
    """Show (or hide) every graded submission of an assignment at once. Ungraded work is never touched."""
    _, course = assignment_service.load_for_lecturer(user, assignment_id)
    ensure_course_writable(course)
    return {"updated": repo.release_all(assignment_id, user.id, released)}
