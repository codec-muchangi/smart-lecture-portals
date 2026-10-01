"""Authentication + authorization dependencies. Single source of truth for access rules (docs/API.md)."""

from typing import Annotated
from uuid import UUID

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.errors import Forbidden, NotFound, Unauthenticated
from app.db.client import get_supabase
from app.repositories import profile_repository as repo
from app.schemas.common import CurrentUser

bearer = HTTPBearer(auto_error=False)


def get_access_token(cred: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> str:
    if cred is None:
        raise Unauthenticated("Authentication required")
    return cred.credentials


def get_current_user(token: Annotated[str, Depends(get_access_token)]) -> CurrentUser:
    """Authenticate the bearer token, then load identity from OUR tables (never from the request body).

    Rejects: bad/expired token (401), no profile / no role row / inactive account (403).
    """
    sb = get_supabase()
    try:
        auth_user = sb.auth.get_user(token).user  # Supabase verifies signature and expiry
    except Exception as exc:
        raise Unauthenticated("Invalid or expired session") from exc
    if auth_user is None:
        raise Unauthenticated("Invalid or expired session")

    profile = repo.get_profile(auth_user.id)
    if profile is None:
        raise Forbidden("No profile for this account")
    details = repo.get_role_details(profile["role"], profile["id"])
    if details is None or details.get("status") != "active":
        raise Forbidden("Account is not active")
    return CurrentUser(
        id=profile["id"], role=profile["role"], full_name=profile["full_name"], email=profile["email"]
    )


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
