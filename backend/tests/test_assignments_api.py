"""Phase 4 (assignments): FR-ASG-01..03, FR-LEC-05/06, FR-STU-05, AT-07."""

from datetime import timedelta

import pytest

from app.core.config import get_settings
from tests import file_samples as samples
from tests.conftest import (
    COURSE_A,
    COURSE_B,
    L1,
    NOW,
    S1,
    S2,
    bearer,
    make_assignment,
    make_submission,
)

COURSE_URL = f"/api/v1/courses/{COURSE_A}/assignments"


def due(days=7):
    return (NOW + timedelta(days=days)).isoformat()


def payload(**over):
    body = {"title": "Assignment 1 - Introduction", "due_at": due(), "max_marks": 20}
    body.update(over)
    return body


def create(client, who=L1, course=COURSE_A, **over):
    return client.post(f"/api/v1/courses/{course}/assignments", headers=bearer(who), json=payload(**over))


def rows(db):
    return db.tables.get("assignments", [])


def set_course_status(db, course_id, status):
    next(c for c in db.tables["courses"] if c["id"] == course_id)["status"] = status


# =============================== create ===============================
def test_lecturer_creates_a_draft_by_default_AT07(client, db, clock):
    r = create(client, description="Read chapter 1", instructions="Answer all questions.")
    assert r.status_code == 201
    a = r.json()
    assert a["title"] == "Assignment 1 - Introduction" and a["max_marks"] == 20
    assert a["published"] is False and a["closed"] is False and a["state"] == "draft"
    assert a["submissions_open"] is False and a["allow_late"] is False
    assert a["has_attachment"] is False and a["attachment_name"] is None
    assert a["created_by"] == L1 and a["course_id"] == COURSE_A
    assert a["submission_counts"] == {"submitted": 0, "late": 0, "graded": 0, "returned": 0, "total": 0}
    assert rows(db)[0]["created_by"] == L1


def test_create_is_audited(client, db, clock):
    a = create(client).json()
    log = db.audit("assignment.create")
    assert len(log) == 1 and log[0]["actor_user_id"] == L1 and log[0]["entity_id"] == a["id"]
    assert log[0]["new_value"]["title"] == "Assignment 1 - Introduction"


def test_can_create_published_with_late_policy(client, db, clock):
    a = create(client, published=True, allow_late=True).json()
    assert a["state"] == "open" and a["submissions_open"] is True and a["allow_late"] is True


def test_deadline_with_offset_is_stored_as_utc(client, db, clock):
    r = create(client, due_at="2026-10-31T17:00:00+03:00")
    assert r.status_code == 201
    assert rows(db)[0]["due_at"] == "2026-10-31T14:00:00+00:00"


def test_text_fields_are_trimmed_and_blank_becomes_null(client, db, clock):
    a = create(client, title="  Padded Title  ", description="   ", instructions="").json()
    assert a["title"] == "Padded Title" and a["description"] is None and a["instructions"] is None


@pytest.mark.parametrize("marks", [0.5, 1, 99.99, 1000])
def test_valid_max_marks(client, db, clock, marks):
    assert create(client, max_marks=marks).status_code == 201


@pytest.mark.parametrize("marks", [0, -5, 1000.01, 5000, 10.005, "twenty", True, None])
def test_invalid_max_marks_are_422(client, db, clock, marks):
    r = create(client, max_marks=marks)
    assert r.status_code == 422 and "max_marks" in r.json()["details"]
    assert rows(db) == []


@pytest.mark.parametrize(
    "over",
    [
        {"title": ""},
        {"title": "A"},
        {"title": "x" * 201},
        {"description": "x" * 2001},
        {"instructions": "x" * 10001},
        {"due_at": "not a date"},
        {"due_at": None},
        {"due_at": "2026-10-31T17:00:00"},  # no timezone
        {"allow_late": "maybe"},
    ],
)
def test_invalid_fields_are_422(client, db, clock, over):
    assert create(client, **over).status_code == 422
    assert rows(db) == []


