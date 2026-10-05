"""Phase 5 (marks): FR-MARK-03/04/05/06/07, FR-STU-08, workflow 5.6, AT-05, AT-11, AT-12, AT-19."""

import pytest

from tests.conftest import (
    COURSE_A,
    COURSE_B,
    L1,
    S1,
    S2,
    add_student,
    bearer,
    make_assessment,
    make_mark,
)

BULK_MAX = 500


def put(client, a, marks, who=L1):
    return client.put(f"/api/v1/assessments/{a['id']}/marks", headers=bearer(who), json={"marks": marks})


def entry(student, mark, feedback=None):
    row = {"student_id": student, "mark": mark}
    if feedback is not None:
        row["feedback"] = feedback
    return row


def stored(db, a):
    return [m for m in db.tables.get("assessment_marks", []) if m["assessment_id"] == a["id"]]


def set_course_status(db, course_id, status):
    next(c for c in db.tables["courses"] if c["id"] == course_id)["status"] = status


@pytest.fixture
def cat(db):
    return make_assessment(db, name="CAT 1", max_marks=30, weight=15)


# =============================== entering marks ===============================
def test_lecturer_enters_marks_for_enrolled_students(client, db, cat):
    other = add_student(db, 1, "Second Student", "STU500", enroll_in=COURSE_A)
    r = put(client, cat, [entry(S1, 24, "Good"), entry(other, 18.5)])
    assert r.status_code == 200 and r.json() == {"created": 2, "updated": 0, "unchanged": 0, "total": 2}
    marks = {m["student_id"]: m for m in stored(db, cat)}
    assert marks[S1]["mark"] == 24 and marks[S1]["feedback"] == "Good" and marks[S1]["entered_by"] == L1
    assert marks[other]["mark"] == 18.5 and marks[other]["feedback"] is None


def test_every_created_mark_is_audited_FR_MARK_07(client, db, cat):
    put(client, cat, [entry(S1, 24, "Good")])
    log = db.audit("mark.create")
    assert len(log) == 1 and log[0]["actor_user_id"] == L1 and log[0]["entity_id"] == cat["id"]
    assert log[0]["old_value"] is None
    assert log[0]["new_value"] == {"student_id": S1, "mark": 24, "feedback": "Good"}


def test_updating_a_mark_records_who_changed_it_and_the_old_value(client, db, cat):
    put(client, cat, [entry(S1, 20)])
    stored(db, cat)[0]["entered_by"] = "first-lecturer"
    r = put(client, cat, [entry(S1, 25, "Re-marked")])
    assert r.json() == {"created": 0, "updated": 1, "unchanged": 0, "total": 1}
    m = stored(db, cat)[0]
    assert (
        m["mark"] == 25 and m["feedback"] == "Re-marked" and m["entered_by"] == L1
    )  # the changer is recorded
    log = db.audit("mark.update")[0]
    assert log["old_value"] == {"student_id": S1, "mark": 20, "feedback": None}
    assert log["new_value"] == {"student_id": S1, "mark": 25, "feedback": "Re-marked"}


def test_resubmitting_identical_marks_changes_and_audits_nothing(client, db, cat):
    put(client, cat, [entry(S1, 20, "ok")])
    before = len(db.tables["audit_logs"])
    r = put(client, cat, [entry(S1, 20.0, "ok")])
    assert r.json() == {"created": 0, "updated": 0, "unchanged": 1, "total": 1}
    assert len(db.tables["audit_logs"]) == before


def test_a_mixed_batch_reports_created_updated_and_unchanged(client, db, cat):
    a, b, c = (add_student(db, n, f"S{n}", f"STU60{n}", enroll_in=COURSE_A) for n in (1, 2, 3))
    make_mark(db, cat, a, 10)
    make_mark(db, cat, b, 12)
    r = put(client, cat, [entry(a, 10), entry(b, 15), entry(c, 8)])
    assert r.json() == {"created": 1, "updated": 1, "unchanged": 1, "total": 3}


def test_one_row_per_student_and_assessment_AT19(client, db, cat):
    for value in (10, 20, 30):
        put(client, cat, [entry(S1, value)])
    assert len(stored(db, cat)) == 1 and stored(db, cat)[0]["mark"] == 30


def test_boundary_marks_zero_and_max_are_valid(client, db, cat):
    other = add_student(db, 1, "Second Student", "STU500", enroll_in=COURSE_A)
    assert put(client, cat, [entry(S1, 0), entry(other, 30)]).status_code == 200


