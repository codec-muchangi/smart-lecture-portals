"""Phase 7: in-app notifications for important events (FR-NOT-03, AT-18):
new assignments, new materials, released marks, released grades. (Announcements: test_announcements_api.py.)

These notifications are best effort: they must never block or undo the lecturer's change."""

from datetime import timedelta

import pytest

from app.services import notification_service
from tests import file_samples as samples
from tests.conftest import (
    COURSE_A,
    COURSE_B,
    L1,
    NOW,
    S1,
    S2,
    add_student,
    bearer,
    make_assessment,
    make_assignment,
    make_submission,
)


@pytest.fixture(autouse=True)
def _frozen_time(clock):
    """Every test runs at the frozen NOW."""


def of_type(db, type_, user=None):
    return [
        n
        for n in db.tables.get("notifications", [])
        if n["type"] == type_ and (user is None or n["user_id"] == user)
    ]


def new_assignment(client, **over):
    body = {
        "title": "Assignment 2",
        "due_at": (NOW + timedelta(days=7)).isoformat(),
        "max_marks": 20,
        **over,
    }
    return client.post(f"/api/v1/courses/{COURSE_A}/assignments", headers=bearer(L1), json=body)


def upload(client, **form):
    return client.post(
        f"/api/v1/courses/{COURSE_A}/materials",
        headers=bearer(L1),
        data={"title": "Week 2 Slides", **form},
        files={"file": ("slides.pdf", samples.pdf(), "application/pdf")},
    )


# =============================== assignments ===============================
def test_a_published_assignment_notifies_enrolled_students_AT_18(client, db):
    other = add_student(db, 1, "Second Student", "STU500", enroll_in=COURSE_A)
    stranger = add_student(db, 2, "Other Course", "STU501", enroll_in=COURSE_B)
    r = new_assignment(client, published=True)
    assert r.status_code == 201
    notes = of_type(db, "assignment_published")
    assert {n["user_id"] for n in notes} == {S1, other} and stranger not in {n["user_id"] for n in notes}
    n = notes[0]
    assert n["title"] == "New assignment: Assignment 2" and n["message"] == "Due 12 Oct 2026, 12:00 UTC"
    assert n["link"] == f"/student/assignments/{r.json()['id']}" and n["is_read"] is False


def test_a_draft_assignment_notifies_nobody(client, db):
    assert new_assignment(client).status_code == 201  # published defaults to false
    assert not db.tables.get("notifications")


def test_publishing_a_draft_assignment_notifies_once(client, db):
    a = make_assignment(db, published=False)
    url = f"/api/v1/assignments/{a['id']}"
    r = client.patch(url, headers=bearer(L1), json={"published": True})
    assert r.status_code == 200
    assert len(of_type(db, "assignment_published", S1)) == 1
    assert of_type(db, "assignment_published", S1)[0]["title"] == "New assignment: Assignment 1"
    # editing it afterwards, or sending the same value again, never notifies again
    client.patch(url, headers=bearer(L1), json={"title": "Renamed", "published": True})
    client.patch(url, headers=bearer(L1), json={"max_marks": 25})
    assert len(of_type(db, "assignment_published", S1)) == 1


def test_the_notice_uses_the_new_title_when_publishing_and_renaming_together(client, db):
    a = make_assignment(db, published=False)
    client.patch(
        f"/api/v1/assignments/{a['id']}", headers=bearer(L1), json={"title": "Final title", "published": True}
    )
    assert of_type(db, "assignment_published", S1)[0]["title"] == "New assignment: Final title"


def test_a_failed_notification_never_blocks_publishing_an_assignment(client, db):
    db.fail_rpc_after.add("notify_course_students")
    r = new_assignment(client, published=True)
    assert r.status_code == 201 and len(db.tables["assignments"]) == 1
    assert not db.tables.get("notifications")  # rolled back by the failed function, change kept