def test_missing_required_fields_are_422(client, db, clock):
    for missing in ("title", "due_at", "max_marks"):
        body = payload()
        body.pop(missing)
        assert client.post(COURSE_URL, headers=bearer(L1), json=body).status_code == 422


def test_unknown_or_forbidden_fields_are_rejected(client, db, clock):
    for extra in (
        {"course_id": COURSE_B},
        {"created_by": S1},
        {"closed": True},
        {"attachment_path": "x/y"},
        {"id": "x"},
    ):
        assert create(client, **extra).status_code == 422
    assert rows(db) == []


def test_deadline_must_be_in_the_future_FR_ASG_03(client, db, clock):
    for when in (NOW - timedelta(days=1), NOW):
        r = create(client, due_at=when.isoformat())
        assert (
            r.status_code == 400
            and r.json()["code"] == "VALIDATION_ERROR"
            and "due_at" in r.json()["details"]
        )
    assert rows(db) == []


def test_deadline_cannot_be_absurdly_far_ahead(client, db, clock):
    limit = get_settings().assignment_max_due_days
    assert create(client, due_at=(NOW + timedelta(days=limit - 1)).isoformat()).status_code == 201
    r = create(client, due_at=(NOW + timedelta(days=limit + 1)).isoformat())
    assert r.status_code == 400 and "due_at" in r.json()["details"]


def test_create_authorization(client, db, clock):
    assert create(client, who=S1).status_code == 403
    assert client.post(COURSE_URL, json=payload()).status_code == 401
    assert create(client, course=COURSE_B).status_code == 404  # lecturer not assigned
    assert rows(db) == []


@pytest.mark.parametrize("status", ["archived", "inactive"])
def test_cannot_create_in_a_read_only_course(client, db, clock, status):
    set_course_status(db, COURSE_A, status)
    assert create(client).status_code == 409 and rows(db) == []


# =============================== list ===============================
def test_lecturer_sees_all_states_students_only_published(client, db, clock):
    make_assignment(db, title="Draft one", published=False)
    make_assignment(db, title="Open one")
    make_assignment(db, title="Closed one", closed=True)
    lec = client.get(COURSE_URL, headers=bearer(L1)).json()
    stu = client.get(COURSE_URL, headers=bearer(S1)).json()
    assert lec["total"] == 3 and {a["state"] for a in lec["items"]} == {"draft", "open", "closed"}
    assert stu["total"] == 2 and {a["title"] for a in stu["items"]} == {"Open one", "Closed one"}


def test_state_filter(client, db, clock):
    make_assignment(db, title="Draft one", published=False)
    make_assignment(db, title="Open one")
    make_assignment(db, title="Closed one", closed=True)

    def titles(state, who=L1):
        r = client.get(f"{COURSE_URL}?state={state}", headers=bearer(who))
        return [a["title"] for a in r.json()["items"]]

    assert (
        titles("draft") == ["Draft one"]
        and titles("open") == ["Open one"]
        and titles("closed") == ["Closed one"]
    )
    assert titles("draft", S1) == []  # students can never see drafts, even by asking
    assert client.get(f"{COURSE_URL}?state=bogus", headers=bearer(L1)).status_code == 422


def test_list_is_latest_deadline_first_and_paginated(client, db, clock):
    for days in (3, 9, 6):
        make_assignment(db, title=f"Due in {days}", due_in_days=days)
    p1 = client.get(f"{COURSE_URL}?page=1&page_size=2", headers=bearer(L1)).json()
    p2 = client.get(f"{COURSE_URL}?page=2&page_size=2", headers=bearer(L1)).json()
    assert p1["total"] == 3 and [a["title"] for a in p1["items"]] == ["Due in 9", "Due in 6"]
    assert [a["title"] for a in p2["items"]] == ["Due in 3"]


def test_search_by_title_and_injection_safety(client, db, clock):
    make_assignment(db, title="Networking Lab")
    make_assignment(db, title="Database Essay")
    assert [
        a["title"] for a in client.get(f"{COURSE_URL}?q=networking", headers=bearer(S1)).json()["items"]
    ] == ["Networking Lab"]
    assert client.get(f"{COURSE_URL}?q=zzz,id.neq.0", headers=bearer(S1)).json()["total"] == 0