def test_marks_can_be_entered_before_and_after_publishing(client, db, cat):
    assert cat["published"] is False and put(client, cat, [entry(S1, 20)]).status_code == 200
    client.patch(f"/api/v1/assessments/{cat['id']}", headers=bearer(L1), json={"published": True})
    assert put(client, cat, [entry(S1, 22)]).status_code == 200  # a correction after release


def test_feedback_is_trimmed_and_blank_becomes_null(client, db, cat):
    put(client, cat, [entry(S1, 20, "  well done  ")])
    assert stored(db, cat)[0]["feedback"] == "well done"
    put(client, cat, [entry(S1, 20, "   ")])
    assert stored(db, cat)[0]["feedback"] is None


# ---------- validation: all or nothing (AT-11) ----------
def test_a_mark_above_the_maximum_rejects_the_whole_batch_AT11(client, db, cat):
    other = add_student(db, 1, "Second Student", "STU500", enroll_in=COURSE_A)
    r = put(client, cat, [entry(S1, 24), entry(other, 31)])
    assert r.status_code == 400 and r.json()["code"] == "MARK_OUT_OF_RANGE"
    rows = r.json()["details"]["rows"]
    assert rows == [{"index": 1, "student_id": other, "message": "Mark 31 is higher than the maximum of 30"}]
    assert stored(db, cat) == [] and db.audit("mark.create") == []  # the valid row was not saved either


def test_every_problem_is_reported_at_once(client, db, cat):
    stranger = add_student(db, 1, "Not Enrolled", "STU700")  # exists but is not in this course
    r = put(client, cat, [entry(S1, 99), entry(S1, 5), entry(stranger, 10)])
    assert r.status_code == 400 and r.json()["code"] == "MARK_OUT_OF_RANGE"
    messages = sorted((e["index"], e["message"]) for e in r.json()["details"]["rows"])
    assert messages == [
        (0, "Mark 99 is higher than the maximum of 30"),
        (1, "This student appears more than once in the request"),
        (2, "This student is not actively enrolled in the course"),
    ]
    assert stored(db, cat) == []


def test_non_enrolled_and_withdrawn_students_are_refused(client, db, cat):
    gone = add_student(db, 1, "Gone", "STU800", enroll_in=COURSE_A)
    db.tables["course_enrollments"][-1]["status"] = "withdrawn"
    for who in (S2, gone, "00000000-0000-0000-0000-00000000ffff"):
        r = put(client, cat, [entry(who, 10)])
        assert r.status_code == 400 and r.json()["code"] == "VALIDATION_ERROR"
        assert "not actively enrolled" in r.json()["details"]["rows"][0]["message"]
    assert stored(db, cat) == []


def test_a_student_listed_twice_is_refused_even_with_the_same_mark(client, db, cat):
    r = put(client, cat, [entry(S1, 10), entry(S1, 10)])
    assert r.status_code == 400 and "more than once" in r.json()["details"]["rows"][0]["message"]
    assert stored(db, cat) == []


@pytest.mark.parametrize("mark", [-1, -0.01, 1000.5, 12.345, "ten", None, True, [1]])
def test_malformed_marks_are_422(client, db, cat, mark):
    r = put(client, cat, [entry(S1, mark)])
    assert r.status_code == 422 and stored(db, cat) == []


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"marks": []},
        {"marks": "none"},
        {"marks": [{"mark": 10}]},
        {"marks": [{"student_id": S1}]},
        {"marks": [{"student_id": "nope", "mark": 10}]},
        {"marks": [{"student_id": S1, "mark": 10, "extra": 1}]},
        {"marks": [{"student_id": S1, "mark": 10, "feedback": "x" * 1001}]},
        {"marks": [entry(S1, 10)], "x": 1},
    ],
)
def test_malformed_requests_are_422(client, db, cat, payload):
    r = client.put(f"/api/v1/assessments/{cat['id']}/marks", headers=bearer(L1), json=payload)
    assert r.status_code == 422 and stored(db, cat) == []


def test_a_batch_larger_than_500_rows_is_422(client, db, cat):
    rows = [entry(f"00000000-0000-0000-0000-{n:012d}", 1) for n in range(BULK_MAX + 1)]
    assert put(client, cat, rows).status_code == 422


def test_a_full_batch_of_500_students_is_accepted(client, db, cat):
    ids = [add_student(db, n, f"Student {n}", f"STU9{n:03d}", enroll_in=COURSE_A) for n in range(1, BULK_MAX)]
    r = put(client, cat, [entry(s, 15) for s in ids + [S1]])
    assert r.status_code == 200 and r.json() == {
        "created": BULK_MAX,
        "updated": 0,
        "unchanged": 0,
        "total": BULK_MAX,
    }


