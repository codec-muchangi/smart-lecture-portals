from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from app.core.errors import ValidationFailed
from app.core.security import CurrentUserDep, LecturerDep, StudentDep
from app.schemas.common import Page
from app.schemas.marks import (
    AssessmentCreate,
    AssessmentOut,
    AssessmentUpdate,
    MarkRosterItem,
    MarksBulkRequest,
    MarksBulkResult,
    MyMarksOut,
)
from app.services import assessment_service

# Course-scoped: /courses/{course_id}/assessments and /courses/{course_id}/marks/me
course_router = APIRouter(prefix="/courses/{course_id}", tags=["marks"])
# Assessment-scoped: /assessments/{assessment_id}[/marks]
assessment_router = APIRouter(prefix="/assessments", tags=["marks"])

PageNo = Annotated[int, Query(ge=1)]
Search = Annotated[str | None, Query(max_length=100)]


@course_router.post("/assessments", status_code=201, response_model=AssessmentOut)
def create_assessment(course_id: UUID, body: AssessmentCreate, user: LecturerDep) -> dict:
    return assessment_service.create_assessment(user, course_id, body)


@course_router.get("/assessments", response_model=Page[AssessmentOut])
def list_assessments(
    course_id: UUID,
    user: CurrentUserDep,
    page: PageNo = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    return assessment_service.list_assessments(user, course_id, page=page, page_size=page_size)


@course_router.get("/marks/me", response_model=MyMarksOut)
def my_marks(course_id: UUID, user: StudentDep) -> dict:
    return assessment_service.my_marks(user, course_id)


@assessment_router.patch("/{assessment_id}", response_model=AssessmentOut)
def update_assessment(assessment_id: UUID, body: AssessmentUpdate, user: LecturerDep) -> dict:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise ValidationFailed("No updatable fields supplied")
    return assessment_service.update_assessment(user, assessment_id, changes)


@assessment_router.get("/{assessment_id}/marks", response_model=Page[MarkRosterItem])
def list_marks(
    assessment_id: UUID,
    user: LecturerDep,
    page: PageNo = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    q: Search = None,
) -> dict:
    return assessment_service.list_marks(user, assessment_id, q=q, page=page, page_size=page_size)


@assessment_router.put("/{assessment_id}/marks", response_model=MarksBulkResult)
def enter_marks(assessment_id: UUID, body: MarksBulkRequest, user: LecturerDep) -> dict:
    return assessment_service.enter_marks(user, assessment_id, body)
