"""Phase 9: security headers, request ids, CORS, error shapes, body limits (SRS 12, NFR-SEC-05, REL-02)."""

import gzip
import logging

import httpx
import pytest

from app.core.config import get_settings
from app.services import dashboard_service
from tests import file_samples as samples
from tests.conftest import COURSE_A, L1, S1, bearer

API = "/api/v1"
ORIGIN = get_settings().cors_origin_list[0]


@pytest.fixture(autouse=True)
def _frozen_time(clock):
    """Run at the frozen NOW."""


def explode(*_a, **_k):
    raise RuntimeError("boom secret-detail")


# =============================== security headers ===============================
@pytest.mark.parametrize(
    "path,status",
    [("/health", 200), (f"{API}/me", 401), (f"{API}/nothing-here", 404), (f"{API}/courses/not-a-uuid", 401)],
)
def test_every_response_carries_security_headers(client, db, path, status):
    r = client.get(path)
    assert r.status_code == status
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["cache-control"] == "no-store"
    assert "camera=()" in r.headers["permissions-policy"]
    assert "strict-transport-security" not in r.headers  # development: no HSTS


def test_validation_error_also_has_headers(client, db):
    r = client.get(f"{API}/courses/not-a-uuid", headers=bearer(S1))
    assert r.status_code == 422 and r.headers["x-content-type-options"] == "nosniff"


def test_hsts_only_in_production(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "environment", "production")
    r = client.get("/health")
    assert r.headers["strict-transport-security"] == "max-age=31536000"


def test_docs_page_keeps_scripts_working_but_is_not_cached_as_api(client, db):
    r = client.get("/docs")
    assert r.status_code == 200 and "content-security-policy" not in r.headers
    assert r.headers["x-content-type-options"] == "nosniff"


# =============================== request ids ===============================
def test_each_request_gets_an_id(client, db):
    a, b = client.get("/health"), client.get("/health")
    assert len(a.headers["x-request-id"]) == 32 and a.headers["x-request-id"] != b.headers["x-request-id"]


def test_a_harmless_incoming_id_is_kept(client, db):
    r = client.get("/health", headers={"X-Request-ID": "trace-12345678"})
    assert r.headers["x-request-id"] == "trace-12345678"


@pytest.mark.parametrize(
    "bad", ["short", "has spaces in it 123", "x" * 80, "bad/slash-12345678", "semi;colon-12345"]
)
def test_an_unsafe_incoming_id_is_replaced(client, db, bad):
    r = client.get("/health", headers={"X-Request-ID": bad})
    assert r.headers["x-request-id"] != bad and len(r.headers["x-request-id"]) == 32


# =============================== unexpected errors ===============================
def test_unexpected_error_is_generic_traceable_and_has_headers(client, db, monkeypatch):
    monkeypatch.setattr(dashboard_service, "get_dashboard", explode)
    r = client.get(
        f"{API}/dashboard", headers={**bearer(S1), "Origin": ORIGIN, "X-Request-ID": "trace-abcdef12"}
    )
    body = r.json()
    assert (
        r.status_code == 500
        and body["code"] == "INTERNAL_ERROR"
        and body["message"] == "Something went wrong"
    )
    assert (
        body["details"] == {"request_id": "trace-abcdef12"} and r.headers["x-request-id"] == "trace-abcdef12"
    )
    assert "boom" not in r.text and "secret-detail" not in r.text and "Traceback" not in r.text
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["access-control-allow-origin"] == ORIGIN  # the browser can read the error


def test_unexpected_error_is_logged_with_its_id(client, db, monkeypatch, caplog):
    monkeypatch.setattr(dashboard_service, "get_dashboard", explode)
    with caplog.at_level(logging.ERROR, logger="app"):
        client.get(f"{API}/dashboard", headers={**bearer(S1), "X-Request-ID": "trace-abcdef12"})
    assert "trace-abcdef12" in caplog.text and "RuntimeError" in caplog.text


def test_unreachable_database_is_a_retryable_503(client, db, monkeypatch):
    def down(*_a, **_k):
        raise httpx.ConnectError("name resolution failed for secret.supabase.co")

    monkeypatch.setattr(dashboard_service, "get_dashboard", down)
    r = client.get(f"{API}/dashboard", headers=bearer(S1))
    assert r.status_code == 503 and r.json()["code"] == "SERVICE_UNAVAILABLE"
    assert r.headers["retry-after"] == "5" and "secret.supabase.co" not in r.text


