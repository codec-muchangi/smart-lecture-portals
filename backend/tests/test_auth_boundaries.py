from uuid import UUID

import pytest

from app.core import security
from app.core.errors import Forbidden, NotFound
from app.schemas.common import CurrentUser
from tests.conftest import COURSE_A, COURSE_B, L1, LECTURER, STUDENT

LECTURER_USER = CurrentUser(
    id=UUID(L1), role="lecturer", full_name="Demo Lecturer", email="lecturer@demo.test"
)


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_protected_endpoint_requires_auth(client):
    r = client.get("/api/v1/me")
    assert r.status_code == 401
    assert r.json()["code"] == "UNAUTHENTICATED"


def test_require_role_blocks_wrong_role():
    with pytest.raises(Forbidden):
        security.require_lecturer(STUDENT)
    assert security.require_lecturer(LECTURER) is LECTURER


def test_course_access_hides_unassigned_course(db):
    with pytest.raises(NotFound):
        security.assert_course_access(LECTURER_USER, UUID(COURSE_B))


def test_student_cannot_use_lecturer_course_guard(db):
    with pytest.raises(Forbidden):
        security.assert_course_lecturer(STUDENT, UUID(COURSE_A))


def test_profile_update_rejects_role_change(client, as_user):
    as_user(STUDENT)
    r = client.patch("/api/v1/me", json={"role": "lecturer"})
    assert r.status_code == 422
    assert r.json()["code"] == "VALIDATION_ERROR"
