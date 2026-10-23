"""Request-level hardening (SRS section 12, NFR-SEC-05, NFR-PERF-01, NFR-REL-02).

* `SecurityHeadersMiddleware`  adds browser-hardening headers to every response (also errors).
* `RequestContextMiddleware`   gives every request an id, writes one access-log line (no query string, no
  headers, no body, so no tokens or passwords), warns about slow requests, and turns an unexpected exception
  into the standard JSON 500 that carries the request id, so a support request can be traced in the logs.

Both are plain ASGI middlewares (no response buffering).
"""

import json
import logging
import re
import time
import uuid
from collections.abc import Callable

from app.core.errors import body_for

log = logging.getLogger("app.access")
error_log = logging.getLogger("app")

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._\-]{8,64}$")
DOC_PATHS = ("/docs", "/redoc", "/openapi.json")


def new_request_id(incoming: str | None) -> str:
    """Keep a caller-supplied id only when it is a harmless token, otherwise make a fresh one."""
    return incoming if incoming and REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex


class SecurityHeadersMiddleware:
    """Static, safe-by-default headers. The API returns JSON only, so the content-security-policy can forbid
    everything; the interactive docs page (non-production only) needs scripts and styles and is excluded."""

    def __init__(self, app, production: Callable[[], bool], hsts_max_age: Callable[[], int]):
        self.app, self.production, self.hsts_max_age = app, production, hsts_max_age

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_doc = scope["path"].startswith(DOC_PATHS)

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                present = {k.lower() for k, _ in headers}
                add = {
                    b"x-content-type-options": b"nosniff",
                    b"x-frame-options": b"DENY",
                    b"referrer-policy": b"no-referrer",
                    b"permissions-policy": b"camera=(), microphone=(), geolocation=()",
                    b"cross-origin-resource-policy": b"same-site",
                }
                if not is_doc:
                    add[b"content-security-policy"] = b"default-src 'none'; frame-ancestors 'none'"
                    add[b"cache-control"] = b"no-store"  # personal data and signed links are never cached
                if self.production():
                    add[b"strict-transport-security"] = f"max-age={self.hsts_max_age()}".encode()
                headers.extend((k, v) for k, v in add.items() if k not in present)
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RequestContextMiddleware:
    def __init__(self, app, slow_seconds: Callable[[], float]):
        self.app, self.slow_seconds = app, slow_seconds

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = dict(scope["headers"]).get(b"x-request-id", b"").decode("latin-1") or None
        request_id = new_request_id(incoming)
        scope.setdefault("state", {})["request_id"] = request_id
        started = time.perf_counter()
        status = {"code": 500, "started": False}

        async def send_with_id(message):
            if message["type"] == "http.response.start":
                status["code"], status["started"] = message["status"], True
                message.setdefault("headers", []).append((b"x-request-id", request_id.encode()))
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception:
            if status["started"]:  # a response is already on its way: nothing sensible can be added
                raise
            error_log.exception("Unhandled error [request_id=%s]", request_id)
            payload = json.dumps(
                body_for("INTERNAL_ERROR", "Something went wrong", {"request_id": request_id})
            ).encode()
            await send_with_id(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(payload)).encode()),
                    ],
                }
            )
            await send_with_id({"type": "http.response.body", "body": payload})
        finally:
            elapsed = time.perf_counter() - started
            line = "%s %s -> %s in %.0f ms [request_id=%s]"
            args = (scope["method"], scope["path"], status["code"], elapsed * 1000, request_id)
            if elapsed >= self.slow_seconds():
                log.warning("SLOW " + line, *args)
            else:
                log.info(line, *args)
