import logging
from uuid import UUID

from app.db.client import get_supabase

log = logging.getLogger("app.audit")


def record(
    actor_id: UUID | str | None,
    action: str,
    entity_type: str,
    entity_id: UUID | str | None = None,
    old: dict | None = None,
    new: dict | None = None,
    strict: bool = False,
) -> None:
    """Append an audit row (SRS section 15). Never pass passwords, tokens or secrets in old/new.

    strict=True re-raises on failure: use it for academic changes (marks, grades, attendance corrections)
    where the change must not succeed without its audit trail. Security-event logging is best-effort.
    """
    row = {
        "actor_user_id": str(actor_id) if actor_id else None,
        "action": action,
        "entity_type": entity_type,
        "entity_id": str(entity_id) if entity_id else None,
        "old_value": old,
        "new_value": new,
    }
    try:
        get_supabase().table("audit_logs").insert(row).execute()
    except Exception:
        log.exception("Failed to write audit log for %s", action)
        if strict:
            raise
