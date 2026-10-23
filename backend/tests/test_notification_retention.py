"""Phase 9: notification retention (SRS 4.9; Phase 7 decision 8)."""

from datetime import timedelta

import pytest

from app.core.errors import ValidationFailed
from app.services import notification_service
from tests.conftest import NOW, S1, S2, make_notification


@pytest.fixture(autouse=True)
def _frozen_time(clock):
    """Run at the frozen NOW."""


def aged(db, days_ago, *, read=True, title="n", user=S1):
    n = make_notification(db, user, title=title, is_read=read)
    n["read_at"] = (NOW - timedelta(days=days_ago)).isoformat() if read else None
    return n


def titles(db):
    return sorted(n["title"] for n in db.tables.get("notifications", []))


def test_only_old_read_notifications_are_deleted(client, db):
    aged(db, 200, title="old-read")
    aged(db, 91, title="just-over", user=S2)
    aged(db, 10, title="recent-read")
    aged(db, 400, read=False, title="old-unread")  # unread are never purged
    assert notification_service.purge_read_notifications(90) == 2
    assert titles(db) == ["old-unread", "recent-read"]


def test_default_is_ninety_days_and_a_run_is_audited(client, db):
    aged(db, 120, title="old")
    assert notification_service.purge_read_notifications() == 1
    log = db.audit("notifications.purge")
    assert len(log) == 1 and log[0]["new_value"] == {"older_than_days": 90, "deleted": 1}


def test_nothing_to_purge_deletes_nothing(client, db):
    aged(db, 5, title="fresh")
    assert notification_service.purge_read_notifications(90) == 0 and titles(db) == ["fresh"]


@pytest.mark.parametrize("days", [0, 1, 29, -5])
def test_a_retention_below_the_minimum_is_refused(client, db, days):
    aged(db, 500, title="ancient")
    with pytest.raises(ValidationFailed, match="at least 30 days"):
        notification_service.purge_read_notifications(days)
    assert titles(db) == ["ancient"] and not db.audit("notifications.purge")


def test_the_database_function_enforces_the_same_minimum(client, db):
    from app.repositories import notification_repository

    with pytest.raises(Exception, match="at least 30 days"):
        notification_repository.purge_read(7)
