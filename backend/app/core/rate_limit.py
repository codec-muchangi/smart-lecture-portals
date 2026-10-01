"""Small in-memory sliding-window limiter for auth endpoints (SRS section 12: abuse protection).

Per-process only: fine for a single API instance. Move to Redis/edge limits if the API is scaled out.
Behind a proxy, run uvicorn with --proxy-headers so request.client is the real client address.
"""

import time
from collections import defaultdict, deque
from collections.abc import Callable

from fastapi import Request

from app.core.errors import RateLimited

_hits: dict[str, deque[float]] = defaultdict(deque)


def reset_rate_limits() -> None:
    _hits.clear()


def rate_limit(name: str, limit: Callable[[], int], window: Callable[[], int]):
    def dep(request: Request) -> None:
        now = time.monotonic()
        key = f"{name}:{request.client.host if request.client else 'unknown'}"
        q, win, lim = _hits[key], window(), limit()
        while q and now - q[0] > win:
            q.popleft()
        if len(q) >= lim:
            retry = max(1, int(win - (now - q[0])))
            raise RateLimited("Too many attempts. Try again later.", {"retry_after": retry})
        q.append(now)

    return dep
