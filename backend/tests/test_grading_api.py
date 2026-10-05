"""Phase 5 (grading): FR-LEC-08, FR-ASG-08/09/10, FR-STU-07/08, workflow 5.3, AT-10, AT-11, AT-12."""

from datetime import timedelta

import pytest

from tests import file_samples as samples
from tests.conftest import (
    COURSE_A,
    COURSE_B,
    L1,
    S1,
    S2,
    add_student,
    assert_grading_invariants,
    bearer,
    make_assignment,
    make_submission,
)


def grade(client, sub, who=L1, **body):
    return client.patch(f"/api/v1/submissions/{sub['id']}/grade", headers=bearer(who), json=body)


def student_view(client, a, who=S1):
    return client.get(f"/api/v1/assignments/{a['id']}/submissions/me", headers=bearer(who)).json()


def row(db, sub):
    return next(s for s in db.tables["submissions"] if s["id"] == sub["id"])


def set_course_status(db, course_id, status):
    next(c for c in db.tables["courses"] if c["id"] == course_id)["status"] = status


@pytest.fixture
def setup(db, clock):
    a = make_assignment(db, max_marks=20)
    return a, make_submission(db, a, S1)


# =============================== grading ===============================
def test_lecturer_grades_a_submission_AT10(client, db, setup):
    a, sub = setup
    r = grade(client, sub, mark=15, feedback="Good structure, weak conclusion")
    assert r.status_code == 200
    body = r.json()
    assert (
        body["status"] == "graded"
        and body["mark"] == 15
        and body["feedback"] == "Good structure, weak conclusion"
    )
    assert body["grade_released"] is False  # visible only after release (5.3)
    assert body["student_name"] == "Demo Student" and body["registration_number"] == "STU001"
    saved = row(db, sub)
    assert saved["graded_by"] == L1 and saved["graded_at"] is not None
    assert_grading_invariants(db)


def test_grading_is_audited_with_old_and_new_values(client, db, setup):
    _, sub = setup
    grade(client, sub, mark=15, feedback="ok")
    log = db.audit("submission.grade")
    assert len(log) == 1 and log[0]["actor_user_id"] == L1 and log[0]["entity_id"] == sub["id"]
    assert log[0]["old_value"] == {
        "status": "submitted",
        "mark": None,
        "feedback": None,
        "grade_released": False,
    }
    assert log[0]["new_value"] == {"status": "graded", "mark": 15, "feedback": "ok", "grade_released": False}


def test_grade_is_hidden_from_the_student_until_released_AT12(client, db, setup):
    a, sub = setup
    grade(client, sub, mark=15, feedback="Well done")
    hidden = student_view(client, a)
    assert hidden["status"] == "graded" and hidden["mark"] is None and hidden["feedback"] is None
    assert hidden["grade_released"] is False
    grade(client, sub, release=True)
    shown = student_view(client, a)
    assert shown["mark"] == 15 and shown["feedback"] == "Well done" and shown["grade_released"] is True


def test_grade_and_release_in_one_call(client, db, setup):
    a, sub = setup
    assert grade(client, sub, mark=18, release=True).json()["grade_released"] is True
    assert student_view(client, a)["mark"] == 18


def test_regrading_updates_the_mark_and_is_audited(client, db, setup):
    _, sub = setup
    grade(client, sub, mark=10, feedback="first pass")
    row(db, sub)["graded_by"] = "someone-else"  # as if another lecturer graded first
    r = grade(client, sub, mark=14)
    assert r.json()["mark"] == 14 and r.json()["feedback"] == "first pass"  # omitted feedback is kept
    assert row(db, sub)["graded_by"] == L1  # the regrader is recorded
    last = db.audit("submission.grade")[-1]
    assert last["old_value"]["mark"] == 10 and last["new_value"]["mark"] == 14
    assert_grading_invariants(db)


def test_regrading_a_released_grade_changes_what_the_student_sees(client, db, setup):
    a, sub = setup
    grade(client, sub, mark=10, release=True)
    grade(client, sub, mark=12)  # release flag is kept
    assert student_view(client, a)["mark"] == 12


def test_release_and_hide_without_regrading(client, db, setup):
    a, sub = setup
    grade(client, sub, mark=15)
    row(db, sub)["graded_by"] = "original-grader"
    assert grade(client, sub, release=True).json()["grade_released"] is True
    assert row(db, sub)["graded_by"] == "original-grader"  # releasing does not take over the grade
    assert db.audit("submission.release")[0]["old_value"]["grade_released"] is False
    assert grade(client, sub, release=False).json()["grade_released"] is False
    assert db.audit("submission.hide")[0]["new_value"]["grade_released"] is False
    assert student_view(client, a)["mark"] is None


