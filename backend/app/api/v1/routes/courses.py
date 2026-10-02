from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from app.core.errors import ValidationFailed
from app.core.security import CurrentUserDep
from app.schemas.common import Page
from app.schemas.course import (
    CourseDetailOut,
    CourseOut,
    CourseStatusFilter,
    CourseUpdate,
    EnrollmentStatusFilter,
    RosterItem,
)
from app.services import course_service

router = APIRouter(prefix="/courses", tags=["courses"])

PageNo = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]
Search = Annotated[str | None, Query(max_length=100)]


@router.get("", response_model=Page[CourseOut])
def list_courses(
    user: CurrentUserDep,
    page: PageNo = 1,
    page_size: PageSize = 20,
    q: Search = None,
    status: CourseStatusFilter = "active",
    academic_year: Annotated[str | None, Query(max_length=20)] = None,
    semester: Annotated[str | None, Query(max_length=30)] = None,
) -> dict:
    return course_service.list_courses(
        user,
        status=status,
        q=q,
        academic_year=academic_year,
        semester=semester,
        page=page,
        page_size=page_size,
    )


@router.get("/{course_id}", response_model=CourseDetailOut)
def get_course(course_id: UUID, user: CurrentUserDep) -> dict:
    return course_service.get_course_detail(user, course_id)


@router.patch("/{course_id}", response_model=CourseDetailOut)
def update_course(course_id: UUID, body: CourseUpdate, user: CurrentUserDep) -> dict:
    if "description" not in body.model_fields_set:
        raise ValidationFailed("No updatable fields supplied")
    return course_service.update_course(user, course_id, body.description)


@router.get("/{course_id}/students", response_model=Page[RosterItem])
def course_students(
    course_id: UUID,
    user: CurrentUserDep,
    page: PageNo = 1,
    page_size: PageSize = 20,
    q: Search = None,
    status: EnrollmentStatusFilter = "active",
) -> dict:
    return course_service.list_roster(user, course_id, status=status, q=q, page=page, page_size=page_size)
