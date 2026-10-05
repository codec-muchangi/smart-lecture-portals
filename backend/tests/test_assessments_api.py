"""Phase 5 (assessments): FR-MARK-01/02/05, FR-LEC-11/12, AT-19."""

import pytest

from tests.conftest import COURSE_A, COURSE_B, L1, S1, S2, add_student, bearer, make_assessment, make_mark

COURSE_URL = f"/api/v1/courses/{COURSE_A}/assessments"


def create(client, who=L1, course=COURSE_A, **over):
    body = {"name": "CAT 1", "type": "cat", "max_marks": 30}
    body.update(over)
    return client.post(f"/api/v1/courses/{course}/assessments", headers=bearer(who), json=body)


def patch(client, a, who=L1, **fields):
    return client.patch(f"/api/v1/assessments/{a['id']}", headers=bearer(who), json=fields)


def rows(db):
    return db.tables.get("assessments", [])


def set_course_status(db, course_id, status):
    next(c for c in db.tables["courses"] if c["id"] == course_id)["status"] = status


# =============================== create ===============================
def test_lecturer_creates_an_unpublished_assessment(client, db):
    r = create(client, weight=15)
    assert r.status_code == 201
    a = r.json()
    assert a["name"] == "CAT 1" and a["type"] == "cat" and a["max_marks"] == 30 and a["weight"] == 15
    assert a["published"] is False  # marks stay private until published (FR-MARK-05)
    assert a["created_by"] == L1 and a["course_id"] == COURSE_A and a["marks_entered"] == 0
    assert rows(db)[0]["created_by"] == L1


def test_weight_is_optional_and_name_is_trimmed(client, db):
    a = create(client, name="  Lab Report  ", type="practical").json()
    assert a["weight"] is None and a["name"] == "Lab Report"


def test_creation_is_audited(client, db):
    a = create(client, weight=20).json()
    log = db.audit("assessment.create")
    assert len(log) == 1 and log[0]["actor_user_id"] == L1 and log[0]["entity_id"] == a["id"]
    assert log[0]["new_value"]["weight"] == 20


@pytest.mark.parametrize("kind", ["cat", "assignment", "practical", "exam", "other"])
def test_all_assessment_types_are_accepted(client, db, kind):
    assert create(client, type=kind, name=f"A {kind}").status_code == 201


@pytest.mark.parametrize(
    "over",
    [
        {"name": ""},
        {"name": "A"},
        {"name": "x" * 101},
        {"type": "quiz"},
        {"type": None},
        {"max_marks": 0},
        {"max_marks": -1},
        {"max_marks": 1000.01},
        {"max_marks": 10.005},
        {"max_marks": "ten"},
        {"max_marks": True},
        {"max_marks": None},
        {"weight": 0},
        {"weight": -5},
        {"weight": 100.01},
        {"weight": 12.345},
        {"weight": "heavy"},
        {"weight": True},
    ],
)
def test_invalid_fields_are_422(client, db, over):
    assert create(client, **over).status_code == 422
    assert rows(db) == []


def test_boundary_values_are_accepted(client, db):
    assert create(client, name="Max", max_marks=1000, weight=100).status_code == 201
    assert create(client, name="Tiny", max_marks=0.01, course=COURSE_A).status_code == 201


def test_missing_required_fields_and_extra_fields(client, db):
    for missing in ("name", "type", "max_marks"):
        body = {"name": "CAT 1", "type": "cat", "max_marks": 30}
        body.pop(missing)
        assert client.post(COURSE_URL, headers=bearer(L1), json=body).status_code == 422
    for extra in ({"published": True}, {"course_id": COURSE_B}, {"created_by": S1}, {"id": "x"}):
        assert create(client, **extra).status_code == 422
    assert rows(db) == []


def test_create_authorization_and_read_only_courses(client, db):
    assert create(client, who=S1).status_code == 403
    assert client.post(COURSE_URL, json={"name": "CAT 1", "type": "cat", "max_marks": 30}).status_code == 401
    assert create(client, course=COURSE_B).status_code == 404
    for status in ("archived", "inactive"):
        set_course_status(db, COURSE_A, status)
        assert create(client).status_code == 409
    assert rows(db) == []


# =============================== weights add up to at most 100 ===============================
def test_weights_may_add_up_to_exactly_100(client, db):
    assert create(client, name="CAT 1", weight=30).status_code == 201
    assert create(client, name="CAT 2", weight=30).status_code == 201
    assert create(client, name="Exam", type="exam", max_marks=100, weight=40).status_code == 201


def test_weights_above_100_are_refused(client, db):
    create(client, name="CAT 1", weight=60)
    r = create(client, name="Exam", type="exam", weight=40.01)
    assert (
        r.status_code == 409 and "100" in r.json()["message"] and r.json()["details"]["other_weights"] == 60
    )
    assert len(rows(db)) == 1


def test_unweighted_assessments_do_not_use_up_the_budget(client, db):
    create(client, name="Quiz", weight=None)
    assert create(client, name="Exam", type="exam", weight=100).status_code == 201


