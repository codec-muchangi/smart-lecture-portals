from fastapi import APIRouter

from app.api.v1.routes import (
    announcements,
    assignments,
    attendance,
    auth,
    courses,
    dashboard,
    marks,
    materials,
    me,
    notifications,
    reports,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(me.router)
api_router.include_router(courses.router)
api_router.include_router(materials.course_router)
api_router.include_router(materials.material_router)
api_router.include_router(assignments.course_router)
api_router.include_router(assignments.assignment_router)
api_router.include_router(assignments.submission_router)
api_router.include_router(marks.course_router)
api_router.include_router(marks.assessment_router)
api_router.include_router(attendance.course_router)
api_router.include_router(attendance.session_router)
api_router.include_router(announcements.course_router)
api_router.include_router(announcements.announcement_router)
api_router.include_router(notifications.router)
api_router.include_router(reports.router)
api_router.include_router(dashboard.router)
