import pytest

from tests.conftest import L1, ORPHAN, S1, S2, S_SUSPENDED, bearer


def profile_row(db, uid):
    return next(r for r in db.tables["profiles"] if r["id"] == uid)


# ---------- reading ----------
def test_student_reads_own_profile_with_role_details(client, db):
    r = client.get("/api/v1/me", headers=bearer(S1))
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == S1 and body["role"] == "student"
    assert body["details"]["registration_number"] == "STU001"
    assert "password" not in body


def test_lecturer_profile_shows_staff_details(client, db):
    body = client.get("/api/v1/me", headers=bearer(L1)).json()
    assert body["role"] == "lecturer" and body["details"]["staff_number"] == "LEC001"


# ---------- authentication / account state ----------
def test_no_token_is_401(client, db):
    assert client.get("/api/v1/me").status_code == 401


def test_invalid_token_is_401(client, db):
    r = client.get("/api/v1/me", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401 and r.json()["code"] == "UNAUTHENTICATED"


def test_suspended_account_is_403(client, db):
    r = client.get("/api/v1/me", headers=bearer(S_SUSPENDED))
    assert r.status_code == 403 and r.json()["code"] == "FORBIDDEN"


def test_auth_user_without_profile_is_403(client, db):
    assert client.get("/api/v1/me", headers=bearer(ORPHAN)).status_code == 403


# ---------- updating: allowed ----------
def test_update_name_and_phone_persists_and_is_audited(client, db):
    r = client.patch(
        "/api/v1/me", headers=bearer(S1), json={"full_name": "  Jane Doe  ", "phone": "+254 700 123456"}
    )
    assert r.status_code == 200
    assert r.json()["full_name"] == "Jane Doe"  # whitespace trimmed
    assert profile_row(db, S1)["phone"] == "+254 700 123456"
    log = db.audit("profile.update")
    assert len(log) == 1
    assert log[0]["actor_user_id"] == S1
    assert (
        log[0]["old_value"]["full_name"] == "Demo Student" and log[0]["new_value"]["full_name"] == "Jane Doe"
    )


def test_null_phone_clears_value(client, db):
    client.patch("/api/v1/me", headers=bearer(S1), json={"phone": "0700123456"})
    r = client.patch("/api/v1/me", headers=bearer(S1), json={"phone": None})
    assert r.status_code == 200 and r.json()["phone"] is None


def test_unchanged_values_write_no_audit_row(client, db):
    client.patch("/api/v1/me", headers=bearer(S1), json={"full_name": "Demo Student"})
    assert db.audit("profile.update") == []


def test_update_only_touches_the_caller(client, db):
    client.patch("/api/v1/me", headers=bearer(S1), json={"full_name": "Changed Name"})
    assert profile_row(db, S2)["full_name"] == "Other Student"


# ---------- updating: forbidden fields (privilege escalation / identity tampering) ----------
@pytest.mark.parametrize(
    "payload",
    [
        {"role": "lecturer"},
        {"email": "hacker@x.test"},
        {"id": "00000000-0000-0000-0000-000000000099"},
        {"registration_number": "STU999"},
        {"staff_number": "LEC999"},
        {"status": "active"},
        {"full_name": "Ok Name", "role": "lecturer"},
    ],
)
def test_protected_fields_are_rejected(client, db, payload):
    r = client.patch("/api/v1/me", headers=bearer(S1), json=payload)
    assert r.status_code == 422 and r.json()["code"] == "VALIDATION_ERROR"
    row = profile_row(db, S1)
    assert (
        row["role"] == "student"
        and row["email"] == "student@demo.test"
        and row["full_name"] == "Demo Student"
    )


# ---------- updating: validation ----------
@pytest.mark.parametrize(
    "payload,field",
    [
        ({"full_name": None}, "full_name"),
        ({"full_name": "A"}, "full_name"),
        ({"full_name": "x" * 121}, "full_name"),
        ({"full_name": "Bad\x00Name"}, "full_name"),
        ({"phone": "abc"}, "phone"),
        ({"phone": "123"}, "phone"),
        ({"avatar_url": "http://insecure.test/a.png"}, "avatar_url"),
        ({"avatar_url": "javascript:alert(1)"}, "avatar_url"),
    ],
)
def test_invalid_values_return_field_level_errors(client, db, payload, field):
    r = client.patch("/api/v1/me", headers=bearer(S1), json=payload)
    assert r.status_code == 422
    assert field in r.json()["details"]


def test_https_avatar_is_accepted(client, db):
    r = client.patch("/api/v1/me", headers=bearer(S1), json={"avatar_url": "https://cdn.test/a.png"})
    assert r.status_code == 200 and r.json()["avatar_url"] == "https://cdn.test/a.png"


def test_empty_body_is_400(client, db):
    r = client.patch("/api/v1/me", headers=bearer(S1), json={})
    assert r.status_code == 400 and r.json()["code"] == "VALIDATION_ERROR"


def test_update_requires_authentication(client, db):
    assert client.patch("/api/v1/me", json={"full_name": "Nope Nope"}).status_code == 401
