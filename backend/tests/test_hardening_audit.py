"""Phase 9: audit trail behaviour under failure (SRS 15)."""

import logging

import pytest

from app.services import audit_service
from tests.conftest import L1


def test_a_failed_security_audit_is_logged_and_does_not_break_the_caller(client, db, caplog):
    db.fail_insert_tables.add("audit_logs")
    with caplog.at_level(logging.ERROR, logger="app.audit"):
        audit_service.record(L1, "auth.login", "profile", L1)  # best effort: must not raise
    assert "Failed to write audit log for auth.login" in caplog.text and not db.audit()


def test_a_failed_academic_audit_is_raised_so_the_change_can_be_refused(client, db):
    db.fail_insert_tables.add("audit_logs")
    with pytest.raises(Exception, match="simulated"):
        audit_service.record(L1, "mark.update", "assessment_mark", L1, strict=True)


def test_audit_rows_keep_actor_action_entity_and_values(client, db):
    audit_service.record(L1, "mark.update", "assessment_mark", L1, old={"mark": 10}, new={"mark": 12})
    row = db.audit("mark.update")[0]
    assert (row["actor_user_id"], row["entity_type"], row["old_value"], row["new_value"]) == (
        L1,
        "assessment_mark",
        {"mark": 10},
        {"mark": 12},
    )