def test_wrong_method_has_its_own_code(client, db):
    r = client.delete("/health")
    assert r.status_code == 405 and r.json()["code"] == "METHOD_NOT_ALLOWED"
    assert "allow" in r.headers


# =============================== CORS ===============================
def preflight(client, origin=ORIGIN, method="POST", headers="authorization,content-type"):
    return client.options(
        f"{API}/courses",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": headers,
        },
    )


def test_cors_allows_the_configured_origin_without_credentials(client, db):
    r = preflight(client)
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == ORIGIN
    assert "access-control-allow-credentials" not in r.headers
    assert (
        "PATCH" in r.headers["access-control-allow-methods"]
        and "*" not in r.headers["access-control-allow-methods"]
    )


def test_cors_refuses_other_origins_and_unknown_headers(client, db):
    assert "access-control-allow-origin" not in preflight(client, origin="https://evil.example").headers
    assert preflight(client, headers="x-evil-header").status_code == 400
    assert preflight(client, method="TRACE").status_code == 400


def test_browser_can_read_the_helper_headers(client, db):
    r = client.get("/health", headers={"Origin": ORIGIN})
    exposed = r.headers["access-control-expose-headers"]
    assert "X-Unread-Count" in exposed and "X-Request-ID" in exposed and "Retry-After" in exposed


# =============================== compression ===============================
def test_large_responses_are_compressed(client, db):
    r = client.get("/openapi.json", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200 and r.headers["content-encoding"] == "gzip" and r.json()["info"]["title"]
    small = client.get("/health", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in small.headers
    assert gzip.compress(b"x")  # sanity: the standard library gzip is what the client undoes


# =============================== body limits ===============================
def test_huge_json_body_is_refused_early(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_json_kb", 1)
    r = client.post(f"{API}/auth/login", json={"email": "a@b.test", "password": "x" * 5000})
    assert (
        r.status_code == 413
        and r.json()["code"] == "PAYLOAD_TOO_LARGE"
        and r.json()["details"]["max_kb"] == 1
    )


def test_normal_json_body_still_passes(client, db):
    r = client.post(f"{API}/auth/login", json={"email": "student@demo.test", "password": "wrong"})
    assert r.status_code == 401


def test_file_uploads_keep_their_own_limit(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_json_kb", 1)  # a tiny JSON cap must not block uploads
    r = client.post(
        f"{API}/courses/{COURSE_A}/materials",
        headers=bearer(L1),
        data={"title": "Notes"},
        files={"file": ("n.pdf", samples.pdf() + b"0" * 4096, "application/pdf")},
    )
    assert r.status_code == 201


# =============================== multipart flag ===============================
@pytest.mark.parametrize(
    "raw,expected", [(None, True), ("", True), ("true", True), ("YES", True), ("0", False), ("off", False)]
)
def test_published_flag_parsing(client, db, raw, expected):
    fields = {"title": "Notes"} | ({} if raw is None else {"published": raw})
    r = client.post(
        f"{API}/courses/{COURSE_A}/materials",
        headers=bearer(L1),
        data=fields,
        files={"file": ("n.pdf", samples.pdf(), "application/pdf")},
    )
    assert r.status_code == 201 and r.json()["published"] is expected


# =============================== middleware edge cases ===============================
async def _run(asgi_app, path="/x"):
    from app.core.middleware import RequestContextMiddleware

    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    wrapped = RequestContextMiddleware(asgi_app, slow_seconds=lambda: 2.0)
    await wrapped({"type": "http", "method": "GET", "path": path, "headers": []}, receive, send)
    return sent


def test_failure_after_the_response_started_is_not_masked():
    """Once headers are on the wire a second response cannot be sent, so the error must surface."""
    import asyncio

    async def streaming_then_crash(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        raise RuntimeError("died mid-stream")

    with pytest.raises(RuntimeError, match="died mid-stream"):
        asyncio.run(_run(streaming_then_crash))


def test_non_http_scopes_pass_straight_through():
    import asyncio

    from app.core.middleware import RequestContextMiddleware, SecurityHeadersMiddleware

    seen = []

    async def inner(scope, receive, send):
        seen.append(scope["type"])

    async def go():
        scope = {"type": "lifespan"}
        await RequestContextMiddleware(inner, slow_seconds=lambda: 2.0)(scope, None, None)
        await SecurityHeadersMiddleware(inner, production=lambda: False, hsts_max_age=lambda: 1)(
            scope, None, None
        )

    asyncio.run(go())
    assert seen == ["lifespan", "lifespan"]
