from fastapi import APIRouter

from app.api.v1.routes import auth, courses, materials, me

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(me.router)
api_router.include_router(courses.router)
api_router.include_router(materials.course_router)
api_router.include_router(materials.material_router)
# Later phases register routers here as they land (assignments, attendance, marks,
# announcements, notifications, timetable, reports, dashboard). See docs/API.md.
