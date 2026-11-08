"""Profile photo upload: POST/DELETE /api/v1/me/avatar."""

import pytest

from app.repositories import profile_repository
from app.services import storage_service
from tests.conftest import S1, bearer

BASE = "https://proj.supabase.co/storage/v1/object/public"
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"0" * 64
TOO_BIG = JPEG + b"0" * (2 * 1024 * 1024)


@pytest.fixture
def store(monkeypatch):
    """In-memory stand-in for the avatars bucket."""
    objects = {}

    def upload(bucket, path, data, content_type):
        objects[(bucket, path)] = (data, content_type)

    def remove(bucket, path):
        objects.pop((bucket, path), None)

    monkeypatch.setattr(storage_service, "upload_object", upload)
    monkeypatch.setattr(storage_service, "remove_object", remove)
    monkeypatch.setattr(storage_service, "public_url", lambda bucket, path: f"{BASE}/{bucket}/{path}")
    return objects


def send(client, data, name="me.jpg", mime="image/jpeg"):
    return client.post("/api/v1/me/avatar", headers=bearer(S1), files={"file": (name, data, mime)})


def current_avatar(client):
    return client.get("/api/v1/me", headers=bearer(S1)).json()["avatar_url"]


@pytest.mark.parametrize(
    "data,ext,mime",
    [(JPEG, "jpg", "image/jpeg"), (PNG, "png", "image/png"), (WEBP, "webp", "image/webp")],
)
def test_valid_photo_is_stored_and_saved(client, db, store, data, ext, mime):
    # The client always claims "me.jpg"; the server decides the type from the bytes.
    r = send(client, data)
    assert r.status_code == 200
    url = r.json()["avatar_url"]
    assert url.startswith(f"{BASE}/avatars/{S1}/") and url.endswith(f".{ext}")
    assert list(store.values()) == [(data, mime)]
    assert current_avatar(client) == url


def test_new_photo_replaces_and_deletes_the_old_one(client, db, store):
    first = send(client, JPEG).json()["avatar_url"]
    second = send(client, PNG).json()["avatar_url"]
    assert first != second and second.endswith(".png")
    assert len(store) == 1


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(b"", id="empty"),
        pytest.param(b"just text pretending to be a photo", id="text"),
        pytest.param(b"%PDF-1.4 not an image", id="pdf"),
        pytest.param(TOO_BIG, id="too-big"),
    ],
)
def test_bad_files_are_rejected_and_nothing_is_stored(client, db, store, data):
    r = send(client, data, name="x.png", mime="image/png")
    assert 400 <= r.status_code < 500
    assert store == {}
    assert current_avatar(client) is None


def test_failed_save_removes_the_new_file(client, db, store, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(profile_repository, "update_profile", boom)
    try:
        r = send(client, JPEG)
        assert r.status_code == 500
    except RuntimeError:
        pass
    assert store == {}


def test_remove_photo_clears_the_link_and_the_file(client, db, store):
    send(client, JPEG)
    r = client.delete("/api/v1/me/avatar", headers=bearer(S1))
    assert r.status_code == 200 and r.json()["avatar_url"] is None
    assert store == {}
    assert current_avatar(client) is None


def test_remove_without_a_photo_is_harmless(client, db, store):
    r = client.delete("/api/v1/me/avatar", headers=bearer(S1))
    assert r.status_code == 200 and r.json()["avatar_url"] is None


def test_upload_requires_authentication(client, db, store):
    r = client.post("/api/v1/me/avatar", files={"file": ("a.jpg", JPEG, "image/jpeg")})
    assert r.status_code == 401
    assert store == {}
