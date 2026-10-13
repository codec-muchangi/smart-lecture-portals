"""Phase 7 (announcements): FR-NOT-01/02/03, FR-LEC-13, FR-STU-10, SRS 9.2, AT-17."""

import pytest

from tests.conftest import (
    COURSE_A,
    COURSE_B,
    L1,
    S1,
    S2,
    add_student,
    bearer,
    make_announcement,
)

BASE = f"/api/v1/courses/{COURSE_A}/announcements"


def create(client, who=L1, course=COURSE_A, **over):
    body = {"title": "Quiz on Friday", "body": "Chapters 1 to 3.", **over}
    return client.post(f"/api/v1/courses/{course}/announcements", headers=bearer(who), json=body)


def patch(client, a, who=L1, **body):
    return client.patch(f"/api/v1/announcements/{a['id']}", headers=bearer(who), json=body)


def listing(client, who=S1, course=COURSE_A, query=""):
    return client.get(f"/api/v1/courses/{course}/announcements{query}", headers=bearer(who))


def notifications(db, user=None):
    rows = db.tables.get("notifications", [])
    return [n for n in rows if user is None or n["user_id"] == user]


def set_course_status(db, course_id, status):
    next(c for c in db.tables["courses"] if c["id"] == course_id)["status"] = status


# =============================== create ===============================
def test_lecturer_creates_a_draft_by_default(client, db):
    r = create(client)
    assert r.status_code == 201
    a = r.json()
    assert a["title"] == "Quiz on Friday" and a["body"] == "Chapters 1 to 3."
    assert a["published"] is False and a["published_at"] is None and a["created_by"] == L1
    assert a["course_id"] == COURSE_A and a["notified"] == 0
    assert not notifications(db)  # a draft tells nobody
    assert len(db.audit("announcement.create")) == 1


def test_publishing_on_create_notifies_enrolled_students_AT_17_FR_NOT_03(client, db):
    other = add_student(db, 1, "Second Student", "STU500", enroll_in=COURSE_A)
    r = create(client, published=True)
    assert r.status_code == 201 and r.json()["published"] is True and r.json()["published_at"]
    assert r.json()["notified"] == 2
    assert {n["user_id"] for n in notifications(db)} == {S1, other}
    n = notifications(db, S1)[0]
    assert n["type"] == "announcement" and n["title"] == "New announcement: Quiz on Friday"
    assert n["message"] == "Chapters 1 to 3." and n["link"] == f"/student/courses/{COURSE_A}"
    assert n["is_read"] is False and n["read_at"] is None
    assert len(db.audit("announcement.publish")) == 1


def test_notification_message_is_a_200_character_preview(client, db):
    create(client, body="x" * 500, published=True)
    assert notifications(db, S1)[0]["message"] == "x" * 200


def test_only_actively_enrolled_students_are_notified(client, db):
    gone = add_student(db, 2, "Gone Student", "STU501", enroll_in=COURSE_A)
    next(e for e in db.tables["course_enrollments"] if e["student_id"] == gone)["status"] = "withdrawn"
    stranger = add_student(db, 3, "Other Course", "STU502", enroll_in=COURSE_B)
    create(client, published=True)
    assert {n["user_id"] for n in notifications(db)} == {S1}
    assert not notifications(db, gone) and not notifications(db, stranger)


def test_title_and_body_are_trimmed(client, db):
    a = create(client, title="  Quiz  ", body="  Be ready.  ").json()
    assert a["title"] == "Quiz" and a["body"] == "Be ready."


@pytest.mark.parametrize(
    "patch_",
    [
        {"title": ""},
        {"title": "   "},
        {"body": ""},
        {"body": "   "},
        {"title": "x" * 201},
        {"body": "x" * 5001},
        {"title": None},
        {"published": "yes"},
        {"published": 1},
        {"surprise": 1},
    ],
)
def test_invalid_announcements_are_422(client, db, patch_):
    assert create(client, **patch_).status_code == 422
    assert not db.tables.get("announcements")


def test_missing_title_or_body_is_422(client, db):
    h = bearer(L1)
    assert client.post(BASE, headers=h, json={"body": "x"}).status_code == 422
    assert client.post(BASE, headers=h, json={"title": "x"}).status_code == 422


def test_the_longest_allowed_title_and_body_are_accepted(client, db):
    assert create(client, title="t" * 200, body="b" * 5000).status_code == 201


@pytest.mark.parametrize("status", ["archived", "inactive"])
def test_a_read_only_course_cannot_get_announcements_409(client, db, status):
    set_course_status(db, COURSE_A, status)
    assert create(client).status_code == 409
    assert not db.tables.get("announcements")


