from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from app.core.security import LecturerDep, StudentDep
from app.schemas.attendance import (
    MyAttendanceOut,
    RecordsBulkRequest,
    RecordsBulkResult,
    SessionCreate,
    SessionDetail,
    SessionOut,
)
from app.schemas.common import Page
from app.services import attendance_service

# Course-scoped: /courses/{course_id}/attendance/...
course_router = APIRouter(prefix="/courses/{course_id}/attendance", tags=["attendance"])
# Session-scoped: /attendance/sessions/{session_id}[/records]
session_router = APIRouter(prefix="/attendance/sessions", tags=["attendance"])

PageNo = Annotated[int, Query(ge=1)]
Search = Annotated[str | None, Query(max_length=100)]


@course_router.post("/sessions", status_code=201, response_model=SessionOut)
def create_session(course_id: UUID, body: SessionCreate, user: LecturerDep) -> dict:
    return attendance_service.create_session(user, course_id, body)


@course_router.get("/sessions", response_model=Page[SessionOut])
def list_sessions(
    course_id: UUID,
    user: LecturerDep,
    page: PageNo = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    return attendance_service.list_sessions(user, course_id, page=page, page_size=page_size)


@course_router.get("/me", response_model=MyAttendanceOut)
def my_attendance(course_id: UUID, user: StudentDep) -> dict:
    return attendance_service.my_attendance(user, course_id)


@session_router.get("/{session_id}", response_model=SessionDetail)
def get_session(
    session_id: UUID,
    user: LecturerDep,
    page: PageNo = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 100,
    q: Search = None,
) -> dict:
    return attendance_service.get_session_detail(user, session_id, q=q, page=page, page_size=page_size)


@session_router.post("/{session_id}/records", response_model=RecordsBulkResult)
def mark_records(session_id: UUID, body: RecordsBulkRequest, user: LecturerDep) -> dict:
    return attendance_service.mark_records(user, session_id, body)
