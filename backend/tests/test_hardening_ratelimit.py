"""Phase 9: abuse protection beyond login (SRS 12): uploads, password change and reports, per session."""

import pytest

from app.core import rate_limit as rl
from app.core.config import get_settings
from tests import file_samples as samples
from tests.conftest import COURSE_A, L1, S1, S2, bearer

API = "/api/v1"
UPLOAD = f"{API}/courses/{COURSE_A}/materials"


@pytest.fixture(autouse=True)
def _frozen_time(clock):
    """Run at the frozen NOW."""


def upload(client, who=L1):
    return client.post(
        UPLOAD,
        headers=bearer(who),
        data={"title": "Notes"},
        files={"file": ("n.pdf", samples.pdf(), "application/pdf")},
    )


def test_uploads_are_limited_per_session(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "upload_rate_limit", 2)
    assert upload(client).status_code == 201 and upload(client).status_code == 201
    r = upload(client)
    assert r.status_code == 429 and r.json()["code"] == "RATE_LIMITED" and int(r.headers["retry-after"]) >= 1


def test_one_users_uploads_do_not_lock_out_another_on_the_same_address(client, db, monkeypatch):
    """A class behind one campus address must not share a budget: the limit is per session."""
    db.tables["course_lecturers"].append({"id": "cl2", "course_id": COURSE_A, "lecturer_id": S2})
    monkeypatch.setattr(get_settings(), "upload_rate_limit", 1)
    assert upload(client).status_code == 201 and upload(client).status_code == 429
    other = client.post(
        UPLOAD,
        headers=bearer(S1),
        data={"title": "x"},
        files={"file": ("n.pdf", samples.pdf(), "application/pdf")},
    )
    assert other.status_code != 429  # a different session has its own budget (403: students cannot upload)


def test_assignment_attachment_and_submission_uploads_share_the_upload_limit(client, db, monkeypatch):
    from tests.conftest import make_assignment

    a = make_assignment(db, due_in_days=3)
    monkeypatch.setattr(get_settings(), "upload_rate_limit", 1)
    pdf = {"file": ("a.pdf", samples.pdf(), "application/pdf")}
    assert (
        client.put(f"{API}/assignments/{a['id']}/attachment", headers=bearer(L1), files=pdf).status_code
        == 200
    )
    assert (
        client.put(f"{API}/assignments/{a['id']}/attachment", headers=bearer(L1), files=pdf).status_code
        == 429
    )
    assert (
        client.post(f"{API}/assignments/{a['id']}/submissions", headers=bearer(S1), files=pdf).status_code
        == 201
    )
    assert (
        client.post(f"{API}/assignments/{a['id']}/submissions", headers=bearer(S1), files=pdf).status_code
        == 429
    )


def test_password_change_is_limited_per_session(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "password_change_rate_limit", 2)
    body = {"current_password": "WrongCurrent1", "new_password": "NewPass456"}
    codes = [
        client.post(f"{API}/auth/password/change", headers=bearer(S1), json=body).status_code
        for _ in range(3)
    ]
    assert codes == [400, 400, 429]  # wrong current password twice, then throttled


def test_reports_are_limited_per_session(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "report_rate_limit", 2)
    url = f"{API}/courses/{COURSE_A}/reports/attendance"
    assert client.get(url, headers=bearer(L1)).status_code == 200
    assert client.get(url, headers=bearer(L1)).status_code == 200
    assert client.get(url, headers=bearer(L1)).status_code == 429
    assert client.get(f"{API}/dashboard", headers=bearer(L1)).status_code == 200  # other routes unaffected


def test_the_limit_window_expires(client, db, monkeypatch):
    clock = {"now": 1000.0}
    monkeypatch.setattr(rl.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(get_settings(), "upload_rate_limit", 1)
    monkeypatch.setattr(get_settings(), "upload_rate_window_seconds", 10)
    assert upload(client).status_code == 201 and upload(client).status_code == 429
    clock["now"] += 11
    assert upload(client).status_code == 201


def test_tokens_are_hashed_in_the_limiter_table(client, db):
    upload(client)
    keys = list(rl._hits)
    assert keys and all(f"tok-{L1}" not in k and L1 not in k for k in keys)
    assert any(k.startswith("upload:tok:") for k in keys)


def test_requests_without_a_token_fall_back_to_the_address(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "upload_rate_limit", 1)
    for _ in range(2):
        client.post(UPLOAD, files={"file": ("n.pdf", samples.pdf(), "application/pdf")})
    assert any(k.startswith("upload:ip:") for k in rl._hits)
    r = client.post(UPLOAD, files={"file": ("n.pdf", samples.pdf(), "application/pdf")})
    assert r.status_code == 429  # even anonymous floods are throttled (before authentication)


def test_idle_keys_are_swept_so_the_table_cannot_grow_forever(monkeypatch):
    rl.reset_rate_limits()
    now = {"t": 0.0}
    monkeypatch.setattr(rl.time, "monotonic", lambda: now["t"])
    limiter = rl.rate_limit("x", lambda: 5, lambda: 60)

    class Req:
        headers: dict = {}

        def __init__(self, host):
            self.client = type("C", (), {"host": host})()

    for i in range(rl.SWEEP_EVERY - 1):
        limiter(Req(f"10.0.{i // 250}.{i % 250}"))
    assert rl.tracked_keys() == rl.SWEEP_EVERY - 1
    now["t"] = 1000.0  # everything is idle by now
    limiter(Req("10.9.9.9"))  # the SWEEP_EVERY-th call triggers the clean-up
    assert rl.tracked_keys() == 1
    rl.reset_rate_limits()


def test_sweep_keeps_live_counters_of_longer_windows(monkeypatch):
    rl.reset_rate_limits()
    now = {"t": 0.0}
    monkeypatch.setattr(rl.time, "monotonic", lambda: now["t"])
    long_limit = rl.rate_limit("long", lambda: 1, lambda: 900)
    short_limit = rl.rate_limit("short", lambda: 5, lambda: 60)

    class Req:
        headers: dict = {}

        def __init__(self, host="1.2.3.4"):
            self.client = type("C", (), {"host": host})()

    long_limit(Req())
    now["t"] = 300.0  # idle for 300 s: expired for "short" (60 s) but still live for "long" (900 s)
    for i in range(rl.SWEEP_EVERY):
        short_limit(Req(f"9.9.{i // 250}.{i % 250}"))
    with pytest.raises(Exception, match="Too many"):
        long_limit(Req())
    rl.reset_rate_limits()
