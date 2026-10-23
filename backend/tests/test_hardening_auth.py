"""Phase 9: authentication provider failures are clear, retryable and never half-done (NFR-REL-02)."""

import logging

from tests.conftest import PASSWORD, S1, bearer

API = "/api/v1"


def test_logout_failure_is_a_503_and_the_token_stays_valid(client, db, monkeypatch, caplog):
    def boom(*_a, **_k):
        raise RuntimeError("provider exploded with secret-detail")

    monkeypatch.setattr(db.auth.admin, "sign_out", boom)
    with caplog.at_level(logging.ERROR, logger="app"):
        r = client.post(f"{API}/auth/logout", headers=bearer(S1))
    assert (
        r.status_code == 503 and r.json()["code"] == "SERVICE_UNAVAILABLE" and "secret-detail" not in r.text
    )
    assert not db.audit("auth.logout")
    assert client.get(f"{API}/me", headers=bearer(S1)).status_code == 200  # not silently logged out


def test_password_change_provider_failure_is_a_503_without_audit(client, db, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("provider exploded")

    monkeypatch.setattr(db.auth.admin, "update_user_by_id", boom)
    r = client.post(
        f"{API}/auth/password/change",
        headers=bearer(S1),
        json={"current_password": PASSWORD, "new_password": "NewPass456"},
    )
    assert r.status_code == 503 and r.json()["code"] == "SERVICE_UNAVAILABLE"
    assert db.auth_users[S1]["password"] == PASSWORD and not db.audit("auth.password_change")
