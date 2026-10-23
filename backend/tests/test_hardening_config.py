"""Phase 9: configuration safety (SRS 12, 18.1): unsafe production settings stop the app from starting."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.main import create_app

GOOD = {
    "environment": "production",
    "supabase_url": "https://abc.supabase.co",
    "supabase_anon_key": "anon-key",
    "supabase_service_role_key": "service-key",
    "cors_origins": "https://portal.example.edu",
    "password_reset_redirect_url": "https://portal.example.edu/reset-password",
}


def settings(**over) -> Settings:
    return Settings(_env_file=None, **{**GOOD, **over})


def test_a_correct_production_configuration_has_no_problems():
    assert settings().problems() == []


@pytest.mark.parametrize(
    "override,fragment",
    [
        ({"supabase_url": "http://abc.supabase.co"}, "SUPABASE_URL"),
        ({"supabase_url": ""}, "SUPABASE_URL"),
        ({"supabase_service_role_key": ""}, "SERVICE_ROLE_KEY"),
        ({"supabase_anon_key": ""}, "ANON_KEY"),
        ({"cors_origins": ""}, "CORS_ORIGINS is empty"),
        ({"cors_origins": "*"}, "not *"),
        ({"cors_origins": "http://portal.example.edu"}, "https://"),
        ({"cors_origins": "https://portal.example.edu,http://localhost:5173"}, "localhost"),
        ({"cors_origins": "https://127.0.0.1:5173"}, "127.0.0.1"),
        ({"cors_origins": "https://box.local"}, "box.local"),
        ({"password_reset_redirect_url": "http://localhost:5173/reset-password"}, "PASSWORD_RESET"),
        ({"password_reset_redirect_url": "https://localhost/reset"}, "PASSWORD_RESET"),
    ],
)
def test_each_unsafe_setting_is_reported(override, fragment):
    found = settings(**override).problems()
    assert found and any(fragment in p for p in found), found


def test_environment_must_be_a_known_name(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)  # CI sets ENVIRONMENT=test
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment="prod")  # a typo must not silently disable production rules
    assert Settings(_env_file=None).environment == "development"


def apply(monkeypatch, **values):
    live = get_settings()
    for key, value in values.items():
        monkeypatch.setattr(live, key, value)


def test_production_refuses_to_start_with_unsafe_settings(monkeypatch):
    apply(monkeypatch, **{**GOOD, "cors_origins": "*"})
    with pytest.raises(RuntimeError, match="Unsafe production configuration: .*not \\*"):
        create_app()


def test_production_with_good_settings_hides_the_api_description(monkeypatch):
    apply(monkeypatch, **GOOD)
    app = create_app()
    assert app.docs_url is None and app.redoc_url is None and app.openapi_url is None
    with TestClient(app) as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert client.get(path).status_code == 404, path


def test_development_only_warns(monkeypatch, caplog):
    apply(monkeypatch, environment="development", cors_origins="*", supabase_url="")
    app = create_app()
    assert app.docs_url == "/docs" and app.openapi_url == "/openapi.json"
    assert "Configuration notice" in caplog.text


def test_env_example_documents_every_setting():
    """SRS NFR-MAIN-02: every environment variable the backend reads is listed in .env.example."""
    example = (Path(__file__).resolve().parent.parent / ".env.example").read_text()
    listed = {line.split("=", 1)[0].strip().upper() for line in example.splitlines() if "=" in line}
    missing = {name.upper() for name in Settings.model_fields} - listed
    assert not missing, f"add to backend/.env.example: {sorted(missing)}"


def test_the_service_client_has_timeouts(monkeypatch):
    """A hung Supabase call must fail fast (then a 503), not freeze the request for minutes."""
    from app.db import client as db_client

    seen = {}

    def fake_create(url, key, options=None):
        seen["options"] = options
        return object()

    monkeypatch.setattr(db_client, "create_client", fake_create)
    db_client.get_supabase.cache_clear()
    try:
        db_client.get_supabase()
    finally:
        db_client.get_supabase.cache_clear()
    live = get_settings()
    assert seen["options"].postgrest_client_timeout == live.database_timeout_seconds
    assert seen["options"].storage_client_timeout == live.storage_timeout_seconds
    assert 0 < live.database_timeout_seconds <= 30
