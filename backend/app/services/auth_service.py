import logging

from supabase import AuthApiError

from app.core.config import get_settings
from app.core.errors import Forbidden, ServiceUnavailable, Unauthenticated, ValidationFailed
from app.core.password_policy import validate_new_password
from app.db.client import get_anon_client, get_supabase
from app.repositories import profile_repository as repo
from app.schemas.common import CurrentUser
from app.services import audit_service

log = logging.getLogger("app.auth")
GENERIC_LOGIN_ERROR = "Invalid email or password"


def _sign_in(email: str, password: str):
    """Verify credentials with a throw-away anon client. Returns the Supabase auth response."""
    try:
        return get_anon_client().auth.sign_in_with_password({"email": email, "password": password})
    except AuthApiError as exc:
        raise Unauthenticated(GENERIC_LOGIN_ERROR) from exc
    except Exception as exc:  # network/provider outage: not the user's fault, and not a credential error
        log.exception("Auth provider failure during sign-in")
        raise ServiceUnavailable("Authentication service unavailable. Please try again.") from exc


def login(email: str, password: str) -> dict:
    result = _sign_in(email.lower(), password)
    session, auth_user = result.session, result.user
    if session is None or auth_user is None:
        raise Unauthenticated(GENERIC_LOGIN_ERROR)

    profile = repo.get_profile(auth_user.id)
    if profile is None:
        # Valid credentials but not provisioned for this app: refuse and hand out no tokens.
        log.warning("Login for auth user without profile: %s", auth_user.id)
        raise Forbidden("Account is not set up for this application")
    details = repo.get_role_details(profile["role"], profile["id"])
    if details is None or details.get("status") != "active":
        audit_service.record(
            profile["id"], "auth.login_denied", "profile", profile["id"], new={"reason": "inactive"}
        )
        raise Forbidden("Account is not active")

    audit_service.record(profile["id"], "auth.login", "profile", profile["id"])
    return {
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "expires_in": session.expires_in,
        "user": {"id": profile["id"], "role": profile["role"], "full_name": profile["full_name"]},
    }


def logout(access_token: str, user: CurrentUser) -> None:
    try:
        get_supabase().auth.admin.sign_out(access_token)  # revokes the user's refresh tokens
    except Exception:
        log.exception("Sign-out failed at provider")
        raise ServiceUnavailable("Could not end the session. Please try again.") from None
    audit_service.record(user.id, "auth.logout", "profile", user.id)


def change_password(user: CurrentUser, current_password: str, new_password: str) -> None:
    validate_new_password(new_password, current_password)
    try:
        _sign_in(user.email, current_password)
    except Unauthenticated:
        raise ValidationFailed(
            "Current password is incorrect", {"current_password": "Incorrect password"}
        ) from None
    try:
        get_supabase().auth.admin.update_user_by_id(str(user.id), {"password": new_password})
    except AuthApiError as exc:
        # Provider-side policy rejection (e.g. breached/weak password)
        raise ValidationFailed(
            "Password was rejected", {"new_password": "Choose a stronger password"}
        ) from exc
    except Exception as exc:
        log.exception("Password update failed")
        raise ServiceUnavailable("Could not change the password. Please try again.") from exc
    audit_service.record(user.id, "auth.password_change", "profile", user.id)  # no secrets recorded


def request_password_reset(email: str) -> None:
    """Always succeeds from the caller's view: never reveals whether the email has an account."""
    try:
        get_anon_client().auth.reset_password_for_email(
            email.lower(), {"redirect_to": get_settings().password_reset_redirect_url}
        )
    except Exception:
        log.warning("Password reset request failed at provider", exc_info=True)
