"""Logging setup (SRS section 12: log security events without logging passwords, tokens or secrets).

A filter masks anything that looks like a bearer token, a JWT, an API key or a password assignment in every
log line, including exception traces, as a second line of defence behind "never log secrets".
"""

import logging
import re

REDACTED = "[REDACTED]"
_PATTERNS = [
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9\-._~+/]+=*"),  # Authorization header values
    re.compile(r"\beyJ[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]*"),  # JWT (access/service keys)
    re.compile(
        r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization)\b(\s*[=:]\s*)[^\s,;&}\]\"']+"
    ),
    re.compile(
        r"(?i)(\"(?:password|new_password|current_password|access_token|refresh_token)\"\s*:\s*)\"[^\"]*\""
    ),
]


def redact(text: str) -> str:
    text = _PATTERNS[0].sub(lambda m: m.group(1) + REDACTED, text)
    text = _PATTERNS[1].sub(REDACTED, text)
    text = _PATTERNS[2].sub(lambda m: m.group(1) + m.group(2) + REDACTED, text)
    return _PATTERNS[3].sub(lambda m: m.group(1) + f'"{REDACTED}"', text)


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(record.getMessage())
        record.args = None
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = redact(record.exc_text)
        return True


def configure_logging(level: str = "INFO") -> None:
    """Idempotent: safe to call every time the app is created (tests do)."""
    root = logging.getLogger()
    # httpx logs every outgoing request URL at INFO, including database filters such as emails and ids.
    for noisy in ("httpx", "httpcore", "hpack"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    root.setLevel(level.upper() if level.upper() in logging.getLevelNamesMapping() else "INFO")
    for handler in root.handlers:
        if not any(isinstance(f, RedactingFilter) for f in handler.filters):
            handler.addFilter(RedactingFilter())
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        handler.addFilter(RedactingFilter())
        root.addHandler(handler)