def test_feedback_can_be_changed_and_cleared(client, db, setup):
    _, sub = setup
    grade(client, sub, mark=15, feedback="first")
    assert grade(client, sub, feedback="second").json()["feedback"] == "second"
    assert grade(client, sub, feedback="   ").json()["feedback"] is None
    assert row(db, sub)["mark"] == 15


def test_an_unchanged_regrade_writes_nothing(client, db, setup):
    _, sub = setup
    grade(client, sub, mark=15, feedback="same", release=True)
    before = len(db.tables["audit_logs"])
    assert grade(client, sub, mark=15.0, feedback="same", release=True).status_code == 200
    assert len(db.tables["audit_logs"]) == before


# ---------- mark validation: FR-ASG-09, AT-11 ----------
@pytest.mark.parametrize("mark", [0, 0.5, 19.99, 20])
def test_marks_within_range_are_accepted(client, db, setup, mark):
    _, sub = setup
    assert grade(client, sub, mark=mark).status_code == 200
    assert row(db, sub)["mark"] == mark


@pytest.mark.parametrize("mark", [20.01, 21, 100, 1000])
def test_mark_above_the_assignment_maximum_is_rejected_AT11(client, db, setup, mark):
    _, sub = setup
    r = grade(client, sub, mark=mark)
    assert r.status_code == 400 and r.json()["code"] == "MARK_OUT_OF_RANGE"
    assert r.json()["details"]["max_marks"] == 20 and r.json()["details"]["mark"] == mark
    saved = row(db, sub)
    assert saved["status"] == "submitted" and saved["mark"] is None
    assert db.audit("submission.grade") == []


def test_the_limit_is_the_assignments_own_maximum(client, db, clock):
    a = make_assignment(db, max_marks=20.5)
    sub = make_submission(db, a, S1)
    assert grade(client, sub, mark=20.5).status_code == 200
    assert grade(client, sub, mark=20.51).status_code == 400


@pytest.mark.parametrize("mark", [-1, -0.01, 1001, 12.345, "ten", True, [5]])
def test_malformed_marks_are_422(client, db, setup, mark):
    _, sub = setup
    r = grade(client, sub, mark=mark)
    assert r.status_code == 422 and "mark" in r.json()["details"]
    assert row(db, sub)["status"] == "submitted"


def test_a_released_mark_cannot_end_up_above_the_maximum_via_regrade(client, db, setup):
    _, sub = setup
    grade(client, sub, mark=20, release=True)
    assert grade(client, sub, mark=25).status_code == 400
    assert row(db, sub)["mark"] == 20


# ---------- request shape ----------
@pytest.mark.parametrize("body", [{}, {"return_for_revision": False}])
def test_an_empty_request_is_rejected(client, db, setup, body):
    _, sub = setup
    r = grade(client, sub, **body)
    assert r.status_code == 400 and r.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    "body",
    [
        {"status": "graded"},
        {"graded_by": S1},
        {"grade_released": True},
        {"graded_at": "2026-01-01"},
        {"student_id": S2},
        {"id": "x"},
        {"mark": 5, "assignment_id": "x"},
    ],
)
def test_unknown_or_forbidden_fields_are_rejected(client, db, setup, body):
    _, sub = setup
    assert grade(client, sub, **body).status_code == 422
    assert row(db, sub)["status"] == "submitted"


def test_feedback_too_long_is_422(client, db, setup):
    _, sub = setup
    assert grade(client, sub, mark=5, feedback="x" * 2001).status_code == 422


def test_cannot_release_or_comment_on_work_that_was_never_graded(client, db, setup):
    _, sub = setup
    r = grade(client, sub, release=True)
    assert r.status_code == 409 and "Enter a mark first" in r.json()["message"]
    assert grade(client, sub, feedback="just a comment").status_code == 409
    assert row(db, sub)["grade_released"] is False
    assert_grading_invariants(db)


