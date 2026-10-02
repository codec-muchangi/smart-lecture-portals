from uuid import UUID

from app.core.security import assert_course_access, assert_course_lecturer
from app.repositories import course_repository as repo
from app.schemas.common import CurrentUser
from app.services import audit_service
from app.utils.search import safe_search


def list_courses(
    user: CurrentUser,
    *,
    status: str,
    q: str | None,
    academic_year: str | None,
    semester: str | None,
    page: int,
    page_size: int,
) -> dict:
    """Only courses the caller is enrolled in (student) or assigned to (lecturer); inactive courses are
    hidden from students."""
    ids = repo.course_ids_for_user(user.role, user.id)
    if not ids:
        return {"items": [], "page": page, "page_size": page_size, "total": 0}
    items, total = repo.list_courses(
        ids,
        status=status,
        hide_inactive=user.role == "student",
        q=safe_search(q),
        academic_year=academic_year,
        semester=semester,
        page=page,
        page_size=page_size,
    )
    return {"items": items, "page": page, "page_size": page_size, "total": total}


def get_course_detail(user: CurrentUser, course_id: UUID) -> dict:
    course = assert_course_access(user, course_id)
    detail = {**course, "lecturers": repo.get_lecturers(course_id), "enrolled_count": None}
    if user.role == "lecturer":
        detail["enrolled_count"] = repo.count_enrolled(course_id)
    return detail


def list_roster(
    user: CurrentUser, course_id: UUID, *, status: str, q: str | None, page: int, page_size: int
) -> dict:
    assert_course_lecturer(user, course_id)
    items, total = repo.roster(course_id, status=status, q=safe_search(q), page=page, page_size=page_size)
    return {"items": items, "page": page, "page_size": page_size, "total": total}


def update_course(user: CurrentUser, course_id: UUID, description: str | None) -> dict:
    course = assert_course_lecturer(user, course_id)
    if course["description"] != description:
        repo.update_description(course_id, description)
        audit_service.record(
            user.id,
            "course.update",
            "course",
            course_id,
            old={"description": course["description"]},
            new={"description": description},
        )
    return get_course_detail(user, course_id)
