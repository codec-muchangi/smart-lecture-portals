"""Assignments (SRS 4.6: FR-ASG-01..03, FR-LEC-05/06, FR-STU-05).

Lifecycle: draft (unpublished) -> open (published, not closed) -> closed. Students only ever see published
assignments. Deadlines are stored in UTC and must be in the future when set. Assignments are never deleted:
close them instead (academic history, SRS 15).
"""

import logging
import uuid
from datetime import timedelta
from typing import BinaryIO
from uuid import UUID

from app.core.config import get_settings
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.security import assert_course_access, assert_course_lecturer, ensure_course_writable
from app.repositories import assignment_repository as repo
from app.repositories import submission_repository as submission_repo
from app.schemas.assignment import AssignmentCreate
from app.schemas.common import CurrentUser
from app.services import audit_service, storage_service, upload_service
from app.services.storage_service import MATERIALS_BUCKET
from app.services.submission_view import student_view
from app.utils import clock
from app.utils.search import safe_search

log = logging.getLogger("app.assignments")
EDITABLE_TEXT = ("title", "description", "instructions")


# ---------- presentation ----------
def attachment_name(assignment: dict) -> str | None:
    path = assignment.get("attachment_path")
    return path.rsplit("/", 1)[-1] if path else None


def decorate(assignment: dict, now) -> dict:
    """Add derived fields: state, whether submissions are open right now, attachment info."""
    published, closed = assignment["published"], assignment["closed"]
    due = clock.parse_ts(assignment["due_at"])
    return {
        **assignment,
        "state": "draft" if not published else "closed" if closed else "open",
        "submissions_open": bool(published and not closed and (now <= due or assignment["allow_late"])),
        "has_attachment": bool(assignment.get("attachment_path")),
        "attachment_name": attachment_name(assignment),
        "my_submission": None,
    }


# ---------- loading with authorization ----------
def load_for_user(user: CurrentUser, assignment_id: UUID) -> tuple[dict, dict]:
    """Assignment + its course, or 404. Students additionally cannot see unpublished assignments."""
    assignment = repo.get(assignment_id)
    if assignment is None:
        raise NotFound("Assignment not found")
    course = assert_course_access(user, UUID(str(assignment["course_id"])))
    if user.role == "student" and not assignment["published"]:
        raise NotFound("Assignment not found")
    return assignment, course


def load_for_lecturer(user: CurrentUser, assignment_id: UUID) -> tuple[dict, dict]:
    assignment = repo.get(assignment_id)
    if assignment is None:
        raise NotFound("Assignment not found")
    course = assert_course_lecturer(user, UUID(str(assignment["course_id"])))
    return assignment, course


# ---------- validation ----------
def _check_deadline(due_at, now) -> None:
    """FR-ASG-03: a deadline must be logically valid: in the future, and not absurdly far away."""
    if due_at <= now:
        raise ValidationFailed("Invalid deadline", {"due_at": "The deadline must be in the future"})
    limit_days = get_settings().assignment_max_due_days
    if due_at > now + timedelta(days=limit_days):
        raise ValidationFailed(
            "Invalid deadline", {"due_at": f"The deadline can be at most {limit_days} days ahead"}
        )


# ---------- queries ----------
def list_assignments(
    user: CurrentUser, course_id: UUID, *, state: str, q: str | None, page: int, page_size: int
) -> dict:
    assert_course_access(user, course_id)
    rows, total = repo.list_for_course(
        course_id,
        published_only=user.role == "student",
        state=state,
        q=safe_search(q),
        page=page,
        page_size=page_size,
    )
    now = clock.utcnow()
    items = [decorate(r, now) for r in rows]
    if user.role == "student":
        mine = submission_repo.for_student(user.id, [r["id"] for r in rows])
        for item in items:
            sub = mine.get(item["id"])
            item["my_submission"] = student_view(sub) if sub else None
    return {"items": items, "page": page, "page_size": page_size, "total": total}


def get_assignment(user: CurrentUser, assignment_id: UUID) -> dict:
    assignment, _ = load_for_user(user, assignment_id)
    detail = {**decorate(assignment, clock.utcnow()), "submission_counts": None}
    if user.role == "student":
        sub = submission_repo.get_for_student(assignment_id, user.id)
        detail["my_submission"] = student_view(sub) if sub else None
    else:
        statuses = submission_repo.statuses_for_assignment(assignment_id)
        counts = {s: statuses.count(s) for s in ("submitted", "late", "graded", "returned")}
        detail["submission_counts"] = {**counts, "total": len(statuses)}
    return detail


# ---------- commands ----------
def create_assignment(user: CurrentUser, course_id: UUID, body: AssignmentCreate) -> dict:
    course = assert_course_lecturer(user, course_id)
    ensure_course_writable(course)
    _check_deadline(body.due_at, clock.utcnow())
    row = repo.insert(
        {
            "id": str(uuid.uuid4()),
            "course_id": str(course["id"]),
            "title": body.title,
            "description": body.description,
            "instructions": body.instructions,
            "due_at": body.due_at.isoformat(),
            "max_marks": body.max_marks,
            "allow_late": body.allow_late,
            "published": body.published,
            "created_by": str(user.id),
        }
    )
    audit_service.record(
        user.id,
        "assignment.create",
        "assignment",
        row["id"],
        new={
            "course_id": str(course["id"]),
            "title": body.title,
            "due_at": body.due_at.isoformat(),
            "max_marks": body.max_marks,
            "allow_late": body.allow_late,
            "published": body.published,
        },
    )
    return get_assignment(user, UUID(str(row["id"])))


