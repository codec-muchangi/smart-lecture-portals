from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Query, Response, UploadFile

from app.core.errors import ValidationFailed
from app.core.security import CurrentUserDep, LecturerDep, StudentDep
from app.schemas.assignment import (
    AssignmentCreate,
    AssignmentDetailOut,
    AssignmentOut,
    AssignmentStateFilter,
    AssignmentUpdate,
    SubmissionListItem,
    SubmissionOut,
    SubmissionStatusFilter,
)
from app.schemas.common import DownloadOut, Page
from app.services import assignment_service, submission_service

# Course-scoped: /courses/{course_id}/assignments
course_router = APIRouter(prefix="/courses/{course_id}/assignments", tags=["assignments"])
# Assignment-scoped: /assignments/{assignment_id}[/attachment|/submissions]
assignment_router = APIRouter(prefix="/assignments", tags=["assignments"])
# Submission-scoped: /submissions/{submission_id}/download
submission_router = APIRouter(prefix="/submissions", tags=["submissions"])

PageNo = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]
Search = Annotated[str | None, Query(max_length=100)]
FileUpload = Annotated[UploadFile, File(description="PDF, DOCX, PPTX, XLSX, CSV, PNG, JPG/JPEG or ZIP")]


# ---------------- assignments ----------------
@course_router.get("", response_model=Page[AssignmentOut])
def list_assignments(
    course_id: UUID,
    user: CurrentUserDep,
    page: PageNo = 1,
    page_size: PageSize = 20,
    q: Search = None,
    state: AssignmentStateFilter = "all",
) -> dict:
    return assignment_service.list_assignments(
        user, course_id, state=state, q=q, page=page, page_size=page_size
    )


@course_router.post("", status_code=201, response_model=AssignmentDetailOut)
def create_assignment(course_id: UUID, body: AssignmentCreate, user: LecturerDep) -> dict:
    return assignment_service.create_assignment(user, course_id, body)


@assignment_router.get("/{assignment_id}", response_model=AssignmentDetailOut)
def get_assignment(assignment_id: UUID, user: CurrentUserDep) -> dict:
    return assignment_service.get_assignment(user, assignment_id)


@assignment_router.patch("/{assignment_id}", response_model=AssignmentDetailOut)
def update_assignment(assignment_id: UUID, body: AssignmentUpdate, user: LecturerDep) -> dict:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise ValidationFailed("No updatable fields supplied")
    return assignment_service.update_assignment(user, assignment_id, changes)


# ---------------- optional attachment ----------------
@assignment_router.put("/{assignment_id}/attachment", response_model=AssignmentDetailOut)
def set_attachment(assignment_id: UUID, file: FileUpload, user: LecturerDep) -> dict:
    return assignment_service.set_attachment(user, assignment_id, file.file, file.filename)


@assignment_router.delete("/{assignment_id}/attachment", response_model=AssignmentDetailOut)
def remove_attachment(assignment_id: UUID, user: LecturerDep) -> dict:
    return assignment_service.remove_attachment(user, assignment_id)


@assignment_router.get("/{assignment_id}/attachment", response_model=DownloadOut)
def download_attachment(assignment_id: UUID, user: CurrentUserDep) -> dict:
    return assignment_service.get_attachment_download(user, assignment_id)


# ---------------- submissions ----------------
@assignment_router.post(
    "/{assignment_id}/submissions",
    response_model=SubmissionOut,
    status_code=201,
    responses={200: {"description": "An existing submission was replaced"}},
)
def submit_assignment(assignment_id: UUID, file: FileUpload, user: StudentDep, response: Response) -> dict:
    submission, created = submission_service.submit(user, assignment_id, file.file, file.filename)
    response.status_code = 201 if created else 200
    return submission


@assignment_router.get("/{assignment_id}/submissions", response_model=Page[SubmissionListItem])
def list_submissions(
    assignment_id: UUID,
    user: LecturerDep,
    page: PageNo = 1,
    page_size: PageSize = 20,
    q: Search = None,
    status: SubmissionStatusFilter = "all",
) -> dict:
    return submission_service.list_submissions(
        user, assignment_id, status=status, q=q, page=page, page_size=page_size
    )


@assignment_router.get("/{assignment_id}/submissions/me", response_model=SubmissionOut)
def my_submission(assignment_id: UUID, user: StudentDep) -> dict:
    return submission_service.get_my_submission(user, assignment_id)


@submission_router.get("/{submission_id}/download", response_model=DownloadOut)
def download_submission(submission_id: UUID, user: CurrentUserDep) -> dict:
    return submission_service.get_download(user, submission_id)
