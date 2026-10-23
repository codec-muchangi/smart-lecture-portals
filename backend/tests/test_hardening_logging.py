"""Phase 9: security-event logging without secrets (SRS 12): redaction, access log, refused-request log."""

import base64
import logging

import pytest

from app.core.logging_config import REDACTED, RedactingFilter, configure_logging, redact
from tests.conftest import COURSE_A, L1, S1, bearer

API = "/api/v1"


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


# Fake secrets are ASSEMBLED at run time, so no literal in the repository looks like a real token to the
# secret scanner (gitleaks), while the tests still exercise the real patterns.
JWT = ".".join(
    [_b64('{"alg":"HS256","typ":"JWT"}'), _b64('{"sub":"1234567890","name":"x"}'), "abcDEF123_-xyz0"]
)
FAKE_KEY = "sk_" + "live_" + "123456789012"


@pytest.mark.parametrize(
    "raw,secret",
    [
        (f"Authorization: Bearer {JWT}", JWT),
        ("header bearer abc.def-123_456", "abc.def-123_456"),
        (f"key was {JWT} here", JWT),
        ("login password=Hunter2Pass failed", "Hunter2Pass"),
        ("passwd: Hunter2Pass, next", "Hunter2Pass"),
        (f"api_key={FAKE_KEY}", FAKE_KEY),
        ('payload {"password": "Hunter2Pass", "x": 1}', "Hunter2Pass"),
        ('{"new_password":"Hunter2Pass","current_password":"Old12345"}', "Old12345"),
        ('{"refresh_token": "r-123456"}', "r-123456"),
    ],
)
def test_redact_masks_secrets(raw, secret):
    cleaned = redact(raw)
    assert secret not in cleaned and REDACTED in cleaned


def test_redact_leaves_ordinary_text_alone():
    text = "GET /api/v1/courses -> 200 in 12 ms [request_id=abc123]"
    assert redact(text) == text


def test_filter_redacts_arguments_and_tracebacks(caplog):
    logger = logging.getLogger("app.test-redaction")
    configure_logging("INFO")
    with caplog.at_level(logging.ERROR, logger="app.test-redaction"):
        try:
            raise RuntimeError(f"failed with token={JWT}")
        except RuntimeError:
            logger.exception("login for %s password=%s", "a@b.test", "Hunter2Pass")
    assert "Hunter2Pass" not in caplog.text and JWT not in caplog.text and "a@b.test" in caplog.text


def test_configure_logging_is_idempotent_and_tolerates_bad_levels():
    root = logging.getLogger()
    configure_logging("not-a-level")
    configure_logging("DEBUG")
    configure_logging("INFO")
    for handler in root.handlers:
        assert sum(isinstance(f, RedactingFilter) for f in handler.filters) == 1
    assert root.level == logging.INFO


def test_the_http_client_does_not_log_request_urls():
    """httpx would log database filters (emails, ids) at INFO; production must not."""
    configure_logging("INFO")
    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING
    assert logging.getLogger("httpcore").getEffectiveLevel() >= logging.WARNING


def test_configure_logging_creates_a_handler_when_there_is_none(monkeypatch):
    root = logging.getLogger()
    monkeypatch.setattr(root, "handlers", [])
    configure_logging("INFO")
    assert len(root.handlers) == 1 and root.handlers[0].filters
    root.handlers.clear()


# =============================== access and security logs ===============================
def test_access_log_has_method_path_status_and_id_but_no_query_or_token(client, db, caplog):
    with caplog.at_level(logging.INFO, logger="app.access"):
        client.get(
            f"{API}/courses?q=very-secret-search", headers={**bearer(S1), "X-Request-ID": "trace-12345678"}
        )
    line = next(r.getMessage() for r in caplog.records if r.name == "app.access")
    assert line.startswith("GET /api/v1/courses -> 200") and "request_id=trace-12345678" in line
    assert "very-secret-search" not in caplog.text and "tok-" not in caplog.text  # incl. httpx's own log


@pytest.mark.parametrize(
    "call,status",
    [
        (lambda c: c.get(f"{API}/me"), 401),
        (lambda c: c.get(f"{API}/courses/{COURSE_A}/reports/attendance", headers=bearer(S1)), 403),
    ],
)
def test_refused_requests_are_logged_without_secrets(client, db, caplog, call, status):
    with caplog.at_level(logging.WARNING, logger="app.security"):
        r = call(client)
    assert r.status_code == status
    line = next(r.getMessage() for r in caplog.records if r.name == "app.security")
    assert f"-> {status}" in line and "client=" in line and "request_id=" in line
    assert "tok-" not in caplog.text and "Bearer" not in caplog.text


def test_failed_login_is_logged_but_not_the_password(client, db, caplog):
    with caplog.at_level(logging.WARNING, logger="app.security"):
        client.post(f"{API}/auth/login", json={"email": "student@demo.test", "password": "WrongPass999"})
    assert "refused POST /api/v1/auth/login -> 401" in caplog.text
    assert "WrongPass999" not in caplog.text and "student@demo.test" not in caplog.text


def test_slow_requests_are_warned_about(client, db, caplog, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "slow_request_seconds", 0.0)
    with caplog.at_level(logging.WARNING, logger="app.access"):
        client.get("/health")
    assert any(
        r.levelno == logging.WARNING and r.getMessage().startswith("SLOW GET /health") for r in caplog.records
    )


def test_successful_requests_are_not_security_events(client, db, caplog):
    with caplog.at_level(logging.WARNING, logger="app.security"):
        client.get(f"{API}/courses", headers=bearer(L1))
    assert not [r for r in caplog.records if r.name == "app.security"]
