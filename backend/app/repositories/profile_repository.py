from uuid import UUID

from app.db.client import get_supabase

ROLE_TABLE = {"student": "students", "lecturer": "lecturers"}
PROFILE_COLS = "id,role,full_name,email,phone,avatar_url,created_at,updated_at"


def get_profile(user_id: UUID | str) -> dict | None:
    rows = (
        get_supabase().table("profiles").select(PROFILE_COLS).eq("id", str(user_id)).limit(1).execute().data
    )
    return rows[0] if rows else None


def get_role_details(role: str, user_id: UUID | str) -> dict | None:
    table = ROLE_TABLE.get(role)
    if table is None:
        return None
    rows = get_supabase().table(table).select("*").eq("id", str(user_id)).limit(1).execute().data
    if not rows:
        return None
    rows[0].pop("id", None)
    return rows[0]


def update_profile(user_id: UUID | str, changes: dict) -> dict:
    res = get_supabase().table("profiles").update(changes).eq("id", str(user_id)).execute().data
    return res[0]
