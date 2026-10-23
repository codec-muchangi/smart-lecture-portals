"""Small in-memory sliding-window limiter (SRS section 12: abuse protection on auth and high-risk endpoints).

Per-process only: fine for a single API instance. Move to Redis/edge limits if the API is scaled out.
Behind a proxy, run uvicorn with --proxy-headers so request.client is the real client address.

`by="ip"`   counts per client address (login, password reset: there is no session yet).
`by="user"` counts per signed-in session (uploads, reports, password change), so a whole class sharing one
            campus address does not lock each other out. The key is a hash of the token: the token itself is
            never stored or logged.
"""

import hashlib
import time
from collections import defaultdict, deque
from collections.abc import Callable
from typing import Literal

from fastapi import Request

from app.core.errors import RateLimited

_hits: dict[str, deque[float]] = defaultdict(deque)
SWEEP_EVERY = 1000  # calls between clean-ups of idle keys, so the table cannot grow without bound
_calls = 0
_longest_window = 0  # sweeping uses the longest window ever configured, so no live counter is dropped


def reset_rate_limits() -> None:
    global _calls, _longest_window
    _hits.clear()
    _calls = _longest_window = 0


def tracked_keys() -> int:
    return len(_hits)


def _sweep(now: float, horizon: float) -> None:
    for key in [k for k, q in _hits.items() if not q or now - q[-1] > horizon]:
        del _hits[key]


def _client_key(request: Request, by: Literal["ip", "user"]) -> str:
    if by == "user":
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer ") and len(auth) > 7:
            return "tok:" + hashlib.sha256(auth[7:].encode()).hexdigest()[:24]
    return "ip:" + (request.client.host if request.client else "unknown")


def rate_limit(
    name: str, limit: Callable[[], int], window: Callable[[], int], by: Literal["ip", "user"] = "ip"
):
    def dep(request: Request) -> None:
        global _calls, _longest_window
        now = time.monotonic()
        _calls += 1
        win, lim = window(), limit()
        _longest_window = max(_longest_window, win)
        if _calls % SWEEP_EVERY == 0:
            _sweep(now, _longest_window)
        q = _hits[f"{name}:{_client_key(request, by)}"]
        while q and now - q[0] > win:
            q.popleft()
        if len(q) >= lim:
            retry = max(1, int(win - (now - q[0])))
            raise RateLimited("Too many attempts. Try again later.", {"retry_after": retry})
        q.append(now)

    return dep