# =============================== return for revision ===============================
def test_return_for_revision_sends_feedback_but_no_mark_FR_STU_07(client, db, setup):
    a, sub = setup
    r = grade(client, sub, return_for_revision=True, feedback="Cite your sources, then resubmit")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "returned" and body["mark"] is None and body["grade_released"] is False
    saved = row(db, sub)
    assert saved["graded_by"] is None and saved["graded_at"] is None
    seen = student_view(client, a)
    assert seen["status"] == "returned" and seen["feedback"] == "Cite your sources, then resubmit"
    assert seen["mark"] is None  # the student can read what to fix even though nothing is "released"
    assert db.audit("submission.return")[0]["new_value"]["status"] == "returned"
    assert_grading_invariants(db)


def test_returning_a_graded_submission_clears_its_mark_and_release(client, db, setup):
    a, sub = setup
    grade(client, sub, mark=12, release=True)
    grade(client, sub, return_for_revision=True, feedback="Redo part 2")
    saved = row(db, sub)
    assert saved["status"] == "returned" and saved["mark"] is None and saved["grade_released"] is False
    assert (
        db.audit("submission.return")[0]["old_value"]["mark"] == 12
    )  # the old mark survives in the audit trail
    assert student_view(client, a)["mark"] is None
    assert_grading_invariants(db)


@pytest.mark.parametrize(
    "body",
    [
        {"return_for_revision": True},
        {"return_for_revision": True, "feedback": "   "},
        {"return_for_revision": True, "feedback": "fix", "mark": 5},
        {"return_for_revision": True, "feedback": "fix", "release": True},
    ],
)
def test_return_for_revision_validation(client, db, setup, body):
    _, sub = setup
    r = grade(client, sub, **body)
    assert r.status_code == 400 and r.json()["code"] == "VALIDATION_ERROR"
    assert row(db, sub)["status"] == "submitted"


def test_returning_twice_with_the_same_feedback_is_a_no_op(client, db, setup):
    _, sub = setup
    grade(client, sub, return_for_revision=True, feedback="Redo")
    before = len(db.tables["audit_logs"])
    assert grade(client, sub, return_for_revision=True, feedback="Redo").status_code == 200
    assert len(db.tables["audit_logs"]) == before


def test_full_revision_cycle_return_resubmit_grade_release(client, db, clock):
    a = make_assignment(db, due_in_days=7, max_marks=20)
    submit = lambda name: client.post(  # noqa: E731
        f"/api/v1/assignments/{a['id']}/submissions",
        headers=bearer(S1),
        files={"file": (name, samples.pdf())},
    )
    first = submit("v1.pdf").json()
    sub = {"id": first["id"]}
    grade(client, sub, return_for_revision=True, feedback="Add references")
    assert student_view(client, a)["feedback"] == "Add references"
    clock.advance(timedelta(days=1))
    again = submit("v2.pdf")
    assert (
        again.status_code == 200
        and again.json()["status"] == "submitted"
        and again.json()["feedback"] is None
    )
    assert grade(client, sub, mark=17, release=True).status_code == 200
    final = student_view(client, a)
    assert final["status"] == "graded" and final["mark"] == 17 and final["feedback"] is None
    assert [e["action"] for e in db.tables["audit_logs"] if e["action"].startswith("submission.")] == [
        "submission.create",
        "submission.return",
        "submission.replace",
        "submission.grade",
    ]
    assert_grading_invariants(db)


def test_grading_a_returned_submission_drops_the_old_revision_comment(client, db, setup):
    _, sub = setup
    grade(client, sub, return_for_revision=True, feedback="Redo it")
    assert grade(client, sub, mark=14).json()["feedback"] is None  # that comment belonged to the return


def test_a_graded_submission_still_cannot_be_replaced_by_the_student(client, db, clock):
    a = make_assignment(db)
    sub = make_submission(db, a, S1)
    grade(client, sub, mark=15)
    r = client.post(
        f"/api/v1/assignments/{a['id']}/submissions",
        headers=bearer(S1),
        files={"file": ("v2.pdf", samples.pdf())},
    )
    assert r.status_code == 409 and row(db, sub)["mark"] == 15


# =============================== authorization (FR-ASG-08) ===============================
def test_students_and_anonymous_users_cannot_grade(client, db, setup):
    _, sub = setup
    assert grade(client, sub, who=S1, mark=20).status_code == 403
    assert client.patch(f"/api/v1/submissions/{sub['id']}/grade", json={"mark": 20}).status_code == 401
    assert row(db, sub)["mark"] is None and db.tables.get("audit_logs", []) == []


def test_a_lecturer_cannot_grade_in_a_course_they_are_not_assigned_to(client, db, clock):
    other = make_submission(db, make_assignment(db, course_id=COURSE_B), S1)
    assert grade(client, other, mark=5).status_code == 404
    assert row(db, other)["mark"] is None


