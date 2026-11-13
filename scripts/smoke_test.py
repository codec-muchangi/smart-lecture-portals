"""Post-deployment smoke test: proves a running API is alive, safe and wired to its database
(SRS 17.1 performance smoke tests, 18, 21 definition of done). Standard library only, so it runs anywhere.

  python scripts/smoke_test.py --api https://your-api.onrender.com \
      --frontend-origin https://your-app.vercel.app --expect-production

Optional end-to-end login checks (AT-01..AT-04), with accounts that exist on THAT server (for example the
demo accounts on a demo environment). Passwords are read from the environment or prompted, never typed on
the command line:
  $env:SMOKE_STUDENT_PASSWORD="..." ; $env:SMOKE_LECTURER_PASSWORD="..."
  python scripts/smoke_test.py --api ... --frontend-origin ... --student-email ... --lecturer-email ...

Exit status 0 = every check passed. Free hosting plans sleep when idle: the first call can take about a
minute, so the default timeout is generous (--timeout).
"""

import argparse
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field

API = "/api/v1"


@dataclass
class Reply:
    status: int
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b""

    def json(self):
        try:
            return json.loads(self.body or b"null")
        except ValueError:
            return None


Fetch = Callable[..., Reply]


def http_fetch(timeout: float) -> Fetch:
    """The real network fetch (standard library). Non-2xx answers are returned, not raised."""

    def fetch(method: str, url: str, headers: dict | None = None, body: dict | None = None) -> Reply:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(url, data=data, method=method, headers=headers or {})
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                lowered = {k.lower(): v for k, v in response.headers.items()}
                return Reply(response.status, lowered, response.read())
        except urllib.error.HTTPError as exc:
            return Reply(exc.code, {k.lower(): v for k, v in exc.headers.items()}, exc.read())

    return fetch


