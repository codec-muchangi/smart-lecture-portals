from fastapi import APIRouter

from app.api.v1.routes import auth, courses, me

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(me.router)
api_router.include_router(courses.router)
# Later phases register routers here as they land (materials, assignments, attendance, marks,
# announcements, notifications, timetable, reports, dashboard). See docs/API.md.