def test_student_list_includes_own_submission_with_hidden_grade(client, db, clock):
    a = make_assignment(db)
    make_submission(db, a, S1, status="graded", mark=17, feedback="Good work", grade_released=False)
    sub = client.get(COURSE_URL, headers=bearer(S1)).json()["items"][0]["my_submission"]
    assert sub["status"] == "graded" and sub["mark"] is None and sub["feedback"] is None  # not released yet
    db.tables["submissions"][0]["grade_released"] = True
    sub = client.get(COURSE_URL, headers=bearer(S1)).json()["items"][0]["my_submission"]
    assert sub["mark"] == 17 and sub["feedback"] == "Good work"


def test_student_sees_only_their_own_submission_in_the_list(client, db, clock):
    a = make_assignment(db)
    make_submission(db, a, S2)
    assert client.get(COURSE_URL, headers=bearer(S1)).json()["items"][0]["my_submission"] is None


def test_lecturer_list_has_no_my_submission(client, db, clock):
    make_submission(db, make_assignment(db), S1)
    assert client.get(COURSE_URL, headers=bearer(L1)).json()["items"][0]["my_submission"] is None


def test_submissions_open_reflects_deadline_policy(client, db, clock):
    make_assignment(db, title="Future", due_in_days=2)
    make_assignment(db, title="Past strict", due_in_days=-2)
    make_assignment(db, title="Past late ok", due_in_days=-2, allow_late=True)
    make_assignment(db, title="Closed", due_in_days=2, closed=True)
    by_title = {a["title"]: a for a in client.get(COURSE_URL, headers=bearer(S1)).json()["items"]}
    assert [by_title[t]["submissions_open"] for t in ("Future", "Past strict", "Past late ok", "Closed")] == [
        True,
        False,
        True,
        False,
    ]


def test_list_access_rules(client, db, clock):
    make_assignment(db, course_id=COURSE_B)
    assert client.get(COURSE_URL).status_code == 401
    assert client.get(f"/api/v1/courses/{COURSE_B}/assignments", headers=bearer(S1)).status_code == 404
    assert client.get(f"/api/v1/courses/{COURSE_B}/assignments", headers=bearer(L1)).status_code == 404
    assert client.get(COURSE_URL, headers=bearer(S2)).status_code == 404  # not enrolled
    assert (
        client.get(COURSE_URL, headers=bearer(L1)).json()["total"] == 0
    )  # B's assignment never leaks into A


@pytest.mark.parametrize("qs", ["page=0", "page_size=0", "page_size=101"])
def test_bad_pagination_is_422(client, db, clock, qs):
    assert client.get(f"{COURSE_URL}?{qs}", headers=bearer(L1)).status_code == 422


def test_inactive_course_hidden_from_students_archived_readable(client, db, clock):
    make_assignment(db)
    set_course_status(db, COURSE_A, "archived")
    assert client.get(COURSE_URL, headers=bearer(S1)).json()["total"] == 1
    set_course_status(db, COURSE_A, "inactive")
    assert client.get(COURSE_URL, headers=bearer(S1)).status_code == 404


# =============================== detail ===============================
def test_student_detail_shows_instructions_deadline_marks_status(client, db, clock):
    a = make_assignment(db, max_marks=30)
    a["instructions"] = "Do it well"
    d = client.get(f"/api/v1/assignments/{a['id']}", headers=bearer(S1)).json()
    assert d["instructions"] == "Do it well" and d["max_marks"] == 30 and d["state"] == "open"
    assert d["due_at"].startswith("2026-10-12") and d["submissions_open"] is True
    assert d["my_submission"] is None and d["submission_counts"] is None  # students never see class counts


def test_lecturer_detail_has_submission_counts(client, db, clock):
    a = make_assignment(db)
    make_submission(db, a, S1, status="submitted")
    make_submission(db, a, S2, status="late")
    d = client.get(f"/api/v1/assignments/{a['id']}", headers=bearer(L1)).json()
    assert d["submission_counts"] == {"submitted": 1, "late": 1, "graded": 0, "returned": 0, "total": 2}


