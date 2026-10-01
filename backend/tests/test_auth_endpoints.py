from app.core.config import get_settings
from tests.conftest import L1, PASSWORD, S1, bearer

LOGIN = "/api/v1/auth/login"


# ---------- login ----------
def test_login_returns_tokens_and_role_and_audits(client, db):
    r = client.post(
        LOGIN, json={"email": "Student@Demo.test", "password": PASSWORD}
    )  # email case-insensitive
    assert r.status_code == 200
    body = r.json()
    assert body["access_token"] and body["refresh_token"] and body["token_type"] == "bearer"
    assert body["user"] == {"id": S1, "role": "student", "full_name": "Demo Student"}
    assert len(db.audit("auth.login")) == 1
    # the issued token really works
    assert (
        client.get("/api/v1/me", headers={"Authorization": f"Bearer {body['access_token']}"}).status_code
        == 200
    )


def test_wrong_password_and_unknown_email_look_identical(client, db):
    a = client.post(LOGIN, json={"email": "student@demo.test", "password": "wrong"})
    b = client.post(LOGIN, json={"email": "nobody@demo.test", "password": "wrong"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()  # no account enumeration
    assert a.json()["message"] == "Invalid email or password"


def test_login_without_profile_gets_no_tokens(client, db):
    r = client.post(LOGIN, json={"email": "orphan@demo.test", "password": PASSWORD})
    assert r.status_code == 403 and "access_token" not in r.text


def test_login_for_suspended_account_is_denied_and_audited(client, db):
    r = client.post(LOGIN, json={"email": "suspended@demo.test", "password": PASSWORD})
    assert r.status_code == 403 and "access_token" not in r.text
    assert len(db.audit("auth.login_denied")) == 1


def test_login_provider_outage_is_503_not_401(client, db):
    db.auth_down = True
    r = client.post(LOGIN, json={"email": "student@demo.test", "password": PASSWORD})
    assert r.status_code == 503 and r.json()["code"] == "SERVICE_UNAVAILABLE"


def test_login_validates_input_shape(client, db):
    assert client.post(LOGIN, json={"email": "not-an-email", "password": "x"}).status_code == 422
    assert client.post(LOGIN, json={"email": "a@b.test"}).status_code == 422


def test_login_is_rate_limited(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "login_rate_limit", 3)
    for _ in range(3):
        assert client.post(LOGIN, json={"email": "student@demo.test", "password": "bad"}).status_code == 401
    r = client.post(LOGIN, json={"email": "student@demo.test", "password": PASSWORD})
    assert r.status_code == 429 and r.json()["code"] == "RATE_LIMITED"
    assert int(r.headers["Retry-After"]) >= 1


def test_login_never_logs_password_in_audit(client, db):
    client.post(LOGIN, json={"email": "student@demo.test", "password": PASSWORD})
    assert PASSWORD not in str(db.tables.get("audit_logs"))


# ---------- logout ----------
def test_logout_revokes_the_token(client, db):
    assert client.post("/api/v1/auth/logout", headers=bearer(S1)).status_code == 204
    assert client.get("/api/v1/me", headers=bearer(S1)).status_code == 401
    assert len(db.audit("auth.logout")) == 1


def test_logout_requires_authentication(client, db):
    assert client.post("/api/v1/auth/logout").status_code == 401


# ---------- change password ----------
CHANGE = "/api/v1/auth/password/change"


def test_change_password_success(client, db):
    r = client.post(
        CHANGE, headers=bearer(S1), json={"current_password": PASSWORD, "new_password": "NewPass456"}
    )
    assert r.status_code == 204
    assert db.auth_users[S1]["password"] == "NewPass456"
    assert (
        client.post(LOGIN, json={"email": "student@demo.test", "password": "NewPass456"}).status_code == 200
    )
    assert client.post(LOGIN, json={"email": "student@demo.test", "password": PASSWORD}).status_code == 401
    assert len(db.audit("auth.password_change")) == 1
    assert "NewPass456" not in str(db.tables.get("audit_logs"))


def test_wrong_current_password_is_rejected(client, db):
    r = client.post(
        CHANGE, headers=bearer(S1), json={"current_password": "nope", "new_password": "NewPass456"}
    )
    assert r.status_code == 400 and "current_password" in r.json()["details"]
    assert db.auth_users[S1]["password"] == PASSWORD


def test_weak_or_unchanged_new_password_is_rejected(client, db):
    for bad in ("short1", "onlyletters", "12345678", PASSWORD):
        r = client.post(CHANGE, headers=bearer(S1), json={"current_password": PASSWORD, "new_password": bad})
        assert r.status_code == 400 and "new_password" in r.json()["details"], bad
    assert db.auth_users[S1]["password"] == PASSWORD


def test_provider_policy_rejection_is_reported(client, db):
    db.reject_password_updates = True
    r = client.post(
        CHANGE, headers=bearer(S1), json={"current_password": PASSWORD, "new_password": "NewPass456"}
    )
    assert r.status_code == 400 and "new_password" in r.json()["details"]


def test_change_password_requires_authentication(client, db):
    assert client.post(CHANGE, json={"current_password": "a", "new_password": "b"}).status_code == 401


def test_user_can_only_change_own_password(client, db):
    client.post(CHANGE, headers=bearer(S1), json={"current_password": PASSWORD, "new_password": "NewPass456"})
    assert db.auth_users[L1]["password"] == PASSWORD


# ---------- reset ----------
RESET = "/api/v1/auth/password/reset"


def test_reset_same_response_for_known_and_unknown_email(client, db):
    a = client.post(RESET, json={"email": "student@demo.test"})
    b = client.post(RESET, json={"email": "ghost@demo.test"})
    assert a.status_code == b.status_code == 202 and a.json() == b.json()
    assert db.reset_requests[0][0] == "student@demo.test"
    assert db.reset_requests[0][1]["redirect_to"] == get_settings().password_reset_redirect_url


def test_reset_hides_provider_failures(client, db):
    db.auth_down = True
    assert client.post(RESET, json={"email": "student@demo.test"}).status_code == 202


def test_reset_is_rate_limited(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "reset_rate_limit", 2)
    for _ in range(2):
        assert client.post(RESET, json={"email": "a@b.test"}).status_code == 202
    assert client.post(RESET, json={"email": "a@b.test"}).status_code == 429
