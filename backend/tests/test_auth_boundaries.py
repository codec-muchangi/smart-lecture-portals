from uuid import UUID

import pytest

from app.core import security
from app.core.errors import Forbidden, NotFound
from tests.conftest import LECTURER, STUDENT


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


def test_course_access_hides_unassigned_course(monkeypatch):
    monkeypatch.setattr(security, "_exists", lambda *a, **k: False)
    with pytest.raises(NotFound):
        security.assert_course_access(LECTURER, UUID(int=9))


def test_student_cannot_use_lecturer_course_guard(monkeypatch):
    monkeypatch.setattr(security, "_exists", lambda *a, **k: True)
    with pytest.raises(Forbidden):
        security.assert_course_lecturer(STUDENT, UUID(int=9))


def test_profile_update_rejects_role_change(client, as_user):
    as_user(STUDENT)
    r = client.patch("/api/v1/me", json={"role": "lecturer"})
    assert r.status_code == 422
    assert r.json()["code"] == "VALIDATION_ERROR"
