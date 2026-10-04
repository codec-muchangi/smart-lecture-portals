"""Student submissions (SRS 4.6, 5.2: FR-ASG-04..07, FR-STU-06/07, FR-LEC-07; AT-06, AT-08, AT-09).

Rules, in the order they are checked on submit:
  1. only a student actively enrolled in the course, and only for a published assignment (otherwise 404);
  2. the course must be active and the assignment not closed (409);
  3. deadline: after it, submissions are refused (DEADLINE_PASSED) unless the lecturer enabled late
     submissions, in which case the submission is stored with status 'late' (FR-ASG-07);
  4. a graded submission can no longer be replaced (409); a submitted/late/returned one can;
  5. the file must pass the shared upload checks (type, content, size).
Storage and database cannot share a transaction, so every path compensates (see inline notes).
"""

import logging
import uuid
from typing import BinaryIO
from uuid import UUID

from app.core.config import get_settings
from app.core.errors import Conflict, DeadlinePassed, NotFound
from app.core.security import assert_course_access, assert_course_lecturer, ensure_course_writable
from app.repositories import assignment_repository
from app.repositories import submission_repository as repo
from app.schemas.common import CurrentUser
from app.services import assignment_service, audit_service, storage_service, upload_service
from app.services.storage_service import SUBMISSIONS_BUCKET
from app.services.submission_view import lecturer_view, student_view
from app.utils import clock
from app.utils.search import safe_search

log = logging.getLogger("app.submissions")


def submit(
    user: CurrentUser, assignment_id: UUID, file_obj: BinaryIO, original_name: str | None
) -> tuple[dict, bool]:
    """Store (or replace) the caller's submission. Returns (submission_as_student_sees_it, created)."""
    assignment, course = assignment_service.load_for_user(user, assignment_id)  # AT-06: not enrolled -> 404
    ensure_course_writable(course)
    if assignment["closed"]:
        raise Conflict("This assignment is closed and no longer accepts submissions")

    now = clock.utcnow()
    due = clock.parse_ts(assignment["due_at"])
    late = now > due
    if late and not assignment["allow_late"]:
        raise DeadlinePassed("The deadline for this assignment has passed", {"due_at": due.isoformat()})

    existing = repo.get_for_student(assignment_id, user.id)
    if existing and existing["status"] == "graded":
        raise Conflict("This submission has already been graded and can no longer be replaced")

    upload = upload_service.read_and_validate(file_obj, original_name)  # AT-09: bad type / too large -> 400
    upload_id = str(
        uuid.uuid4()
    )  # fresh folder per upload: a replacement can never collide with the old file
    path = f"{course['id']}/{assignment_id}/{user.id}/{upload_id}/{upload.safe_name}"
    storage_service.upload_object(SUBMISSIONS_BUCKET, path, upload.data, upload.mime_type)

    status = "late" if late else "submitted"
    submitted_at = now.isoformat()
    if existing is None:
        row = _insert(user, assignment_id, upload_id, path, upload, status, submitted_at)
        audit_service.record(
            user.id,
            "submission.create",
            "submission",
            row["id"],
            new={"assignment_id": str(assignment_id), "file_name": upload.safe_name, "status": status},
        )
        return student_view(row), True

    try:
        row = repo.update(
            existing["id"],
            {
                "storage_path": path,
                "file_name": upload.safe_name,
                "file_size": len(upload.data),
                "submitted_at": submitted_at,
                "status": status,
            },
        )
    except Exception:
        _remove_quietly(path, "failed replacement update")
        raise
    old_removed = _remove_quietly(existing["storage_path"], "replaced submission")
    audit_service.record(
        user.id,
        "submission.replace",
        "submission",
        existing["id"],
        old={"file_name": existing["file_name"], "status": existing["status"]},
        new={"file_name": upload.safe_name, "status": status, "old_file_removed": old_removed},
    )
    return student_view(row), False


def _insert(user, assignment_id, upload_id, path, upload, status, submitted_at) -> dict:
    try:
        return repo.insert(
            {
                "id": upload_id,  # first upload: submission id == folder id, exactly as SRS 14 lays out
                "assignment_id": str(assignment_id),
                "student_id": str(user.id),
                "storage_path": path,
                "file_name": upload.safe_name,
                "file_size": len(upload.data),
                "submitted_at": submitted_at,
                "status": status,
            }
        )
    except Exception as exc:
        _remove_quietly(path, "failed insert")  # compensate: no orphaned file
        if "duplicate" in str(exc).lower() or "23505" in str(exc):  # two requests raced; the other won
            raise Conflict("A submission already exists for this assignment. Please try again.") from exc
        raise


def list_submissions(
    user: CurrentUser, assignment_id: UUID, *, status: str, q: str | None, page: int, page_size: int
) -> dict:
    assignment_service.load_for_lecturer(user, assignment_id)
    rows, total = repo.list_for_assignment(
        assignment_id, status=status, q=safe_search(q), page=page, page_size=page_size
    )
    return {"items": [lecturer_view(r) for r in rows], "page": page, "page_size": page_size, "total": total}


def get_my_submission(user: CurrentUser, assignment_id: UUID) -> dict:
    assignment_service.load_for_user(user, assignment_id)
    row = repo.get_for_student(assignment_id, user.id)
    if row is None:
        raise NotFound("You have not submitted this assignment")
    return student_view(row)


def get_download(user: CurrentUser, submission_id: UUID) -> dict:
    """Lecturer of the course, or the student who owns the submission. Everyone else gets 404."""
    submission = repo.get(submission_id)
    if submission is None:
        raise NotFound("Submission not found")
    assignment = assignment_repository.get(submission["assignment_id"])
    if assignment is None:
        raise NotFound("Submission not found")
    course_id = UUID(str(assignment["course_id"]))
    if user.role == "lecturer":
        assert_course_lecturer(user, course_id)
    else:
        if str(submission["student_id"]) != str(user.id):
            raise NotFound("Submission not found")
        assert_course_access(user, course_id)
    ttl = get_settings().signed_url_ttl_seconds
    url = storage_service.signed_download_url(
        SUBMISSIONS_BUCKET, submission["storage_path"], ttl, submission["file_name"]
    )
    return {"url": url, "expires_in": ttl, "file_name": submission["file_name"]}


def _remove_quietly(path: str, reason: str) -> bool:
    """Best-effort removal; a leftover object is unreachable (private bucket, no record points to it) and is
    logged and audited, but never fails the student's request."""
    try:
        storage_service.remove_object(SUBMISSIONS_BUCKET, path)
        return True
    except Exception:
        log.exception("Could not remove stored object %s (%s)", path, reason)
        return False