def test_an_unassigned_lecturer_loses_the_right_to_grade(client, db, setup):
    _, sub = setup
    db.tables["course_lecturers"].clear()
    assert grade(client, sub, mark=5).status_code == 404


def test_unknown_and_malformed_ids(client, db, setup):
    assert (
        client.patch(
            "/api/v1/submissions/00000000-0000-0000-0000-00000000ffff/grade",
            headers=bearer(L1),
            json={"mark": 5},
        ).status_code
        == 404
    )
    assert (
        client.patch("/api/v1/submissions/not-a-uuid/grade", headers=bearer(L1), json={"mark": 5}).status_code
        == 422
    )


@pytest.mark.parametrize("status", ["archived", "inactive"])
def test_grading_is_blocked_in_a_read_only_course(client, db, setup, status):
    _, sub = setup
    set_course_status(db, COURSE_A, status)
    assert grade(client, sub, mark=5).status_code == 409
    assert row(db, sub)["mark"] is None


def test_a_withdrawn_students_work_can_still_be_graded(client, db, setup):
    _, sub = setup
    db.tables["course_enrollments"][0]["status"] = "withdrawn"
    assert grade(client, sub, mark=11).status_code == 200


def test_grading_one_student_never_touches_another(client, db, clock):
    a = make_assignment(db)
    other = add_student(db, 1, "Second Student", "STU900", enroll_in=COURSE_A)
    mine, theirs = make_submission(db, a, S1), make_submission(db, a, other)
    grade(client, mine, mark=15, release=True)
    assert row(db, theirs)["status"] == "submitted" and row(db, theirs)["mark"] is None
    assert_grading_invariants(db)


def test_the_student_never_sees_other_students_grades(client, db, clock):
    a = make_assignment(db)
    other = add_student(db, 1, "Second Student", "STU900", enroll_in=COURSE_A)
    grade(client, make_submission(db, a, other), mark=19, release=True)
    assert client.get(f"/api/v1/assignments/{a['id']}/submissions/me", headers=bearer(S1)).status_code == 404
    assert (
        client.get(f"/api/v1/courses/{COURSE_A}/assignments", headers=bearer(S1)).json()["items"][0][
            "my_submission"
        ]
        is None
    )


# =============================== atomicity (FR-MARK-07 / SRS 15) ===============================
def test_a_grade_and_its_audit_row_succeed_or_fail_together(client, db, setup):
    _, sub = setup
    db.fail_rpc_after.add("apply_grade")  # the database "crashes" after doing the work
    r = grade(client, sub, mark=15)
    assert r.status_code == 500 and r.json()["code"] == "INTERNAL_ERROR" and "simulated" not in r.text
    assert row(db, sub)["status"] == "submitted" and row(db, sub)["mark"] is None
    assert db.audit("submission.grade") == []


def test_a_database_rule_violation_is_a_clean_conflict(client, db, setup, monkeypatch):
    from app.repositories import submission_repository

    _, sub = setup

    def boom(*args, **kwargs):
        raise Exception('{"code":"23514","message":"grader is not assigned to this course"}')

    monkeypatch.setattr(submission_repository, "apply_grade", boom)
    r = grade(client, sub, mark=5)
    assert r.status_code == 409 and "reload" in r.json()["message"]


# =============================== bulk release ===============================
def release_all(client, a, who=L1, released=True):
    return client.post(
        f"/api/v1/assignments/{a['id']}/grades/release", headers=bearer(who), json={"released": released}
    )


def test_release_all_shows_every_graded_submission_and_ignores_the_rest(client, db, clock):
    a = make_assignment(db)
    ids = [add_student(db, n, f"Student {n}", f"STU80{n}", enroll_in=COURSE_A) for n in range(1, 4)]
    graded1 = make_submission(db, a, S1, status="graded", mark=10)
    graded2 = make_submission(db, a, ids[0], status="graded", mark=12)
    already = make_submission(db, a, ids[1], status="graded", mark=14, grade_released=True)
    pending = make_submission(db, a, ids[2], status="submitted")
    for s in (graded1, graded2, already):
        s["graded_by"], s["graded_at"] = L1, "2026-10-05T10:00:00+00:00"
    r = release_all(client, a)
    assert r.status_code == 200 and r.json() == {"updated": 2}  # `already` was released before
    assert row(db, graded1)["grade_released"] and row(db, graded2)["grade_released"]
    assert row(db, pending)["grade_released"] is False and row(db, pending)["status"] == "submitted"
    assert release_all(client, a).json() == {"updated": 0}  # idempotent
    log = db.audit("grades.release_all")
    assert len(log) == 2 and log[0]["new_value"] == {"count": 2} and log[0]["entity_id"] == a["id"]
    assert_grading_invariants(db)


