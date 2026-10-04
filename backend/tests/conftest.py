from datetime import UTC, datetime, timedelta
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


def add_student(db, n: int, name: str, reg: str, status: str = "active", enroll_in: str | None = None) -> str:
    """Add an extra student (and optionally enroll them) to the fake database."""
    from uuid import UUID as _U

    uid = str(_U(int=1000 + n))
    db.auth_users[uid] = {"email": f"s{n}@demo.test", "password": PASSWORD}
    db.tables["profiles"].append(
        {
            "id": uid,
            "role": "student",
            "full_name": name,
            "email": f"s{n}@demo.test",
            "phone": "0700000000",
            "avatar_url": None,
            "created_at": "2026-09-01T00:00:00+00:00",
            "updated_at": "2026-09-01T00:00:00+00:00",
        }
    )
    db.tables["students"].append(
        {"id": uid, "registration_number": reg, "program": "BSc CS", "year_of_study": 2, "status": status}
    )
    if enroll_in:
        db.tables["course_enrollments"].append(
            {"id": f"e{n}", "course_id": enroll_in, "student_id": uid, "status": "active"}
        )
    return uid


def make_material(
    db,
    course_id=None,
    title="Week 1 Notes",
    published=True,
    file_name="notes.pdf",
    uploader=None,
    category="lecture_notes",
    deleted=False,
    with_object=True,
) -> dict:
    """Insert a material row (and its stored file) straight into the fake, bypassing the API."""
    from uuid import uuid4

    course_id = course_id or COURSE_A
    mid = str(uuid4())
    path = f"{course_id}/{mid}/{file_name}"
    row = {
        **db.defaults("materials"),  # first, so the explicit values below win
        "id": mid,
        "course_id": course_id,
        "title": title,
        "description": None,
        "category": category,
        "storage_path": path,
        "file_name": file_name,
        "mime_type": "application/pdf",
        "file_size": 10,
        "uploaded_by": uploader or L1,
        "published": published and not deleted,
    }
    if deleted:
        row["deleted_at"] = "2026-09-02T00:00:00+00:00"
    db.tables.setdefault("materials", []).append(row)
    if with_object:
        db.objects[("materials", path)] = {"data": b"%PDF-1.4 test", "content_type": "application/pdf"}
    return row


# ---- time control for deadline rules ----
NOW = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)


class Clock:
    """Mutable fake 'now'. `clock.now = ...` moves time; `clock.advance(timedelta(...))` steps it."""

    def __init__(self):
        self.now = NOW

    def advance(self, delta):
        self.now = self.now + delta


@pytest.fixture
def clock(monkeypatch):
    from app.utils import clock as clock_module

    fake = Clock()
    monkeypatch.setattr(clock_module, "utcnow", lambda: fake.now)
    return fake


def make_assignment(
    db,
    course_id=None,
    title="Assignment 1",
    due_in_days=7,
    published=True,
    closed=False,
    allow_late=False,
    max_marks=20,
    attachment_path=None,
    creator=None,
) -> dict:
    """Insert an assignment straight into the fake. Deadline is relative to the frozen NOW."""
    from datetime import timedelta
    from uuid import uuid4

    row = {
        **db.defaults("assignments"),
        "id": str(uuid4()),
        "course_id": course_id or COURSE_A,
        "title": title,
        "due_at": (NOW + timedelta(days=due_in_days)).isoformat(),
        "max_marks": max_marks,
        "allow_late": allow_late,
        "published": published,
        "closed": closed,
        "attachment_path": attachment_path,
        "created_by": creator or L1,
    }
    db.tables.setdefault("assignments", []).append(row)
    return row


def make_submission(
    db,
    assignment,
    student_id=None,
    status="submitted",
    mark=None,
    feedback=None,
    grade_released=False,
    file_name="answer.pdf",
    with_object=True,
) -> dict:
    """Insert a submission (and its stored file) straight into the fake."""
    from uuid import uuid4

    sid, upload_id = student_id or S1, str(uuid4())
    path = f"{assignment['course_id']}/{assignment['id']}/{sid}/{upload_id}/{file_name}"
    row = {
        **db.defaults("submissions"),
        "id": upload_id,
        "assignment_id": assignment["id"],
        "student_id": sid,
        "storage_path": path,
        "file_name": file_name,
        "file_size": 10,
        "submitted_at": (NOW - timedelta(hours=1)).isoformat(),
        "status": status,
        "mark": mark,
        "feedback": feedback,
        "grade_released": grade_released,
    }
    db.tables.setdefault("submissions", []).append(row)
    if with_object:
        db.objects[("submissions", path)] = {"data": b"%PDF-1.4 test", "content_type": "application/pdf"}
    return row


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

    def course(cid, code, name, status="active", year="2026/2027", semester="Semester 1"):
        return {
            "id": cid,
            "course_code": code,
            "course_name": name,
            "description": None,
            "credit_hours": 3,
            "academic_year": year,
            "semester": semester,
            "status": status,
            "created_at": now,
            "updated_at": now,
        }

    fake.tables["courses"] = [
        course(COURSE_A, "CIT 3253", "Network Administration"),
        course(COURSE_B, "CIT 3254", "Database Systems"),
    ]
    fake.tables["course_lecturers"] = [{"id": "cl1", "course_id": COURSE_A, "lecturer_id": L1}]
    fake.tables["course_enrollments"] = [
        {"id": "e1", "course_id": COURSE_A, "student_id": S1, "status": "active"}
    ]
    yield fake
    db_client.get_supabase.cache_clear()
    reset_rate_limits()