def test_draft_is_404_to_students_but_visible_to_its_lecturer(client, db, clock):
    a = make_assignment(db, published=False)
    assert client.get(f"/api/v1/assignments/{a['id']}", headers=bearer(S1)).status_code == 404
    assert client.get(f"/api/v1/assignments/{a['id']}", headers=bearer(L1)).status_code == 200


def test_detail_access_rules(client, db, clock):
    other = make_assignment(db, course_id=COURSE_B)
    url = f"/api/v1/assignments/{other['id']}"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=bearer(S1)).status_code == 404
    assert client.get(url, headers=bearer(L1)).status_code == 404
    assert (
        client.get("/api/v1/assignments/00000000-0000-0000-0000-00000000ffff", headers=bearer(L1)).status_code
        == 404
    )
    assert client.get("/api/v1/assignments/not-a-uuid", headers=bearer(L1)).status_code == 422


# =============================== update ===============================
def patch(client, a, who=L1, **fields):
    return client.patch(f"/api/v1/assignments/{a['id']}", headers=bearer(who), json=fields)


def test_lecturer_edits_fields_and_it_is_audited(client, db, clock):
    a = make_assignment(db, published=False)
    r = patch(
        client,
        a,
        title="  New title ",
        instructions="New text",
        max_marks=25,
        allow_late=True,
        due_at=due(14),
    )
    assert r.status_code == 200
    body = r.json()
    assert (body["title"], body["instructions"], body["max_marks"], body["allow_late"]) == (
        "New title",
        "New text",
        25,
        True,
    )
    assert body["due_at"].startswith("2026-10-19")
    log = db.audit("assignment.update")[0]
    assert log["old_value"]["title"] == "Assignment 1" and log["new_value"]["title"] == "New title"
    assert set(log["new_value"]) == {"title", "instructions", "max_marks", "allow_late", "due_at"}


def test_publish_then_close_then_reopen(client, db, clock):
    a = make_assignment(db, published=False)
    assert patch(client, a, published=True).json()["state"] == "open"
    assert patch(client, a, closed=True).json()["state"] == "closed"
    assert patch(client, a, closed=False).json()["state"] == "open"


def test_publishing_requires_a_future_deadline(client, db, clock):
    a = make_assignment(db, published=False, due_in_days=-1)
    r = patch(client, a, published=True)
    assert r.status_code == 400 and "due_at" in r.json()["details"]
    assert (
        patch(client, a, published=True, due_at=due(3)).json()["state"] == "open"
    )  # fixing the deadline in the same call works


def test_new_deadline_must_be_in_the_future_and_unchanged_one_is_not_rechecked(client, db, clock):
    a = make_assignment(db, due_in_days=-1)  # already past, e.g. an old published assignment
    assert patch(client, a, title="Typo fixed").status_code == 200  # editing text after the deadline is fine
    assert patch(client, a, due_at=(NOW - timedelta(hours=1)).isoformat()).status_code == 400
    assert patch(client, a, due_at=due(2)).status_code == 200  # a deadline extension


def test_cannot_close_a_draft(client, db, clock):
    a = make_assignment(db, published=False)
    r = patch(client, a, closed=True)
    assert r.status_code == 400 and "closed" in r.json()["details"]


def test_unpublishing_is_blocked_once_there_are_submissions(client, db, clock):
    a = make_assignment(db)
    assert patch(client, a, published=False).json()["state"] == "draft"  # fine while nobody submitted
    patch(client, a, published=True)
    make_submission(db, a, S1)
    r = patch(client, a, published=False)
    assert r.status_code == 409 and "Close it instead" in r.json()["message"]
    assert rows(db)[0]["published"] is True


def test_unpublishing_a_closed_assignment_also_reopens_the_flag(client, db, clock):
    a = make_assignment(db, closed=True)
    r = patch(client, a, published=False)
    assert r.status_code == 200 and r.json()["closed"] is False and r.json()["state"] == "draft"


def test_max_marks_cannot_drop_below_an_awarded_mark(client, db, clock):
    a = make_assignment(db, max_marks=20)
    make_submission(db, a, S1, status="graded", mark=18)
    r = patch(client, a, max_marks=15)
    assert r.status_code == 409 and "18" in r.json()["message"]
    assert patch(client, a, max_marks=18).status_code == 200
    assert patch(client, a, max_marks=40).status_code == 200


