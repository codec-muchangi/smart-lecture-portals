"""Reject oversized request bodies early, from the Content-Length header, before the body is read or buffered.

Best effort: a client that omits Content-Length (chunked upload) is still stopped by the exact post-read size
check in the service layer. Production deployments should also cap body size at the reverse proxy.
"""

from collections.abc import Callable

from fastapi.responses import JSONResponse

OVERHEAD_BYTES = 1024 * 1024  # multipart framing and the other form fields


class UploadSizeLimitMiddleware:
    """Files: the configured upload size. Everything else (JSON): `max_json_bytes`, so a client cannot make
    the server buffer a huge JSON document (SRS 12: validate and bound all input)."""

    def __init__(
        self, app, max_file_bytes: Callable[[], int], max_json_bytes: Callable[[], int] | None = None
    ):
        self.app = app
        self.max_file_bytes = max_file_bytes
        self.max_json_bytes = max_json_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] in ("POST", "PUT", "PATCH"):
            headers = dict(scope["headers"])
            raw = headers.get(b"content-length")
            is_file = headers.get(b"content-type", b"").lower().startswith(b"multipart/")
            if (
                self.max_json_bytes
                and not is_file
                and raw
                and raw.isdigit()
                and int(raw) > self.max_json_bytes()
            ):
                response = JSONResponse(
                    {
                        "code": "PAYLOAD_TOO_LARGE",
                        "message": "Request body is too large",
                        "details": {"max_kb": self.max_json_bytes() // 1024},
                    },
                    status_code=413,
                )
                await response(scope, receive, send)
                return
            if raw and raw.isdigit() and int(raw) > self.max_file_bytes() + OVERHEAD_BYTES:
                limit_mb = self.max_file_bytes() // (1024 * 1024)
                response = JSONResponse(
                    {
                        "code": "FILE_TOO_LARGE",
                        "message": f"Request is larger than the {limit_mb} MB upload limit",
                        "details": {"max_mb": limit_mb},
                    },
                    status_code=400,
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
