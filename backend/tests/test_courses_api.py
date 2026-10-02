"""Phase 2: FR-COURSE-01..05, FR-STU-02/03, FR-LEC-02/03, NFR-PERF-02 (pagination), NFR-SEC-06 (IDOR)."""

import pytest

from app.core import security
from app.core.errors import Conflict
from tests.conftest import COURSE_A, COURSE_B, L1, S1, S2, add_student, bearer

COURSES = "/api/v1/courses"


def set_status(db, course_id, status):
    next(c for c in db.tables["courses"] if c["id"] == course_id)["status"] = status


# ---------- listing ----------
def test_course_list_has_full_course_fields_and_pagination_envelope(client, db):
    body = client.get(COURSES, headers=bearer(S1)).json()
    assert set(body) == {"items", "page", "page_size", "total"}
    c = body["items"][0]
    for field in (
        "course_code",
        "course_name",
        "description",
        "credit_hours",
        "academic_year",
        "semester",
        "status",
    ):
        assert field in c


def test_lecturer_with_two_courses_gets_pagination(client, db):
    db.tables["course_lecturers"].append({"id": "cl2", "course_id": COURSE_B, "lecturer_id": L1})
    page1 = client.get(f"{COURSES}?page=1&page_size=1", headers=bearer(L1)).json()
    page2 = client.get(f"{COURSES}?page=2&page_size=1", headers=bearer(L1)).json()
    assert page1["total"] == page2["total"] == 2
    assert [c["course_code"] for c in page1["items"]] == ["CIT 3253"]
    assert [c["course_code"] for c in page2["items"]] == ["CIT 3254"]


@pytest.mark.parametrize("qs", ["page=0", "page_size=0", "page_size=101", "status=bogus"])
def test_bad_list_params_are_422(client, db, qs):
    assert client.get(f"{COURSES}?{qs}", headers=bearer(S1)).status_code == 422


def test_search_matches_code_and_name_case_insensitively(client, db):
    db.tables["course_lecturers"].append({"id": "cl2", "course_id": COURSE_B, "lecturer_id": L1})
    by_name = client.get(f"{COURSES}?q=database", headers=bearer(L1)).json()
    by_code = client.get(f"{COURSES}?q=3253", headers=bearer(L1)).json()
    assert [c["id"] for c in by_name["items"]] == [COURSE_B]
    assert [c["id"] for c in by_code["items"]] == [COURSE_A]


def test_search_cannot_inject_extra_filters(client, db):
    # Commas/parentheses would add a clause to the PostgREST or=(...) filter; they must be stripped.
    r = client.get(f"{COURSES}?q=zzz,id.neq.0", headers=bearer(L1))
    assert r.status_code == 200 and r.json()["total"] == 0


def test_filter_by_period(client, db):
    db.tables["courses"][0]["semester"] = "Semester 2"
    assert client.get(f"{COURSES}?semester=Semester 2", headers=bearer(S1)).json()["total"] == 1
    assert client.get(f"{COURSES}?semester=Semester 1", headers=bearer(S1)).json()["total"] == 0


def test_default_list_is_active_only_and_archived_is_viewable(client, db):
    set_status(db, COURSE_A, "archived")
    assert client.get(COURSES, headers=bearer(S1)).json()["total"] == 0
    archived = client.get(f"{COURSES}?status=archived", headers=bearer(S1)).json()
    assert [c["id"] for c in archived["items"]] == [COURSE_A]
    assert client.get(f"{COURSES}?status=all", headers=bearer(S1)).json()["total"] == 1


def test_inactive_course_is_hidden_from_students_but_not_lecturers(client, db):
    set_status(db, COURSE_A, "inactive")
    assert client.get(f"{COURSES}?status=all", headers=bearer(S1)).json()["total"] == 0
    assert client.get(f"{COURSES}/{COURSE_A}", headers=bearer(S1)).status_code == 404
    assert client.get(f"{COURSES}?status=inactive", headers=bearer(L1)).json()["total"] == 1
    assert client.get(f"{COURSES}/{COURSE_A}", headers=bearer(L1)).status_code == 200


