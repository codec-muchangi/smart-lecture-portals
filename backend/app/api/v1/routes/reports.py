from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.core.limits import report_limit
from app.core.security import LecturerDep
from app.schemas.report import AttendanceReport, PerformanceReport, SubmissionsReport
from app.services import report_service

router = APIRouter(
    prefix="/courses/{course_id}/reports", tags=["reports"], dependencies=[Depends(report_limit)]
)


@router.get("/attendance", response_model=AttendanceReport)
def attendance_report(
    course_id: UUID,
    user: LecturerDep,
    student_id: UUID | None = None,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
) -> dict:
    return report_service.attendance_report(
        user, course_id, student_id=student_id, date_from=date_from, date_to=date_to
    )


@router.get("/submissions", response_model=SubmissionsReport)
def submissions_report(
    course_id: UUID, user: LecturerDep, student_id: UUID | None = None, assignment_id: UUID | None = None
) -> dict:
    return report_service.submissions_report(
        user, course_id, student_id=student_id, assignment_id=assignment_id
    )


@router.get("/performance", response_model=PerformanceReport)
def performance_report(course_id: UUID, user: LecturerDep, student_id: UUID | None = None) -> dict:
    return report_service.performance_report(user, course_id, student_id=student_id)
