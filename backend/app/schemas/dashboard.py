from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class DashboardCourse(BaseModel):
    id: UUID
    course_code: str
    course_name: str
    academic_year: str
    semester: str
    status: str
    enrolled_count: int | None = None  # lecturers only


# ---------- student (FR-STU-01) ----------
class UpcomingAssignment(BaseModel):
    assignment_id: UUID
    course_id: UUID
    course_code: str
    title: str
    due_at: datetime
    max_marks: float
    # not_submitted | submitted | late | graded | returned
    submission_status: str


class StudentAttendanceItem(BaseModel):
    course_id: UUID
    course_code: str
    present: int
    absent: int
    late: int
    excused: int
    attended: int
    counted_sessions: int
    attendance_pct: float | None = None


class RecentMark(BaseModel):
    kind: Literal["assignment", "assessment"]
    course_id: UUID
    course_code: str
    title: str
    mark: float
    max_marks: float
    percentage: float | None = None
    date: datetime | None = None


class DashboardAnnouncement(BaseModel):
    id: UUID
    course_id: UUID
    course_code: str
    title: str
    preview: str
    published_at: datetime | None = None


class StudentDashboard(BaseModel):
    role: Literal["student"]
    courses: list[DashboardCourse]
    upcoming_assignments: list[UpcomingAssignment]
    attendance_summary: list[StudentAttendanceItem]
    recent_marks: list[RecentMark]
    announcements: list[DashboardAnnouncement]
    unread_notifications: int


# ---------- lecturer (FR-LEC-01) ----------
class PendingGradingItem(BaseModel):
    assignment_id: UUID
    course_id: UUID
    course_code: str
    title: str
    due_at: datetime
    pending: int  # submitted or late, not graded yet


class PendingGrading(BaseModel):
    total: int
    items: list[PendingGradingItem]


class UpcomingDeadline(BaseModel):
    assignment_id: UUID
    course_id: UUID
    course_code: str
    title: str
    due_at: datetime
    enrolled: int
    submitted: int  # students who have handed something in


class LecturerAttendanceItem(BaseModel):
    course_id: UUID
    course_code: str
    sessions: int
    last_session_date: date | None = None
    attendance_pct: float | None = None  # pooled over all sessions


class LecturerPerformanceItem(BaseModel):
    course_id: UUID
    course_code: str
    published_assessments: int
    students_without_marks: int
    average_weighted_percent: float | None = None


class LecturerDashboard(BaseModel):
    role: Literal["lecturer"]
    courses: list[DashboardCourse]
    pending_grading: PendingGrading
    upcoming_deadlines: list[UpcomingDeadline]
    attendance_summary: list[LecturerAttendanceItem]
    performance_summary: list[LecturerPerformanceItem]


DashboardOut = Annotated[StudentDashboard | LecturerDashboard, Field(discriminator="role")]
