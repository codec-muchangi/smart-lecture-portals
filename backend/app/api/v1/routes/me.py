from fastapi import APIRouter

from app.core.errors import ValidationFailed
from app.core.security import CurrentUserDep
from app.schemas.profile import ProfileOut, ProfileUpdate
from app.services import profile_service

router = APIRouter(tags=["profile"])


@router.get("/me", response_model=ProfileOut)
def read_me(user: CurrentUserDep) -> dict:
    return profile_service.get_me(user)


@router.patch("/me", response_model=ProfileOut)
def update_me(body: ProfileUpdate, user: CurrentUserDep) -> dict:
    if not body.model_dump(exclude_unset=True):
        raise ValidationFailed("No updatable fields supplied")
    return profile_service.update_me(user, body)
