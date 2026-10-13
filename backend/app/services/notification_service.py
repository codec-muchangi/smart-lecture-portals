"""In-app notifications (SRS 4.9: FR-NOT-03, FR-NOT-04; AT-18).

Two halves:
- the READING side: every user lists and marks only their OWN notifications (no user id is ever accepted from
  the client, so another user's notification is simply "not found");
- the EVENT side: `notify_course` / `notify_users` are called by the assignment, material, marks and grading
  services after the triggering change has been saved. They are BEST EFFORT on purpose: a notification that
  fails to send is logged, and never undoes or blocks the lecturer's academic change. (Announcements are the
  one exception: their notifications are created in the same database transaction, see 0009.)
"""

import logging
from uuid import UUID

from app.core.errors import NotFound
from app.repositories import notification_repository as repo
from app.schemas.common import CurrentUser
from app.utils import clock

log = logging.getLogger("app.notifications")


# ---------- reading ----------
def list_notifications(user: CurrentUser, *, is_read: bool | None, page: int, page_size: int) -> dict:
    rows, total = repo.list_for_user(user.id, is_read=is_read, page=page, page_size=page_size)
    return {"items": rows, "page": page, "page_size": page_size, "total": total}


def unread_count(user: CurrentUser) -> int:
    return repo.count_unread(user.id)


def mark_read(user: CurrentUser, notification_id: UUID) -> dict:
    """FR-NOT-04. Marking an already-read notification is allowed and changes nothing."""
    row = repo.get_for_user(notification_id, user.id)
    if row is None:
        raise NotFound("Notification not found")
    if row["is_read"]:
        return row
    return repo.mark_read(notification_id, user.id, clock.utcnow().isoformat())


def mark_all_read(user: CurrentUser) -> dict:
    return {"updated": repo.mark_all_read(user.id, clock.utcnow().isoformat())}


# ---------- events (best effort) ----------
def notify_course(
    course_id: UUID | str, type_: str, title: str, message: str, link: str | None = None
) -> int:
    """Notify every actively enrolled student of a course. Returns how many were notified (0 on failure)."""
    try:
        return repo.notify_course(course_id, type_, title, message, link)
    except Exception:
        log.exception("Could not create %s notifications for course %s", type_, course_id)
        return 0


def notify_users(user_ids: list[str], type_: str, title: str, message: str, link: str | None = None) -> int:
    """Notify specific users (for example the students whose grades were just released)."""
    if not user_ids:
        return 0
    try:
        return repo.insert_many(sorted(set(user_ids)), type_, title, message, link)
    except Exception:
        log.exception("Could not create %s notifications for %d user(s)", type_, len(user_ids))
        return 0
