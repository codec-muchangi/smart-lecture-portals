from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response

from app.core.security import CurrentUserDep
from app.schemas.announcement import NotificationOut, ReadAllResult
from app.schemas.common import Page
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=Page[NotificationOut])
def list_notifications(
    user: CurrentUserDep,
    response: Response,
    is_read: bool | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    # The unread total is independent of the filter and page, so a bell badge can use any request.
    response.headers["X-Unread-Count"] = str(notification_service.unread_count(user))
    return notification_service.list_notifications(user, is_read=is_read, page=page, page_size=page_size)


@router.post("/read-all", response_model=ReadAllResult)
def read_all(user: CurrentUserDep) -> dict:
    return notification_service.mark_all_read(user)


@router.patch("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: UUID, user: CurrentUserDep) -> dict:
    return notification_service.mark_read(user, notification_id)
