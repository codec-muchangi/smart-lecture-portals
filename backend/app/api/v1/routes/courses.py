from uuid import UUID

from fastapi import APIRouter, Query

from app.core.errors import NotFound
from app.core.security import CurrentUserDep, assert_course_access, assert_course_lecturer
from app.db.client import get_supabase

router = APIRouter(prefix="/courses", tags=["courses"])


def _course_ids(user) -> list[str]:
    sb = get_supabase()
    if user.role == "lecturer":
        rows = sb.table("course_lecturers").select("course_id").eq("lecturer_id", str(user.id)).execute().data
    else:
        rows = (
            sb.table("course_enrollments")
            .select("course_id")
            .eq("student_id", str(user.id))
            .eq("status", "active")
            .execute()
            .data
        )
    return [r["course_id"] for r in rows]


@router.get("")
def list_courses(
    user: CurrentUserDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = None,
    status: str | None = None,
) -> dict:
    ids = _course_ids(user)
    if not ids:
        return {"items": [], "page": page, "page_size": page_size, "total": 0}
    query = get_supabase().table("courses").select("*", count="exact").in_("id", ids)
    if status:
        query = query.eq("status", status)
    if q:
        safe = q.replace(",", " ").replace("(", " ").replace(")", " ")
        query = query.or_(f"course_code.ilike.%{safe}%,course_name.ilike.%{safe}%")
    start = (page - 1) * page_size
    res = query.order("course_code").range(start, start + page_size - 1).execute()
    return {"items": res.data, "page": page, "page_size": page_size, "total": res.count or 0}


@router.get("/{course_id}")
def get_course(course_id: UUID, user: CurrentUserDep) -> dict:
    assert_course_access(user, course_id)
    rows = get_supabase().table("courses").select("*").eq("id", str(course_id)).limit(1).execute().data
    if not rows:
        raise NotFound("Course not found")
    return rows[0]


@router.get("/{course_id}/students")
def course_students(course_id: UUID, user: CurrentUserDep) -> dict:
    assert_course_lecturer(user, course_id)
    rows = (
        get_supabase()
        .table("course_enrollments")
        .select("student_id,status,students(registration_number,program,profiles(full_name,email))")
        .eq("course_id", str(course_id))
        .execute()
        .data
    )
    return {"items": rows}