# =============================== materials ===============================
def test_a_published_material_notifies_students(client, db):
    r = upload(client)  # published defaults to true
    assert r.status_code == 201
    n = of_type(db, "material_added", S1)
    assert len(n) == 1 and n[0]["title"] == "New material: Week 2 Slides"
    assert n[0]["link"] == f"/student/courses/{COURSE_A}/materials"


def test_a_draft_material_notifies_nobody_until_it_is_published(client, db):
    r = upload(client, published="false")
    assert r.status_code == 201 and not db.tables.get("notifications")
    url = f"/api/v1/materials/{r.json()['id']}"
    assert client.patch(url, headers=bearer(L1), json={"published": True}).status_code == 200
    assert len(of_type(db, "material_added", S1)) == 1
    client.patch(url, headers=bearer(L1), json={"description": "More detail"})
    client.patch(url, headers=bearer(L1), json={"published": False})
    client.patch(url, headers=bearer(L1), json={"published": True})  # re-publishing is not a new material
    assert len(of_type(db, "material_added", S1)) == 2


def test_a_failed_notification_never_blocks_a_material_upload(client, db):
    db.fail_rpc_after.add("notify_course_students")
    assert upload(client).status_code == 201 and len(db.tables["materials"]) == 1


# =============================== marks ===============================
def test_publishing_an_assessment_notifies_students_that_marks_are_released(client, db):
    a = make_assessment(db, name="CAT 1")
    url = f"/api/v1/assessments/{a['id']}"
    assert client.patch(url, headers=bearer(L1), json={"published": True}).status_code == 200
    n = of_type(db, "marks_released", S1)
    assert len(n) == 1 and n[0]["title"] == "Marks released: CAT 1" and n[0]["link"] == "/student/marks"
    client.patch(url, headers=bearer(L1), json={"name": "CAT One"})
    client.patch(url, headers=bearer(L1), json={"published": False})
    assert len(of_type(db, "marks_released", S1)) == 1  # hiding or renaming sends nothing


def test_entering_marks_for_an_unpublished_assessment_notifies_nobody(client, db):
    a = make_assessment(db)
    r = client.put(
        f"/api/v1/assessments/{a['id']}/marks",
        headers=bearer(L1),
        json={"marks": [{"student_id": S1, "mark": 20}]},
    )
    assert r.status_code == 200 and not db.tables.get("notifications")


def test_a_failed_notification_never_blocks_publishing_an_assessment(client, db):
    a = make_assessment(db)
    db.fail_rpc_after.add("notify_course_students")
    r = client.patch(f"/api/v1/assessments/{a['id']}", headers=bearer(L1), json={"published": True})
    assert r.status_code == 200 and a["published"] is True


# =============================== grades ===============================
def grade(client, sub, **body):
    return client.patch(f"/api/v1/submissions/{sub['id']}/grade", headers=bearer(L1), json=body)


def test_releasing_a_grade_notifies_that_student_only(client, db):
    a = make_assignment(db)
    s1, s2 = (
        make_submission(db, a, S1),
        make_submission(db, a, add_student(db, 1, "Two", "STU500", enroll_in=COURSE_A)),
    )
    assert grade(client, s1, mark=15, release=True).status_code == 200
    n = of_type(db, "grade_released")
    assert [x["user_id"] for x in n] == [S1]
    assert (
        n[0]["title"] == "Grade released: Assignment 1" and n[0]["link"] == f"/student/assignments/{a['id']}"
    )
    assert s2["grade_released"] is False


def test_grading_without_releasing_notifies_nobody(client, db):
    a = make_assignment(db)
    sub = make_submission(db, a, S1)
    grade(client, sub, mark=15)
    assert not db.tables.get("notifications")


