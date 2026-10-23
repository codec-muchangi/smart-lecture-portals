"""Phase 9: liveness and readiness probes (NFR-REL-02) for the deployment phase."""

import logging

from app.db import client as db_client


def test_liveness_never_needs_the_database(client, monkeypatch):
    monkeypatch.setattr(db_client, "get_supabase", lambda: (_ for _ in ()).throw(AssertionError("no db")))
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_readiness_is_ready_when_the_database_answers(client, db):
    r = client.get("/health/ready")
    assert r.status_code == 200 and r.json() == {"status": "ready"}
    assert r.headers["cache-control"] == "no-store"


def test_readiness_reports_unavailable_without_details(client, db, monkeypatch, caplog):
    def down(name):
        raise ConnectionError("connection to db.secret-host.supabase.co refused")

    monkeypatch.setattr(db, "table", down)
    with caplog.at_level(logging.ERROR, logger="app"):
        r = client.get("/health/ready")
    assert r.status_code == 503 and r.json() == {"status": "unavailable"} and r.headers["retry-after"] == "5"
    assert "secret-host" not in r.text and "ConnectionError" in caplog.text
    assert "secret-host" not in caplog.text  # only the error class is logged, not its message


def test_readiness_needs_no_token(client, db):
    assert client.get("/health/ready").status_code == 200
