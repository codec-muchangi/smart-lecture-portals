"""Account provisioning. Version 1.0 has no admin UI and no self-registration (SRS 1.3, 24):
accounts are created by controlled setup via scripts/create_user.py, which calls this service.

Data flow: (1) create the auth identity, (2) create profile + role row atomically via the
`provision_profile` SQL function, (3) if step 2 fails, delete the auth identity so nothing is orphaned.
"""

import logging

from app.core.errors import Conflict, ValidationFailed
from app.core.password_policy import validate_new_password
from app.db.client import get_supabase

log = logging.getLogger("app.provisioning")
STUDENT_FIELDS = ("registration_number", "program", "year_of_study")
LECTURER_FIELDS = ("staff_number", "department", "title")


def provision_user(
    role: str, email: str, password: str, full_name: str, phone: str | None = None, **role_fields
) -> str:
    if role not in ("student", "lecturer"):
        raise ValidationFailed("Role must be 'student' or 'lecturer'")
    allowed = STUDENT_FIELDS if role == "student" else LECTURER_FIELDS
    required = allowed[0]
    unknown = set(role_fields) - set(allowed)
    if unknown:
        raise ValidationFailed(f"Unknown fields for {role}: {sorted(unknown)}")
    if not role_fields.get(required):
        raise ValidationFailed(f"{required} is required for {role}")
    if len(full_name.strip()) < 2:
        raise ValidationFailed("full_name is too short")
    validate_new_password(password)

    sb = get_supabase()
    email = email.strip().lower()
    created = sb.auth.admin.create_user({"email": email, "password": password, "email_confirm": True})
    user_id = created.user.id
    try:
        sb.rpc(
            "provision_profile",
            {
                "p_id": user_id,
                "p_role": role,
                "p_full_name": full_name.strip(),
                "p_email": email,
                "p_phone": phone,
                **{f"p_{k}": v for k, v in role_fields.items()},
            },
        ).execute()
    except Exception as exc:
        log.exception("Provisioning failed; rolling back auth user %s", user_id)
        sb.auth.admin.delete_user(user_id)
        text = str(exc).lower()
        if "duplicate" in text or "23505" in text:
            raise Conflict("An account with that email or student/staff number already exists") from exc
        raise
    return user_id