# ---------- detail ----------
def test_student_sees_lecturer_info_but_not_class_size(client, db):
    d = client.get(f"{COURSES}/{COURSE_A}", headers=bearer(S1)).json()
    assert d["lecturers"] == [
        {
            "id": L1,
            "full_name": "Demo Lecturer",
            "email": "lecturer@demo.test",
            "title": "Dr.",
            "department": "CS",
        }
    ]
    assert d["enrolled_count"] is None


def test_lecturer_sees_active_enrolled_count(client, db):
    add_student(db, 1, "Extra One", "STU101", enroll_in=COURSE_A)
    add_student(db, 2, "Gone", "STU102", enroll_in=COURSE_A)
    db.tables["course_enrollments"][-1]["status"] = "withdrawn"
    assert (
        client.get(f"{COURSES}/{COURSE_A}", headers=bearer(L1)).json()["enrolled_count"] == 2
    )  # S1 + Extra One


def test_unknown_course_is_404(client, db):
    assert (
        client.get(f"{COURSES}/00000000-0000-0000-0000-00000000ffff", headers=bearer(L1)).status_code == 404
    )


def test_malformed_course_id_is_422(client, db):
    assert client.get(f"{COURSES}/not-a-uuid", headers=bearer(L1)).status_code == 422


def test_withdrawn_student_loses_access_to_list_and_detail(client, db):
    db.tables["course_enrollments"][0]["status"] = "withdrawn"
    assert client.get(COURSES, headers=bearer(S1)).json()["total"] == 0
    assert client.get(f"{COURSES}/{COURSE_A}", headers=bearer(S1)).status_code == 404


# ---------- roster ----------
def test_roster_fields_exclude_private_data(client, db):
    item = client.get(f"{COURSES}/{COURSE_A}/students", headers=bearer(L1)).json()["items"][0]
    assert set(item) == {
        "student_id",
        "full_name",
        "email",
        "registration_number",
        "program",
        "year_of_study",
        "enrollment_status",
        "enrolled_at",
    }  # no phone, no avatar


def test_roster_is_paginated_sorted_and_searchable(client, db):
    for n, (name, reg) in enumerate(
        [("Zed Zulu", "STU201"), ("Amy Adams", "STU202"), ("Bob Brown", "STU203")], 1
    ):
        add_student(db, n, name, reg, enroll_in=COURSE_A)
    p1 = client.get(f"{COURSES}/{COURSE_A}/students?page=1&page_size=2", headers=bearer(L1)).json()
    assert p1["total"] == 4 and [i["full_name"] for i in p1["items"]] == ["Amy Adams", "Bob Brown"]
    p2 = client.get(f"{COURSES}/{COURSE_A}/students?page=2&page_size=2", headers=bearer(L1)).json()
    assert [i["full_name"] for i in p2["items"]] == ["Demo Student", "Zed Zulu"]
    by_reg = client.get(f"{COURSES}/{COURSE_A}/students?q=STU203", headers=bearer(L1)).json()
    assert [i["full_name"] for i in by_reg["items"]] == ["Bob Brown"]
    by_email = client.get(f"{COURSES}/{COURSE_A}/students?q=s1@demo", headers=bearer(L1)).json()
    assert [i["full_name"] for i in by_email["items"]] == ["Zed Zulu"]  # add_student(n=1) => s1@demo.test


def test_roster_defaults_to_active_and_can_show_withdrawn(client, db):
    add_student(db, 1, "Gone Student", "STU301", enroll_in=COURSE_A)
    db.tables["course_enrollments"][-1]["status"] = "withdrawn"
    active = client.get(f"{COURSES}/{COURSE_A}/students", headers=bearer(L1)).json()
    assert [i["registration_number"] for i in active["items"]] == ["STU001"]
    withdrawn = client.get(f"{COURSES}/{COURSE_A}/students?status=withdrawn", headers=bearer(L1)).json()
    assert [i["registration_number"] for i in withdrawn["items"]] == ["STU301"]
    assert client.get(f"{COURSES}/{COURSE_A}/students?status=all", headers=bearer(L1)).json()["total"] == 2


