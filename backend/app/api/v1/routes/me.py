from fastapi import APIRouter

from app.core.errors import ValidationFailed
from app.core.security import CurrentUserDep
from app.db.client import get_supabase
from app.schemas.profile import ProfileUpdate

router = APIRouter(tags=["profile"])


@router.get("/me")
def read_me(user: CurrentUserDep) -> dict:
    sb = get_supabase()
    profile = sb.table("profiles").select("*").eq("id", str(user.id)).single().execute().data
    table = "students" if user.role == "student" else "lecturers"
    detail = sb.table(table).select("*").eq("id", str(user.id)).limit(1).execute().data
    return {**profile, "details": detail[0] if detail else None}


@router.patch("/me")
def update_me(body: ProfileUpdate, user: CurrentUserDep) -> dict:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise ValidationFailed("No updatable fields supplied")
    return get_supabase().table("profiles").update(changes).eq("id", str(user.id)).execute().data[0]