def test_no_op_and_blank_clearing(client, db, clock):
    a = make_assignment(db, title="Same")
    assert patch(client, a, title="Same", max_marks=20.0).status_code == 200
    assert db.audit("assignment.update") == []
    patch(client, a, instructions="x")
    assert patch(client, a, instructions="  ").json()["instructions"] is None


@pytest.mark.parametrize(
    "fields,status",
    [
        ({}, 400),
        ({"title": None}, 422),
        ({"due_at": None}, 422),
        ({"max_marks": None}, 422),
        ({"published": None}, 422),
        ({"closed": None}, 422),
        ({"allow_late": None}, 422),
        ({"max_marks": 0}, 422),
        ({"title": "A"}, 422),
        ({"due_at": "2026-12-01T10:00:00"}, 422),
        ({"course_id": COURSE_B}, 422),
        ({"created_by": S1}, 422),
        ({"attachment_path": "a/b"}, 422),
        ({"id": "x"}, 422),
    ],
)
def test_invalid_updates(client, db, clock, fields, status):
    a = make_assignment(db)
    before = dict(rows(db)[0])
    assert patch(client, a, **fields).status_code == status
    assert rows(db)[0] == before


def test_update_authorization_and_read_only_courses(client, db, clock):
    a = make_assignment(db)
    other = make_assignment(db, course_id=COURSE_B)
    url = f"/api/v1/assignments/{a['id']}"
    assert client.patch(url, json={"title": "Hacked"}).status_code == 401
    assert patch(client, a, who=S1, title="Hacked").status_code == 403
    assert patch(client, other, title="Hacked").status_code == 404
    set_course_status(db, COURSE_A, "archived")
    assert patch(client, a, title="Too late").status_code == 409
    assert rows(db)[0]["title"] == "Assignment 1"


# =============================== attachment ===============================
def attach(client, a, who=L1, name="brief.pdf", data=None, content_type="application/pdf"):
    return client.put(
        f"/api/v1/assignments/{a['id']}/attachment",
        headers=bearer(who),
        files={"file": (name, samples.pdf() if data is None else data, content_type)},
    )


def test_lecturer_attaches_a_file_and_students_download_it(client, db, clock):
    a = make_assignment(db)
    r = attach(client, a, name="Assignment Brief (v1).pdf")
    assert r.status_code == 200
    body = r.json()
    assert body["has_attachment"] is True and body["attachment_name"] == "Assignment_Brief_v1.pdf"
    assert "attachment_path" not in body
    path = rows(db)[0]["attachment_path"]
    assert path.startswith(f"{COURSE_A}/assignments/{a['id']}/") and path.endswith("/Assignment_Brief_v1.pdf")
    assert ("materials", path) in db.objects  # private materials bucket
    dl = client.get(f"/api/v1/assignments/{a['id']}/attachment", headers=bearer(S1))
    assert dl.status_code == 200 and dl.json()["file_name"] == "Assignment_Brief_v1.pdf"
    assert dl.json()["expires_in"] == get_settings().signed_url_ttl_seconds
    assert (
        db.audit("assignment.attachment_set")[0]["new_value"]["attachment_name"] == "Assignment_Brief_v1.pdf"
    )


def test_replacing_the_attachment_removes_the_old_file(client, db, clock):
    a = make_assignment(db)
    attach(client, a, name="same.pdf")
    first = rows(db)[0]["attachment_path"]
    attach(client, a, name="same.pdf")  # same name must not collide
    second = rows(db)[0]["attachment_path"]
    assert first != second and ("materials", first) not in db.objects and ("materials", second) in db.objects
    assert len(db.objects) == 1