# =============================== visibility (FR-NOT-02) ===============================
def test_student_sees_published_announcements_only_AT_17(client, db):
    pub = make_announcement(db, title="Published")
    make_announcement(db, title="Draft", published=False)
    r = listing(client)
    assert r.status_code == 200
    assert [i["id"] for i in r.json()["items"]] == [pub["id"]] and r.json()["total"] == 1


def test_lecturer_sees_drafts_too(client, db):
    make_announcement(db, title="Published")
    make_announcement(db, title="Draft", published=False)
    r = listing(client, who=L1)
    assert r.json()["total"] == 2 and {i["title"] for i in r.json()["items"]} == {"Published", "Draft"}


def test_student_list_is_newest_published_first(client, db):
    old = make_announcement(db, title="Old")
    new = make_announcement(db, title="New")
    old["published_at"] = "2026-09-01T00:00:00+00:00"
    new["published_at"] = "2026-10-02T00:00:00+00:00"
    assert [i["title"] for i in listing(client).json()["items"]] == ["New", "Old"]


def test_lecturer_list_is_newest_created_first(client, db):
    first = make_announcement(db, title="First")
    second = make_announcement(db, title="Second", published=False)
    assert first["created_at"] < second["created_at"]
    assert [i["title"] for i in listing(client, who=L1).json()["items"]] == ["Second", "First"]


def test_list_is_paginated(client, db):
    for i in range(5):
        make_announcement(db, title=f"A{i}")
    r = listing(client, query="?page=2&page_size=2").json()
    assert r["total"] == 5 and r["page"] == 2 and len(r["items"]) == 2
    assert listing(client, query="?page_size=101").status_code == 422
    assert listing(client, query="?page=0").status_code == 422


def test_a_course_shows_only_its_own_announcements(client, db):
    make_announcement(db, title="Mine")
    make_announcement(db, course_id=COURSE_B, title="Other course")
    assert [i["title"] for i in listing(client, who=L1).json()["items"]] == ["Mine"]


def test_student_not_enrolled_gets_404(client, db):
    make_announcement(db, course_id=COURSE_B)
    assert listing(client, course=COURSE_B).status_code == 404
    assert listing(client, who=S2).status_code == 404


def test_withdrawn_student_loses_access(client, db):
    next(e for e in db.tables["course_enrollments"] if e["student_id"] == S1)["status"] = "withdrawn"
    assert listing(client).status_code == 404


def test_students_cannot_create_or_edit_403(client, db):
    a = make_announcement(db, published=False)
    assert create(client, who=S1).status_code == 403
    assert patch(client, a, who=S1, title="Hacked").status_code == 403
    assert a["title"] == "Welcome" and not db.tables["announcements"][1:]


def test_lecturer_not_assigned_to_the_course_gets_404(client, db):
    other = make_announcement(db, course_id=COURSE_B)
    assert create(client, course=COURSE_B).status_code == 404
    assert listing(client, who=L1, course=COURSE_B).status_code == 404
    assert patch(client, other, title="Nope").status_code == 404
    assert other["title"] == "Welcome"


def test_unknown_ids_are_404_and_malformed_ids_422(client, db):
    assert create(client, course="00000000-0000-0000-0000-00000000ffff").status_code == 404
    r = client.patch(
        "/api/v1/announcements/00000000-0000-0000-0000-00000000ffff", headers=bearer(L1), json={"title": "x"}
    )
    assert r.status_code == 404
    assert (
        client.patch("/api/v1/announcements/nope", headers=bearer(L1), json={"title": "x"}).status_code == 422
    )


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", BASE),
        ("get", BASE),
        ("patch", "/api/v1/announcements/00000000-0000-0000-0000-000000000001"),
    ],
)
def test_every_announcement_endpoint_needs_a_login_401(client, db, method, path):
    assert getattr(client, method)(path).status_code == 401
    assert getattr(client, method)(path, headers={"Authorization": "Bearer nonsense"}).status_code == 401


# =============================== edit / publish / unpublish ===============================
def test_editing_title_and_body_is_audited_with_old_and_new(client, db):
    a = make_announcement(db, title="Old title", body="Old body")
    r = patch(client, a, title="New title", body="New body")
    assert r.status_code == 200 and r.json()["title"] == "New title" and r.json()["notified"] == 0
    assert a["title"] == "New title" and a["body"] == "New body"
    log = db.audit("announcement.update")
    assert len(log) == 1 and log[0]["actor_user_id"] == L1 and log[0]["entity_id"] == a["id"]
    assert log[0]["old_value"] == {"title": "Old title", "body": "Old body"}
    assert log[0]["new_value"] == {"title": "New title", "body": "New body"}
    assert not notifications(db)  # editing never notifies


