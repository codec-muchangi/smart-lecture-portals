from functools import lru_cache

from supabase import Client, create_client

from app.core.config import get_settings


@lru_cache
def get_supabase() -> Client:
    """Service-role client. Backend only; bypasses RLS, so every call site must authorize first."""
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)
