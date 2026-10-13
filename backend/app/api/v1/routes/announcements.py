from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from app.core.errors import ValidationFailed
from app.core.security import CurrentUserDep, LecturerDep
from app.schemas.announcement import AnnouncementCreate, AnnouncementOut, AnnouncementUpdate
from app.schemas.common import Page
from app.services import announcement_service

# Course-scoped: /courses/{course_id}/announcements
course_router = APIRouter(prefix="/courses/{course_id}", tags=["announcements"])
# Announcement-scoped: /announcements/{announcement_id}
announcement_router = APIRouter(prefix="/announcements", tags=["announcements"])


@course_router.post("/announcements", status_code=201, response_model=AnnouncementOut)
def create_announcement(course_id: UUID, body: AnnouncementCreate, user: LecturerDep) -> dict:
    return announcement_service.create_announcement(user, course_id, body)


@course_router.get("/announcements", response_model=Page[AnnouncementOut])
def list_announcements(
    course_id: UUID,
    user: CurrentUserDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    return announcement_service.list_announcements(user, course_id, page=page, page_size=page_size)


@announcement_router.patch("/{announcement_id}", response_model=AnnouncementOut)
def update_announcement(announcement_id: UUID, body: AnnouncementUpdate, user: LecturerDep) -> dict:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise ValidationFailed("No updatable fields supplied")
    return announcement_service.update_announcement(user, announcement_id, changes)
