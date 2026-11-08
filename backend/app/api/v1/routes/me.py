from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from app.core.errors import ValidationFailed
from app.core.security import CurrentUserDep
from app.schemas.profile import ProfileOut, ProfileUpdate
from app.services import avatar_service, profile_service

router = APIRouter(tags=["profile"])


@router.get("/me", response_model=ProfileOut)
def read_me(user: CurrentUserDep) -> dict:
    return profile_service.get_me(user)


@router.patch("/me", response_model=ProfileOut)
def update_me(body: ProfileUpdate, user: CurrentUserDep) -> dict:
    if not body.model_dump(exclude_unset=True):
        raise ValidationFailed("No updatable fields supplied")
    return profile_service.update_me(user, body)


@router.post("/me/avatar", response_model=ProfileOut)
def upload_avatar(user: CurrentUserDep, file: Annotated[UploadFile, File()]) -> dict:
    """Upload or replace the caller's profile photo (JPEG/PNG/WebP, max 2 MB)."""
    # Read one byte past the limit so an oversized file is detected without loading it all.
    data = file.file.read(avatar_service.MAX_AVATAR_BYTES + 1)
    return avatar_service.set_avatar(user, data)


@router.delete("/me/avatar", response_model=ProfileOut)
def remove_avatar(user: CurrentUserDep) -> dict:
    """Remove the caller's profile photo."""
    return avatar_service.clear_avatar(user)
