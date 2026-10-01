from datetime import UTC, datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.core.rate_limit import reset_rate_limits
from app.core.security import get_current_user
from app.db import client as db_client
from app.main import app
from app.schemas.common import CurrentUser
from tests.fakes import FakeSupabase

STUDENT = CurrentUser(id=UUID(int=1), role="student", full_name="S", email="s@x.test")
LECTURER = CurrentUser(id=UUID(int=2), role="lecturer", full_name="L", email="l@x.test")

# Seeded identities for the fake database
S1, L1, S_SUSPENDED, ORPHAN, S2 = (str(UUID(int=i)) for i in (1, 2, 3, 4, 5))
COURSE_A, COURSE_B = str(UUID(int=100)), str(UUID(int=101))
PASSWORD = "Passw0rd123"


def bearer(uid: str) -> dict:
    return {"Authorization": f"Bearer tok-{uid}"}


@pytest.fixture
def client():
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def as_user(client):
    def _set(user: CurrentUser):
        app.dependency_overrides[get_current_user] = lambda: user

    return _set


@pytest.fixture
def db(monkeypatch):
    """Fake Supabase wired in where the app creates its clients. Seeded with two courses, two students,
    one lecturer (assigned to course A only), a suspended student and an auth user with no profile."""
    fake = FakeSupabase()
    monkeypatch.setattr(db_client, "create_client", lambda *a, **k: fake)
    db_client.get_supabase.cache_clear()
    reset_rate_limits()
    now = datetime(2026, 9, 1, tzinfo=UTC).isoformat()

    def person(uid, role, name, email):
        fake.auth_users[uid] = {"email": email, "password": PASSWORD}
        fake.tables.setdefault("profiles", []).append(
            {
                "id": uid,
                "role": role,
                "full_name": name,
                "email": email,
                "phone": None,
                "avatar_url": None,
                "created_at": now,
                "updated_at": now,
            }
        )

    person(S1, "student", "Demo Student", "student@demo.test")
    person(S2, "student", "Other Student", "other@demo.test")
    person(S_SUSPENDED, "student", "Suspended Student", "suspended@demo.test")
    person(L1, "lecturer", "Demo Lecturer", "lecturer@demo.test")
    fake.auth_users[ORPHAN] = {"email": "orphan@demo.test", "password": PASSWORD}
    fake.tables["students"] = [
        {
            "id": S1,
            "registration_number": "STU001",
            "program": "BSc CS",
            "year_of_study": 3,
            "status": "active",
        },
        {
            "id": S2,
            "registration_number": "STU002",
            "program": "BSc CS",
            "year_of_study": 2,
            "status": "active",
        },
        {
            "id": S_SUSPENDED,
            "registration_number": "STU003",
            "program": None,
            "year_of_study": None,
            "status": "suspended",
        },
    ]
    fake.tables["lecturers"] = [
        {"id": L1, "staff_number": "LEC001", "department": "CS", "title": "Dr.", "status": "active"}
    ]
    fake.tables["courses"] = [
        {
            "id": COURSE_A,
            "course_code": "CIT 3253",
            "course_name": "Network Administration",
            "status": "active",
        },
        {"id": COURSE_B, "course_code": "CIT 3254", "course_name": "Database Systems", "status": "active"},
    ]
    fake.tables["course_lecturers"] = [{"id": "cl1", "course_id": COURSE_A, "lecturer_id": L1}]
    fake.tables["course_enrollments"] = [
        {"id": "e1", "course_id": COURSE_A, "student_id": S1, "status": "active"}
    ]
    yield fake
    db_client.get_supabase.cache_clear()
    reset_rate_limits()