def test_the_weight_budget_is_per_course(client, db):
    db.tables["course_lecturers"].append({"id": "cl2", "course_id": COURSE_B, "lecturer_id": L1})
    create(client, weight=100)
    assert create(client, course=COURSE_B, weight=100).status_code == 201


def test_raising_a_weight_beyond_the_budget_is_refused_and_lowering_frees_it(client, db):
    a = create(client, name="CAT 1", weight=50).json()
    create(client, name="Exam", type="exam", weight=50)
    assert patch(client, a, weight=60).status_code == 409
    assert patch(client, a, weight=40).status_code == 200
    assert create(client, name="Quiz", weight=10).status_code == 201


def test_decimal_weights_are_summed_exactly(client, db):
    for n in range(3):
        assert create(client, name=f"Part {n}", weight=33.33).status_code == 201
    assert create(client, name="Rest", weight=0.01).status_code == 201  # 99.99 + 0.01 == 100.00 exactly
    assert create(client, name="Over", weight=0.01).status_code == 409


# =============================== list ===============================
def test_lecturer_sees_all_with_mark_counts_students_only_published(client, db):
    a = make_assessment(db, name="Draft CAT", published=False)
    b = make_assessment(db, name="Published CAT", published=True)
    make_mark(db, a, S1, 10)
    make_mark(db, b, S1, 20)
    make_mark(db, b, S2, 25)
    lec = client.get(COURSE_URL, headers=bearer(L1)).json()
    stu = client.get(COURSE_URL, headers=bearer(S1)).json()
    assert lec["total"] == 2 and {i["name"]: i["marks_entered"] for i in lec["items"]} == {
        "Draft CAT": 1,
        "Published CAT": 2,
    }
    assert [i["name"] for i in stu["items"]] == ["Published CAT"] and stu["items"][0]["marks_entered"] is None


def test_list_order_and_pagination(client, db):
    for n in range(3):
        make_assessment(db, name=f"CAT {n}")
    p1 = client.get(f"{COURSE_URL}?page=1&page_size=2", headers=bearer(L1)).json()
    p2 = client.get(f"{COURSE_URL}?page=2&page_size=2", headers=bearer(L1)).json()
    assert p1["total"] == 3 and [i["name"] for i in p1["items"]] == ["CAT 0", "CAT 1"]
    assert [i["name"] for i in p2["items"]] == ["CAT 2"]


@pytest.mark.parametrize("qs", ["page=0", "page_size=0", "page_size=101"])
def test_bad_pagination_is_422(client, db, qs):
    assert client.get(f"{COURSE_URL}?{qs}", headers=bearer(L1)).status_code == 422


def test_list_access_rules(client, db):
    make_assessment(db, course_id=COURSE_B, published=True)
    assert client.get(COURSE_URL).status_code == 401
    assert client.get(f"/api/v1/courses/{COURSE_B}/assessments", headers=bearer(S1)).status_code == 404
    assert client.get(f"/api/v1/courses/{COURSE_B}/assessments", headers=bearer(L1)).status_code == 404
    assert client.get(COURSE_URL, headers=bearer(S2)).status_code == 404
    assert client.get(COURSE_URL, headers=bearer(L1)).json()["total"] == 0


# =============================== update / publish ===============================
def test_lecturer_edits_and_publishes_with_an_audit_trail(client, db):
    a = make_assessment(db, name="CAT 1", max_marks=30, weight=10)
    r = patch(client, a, name="  CAT One ", type="exam", max_marks=50, weight=20, published=True)
    assert r.status_code == 200
    body = r.json()
    assert (body["name"], body["type"], body["max_marks"], body["weight"], body["published"]) == (
        "CAT One",
        "exam",
        50,
        20,
        True,
    )
    log = db.audit("assessment.update")[0]
    assert log["old_value"]["name"] == "CAT 1" and log["new_value"]["name"] == "CAT One"
    assert set(log["new_value"]) == {"name", "type", "max_marks", "weight", "published"}


def test_publish_and_unpublish_toggle_student_visibility_FR_LEC_12(client, db):
    a = make_assessment(db)
    assert client.get(COURSE_URL, headers=bearer(S1)).json()["total"] == 0
    patch(client, a, published=True)
    assert client.get(COURSE_URL, headers=bearer(S1)).json()["total"] == 1
    patch(client, a, published=False)
    assert client.get(COURSE_URL, headers=bearer(S1)).json()["total"] == 0


def test_weight_can_be_removed_with_null(client, db):
    a = make_assessment(db, weight=25)
    assert patch(client, a, weight=None).json()["weight"] is None
    assert patch(client, a, weight=None).status_code == 200  # already null: no-op
    assert len(db.audit("assessment.update")) == 1


def test_max_marks_cannot_drop_below_a_mark_already_entered(client, db):
    a = make_assessment(db, max_marks=30)
    make_mark(db, a, S1, 27)
    r = patch(client, a, max_marks=25)
    assert r.status_code == 409 and "27" in r.json()["message"]
    assert rows(db)[0]["max_marks"] == 30
    assert patch(client, a, max_marks=27).status_code == 200
    assert patch(client, a, max_marks=100).status_code == 200