def test_roster_only_contains_that_course(client, db):
    add_student(db, 1, "Other Course Kid", "STU401", enroll_in=COURSE_B)
    regs = [
        i["registration_number"]
        for i in client.get(f"{COURSES}/{COURSE_A}/students", headers=bearer(L1)).json()["items"]
    ]
    assert "STU401" not in regs


def test_roster_is_lecturer_only_and_scoped(client, db):
    assert client.get(f"{COURSES}/{COURSE_A}/students", headers=bearer(S1)).status_code == 403
    assert client.get(f"{COURSES}/{COURSE_B}/students", headers=bearer(L1)).status_code == 404
    assert client.get(f"{COURSES}/{COURSE_A}/students").status_code == 401


# ---------- lecturer course update ----------
def test_lecturer_updates_description_and_it_is_audited(client, db):
    r = client.patch(
        f"{COURSES}/{COURSE_A}", headers=bearer(L1), json={"description": "  Networking basics  "}
    )
    assert r.status_code == 200 and r.json()["description"] == "Networking basics"
    log = db.audit("course.update")
    assert len(log) == 1 and log[0]["new_value"] == {"description": "Networking basics"}
    assert log[0]["actor_user_id"] == L1


def test_blank_description_clears_it_and_same_value_is_not_audited(client, db):
    client.patch(f"{COURSES}/{COURSE_A}", headers=bearer(L1), json={"description": "x"})
    client.patch(f"{COURSES}/{COURSE_A}", headers=bearer(L1), json={"description": "x"})
    assert len(db.audit("course.update")) == 1
    r = client.patch(f"{COURSES}/{COURSE_A}", headers=bearer(L1), json={"description": "   "})
    assert r.json()["description"] is None


@pytest.mark.parametrize(
    "payload",
    [
        {"course_code": "HACK 1"},
        {"course_name": "x"},
        {"status": "archived"},
        {"credit_hours": 99},
        {"academic_year": "2000/2001"},
        {"id": "x"},
    ],
)
def test_lecturer_cannot_change_academic_fields(client, db, payload):
    before = dict(next(c for c in db.tables["courses"] if c["id"] == COURSE_A))
    assert client.patch(f"{COURSES}/{COURSE_A}", headers=bearer(L1), json=payload).status_code == 422
    assert next(c for c in db.tables["courses"] if c["id"] == COURSE_A) == before


def test_description_too_long_and_empty_body_rejected(client, db):
    assert (
        client.patch(
            f"{COURSES}/{COURSE_A}", headers=bearer(L1), json={"description": "x" * 2001}
        ).status_code
        == 422
    )
    assert client.patch(f"{COURSES}/{COURSE_A}", headers=bearer(L1), json={}).status_code == 400


def test_student_and_unassigned_lecturer_cannot_update(client, db):
    assert (
        client.patch(f"{COURSES}/{COURSE_A}", headers=bearer(S1), json={"description": "x"}).status_code
        == 403
    )
    assert (
        client.patch(f"{COURSES}/{COURSE_B}", headers=bearer(L1), json={"description": "x"}).status_code
        == 404
    )
    assert client.patch(f"{COURSES}/{COURSE_A}", json={"description": "x"}).status_code == 401


# ---------- shared guards used by later phases ----------
def test_ensure_course_writable_blocks_archived_and_inactive(db):
    security.ensure_course_writable({"status": "active"})
    for status in ("archived", "inactive"):
        with pytest.raises(Conflict):
            security.ensure_course_writable({"status": status})


def test_student_without_enrollment_gets_empty_list_not_error(client, db):
    assert client.get(COURSES, headers=bearer(S2)).json()["items"] == []