def test_publishing_a_draft_sets_published_at_and_notifies_AT_17(client, db):
    a = make_announcement(db, published=False)
    r = patch(client, a, published=True)
    assert r.status_code == 200 and r.json()["published"] is True and r.json()["published_at"]
    assert r.json()["notified"] == 1 and len(notifications(db, S1)) == 1
    assert len(db.audit("announcement.publish")) == 1
    assert [i["id"] for i in listing(client).json()["items"]] == [a["id"]]  # now visible to the student


def test_unpublishing_hides_it_from_students_and_keeps_published_at(client, db):
    a = make_announcement(db)
    r = patch(client, a, published=False)
    assert r.status_code == 200 and r.json()["published"] is False
    assert r.json()["published_at"] == "2026-10-01T08:00:00Z"
    assert listing(client).json()["items"] == []
    log = db.audit("announcement.unpublish")
    assert log[0]["old_value"] == {"published": True} and log[0]["new_value"] == {"published": False}


def test_republishing_after_an_unpublish_does_not_notify_again(client, db):
    a = make_announcement(db, published=False)
    patch(client, a, published=True)
    patch(client, a, published=False)
    r = patch(client, a, published=True)
    assert r.json()["notified"] == 0
    assert len(notifications(db, S1)) == 1


def test_editing_a_published_announcement_does_not_notify_again(client, db):
    a = make_announcement(db, published=False)
    patch(client, a, published=True)
    patch(client, a, body="Updated details")
    assert len(notifications(db, S1)) == 1


def test_sending_the_same_values_changes_and_audits_nothing(client, db):
    a = make_announcement(db, title="Same")
    before = len(db.tables.get("audit_logs", []))
    r = patch(client, a, title="Same", published=True)
    assert r.status_code == 200 and r.json()["notified"] == 0
    assert len(db.tables.get("audit_logs", [])) == before


def test_publish_and_edit_in_one_call(client, db):
    a = make_announcement(db, published=False, title="Draft")
    r = patch(client, a, title="Final", published=True)
    assert r.json()["title"] == "Final" and r.json()["notified"] == 1
    assert notifications(db, S1)[0]["title"] == "New announcement: Final"  # the notice uses the new title


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"title": ""},
        {"title": None},
        {"body": None},
        {"published": None},
        {"published": "true"},
        {"x": 1},
    ],
)
def test_invalid_updates_are_rejected(client, db, body):
    a = make_announcement(db)
    r = patch(client, a, **body)
    assert r.status_code in (400, 422) and a["title"] == "Welcome"


def test_an_empty_update_is_400_with_a_clear_message(client, db):
    a = make_announcement(db)
    r = patch(client, a)
    assert r.status_code == 400 and r.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("status", ["archived", "inactive"])
def test_a_read_only_course_cannot_edit_announcements_409(client, db, status):
    a = make_announcement(db)
    set_course_status(db, COURSE_A, status)
    assert patch(client, a, title="Changed").status_code == 409
    assert a["title"] == "Welcome"


def test_an_archived_course_still_lists_announcements(client, db):
    make_announcement(db)
    set_course_status(db, COURSE_A, "archived")
    assert listing(client).json()["total"] == 1 and listing(client, who=L1).json()["total"] == 1


def test_an_update_rejected_by_a_database_rule_is_a_409(client, db, monkeypatch):
    from app.repositories import announcement_repository as repo

    a = make_announcement(db)

    def refuse(*_):
        raise Exception("author is not assigned to this course (23514)")

    monkeypatch.setattr(repo, "update", refuse)
    assert patch(client, a, title="x").status_code == 409


def test_a_create_rejected_by_a_database_rule_is_a_409(client, db, monkeypatch):
    from app.repositories import announcement_repository as repo

    def refuse(*_):
        raise Exception("author is not assigned to this course (23514)")

    monkeypatch.setattr(repo, "create", refuse)
    assert create(client).status_code == 409


def test_other_database_failures_are_500_not_409(client, db, monkeypatch):
    from app.repositories import announcement_repository as repo

    def boom(*_):
        raise Exception("connection reset")

    monkeypatch.setattr(repo, "create", boom)
    monkeypatch.setattr(repo, "update", boom)
    assert create(client).status_code == 500
    assert patch(client, make_announcement(db), title="x").status_code == 500


def test_a_failure_in_the_transaction_rolls_back_the_announcement_and_its_notifications(client, db):
    db.fail_rpc_after.add("create_announcement")  # fails AFTER the rows were written
    r = create(client, published=True)
    assert r.status_code == 500
    assert (
        not db.tables.get("announcements") and not notifications(db) and not db.audit("announcement.publish")
    )
