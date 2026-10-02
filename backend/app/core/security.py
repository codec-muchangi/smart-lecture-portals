"""Authentication + authorization dependencies. Single source of truth for access rules (docs/API.md)."""

from typing import Annotated
from uuid import UUID

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.errors import Conflict, Forbidden, NotFound, Unauthenticated
from app.db.client import get_supabase
from app.repositories import course_repository as course_repo
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


def assert_course_access(user: CurrentUser, course_id: UUID) -> dict:
    """Central course-scope rule, reused by every course-owned resource in later phases.

    - lecturer: must be assigned to the course
    - student: must be actively enrolled, and the course must not be inactive
    Anything else raises 404 (not 403) so the existence of other courses is not revealed.
    Returns the course row so callers need no second lookup.
    """
    course = course_repo.get_course(course_id)
    if course is None:
        raise NotFound("Course not found")
    if user.role == "lecturer":
        allowed = course_repo.is_assigned(course_id, user.id)
    else:
        allowed = course["status"] != "inactive" and course_repo.is_enrolled(course_id, user.id)
    if not allowed:
        raise NotFound("Course not found")
    return course


def assert_course_lecturer(user: CurrentUser, course_id: UUID) -> dict:
    if user.role != "lecturer":
        raise Forbidden("Lecturer access required")
    return assert_course_access(user, course_id)


def ensure_course_writable(course: dict) -> None:
    """Archived/inactive courses are read-only history: block new materials, assignments, marks, etc."""
    if course["status"] != "active":
        raise Conflict("This course is not active, so it can no longer be changed")
