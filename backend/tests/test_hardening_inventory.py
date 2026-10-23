"""Phase 9: whole-API audits that fail when a new route breaks a rule (SRS NFR-SEC-01, PERF-02, MAIN-02).

They read the generated OpenAPI description, so any endpoint added in a later phase is checked automatically.
"""

import re
from pathlib import Path
from uuid import UUID

import pytest

from app.main import app
from tests.conftest import bearer

SPEC = app.openapi()
ROOT = Path(__file__).resolve().parent.parent.parent
OPERATIONS = [(m.upper(), p, op) for p, ops in SPEC["paths"].items() for m, op in ops.items()]

# The ONLY endpoints that work without signing in: logging in, asking for a reset link, health probes.
PUBLIC = {
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/password/reset"),
    ("GET", "/health"),
    ("GET", "/health/ready"),
}

# Lists that are not paginated, each one bounded by construction (reviewed in Phase 9). A new unpaginated
# collection must be added here on purpose, with a reason, or paginated.
BOUNDED = {
    "/api/v1/dashboard": "fixed-size summary (top-N lists)",
    "/api/v1/timetable": "date window of at most 93 days",
    "/api/v1/courses/{course_id}/attendance/me": "one student's records in one course",
    "/api/v1/courses/{course_id}/marks/me": "one student's marks in one course",
    "/api/v1/assignments/{assignment_id}/submissions/me": "at most one submission per student",
    "/api/v1/courses/{course_id}/reports/attendance": "class-sized report, complete so totals reconcile",
    "/api/v1/courses/{course_id}/reports/submissions": "class-sized report, complete so totals reconcile",
    "/api/v1/courses/{course_id}/reports/performance": "class-sized report, complete so totals reconcile",
}


def concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", str(UUID(int=7)), path)


def test_the_inventory_is_not_empty():
    assert len(OPERATIONS) >= 50


# =============================== NFR-SEC-01 ===============================
def test_only_the_reviewed_endpoints_are_public():
    public = {(m, p) for m, p, op in OPERATIONS if not op.get("security")}
    assert public == PUBLIC


@pytest.mark.parametrize(
    "method,path", [(m, p) for m, p, op in OPERATIONS if op.get("security")], ids=lambda v: str(v)
)
def test_every_protected_endpoint_rejects_a_missing_or_bad_token(client, db, method, path):
    url = concrete(path)
    assert client.request(method, url).status_code == 401
    assert (
        client.request(method, url, headers={"Authorization": "Bearer not-a-real-token"}).status_code == 401
    )


# =============================== NFR-SEC-01/06: roles ===============================
LECTURER_ONLY = [
    (m, p)
    for m, p, op in OPERATIONS
    if op.get("security") and ("/reports/" in p or p.endswith("/grade") or p.endswith("/grades/release"))
]


@pytest.mark.parametrize("method,path", LECTURER_ONLY, ids=lambda v: str(v))
def test_lecturer_only_endpoints_refuse_students(client, db, method, path):
    from tests.conftest import S1

    r = client.request(method, concrete(path), headers=bearer(S1), json={})
    assert r.status_code in (403, 422)  # refused by role, never served
    assert r.status_code != 422 or r.json()["code"] == "VALIDATION_ERROR"


# =============================== NFR-PERF-02 ===============================
def returns_a_list(op: dict) -> bool:
    """True when the success response is an array or an object whose top level is an `items` list."""
    schema = (
        ((op["responses"].get("200") or {}).get("content") or {})
        .get("application/json", {})
        .get("schema", {})
    )
    if "$ref" in schema:
        schema = SPEC["components"]["schemas"][schema["$ref"].split("/")[-1]]
    return (
        schema.get("type") == "array" or schema.get("properties", {}).get("items", {}).get("type") == "array"
    )


def test_every_collection_is_paginated_or_explicitly_bounded():
    unpaginated = []
    for method, path, op in OPERATIONS:
        names = {p["name"] for p in op.get("parameters", [])}
        if (
            method == "GET"
            and returns_a_list(op)
            and not {"page", "page_size"} <= names
            and path not in BOUNDED
        ):
            unpaginated.append(path)
    assert not unpaginated, f"paginate or add to BOUNDED with a reason: {unpaginated}"


def test_the_paginated_check_really_sees_lists():
    listed = {p for m, p, op in OPERATIONS if m == "GET" and returns_a_list(op)}
    assert "/api/v1/courses" in listed and "/api/v1/notifications" in listed and "/api/v1/timetable" in listed


def test_page_sizes_have_a_ceiling():
    for _method, path, op in OPERATIONS:
        for p in op.get("parameters", []):
            if p["name"] == "page_size":
                assert p["schema"].get("maximum") and p["schema"]["maximum"] <= 200, path
            if p["name"] == "page":
                assert p["schema"].get("minimum", 1) >= 1, path


def test_the_bounded_list_only_names_real_routes():
    paths = {p for _, p, _ in OPERATIONS}
    assert set(BOUNDED) <= paths


# =============================== NFR-MAIN-02 ===============================
def documented_routes() -> set[tuple[str, str]]:
    text = (ROOT / "docs" / "API.md").read_text()
    found = set()
    for method, path in re.findall(r"\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`(/[^`]*)`", text):
        found.add((method, re.sub(r"\{[^}]+\}", "{}", path)))
    return found


def test_every_endpoint_is_documented_in_api_md():
    documented = documented_routes()
    missing = []
    for method, path, _ in OPERATIONS:
        short = path.removeprefix("/api/v1")
        if (method, re.sub(r"\{[^}]+\}", "{}", short)) not in documented:
            missing.append(f"{method} {path}")
    assert not missing, f"document in docs/API.md: {missing}"


def test_api_md_does_not_describe_routes_that_do_not_exist():
    real = {(m, re.sub(r"\{[^}]+\}", "{}", p.removeprefix("/api/v1"))) for m, p, _ in OPERATIONS}
    ghosts = sorted(documented_routes() - real)
    assert not ghosts, f"in docs/API.md but not in the API: {ghosts}"