def test_removing_the_attachment(client, db, clock):
    a = make_assignment(db)
    attach(client, a)
    r = client.delete(f"/api/v1/assignments/{a['id']}/attachment", headers=bearer(L1))
    assert r.status_code == 200 and r.json()["has_attachment"] is False
    assert rows(db)[0]["attachment_path"] is None and db.objects == {}
    assert client.delete(f"/api/v1/assignments/{a['id']}/attachment", headers=bearer(L1)).status_code == 404
    assert client.get(f"/api/v1/assignments/{a['id']}/attachment", headers=bearer(L1)).status_code == 404


def test_attachment_uses_the_shared_upload_rules(client, db, clock, monkeypatch):
    a = make_assignment(db)
    for name, data in (
        ("run.exe", samples.WINDOWS_EXE),
        ("fake.pdf", samples.WINDOWS_EXE),
        ("page.html", samples.HTML),
    ):
        r = attach(client, a, name=name, data=data)
        assert r.status_code == 400 and r.json()["code"] == "FILE_TYPE_NOT_ALLOWED", name
    assert attach(client, a, data=b"").status_code == 400
    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    r = attach(client, a, data=samples.pdf() + b"0" * (1024 * 1024))
    assert r.status_code == 400 and r.json()["code"] == "FILE_TOO_LARGE"
    assert db.objects == {} and rows(db)[0]["attachment_path"] is None


def test_attachment_authorization(client, db, clock):
    a = make_assignment(db)
    draft = make_assignment(db, published=False)
    other = make_assignment(db, course_id=COURSE_B)
    attach(client, a)
    attach(client, draft)

    def url(x):
        return f"/api/v1/assignments/{x['id']}/attachment"

    assert attach(client, a, who=S1).status_code == 403
    assert client.delete(url(a), headers=bearer(S1)).status_code == 403
    assert attach(client, other).status_code == 404
    assert client.get(url(a)).status_code == 401
    assert (
        client.get(url(draft), headers=bearer(S1)).status_code == 404
    )  # draft attachments are hidden from students
    assert client.get(url(draft), headers=bearer(L1)).status_code == 200
    assert client.get(url(other), headers=bearer(S1)).status_code == 404


def test_attachment_changes_are_blocked_in_read_only_courses(client, db, clock):
    a = make_assignment(db)
    attach(client, a)
    set_course_status(db, COURSE_A, "archived")
    assert attach(client, a).status_code == 409
    assert client.delete(f"/api/v1/assignments/{a['id']}/attachment", headers=bearer(L1)).status_code == 409


def test_attachment_storage_failures_leave_a_consistent_state(client, db, clock):
    a = make_assignment(db)
    db.storage_fail_upload = True
    assert attach(client, a).status_code == 503 and rows(db)[0]["attachment_path"] is None
    db.storage_fail_upload = False
    attach(client, a)
    old = rows(db)[0]["attachment_path"]
    db.storage_fail_remove = True  # replacing succeeds even if the old file cannot be removed right now
    assert attach(client, a, name="new.pdf").status_code == 200
    assert rows(db)[0]["attachment_path"] != old
    assert db.audit("assignment.attachment_set")[-1]["new_value"]["old_file_removed"] is False


def test_failed_attachment_update_removes_the_new_file_and_keeps_the_old_one(client, db, clock):
    a = make_assignment(db)
    attach(client, a, name="v1.pdf")
    old = rows(db)[0]["attachment_path"]
    db.fail_update_tables.add("assignments")
    assert attach(client, a, name="v2.pdf").status_code == 500
    assert rows(db)[0]["attachment_path"] == old and list(db.objects) == [("materials", old)]


def test_lecturer_operations_on_an_unknown_assignment_are_404(client, db, clock):
    ghost = "00000000-0000-0000-0000-00000000ffff"
    headers = bearer(L1)
    assert (
        client.patch(f"/api/v1/assignments/{ghost}", headers=headers, json={"title": "Nope"}).status_code
        == 404
    )
    assert client.delete(f"/api/v1/assignments/{ghost}/attachment", headers=headers).status_code == 404
    assert (
        client.put(
            f"/api/v1/assignments/{ghost}/attachment",
            headers=headers,
            files={"file": ("a.pdf", samples.pdf())},
        ).status_code
        == 404
    )
    assert client.get(f"/api/v1/assignments/{ghost}/submissions", headers=headers).status_code == 404
