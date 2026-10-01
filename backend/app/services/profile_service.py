from app.core.errors import NotFound
from app.repositories import profile_repository as repo
from app.schemas.common import CurrentUser
from app.schemas.profile import ProfileUpdate
from app.services import audit_service


def get_me(user: CurrentUser) -> dict:
    profile = repo.get_profile(user.id)
    if profile is None:
        raise NotFound("Profile not found")
    return {**profile, "details": repo.get_role_details(user.role, user.id)}


def update_me(user: CurrentUser, body: ProfileUpdate) -> dict:
    """Apply only genuinely changed, permitted fields; audit old/new values of those fields."""
    requested = body.model_dump(exclude_unset=True)
    current = repo.get_profile(user.id)
    if current is None:
        raise NotFound("Profile not found")
    changes = {k: v for k, v in requested.items() if current.get(k) != v}
    if changes:
        repo.update_profile(user.id, changes)
        audit_service.record(
            user.id,
            "profile.update",
            "profile",
            user.id,
            old={k: current.get(k) for k in changes},
            new=changes,
        )
    return get_me(user)
