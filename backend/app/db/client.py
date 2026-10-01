from functools import lru_cache

from supabase import Client, create_client

from app.core.config import get_settings


@lru_cache
def get_supabase() -> Client:
    """Service-role client. Backend only; bypasses RLS, so every call site must authorize first.

    Never call sign_in_* on this shared client: that would attach a user session to it.
    """
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)


def get_anon_client() -> Client:
    """Fresh, throw-away anon client for user-credential operations (login, password verification, reset).

    Deliberately NOT cached: a sign-in stores that user's session on the client object.
    """
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_anon_key)