def test_noop_update_is_not_audited(client, db):
    a = make_assessment(db, name="Same", max_marks=30, weight=10)
    assert patch(client, a, name="Same", max_marks=30.0, weight=10.0).status_code == 200
    assert db.audit("assessment.update") == []


@pytest.mark.parametrize(
    "fields,status",
    [
        ({}, 400),
        ({"name": None}, 422),
        ({"type": None}, 422),
        ({"max_marks": None}, 422),
        ({"published": None}, 422),
        ({"name": "A"}, 422),
        ({"type": "quiz"}, 422),
        ({"max_marks": 0}, 422),
        ({"weight": 0}, 422),
        ({"weight": 101}, 422),
        ({"course_id": COURSE_B}, 422),
        ({"created_by": S1}, 422),
        ({"id": "x"}, 422),
    ],
)
def test_invalid_updates(client, db, fields, status):
    a = make_assessment(db)
    before = dict(rows(db)[0])
    assert patch(client, a, **fields).status_code == status
    assert rows(db)[0] == before


def test_update_authorization_and_read_only_courses(client, db):
    a = make_assessment(db)
    other = make_assessment(db, course_id=COURSE_B)
    url = f"/api/v1/assessments/{a['id']}"
    assert client.patch(url, json={"name": "Hacked"}).status_code == 401
    assert patch(client, a, who=S1, name="Hacked").status_code == 403
    assert patch(client, other, name="Hacked").status_code == 404
    assert (
        client.patch(
            "/api/v1/assessments/00000000-0000-0000-0000-00000000ffff",
            headers=bearer(L1),
            json={"name": "Nope"},
        ).status_code
        == 404
    )
    assert (
        client.patch("/api/v1/assessments/not-a-uuid", headers=bearer(L1), json={"name": "Nope"}).status_code
        == 422
    )
    set_course_status(db, COURSE_A, "archived")
    assert patch(client, a, name="Too late").status_code == 409
    assert rows(db)[0]["name"] == "CAT 1"


def test_no_delete_endpoint_exists(client, db):
    a = make_assessment(db)
    assert client.delete(f"/api/v1/assessments/{a['id']}", headers=bearer(L1)).status_code == 405


# =============================== the marks roster ===============================
def roster(client, a, qs="", who=L1):
    return client.get(f"/api/v1/assessments/{a['id']}/marks{qs}", headers=bearer(who))


def test_roster_lists_actively_enrolled_students_with_current_marks(client, db):
    a = make_assessment(db)
    other = add_student(db, 1, "Amy Adams", "STU201", enroll_in=COURSE_A)
    gone = add_student(db, 2, "Gone Student", "STU202", enroll_in=COURSE_A)
    db.tables["course_enrollments"][-1]["status"] = "withdrawn"
    make_mark(db, a, S1, 22, "Solid")
    body = roster(client, a).json()
    assert body["total"] == 2 and gone not in {i["student_id"] for i in body["items"]}
    by_id = {i["student_id"]: i for i in body["items"]}
    assert by_id[S1]["mark"] == 22 and by_id[S1]["feedback"] == "Solid" and by_id[S1]["updated_at"]
    assert by_id[other]["mark"] is None and by_id[other]["updated_at"] is None  # enrolled, not marked yet
    assert [i["full_name"] for i in body["items"]] == ["Amy Adams", "Demo Student"]  # sorted by name
    assert set(by_id[S1]) == {
        "student_id",
        "full_name",
        "registration_number",
        "email",
        "mark",
        "feedback",
        "updated_at",
    }


def test_roster_search_and_pagination(client, db):
    a = make_assessment(db)
    for n in range(1, 5):
        add_student(db, n, f"Student {n}", f"STU30{n}", enroll_in=COURSE_A)
    assert roster(client, a, "?q=STU303").json()["items"][0]["full_name"] == "Student 3"
    assert roster(client, a, "?q=zzz,id.neq.0").json()["total"] == 0
    p1 = roster(client, a, "?page=1&page_size=2").json()
    p3 = roster(client, a, "?page=3&page_size=2").json()
    assert p1["total"] == 5 and len(p1["items"]) == 2 and len(p3["items"]) == 1
    assert roster(client, a, "?page_size=200").status_code == 200
    assert roster(client, a, "?page_size=201").status_code == 422


def test_roster_only_shows_the_assessments_course_and_is_lecturer_only(client, db):
    a = make_assessment(db)
    other = make_assessment(db, course_id=COURSE_B)
    add_student(db, 1, "Other Course Kid", "STU401", enroll_in=COURSE_B)
    assert "STU401" not in {i["registration_number"] for i in roster(client, a).json()["items"]}
    assert roster(client, a, who=S1).status_code == 403  # AT-05: students cannot read the marks roster
    assert client.get(f"/api/v1/assessments/{a['id']}/marks").status_code == 401
    assert roster(client, other).status_code == 404
    assert (
        client.get(
            "/api/v1/assessments/00000000-0000-0000-0000-00000000ffff/marks", headers=bearer(L1)
        ).status_code
        == 404
    )
