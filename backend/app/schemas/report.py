from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel


# ---------- attendance (FR-REP-01) ----------
class AttendanceStudentRow(BaseModel):
    student_id: UUID
    full_name: str
    registration_number: str
    present: int
    absent: int
    late: int
    excused: int
    attended: int  # present + late
    counted_sessions: int  # present + late + absent (excused are left out)
    attendance_pct: float | None = None
    unmarked: int  # sessions in the report in which the student has no record yet


class AttendanceSessionRow(BaseModel):
    session_id: UUID
    session_date: date
    start_time: time
    end_time: time
    topic: str | None = None
    present: int
    absent: int
    late: int
    excused: int
    unmarked: int  # students in the report with no record for this session
    attendance_pct: float | None = None


class AttendanceSummary(BaseModel):
    students: int
    sessions: int
    present: int
    absent: int
    late: int
    excused: int
    unmarked: int
    attended: int
    counted_records: int
    attendance_pct: float | None = None  # pooled: attended / counted_records


class AttendanceReport(BaseModel):
    course_id: UUID
    student_id: UUID | None = None  # echoes the filter
    date_from: date | None = None
    date_to: date | None = None
    summary: AttendanceSummary
    students: list[AttendanceStudentRow]
    sessions: list[AttendanceSessionRow]


# ---------- submissions (FR-REP-02) ----------
class SubmissionAssignmentRow(BaseModel):
    assignment_id: UUID
    title: str
    due_at: datetime
    max_marks: float
    closed: bool
    enrolled: int  # students in the report
    submitted: int  # status "submitted" (on time, not graded yet)
    late: int
    graded: int
    returned: int
    total_submissions: int  # students who have handed something in
    not_submitted: int
    missing: int  # not_submitted once the deadline has passed, else 0
    released: int  # graded submissions whose grade the student can see
    average_mark: float | None = None
    highest_mark: float | None = None
    lowest_mark: float | None = None
    average_percent: float | None = None


class SubmissionsSummary(BaseModel):
    assignments: int
    students: int
    total_submissions: int
    submitted: int
    late: int
    graded: int
    returned: int
    not_submitted: int
    missing: int
    submission_rate_pct: float | None = None  # total_submissions / (students x assignments)


class SubmissionsReport(BaseModel):
    course_id: UUID
    student_id: UUID | None = None
    assignment_id: UUID | None = None
    summary: SubmissionsSummary
    assignments: list[SubmissionAssignmentRow]


# ---------- performance (FR-REP-03) ----------
class PerformanceAssessmentRow(BaseModel):
    assessment_id: UUID
    name: str
    type: str
    max_marks: float
    weight: float | None = None
    published: bool
    students: int
    marks_entered: int
    average: float | None = None
    highest: float | None = None
    lowest: float | None = None
    average_percent: float | None = None


class PerformanceStudentRow(BaseModel):
    student_id: UUID
    full_name: str
    registration_number: str
    marks_entered: int  # published assessments the student has a mark for
    weighted_total: float
    weight_graded: float
    weight_published: float
    weighted_percent: float | None = None
    marks_total: float
    max_total: float


class PerformanceSummary(BaseModel):
    students: int
    assessments: int
    published_assessments: int
    students_without_marks: int
    average_weighted_percent: float | None = None
    highest_weighted_percent: float | None = None
    lowest_weighted_percent: float | None = None


class PerformanceReport(BaseModel):
    course_id: UUID
    student_id: UUID | None = None
    summary: PerformanceSummary
    assessments: list[PerformanceAssessmentRow]
    students: list[PerformanceStudentRow]