class Smoke:
    def __init__(self, base: str, fetch: Fetch, origin: str | None, production: bool, out=print):
        self.base = base.rstrip("/")
        self.fetch, self.origin, self.production, self.out = fetch, origin, production, out
        self.failures = 0
        self.checks = 0

    def record(self, name: str, ok: bool, detail: str = "") -> bool:
        self.checks += 1
        self.failures += 0 if ok else 1
        self.out(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail and not ok else ""))
        return ok

    def call(self, method: str, path: str, token=None, body=None, headers=None) -> Reply:
        sent = dict(headers or {})
        if token:
            sent["Authorization"] = f"Bearer {token}"
        return self.fetch(method, self.base + path, sent, body)

    def run_public(self) -> None:
        self.out("Public checks")
        host = self.base.split("://", 1)[-1]
        local = host.startswith(("localhost", "127.0.0.1", "testserver"))
        https_ok = self.base.startswith("https://") or local
        self.record("API address uses HTTPS (SRS 12)", https_ok, "use an https:// address in production")

        health = self.call("GET", "/health")
        alive = health.status == 200 and health.json() == {"status": "ok"}
        self.record("GET /health is alive", alive, f"status {health.status}")
        ready = self.call("GET", "/health/ready")
        self.record("GET /health/ready: database reachable", ready.status == 200, f"status {ready.status}")

        h = health.headers
        headers_ok = h.get("x-content-type-options") == "nosniff" and h.get("x-frame-options") == "DENY"
        self.record("security headers present", headers_ok, str(sorted(h)))
        self.record("every response carries X-Request-ID", bool(h.get("x-request-id")))
        if self.production:
            self.record("HSTS is sent in production", "strict-transport-security" in h)
            for path in ("/docs", "/redoc", "/openapi.json"):
                self.record(f"{path} is not published in production", self.call("GET", path).status == 404)

        me = self.call("GET", f"{API}/me")
        refused = me.status == 401 and (me.json() or {}).get("code") == "UNAUTHENTICATED"
        self.record("GET /me without a token is refused (401)", refused, f"status {me.status}")
        creds = {"email": "nobody@smoke-test.invalid", "password": "wrong-password-1"}
        bad = self.call("POST", f"{API}/auth/login", body=creds)
        self.record("a wrong login is refused (401), never an error page", bad.status == 401, f"{bad.status}")

        if self.origin:
            ask = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization"}
            good = self.call("OPTIONS", f"{API}/auth/login", headers={"Origin": self.origin, **ask})
            got = good.headers.get("access-control-allow-origin")
            self.record("CORS allows the front-end origin", got == self.origin, f"got {got!r}")
            evil = self.call("OPTIONS", f"{API}/auth/login", headers={"Origin": "https://evil.example", **ask})
            self.record("CORS refuses other origins", "access-control-allow-origin" not in evil.headers)

    def login(self, email: str, password: str) -> tuple[str | None, dict]:
        r = self.call("POST", f"{API}/auth/login", body={"email": email, "password": password})
        data = r.json() or {}
        return (data.get("access_token") if r.status == 200 else None), data

    def run_student(self, email: str, password: str) -> None:
        self.out(f"Student journey ({email})")
        token, data = self.login(email, password)
        if not self.record("AT-01 student can log in", token is not None and data["user"]["role"] == "student"):
            return
        dash = self.call("GET", f"{API}/dashboard", token)
        self.record("AT-01 student dashboard loads", dash.status == 200, f"status {dash.status}")
        for path in ("/courses", "/timetable", "/notifications"):
            self.record(f"GET {path} works", self.call("GET", API + path, token).status == 200)
        items = (self.call("GET", f"{API}/courses", token).json() or {}).get("items", [])
        if items:
            r = self.call("GET", f"{API}/courses/{items[0]['id']}/reports/attendance", token)
            self.record("AT-03 student cannot open a lecturer-only report", r.status in (403, 404), f"{r.status}")
        self.record("logout works", self.call("POST", f"{API}/auth/logout", token).status in (200, 204))

    def run_lecturer(self, email: str, password: str) -> None:
        self.out(f"Lecturer journey ({email})")
        token, data = self.login(email, password)
        if not self.record("AT-02 lecturer can log in", token is not None and data["user"]["role"] == "lecturer"):
            return
        dash = self.call("GET", f"{API}/dashboard", token)
        self.record("AT-02 lecturer dashboard loads", dash.status == 200, f"status {dash.status}")
        items = (self.call("GET", f"{API}/courses", token).json() or {}).get("items", [])
        self.record("lecturer sees assigned courses", len(items) > 0, "no course is assigned to this account")
        if items:
            for kind in ("attendance", "submissions", "performance"):
                r = self.call("GET", f"{API}/courses/{items[0]['id']}/reports/{kind}", token)
                self.record(f"{kind} report loads", r.status == 200, f"status {r.status}")
        self.record("logout works", self.call("POST", f"{API}/auth/logout", token).status in (200, 204))


def main(argv: list[str] | None = None, fetch: Fetch | None = None) -> int:
    ap = argparse.ArgumentParser(description="Smoke-test a deployed Smart Lecture Portal API.")
    ap.add_argument("--api", required=True, help="API address without /api/v1")
    ap.add_argument("--frontend-origin", help="exact front-end origin, e.g. https://your-app.vercel.app")
    ap.add_argument("--expect-production", action="store_true", help="also require HSTS and no public /docs")
    ap.add_argument("--student-email")
    ap.add_argument("--lecturer-email")
    ap.add_argument("--timeout", type=float, default=90.0, help="seconds per request (default 90)")
    args = ap.parse_args(argv)

    smoke = Smoke(args.api, fetch or http_fetch(args.timeout), args.frontend_origin, args.expect_production)
    started = time.perf_counter()
    smoke.run_public()
    journeys = (
        ("student", args.student_email, "SMOKE_STUDENT_PASSWORD", smoke.run_student),
        ("lecturer", args.lecturer_email, "SMOKE_LECTURER_PASSWORD", smoke.run_lecturer),
    )
    for who, email, env_name, runner in journeys:
        if email:
            runner(email, os.environ.get(env_name) or getpass.getpass(f"Password for the {who} account: "))
    passed, seconds = smoke.checks - smoke.failures, time.perf_counter() - started
    print(f"{passed}/{smoke.checks} checks passed in {seconds:.1f}s")
    if smoke.failures:
        print("SMOKE TEST FAILED: fix the [FAIL] lines above (docs/DEPLOYMENT.md, 'If something fails').")
        return 1
    print("SMOKE TEST PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