def test_hide_all_takes_grades_back_from_students(client, db, clock):
    a = make_assignment(db)
    s = make_submission(db, a, S1, status="graded", mark=10, grade_released=True)
    s["graded_by"], s["graded_at"] = L1, "2026-10-05T10:00:00+00:00"
    assert release_all(client, a, released=False).json() == {"updated": 1}
    assert student_view(client, a)["mark"] is None
    assert db.audit("grades.hide_all")[0]["new_value"] == {"count": 1}


def test_release_all_only_affects_that_assignment(client, db, clock):
    a, b = make_assignment(db, title="A"), make_assignment(db, title="B")
    sa = make_submission(db, a, S1, status="graded", mark=10)
    sb = make_submission(db, b, S1, status="graded", mark=11)
    for s in (sa, sb):
        s["graded_by"], s["graded_at"] = L1, "2026-10-05T10:00:00+00:00"
    release_all(client, a)
    assert row(db, sa)["grade_released"] is True and row(db, sb)["grade_released"] is False


def test_release_all_authorization_and_validation(client, db, clock):
    a = make_assignment(db)
    other = make_assignment(db, course_id=COURSE_B)
    assert release_all(client, a, who=S1).status_code == 403
    assert (
        client.post(f"/api/v1/assignments/{a['id']}/grades/release", json={"released": True}).status_code
        == 401
    )
    assert release_all(client, other).status_code == 404
    assert release_all(client, {"id": "00000000-0000-0000-0000-00000000ffff"}).status_code == 404
    for body in ({}, {"released": "yes"}, {"released": True, "extra": 1}):
        r = client.post(f"/api/v1/assignments/{a['id']}/grades/release", headers=bearer(L1), json=body)
        assert r.status_code == 422, body
    set_course_status(db, COURSE_A, "archived")
    assert release_all(client, a).status_code == 409


def test_release_all_is_atomic(client, db, clock):
    a = make_assignment(db)
    s = make_submission(db, a, S1, status="graded", mark=10)
    s["graded_by"], s["graded_at"] = L1, "2026-10-05T10:00:00+00:00"
    db.fail_rpc_after.add("release_grades")
    assert release_all(client, a).status_code == 500
    assert row(db, s)["grade_released"] is False and db.audit("grades.release_all") == []


# =============================== lecturer list reflects grading ===============================
def test_lecturer_list_filters_by_graded_and_returned(client, db, clock):
    a = make_assignment(db)
    other = add_student(db, 1, "Second Student", "STU900", enroll_in=COURSE_A)
    s1, s2 = make_submission(db, a, S1), make_submission(db, a, other)
    grade(client, s1, mark=15)
    grade(client, s2, return_for_revision=True, feedback="redo")
    graded = client.get(f"/api/v1/assignments/{a['id']}/submissions?status=graded", headers=bearer(L1)).json()
    returned = client.get(
        f"/api/v1/assignments/{a['id']}/submissions?status=returned", headers=bearer(L1)
    ).json()
    assert [i["mark"] for i in graded["items"]] == [15] and [i["feedback"] for i in returned["items"]] == [
        "redo"
    ]
    detail = client.get(f"/api/v1/assignments/{a['id']}", headers=bearer(L1)).json()
    assert detail["submission_counts"] == {"submitted": 0, "late": 0, "graded": 1, "returned": 1, "total": 2}


def test_lowering_max_marks_below_an_awarded_mark_is_still_blocked_after_real_grading(client, db, setup):
    a, sub = setup
    grade(client, sub, mark=18)
    r = client.patch(f"/api/v1/assignments/{a['id']}", headers=bearer(L1), json={"max_marks": 15})
    assert r.status_code == 409 and "18" in r.json()["message"]
    assert (
        client.patch(f"/api/v1/assignments/{a['id']}", headers=bearer(L1), json={"max_marks": 18}).status_code
        == 200
    )


def test_grading_a_submission_whose_assignment_is_gone_is_404(client, db, clock):
    orphan = make_submission(db, {"id": "00000000-0000-0000-0000-0000000000aa", "course_id": COURSE_A})
    assert grade(client, orphan, mark=5).status_code == 404