# ---------- authorization ----------
def test_marks_entry_authorization(client, db, cat):
    other = make_assessment(db, course_id=COURSE_B)
    assert put(client, cat, [entry(S1, 10)], who=S1).status_code == 403  # a student cannot enter marks
    assert (
        client.put(f"/api/v1/assessments/{cat['id']}/marks", json={"marks": [entry(S1, 10)]}).status_code
        == 401
    )
    assert put(client, other, [entry(S1, 10)]).status_code == 404  # lecturer not assigned to that course
    assert (
        client.put(
            "/api/v1/assessments/00000000-0000-0000-0000-00000000ffff/marks",
            headers=bearer(L1),
            json={"marks": [entry(S1, 10)]},
        ).status_code
        == 404
    )
    db.tables["course_lecturers"].clear()
    assert put(client, cat, [entry(S1, 10)]).status_code == 404
    assert stored(db, cat) == []


@pytest.mark.parametrize("status", ["archived", "inactive"])
def test_marks_cannot_be_entered_in_a_read_only_course(client, db, cat, status):
    set_course_status(db, COURSE_A, status)
    assert put(client, cat, [entry(S1, 10)]).status_code == 409 and stored(db, cat) == []


# ---------- atomicity (NFR-REL-01) ----------
def test_marks_and_their_audit_rows_are_written_together_or_not_at_all(client, db, cat):
    other = add_student(db, 1, "Second Student", "STU500", enroll_in=COURSE_A)
    db.fail_rpc_after.add("upsert_assessment_marks")
    r = put(client, cat, [entry(S1, 20), entry(other, 25)])
    assert r.status_code == 500 and r.json()["code"] == "INTERNAL_ERROR" and "simulated" not in r.text
    assert stored(db, cat) == [] and db.tables.get("audit_logs", []) == []


def test_a_database_rule_violation_is_a_clean_conflict(client, db, cat, monkeypatch):
    from app.repositories import assessment_repository

    def boom(*args, **kwargs):
        raise Exception('{"code":"23514","message":"student is not actively enrolled in this course"}')

    monkeypatch.setattr(assessment_repository, "upsert_marks", boom)
    r = put(client, cat, [entry(S1, 10)])
    assert r.status_code == 409 and "reload" in r.json()["message"]


def test_a_race_that_withdraws_a_student_mid_request_changes_nothing(client, db, cat, monkeypatch):
    """The API check passed, then the student was withdrawn before the database transaction: the database
    function re-validates and rejects, and nothing is written."""
    from app.repositories import assessment_repository

    real = assessment_repository.upsert_marks

    def withdraw_then_write(*args, **kwargs):
        db.tables["course_enrollments"][0]["status"] = "withdrawn"
        return real(*args, **kwargs)

    monkeypatch.setattr(assessment_repository, "upsert_marks", withdraw_then_write)
    assert put(client, cat, [entry(S1, 20)]).status_code == 409
    assert stored(db, cat) == [] and db.audit("mark.create") == []


# =============================== a student's own marks ===============================
def my(client, who=S1, course=COURSE_A):
    return client.get(f"/api/v1/courses/{course}/marks/me", headers=bearer(who))


def test_student_sees_only_published_assessments_AT12(client, db):
    draft = make_assessment(db, name="Draft CAT", published=False, weight=10)
    live = make_assessment(db, name="Live CAT", published=True, weight=15)
    make_mark(db, draft, S1, 29)
    make_mark(db, live, S1, 21, "Fine")
    body = my(client).json()
    assert [i["name"] for i in body["items"]] == ["Live CAT"]  # the unpublished mark is invisible
    assert body["items"][0]["mark"] == 21 and body["items"][0]["feedback"] == "Fine"
    assert "Draft CAT" not in str(body)


def test_publishing_and_unpublishing_controls_the_students_view(client, db):
    a = make_assessment(db, name="CAT 1")
    make_mark(db, a, S1, 20)
    assert my(client).json()["items"] == []
    client.patch(f"/api/v1/assessments/{a['id']}", headers=bearer(L1), json={"published": True})
    assert my(client).json()["items"][0]["mark"] == 20
    client.patch(f"/api/v1/assessments/{a['id']}", headers=bearer(L1), json={"published": False})
    assert my(client).json()["items"] == []


def test_student_sees_only_their_own_marks_AT05(client, db):
    a = make_assessment(db, published=True)
    other = add_student(db, 1, "Second Student", "STU500", enroll_in=COURSE_A)
    make_mark(db, a, S1, 12)
    make_mark(db, a, other, 29, "private")
    mine = my(client).json()
    theirs = my(client, other).json()
    assert mine["items"][0]["mark"] == 12 and theirs["items"][0]["mark"] == 29
    assert "private" not in str(mine) and "29" not in [str(i["mark"]) for i in mine["items"]]