def test_release_only_notifies_then_regrading_does_not_notify_again(client, db):
    a = make_assignment(db)
    sub = make_submission(db, a, S1)
    grade(client, sub, mark=15)
    grade(client, sub, release=True)
    assert len(of_type(db, "grade_released", S1)) == 1
    grade(client, sub, mark=17, feedback="Re-marked")  # already visible: a correction, not news
    grade(client, sub, release=False)
    assert len(of_type(db, "grade_released", S1)) == 1
    grade(client, sub, release=True)  # hidden then shown again: the student is told again
    assert len(of_type(db, "grade_released", S1)) == 2


def test_bulk_release_notifies_only_the_students_it_reveals(client, db):
    a = make_assignment(db)
    other = add_student(db, 1, "Two", "STU500", enroll_in=COURSE_A)
    third = add_student(db, 2, "Three", "STU501", enroll_in=COURSE_A)
    s1 = make_submission(db, a, S1)
    make_submission(db, a, other, status="graded", mark=10)
    make_submission(db, a, third)  # not graded: untouched
    s1.update(status="graded", mark=12, graded_by=L1, graded_at="2026-10-05T10:00:00+00:00")
    already = next(s for s in db.tables["submissions"] if s["student_id"] == other)
    already.update(grade_released=True, graded_by=L1, graded_at="2026-10-05T10:00:00+00:00")
    r = client.post(
        f"/api/v1/assignments/{a['id']}/grades/release", headers=bearer(L1), json={"released": True}
    )
    assert r.json() == {"updated": 1}
    assert [n["user_id"] for n in of_type(db, "grade_released")] == [
        S1
    ]  # not `other` (already visible), not `third`


def test_bulk_hide_and_repeated_bulk_release_notify_nobody(client, db):
    a = make_assignment(db)
    s1 = make_submission(db, a, S1)
    grade(client, s1, mark=12)
    url = f"/api/v1/assignments/{a['id']}/grades/release"
    client.post(url, headers=bearer(L1), json={"released": True})
    assert len(of_type(db, "grade_released")) == 1
    client.post(url, headers=bearer(L1), json={"released": True})  # nothing changed
    client.post(url, headers=bearer(L1), json={"released": False})
    assert len(of_type(db, "grade_released")) == 1


def test_a_failed_notification_never_blocks_a_grade_release(client, db):
    a = make_assignment(db)
    sub = make_submission(db, a, S1)
    grade(client, sub, mark=15)
    db.fail_insert_tables.add("notifications")
    r = grade(client, sub, release=True)
    assert r.status_code == 200 and r.json()["grade_released"] is True
    assert not db.tables.get("notifications")


def test_a_failed_bulk_notification_never_blocks_a_bulk_release(client, db):
    a = make_assignment(db)
    sub = make_submission(db, a, S1)
    grade(client, sub, mark=15)
    db.fail_insert_tables.add("notifications")
    r = client.post(
        f"/api/v1/assignments/{a['id']}/grades/release", headers=bearer(L1), json={"released": True}
    )
    assert r.status_code == 200 and r.json() == {"updated": 1}


def test_returning_for_revision_sends_no_notification(client, db):
    a = make_assignment(db)
    sub = make_submission(db, a, S1)
    assert grade(client, sub, return_for_revision=True, feedback="Redo section 2").status_code == 200
    assert not db.tables.get("notifications")


# =============================== the helpers themselves ===============================
def test_notify_users_deduplicates_and_ignores_an_empty_list(db):
    assert notification_service.notify_users([], "general", "t", "m") == 0
    assert notification_service.notify_users([S1, S1, S2], "general", "t", "m", "/x") == 2
    assert {n["user_id"] for n in db.tables["notifications"]} == {S1, S2}


def test_notify_course_returns_zero_instead_of_raising(db):
    db.fail_rpc_after.add("notify_course_students")
    assert notification_service.notify_course(COURSE_A, "general", "t", "m") == 0


def test_notify_users_returns_zero_instead_of_raising(db):
    db.fail_insert_tables.add("notifications")
    assert notification_service.notify_users([S1], "general", "t", "m") == 0
