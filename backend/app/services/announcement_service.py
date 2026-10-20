"""Course announcements (SRS 4.9: FR-NOT-01/02/03, FR-LEC-13, FR-STU-10; AT-17).

A lecturer assigned to the course writes announcements (drafts or published), edits them and publishes or
unpublishes them. Students enrolled in the course see only PUBLISHED ones. Publishing for the first time
notifies the enrolled students, in the same database transaction as the change (see create_announcement and
update_announcement in migration 0009). Re-publishing after an unpublish does not notify again.
"""

import logging
from uuid import UUID

from app.core.errors import Conflict, NotFound
from app.core.security import assert_course_access, assert_course_lecturer, ensure_course_writable
from app.repositories import announcement_repository as repo
from app.schemas.announcement import AnnouncementCreate
from app.schemas.common import CurrentUser

log = logging.getLogger("app.announcements")


def _unpack(result: dict) -> dict:
    return {**result["announcement"], "notified": result["notified"]}


def _rule_rejected(exc: Exception) -> bool:
    return "23514" in str(exc)  # a database rule refused it: the data changed since we looked


def create_announcement(user: CurrentUser, course_id: UUID, body: AnnouncementCreate) -> dict:
    course = assert_course_lecturer(user, course_id)
    ensure_course_writable(course)
    try:
        result = repo.create(course["id"], user.id, body.title, body.body, body.published)
    except Exception as exc:
        if _rule_rejected(exc):
            raise Conflict(
                "The announcement could not be saved because the data changed. Please try again."
            ) from exc
        raise
    return _unpack(result)


def list_announcements(user: CurrentUser, course_id: UUID, *, page: int, page_size: int) -> dict:
    assert_course_access(user, course_id)
    rows, total = repo.list_for_course(
        course_id, published_only=user.role == "student", page=page, page_size=page_size
    )
    return {"items": rows, "page": page, "page_size": page_size, "total": total}


def update_announcement(user: CurrentUser, announcement_id: UUID, requested: dict) -> dict:
    announcement = repo.get(announcement_id)
    if announcement is None:
        raise NotFound("Announcement not found")
    course = assert_course_lecturer(user, UUID(str(announcement["course_id"])))
    ensure_course_writable(course)
    try:
        result = repo.update(announcement_id, user.id, requested)
    except Exception as exc:
        if _rule_rejected(exc):
            raise Conflict(
                "The announcement could not be saved because the data changed. Please try again."
            ) from exc
        raise
    return _unpack(result)