def _differs(field: str, old, new) -> bool:
    if field == "due_at":
        return clock.parse_ts(old) != new
    if field == "max_marks":
        return float(old) != float(new)
    return old != new


def update_assignment(user: CurrentUser, assignment_id: UUID, requested: dict) -> dict:
    assignment, course = load_for_lecturer(user, assignment_id)
    ensure_course_writable(course)
    now = clock.utcnow()
    changes = {k: v for k, v in requested.items() if _differs(k, assignment[k], v)}
    if not changes:
        return get_assignment(user, assignment_id)

    new_published = changes.get("published", assignment["published"])
    new_closed = changes.get("closed", assignment["closed"])
    new_due = changes.get("due_at", clock.parse_ts(assignment["due_at"]))

    if "due_at" in changes:
        _check_deadline(new_due, now)
    if new_published and not assignment["published"] and new_due <= now:
        raise ValidationFailed("Cannot publish", {"due_at": "Set a future deadline before publishing"})
    if "published" in changes and not new_published:
        if submission_repo.statuses_for_assignment(assignment_id):
            raise Conflict(
                "This assignment already has submissions, so it cannot be unpublished. Close it instead."
            )
        changes["closed"] = new_closed = False  # a draft cannot be closed (DB constraint)
    if new_closed and not new_published:
        raise ValidationFailed("Cannot close", {"closed": "Only a published assignment can be closed"})
    if "max_marks" in changes:
        top = submission_repo.highest_mark(assignment_id)
        if top is not None and changes["max_marks"] < top:
            raise Conflict(f"Maximum marks cannot be lower than a mark already awarded ({top:g})")

    old = {k: assignment[k] for k in changes}
    db_changes = {k: (v.isoformat() if k == "due_at" else v) for k, v in changes.items()}
    repo.update(assignment_id, db_changes)
    audit_service.record(
        user.id,
        "assignment.update",
        "assignment",
        assignment_id,
        old=old,
        new=db_changes,
    )
    return get_assignment(user, assignment_id)


# ---------- attachment (optional file for students to read) ----------
def set_attachment(
    user: CurrentUser, assignment_id: UUID, file_obj: BinaryIO, original_name: str | None
) -> dict:
    assignment, course = load_for_lecturer(user, assignment_id)
    ensure_course_writable(course)
    upload = upload_service.read_and_validate(file_obj, original_name)
    # A fresh folder per upload means replacing a file can never collide with the old object.
    path = f"{course['id']}/assignments/{assignment_id}/{uuid.uuid4()}/{upload.safe_name}"
    storage_service.upload_object(MATERIALS_BUCKET, path, upload.data, upload.mime_type)
    try:
        repo.update(assignment_id, {"attachment_path": path})
    except Exception:
        _remove_quietly(path, "failed attachment update")
        raise
    old_path = assignment.get("attachment_path")
    old_removed = _remove_quietly(old_path, "replaced attachment") if old_path else None
    audit_service.record(
        user.id,
        "assignment.attachment_set",
        "assignment",
        assignment_id,
        old={"attachment_name": attachment_name(assignment)},
        new={
            "attachment_name": upload.safe_name,
            "file_size": len(upload.data),
            "old_file_removed": old_removed,
        },
    )
    return get_assignment(user, assignment_id)


def remove_attachment(user: CurrentUser, assignment_id: UUID) -> dict:
    assignment, course = load_for_lecturer(user, assignment_id)
    ensure_course_writable(course)
    old_path = assignment.get("attachment_path")
    if not old_path:
        raise NotFound("This assignment has no attachment")
    repo.update(assignment_id, {"attachment_path": None})
    removed = _remove_quietly(old_path, "removed attachment")
    audit_service.record(
        user.id,
        "assignment.attachment_remove",
        "assignment",
        assignment_id,
        old={"attachment_name": attachment_name(assignment)},
        new={"file_removed": removed},
    )
    return get_assignment(user, assignment_id)


def get_attachment_download(user: CurrentUser, assignment_id: UUID) -> dict:
    assignment, _ = load_for_user(user, assignment_id)
    path = assignment.get("attachment_path")
    if not path:
        raise NotFound("This assignment has no attachment")
    ttl = get_settings().signed_url_ttl_seconds
    name = attachment_name(assignment)
    url = storage_service.signed_download_url(MATERIALS_BUCKET, path, ttl, name)
    return {"url": url, "expires_in": ttl, "file_name": name}


def _remove_quietly(path: str, reason: str) -> bool:
    """Best-effort object removal. A leftover file is harmless (private bucket, unreachable by any record)
    and is logged and audited so it can be cleaned up; it must never fail the user's request."""
    try:
        storage_service.remove_object(MATERIALS_BUCKET, path)
        return True
    except Exception:
        log.exception("Could not remove stored object %s (%s)", path, reason)
        return False
