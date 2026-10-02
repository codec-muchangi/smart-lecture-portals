from uuid import UUID

from app.db.client import get_supabase

COURSE_COLS = (
    "id,course_code,course_name,description,credit_hours,academic_year,semester,status,created_at,updated_at"
)


def get_course(course_id: UUID | str) -> dict | None:
    rows = (
        get_supabase().table("courses").select(COURSE_COLS).eq("id", str(course_id)).limit(1).execute().data
    )
    return rows[0] if rows else None


def is_assigned(course_id: UUID | str, lecturer_id: UUID | str) -> bool:
    rows = (
        get_supabase()
        .table("course_lecturers")
        .select("id")
        .eq("course_id", str(course_id))
        .eq("lecturer_id", str(lecturer_id))
        .limit(1)
        .execute()
        .data
    )
    return bool(rows)


def is_enrolled(course_id: UUID | str, student_id: UUID | str) -> bool:
    rows = (
        get_supabase()
        .table("course_enrollments")
        .select("id")
        .eq("course_id", str(course_id))
        .eq("student_id", str(student_id))
        .eq("status", "active")
        .limit(1)
        .execute()
        .data
    )
    return bool(rows)


def course_ids_for_user(role: str, user_id: UUID | str) -> list[str]:
    sb = get_supabase()
    if role == "lecturer":
        rows = sb.table("course_lecturers").select("course_id").eq("lecturer_id", str(user_id)).execute().data
    else:
        rows = (
            sb.table("course_enrollments")
            .select("course_id")
            .eq("student_id", str(user_id))
            .eq("status", "active")
            .execute()
            .data
        )
    return [r["course_id"] for r in rows]


def list_courses(
    ids: list[str],
    *,
    status: str,
    hide_inactive: bool,
    q: str | None,
    academic_year: str | None,
    semester: str | None,
    page: int,
    page_size: int,
) -> tuple[list[dict], int]:
    query = get_supabase().table("courses").select(COURSE_COLS, count="exact").in_("id", ids)
    if status != "all":
        query = query.eq("status", status)
    if hide_inactive:
        query = query.neq("status", "inactive")
    if academic_year:
        query = query.eq("academic_year", academic_year)
    if semester:
        query = query.eq("semester", semester)
    if q:
        query = query.or_(f"course_code.ilike.%{q}%,course_name.ilike.%{q}%")
    start = (page - 1) * page_size
    res = query.order("course_code").range(start, start + page_size - 1).execute()
    return res.data, res.count or 0


def get_lecturers(course_id: UUID | str) -> list[dict]:
    sb = get_supabase()
    links = sb.table("course_lecturers").select("lecturer_id").eq("course_id", str(course_id)).execute().data
    ids = [link["lecturer_id"] for link in links]
    if not ids:
        return []
    details = sb.table("lecturers").select("id,department,title").in_("id", ids).execute().data
    profiles = {
        p["id"]: p for p in sb.table("profiles").select("id,full_name,email").in_("id", ids).execute().data
    }
    out = [
        {
            "id": d["id"],
            "full_name": profiles[d["id"]]["full_name"],
            "email": profiles[d["id"]]["email"],
            "title": d.get("title"),
            "department": d.get("department"),
        }
        for d in details
        if d["id"] in profiles
    ]
    return sorted(out, key=lambda x: x["full_name"])


def count_enrolled(course_id: UUID | str) -> int:
    res = (
        get_supabase()
        .table("course_enrollments")
        .select("id", count="exact")
        .eq("course_id", str(course_id))
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    return res.count or 0


def roster(
    course_id: UUID | str, *, status: str, q: str | None, page: int, page_size: int
) -> tuple[list[dict], int]:
    query = get_supabase().table("v_course_roster").select("*", count="exact").eq("course_id", str(course_id))
    if status != "all":
        query = query.eq("enrollment_status", status)
    if q:
        query = query.or_(f"full_name.ilike.%{q}%,registration_number.ilike.%{q}%,email.ilike.%{q}%")
    start = (page - 1) * page_size
    res = query.order("full_name").range(start, start + page_size - 1).execute()
    return res.data, res.count or 0


def update_description(course_id: UUID | str, description: str | None) -> dict:
    res = (
        get_supabase()
        .table("courses")
        .update({"description": description})
        .eq("id", str(course_id))
        .execute()
    )
    return res.data[0]
