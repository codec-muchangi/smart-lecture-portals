from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.main import app
from app.schemas.common import CurrentUser

STUDENT = CurrentUser(id=UUID(int=1), role="student", full_name="S", email="s@x.test")
LECTURER = CurrentUser(id=UUID(int=2), role="lecturer", full_name="L", email="l@x.test")


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
