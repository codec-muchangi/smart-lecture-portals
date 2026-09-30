"""Authentication + authorization dependencies. Single source of truth for access rules (docs/API.md)."""

from typing import Annotated
from uuid import UUID

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.errors import Forbidden, NotFound, Unauthenticated
from app.db.client import get_supabase
from app.schemas.common import CurrentUser

bearer = HTTPBearer(auto_error=False)


def get_current_user(cred: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> CurrentUser:
    if cred is None:
        raise Unauthenticated("Authentication required")
    sb = get_supabase()
    try:
        auth_user = sb.auth.get_user(cred.credentials).user
    except Exception as exc:
        raise Unauthenticated("Invalid or expired session") from exc
    if auth_user is None:
        raise Unauthenticated("Invalid or expired session")
    rows = (
        sb.table("profiles").select("id,role,full_name,email").eq("id", auth_user.id).limit(1).execute().data
    )
    if not rows:
        raise Forbidden("No profile for this account")
    return CurrentUser(**rows[0])


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]


def require_role(role: str):
    def dep(user: CurrentUserDep) -> CurrentUser:
        if user.role != role:
            raise Forbidden("Not allowed for your role")
        return user

    return dep


require_student = require_role("student")
require_lecturer = require_role("lecturer")


def _exists(table: str, **eq) -> bool:
    q = get_supabase().table(table).select("id").limit(1)
    for k, v in eq.items():
        q = q.eq(k, str(v))
    return bool(q.execute().data)


def assert_course_access(user: CurrentUser, course_id: UUID) -> None:
    """Lecturer must be assigned; student must be actively enrolled. 404 avoids existence leaks."""
    if user.role == "lecturer":
        ok = _exists("course_lecturers", course_id=course_id, lecturer_id=user.id)
    else:
        ok = _exists("course_enrollments", course_id=course_id, student_id=user.id, status="active")
    if not ok:
        raise NotFound("Course not found")


def assert_course_lecturer(user: CurrentUser, course_id: UUID) -> None:
    if user.role != "lecturer":
        raise Forbidden("Lecturer access required")
    assert_course_access(user, course_id)
