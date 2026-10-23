import logging

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("app")


class AppError(Exception):
    status_code = 400
    code = "BAD_REQUEST"

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.message, self.details = message, details or {}


class Unauthenticated(AppError):
    status_code, code = 401, "UNAUTHENTICATED"


class Forbidden(AppError):
    status_code, code = 403, "FORBIDDEN"


class NotFound(AppError):
    status_code, code = 404, "NOT_FOUND"


class Conflict(AppError):
    status_code, code = 409, "CONFLICT"


class ValidationFailed(AppError):
    status_code, code = 400, "VALIDATION_ERROR"


class FileTooLarge(AppError):
    status_code, code = 400, "FILE_TOO_LARGE"


class FileTypeNotAllowed(AppError):
    status_code, code = 400, "FILE_TYPE_NOT_ALLOWED"


class MarkOutOfRange(AppError):
    status_code, code = 400, "MARK_OUT_OF_RANGE"


class DeadlinePassed(AppError):
    status_code, code = 400, "DEADLINE_PASSED"


class RateLimited(AppError):
    status_code, code = 429, "RATE_LIMITED"


class ServiceUnavailable(AppError):
    status_code, code = 503, "SERVICE_UNAVAILABLE"


def body_for(code: str, message: str, details: dict | None = None) -> dict:
    return {"code": code, "message": message, "details": details or {}}


_body = body_for
security_log = logging.getLogger("app.security")
SECURITY_STATUSES = {401, 403, 429}


def _note_security_event(request: Request, status: int, code: str) -> None:
    """One WARNING line per refused request (who, where, why), never the headers, body or query string."""
    if status in SECURITY_STATUSES:
        client = request.client.host if request.client else "unknown"
        security_log.warning(
            "refused %s %s -> %s %s client=%s request_id=%s",
            request.method,
            request.url.path,
            status,
            code,
            client,
            getattr(request.state, "request_id", "-"),
        )


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError):
        _note_security_event(request, exc.status_code, exc.code)
        headers = {"Retry-After": str(exc.details["retry_after"])} if isinstance(exc, RateLimited) else None
        return JSONResponse(
            _body(exc.code, exc.message, exc.details), status_code=exc.status_code, headers=headers
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        fields = {".".join(str(p) for p in e["loc"] if p != "body"): e["msg"] for e in exc.errors()}
        return JSONResponse(_body("VALIDATION_ERROR", "Invalid request", fields), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        code = {
            401: "UNAUTHENTICATED",
            403: "FORBIDDEN",
            404: "NOT_FOUND",
            405: "METHOD_NOT_ALLOWED",
            413: "PAYLOAD_TOO_LARGE",
            429: "RATE_LIMITED",
        }.get(exc.status_code, "HTTP_ERROR")
        _note_security_event(request, exc.status_code, code)
        return JSONResponse(_body(code, str(exc.detail)), status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(httpx.TransportError)
    async def upstream_unreachable(request: Request, exc: httpx.TransportError):
        """Supabase (database, auth or storage) is unreachable: tell the client to retry (NFR-REL-02)."""
        log.error(
            "Upstream unreachable: %s [request_id=%s]",
            type(exc).__name__,
            getattr(request.state, "request_id", "-"),
        )
        return JSONResponse(
            _body("SERVICE_UNAVAILABLE", "The service is temporarily unavailable. Please try again."),
            status_code=503,
            headers={"Retry-After": "5"},
        )

    # Unexpected exceptions are answered by RequestContextMiddleware (app/core/middleware.py) so that the 500
    # also carries the security headers, the CORS headers and the request id.
