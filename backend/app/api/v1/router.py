from fastapi import APIRouter

from app.api.v1.routes import assignments, auth, courses, marks, materials, me

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
# Later phases register routers here as they land (attendance,
# announcements, notifications, timetable, reports, dashboard). See docs/API.md.