def test_published_but_unmarked_assessment_shows_a_null_mark(client, db):
    make_assessment(db, name="Exam", type_="exam", max_marks=100, weight=60, published=True)
    item = my(client).json()["items"][0]
    assert item["mark"] is None and item["percentage"] is None and item["weight"] == 60


def test_each_item_carries_percentage_and_the_assessment_details(client, db):
    a = make_assessment(db, name="CAT 1", type_="cat", max_marks=30, weight=15, published=True)
    make_mark(db, a, S1, 17)
    item = my(client).json()["items"][0]
    assert item["assessment_id"] == a["id"] and item["type"] == "cat" and item["max_marks"] == 30
    assert item["percentage"] == 56.67


def test_weighted_totals_FR_MARK_04(client, db):
    cat1 = make_assessment(db, name="CAT 1", max_marks=30, weight=15, published=True)
    cat2 = make_assessment(db, name="CAT 2", max_marks=50, weight=25, published=True)
    make_assessment(db, name="Exam", type_="exam", max_marks=100, weight=60, published=True)  # not marked yet
    make_assessment(db, name="Hidden", max_marks=10, weight=0.01, published=False)
    make_mark(db, cat1, S1, 24)
    make_mark(db, cat2, S1, 40)
    totals = my(client).json()["totals"]
    assert totals == {
        "weighted_total": 32.0,
        "weight_graded": 40.0,
        "weight_published": 100.0,
        "weighted_percent": 80.0,
        "marks_total": 64.0,
        "max_total": 80.0,
    }


def test_totals_are_empty_but_valid_when_nothing_is_published(client, db):
    body = my(client).json()
    assert (
        body["items"] == []
        and body["totals"]["weighted_total"] == 0
        and body["totals"]["weighted_percent"] is None
    )
    assert body["course_id"] == COURSE_A


def test_a_correction_changes_the_students_total(client, db):
    a = make_assessment(db, max_marks=30, weight=30, published=True)
    put(client, a, [entry(S1, 15)])
    assert my(client).json()["totals"]["weighted_total"] == 15.0
    put(client, a, [entry(S1, 30)])
    assert my(client).json()["totals"]["weighted_total"] == 30.0


def test_my_marks_access_rules(client, db):
    assert client.get(f"/api/v1/courses/{COURSE_A}/marks/me").status_code == 401
    assert my(client, L1).status_code == 403  # lecturers have no "my marks"
    assert my(client, S2).status_code == 404  # not enrolled
    assert my(client, S1, COURSE_B).status_code == 404
    assert client.get("/api/v1/courses/not-a-uuid/marks/me", headers=bearer(S1)).status_code == 422


def test_withdrawn_students_lose_access_and_archived_courses_stay_readable(client, db):
    a = make_assessment(db, published=True)
    make_mark(db, a, S1, 20)
    set_course_status(db, COURSE_A, "archived")
    assert my(client).json()["items"][0]["mark"] == 20  # read-only history
    set_course_status(db, COURSE_A, "inactive")
    assert my(client).status_code == 404
    set_course_status(db, COURSE_A, "active")
    db.tables["course_enrollments"][0]["status"] = "withdrawn"
    assert my(client).status_code == 404


# =============================== end to end (workflow 5.6) ===============================
def test_full_marks_workflow(client, db):
    created = client.post(
        f"/api/v1/courses/{COURSE_A}/assessments",
        headers=bearer(L1),
        json={"name": "CAT 1", "type": "cat", "max_marks": 30, "weight": 20},
    ).json()
    roster = client.get(f"/api/v1/assessments/{created['id']}/marks", headers=bearer(L1)).json()
    assert [i["mark"] for i in roster["items"]] == [None]  # enrolled students are loaded, unmarked
    assert put(client, created, [entry(roster["items"][0]["student_id"], 27, "Excellent")]).status_code == 200
    assert my(client).json()["items"] == []  # unpublished: invisible to the student
    client.patch(f"/api/v1/assessments/{created['id']}", headers=bearer(L1), json={"published": True})
    body = my(client).json()
    assert body["items"][0]["mark"] == 27 and body["totals"]["weighted_total"] == 18.0
    assert [
        a["action"] for a in db.tables["audit_logs"] if a["action"].split(".")[0] in ("assessment", "mark")
    ] == [
        "assessment.create",
        "mark.create",
        "assessment.update",
    ]
