"""Shared rate-limit dependencies for high-risk, non-auth endpoints (SRS section 12)."""

from app.core.config import get_settings
from app.core.rate_limit import rate_limit

upload_limit = rate_limit(
    "upload",
    lambda: get_settings().upload_rate_limit,
    lambda: get_settings().upload_rate_window_seconds,
    by="user",
)
report_limit = rate_limit(
    "report",
    lambda: get_settings().report_rate_limit,
    lambda: get_settings().report_rate_window_seconds,
    by="user",
)
