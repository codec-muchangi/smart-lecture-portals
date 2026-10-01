"""Role + course-scope rules (SRS 3.1, acceptance tests AT-03, AT-04)."""

from tests.conftest import COURSE_A, COURSE_B, L1, S1, S2, bearer


def test_lists_only_own_courses(client, db):
    lec = client.get("/api/v1/courses", headers=bearer(L1)).json()
    stu = client.get("/api/v1/courses", headers=bearer(S1)).json()
    assert [c["id"] for c in lec["items"]] == [COURSE_A] and lec["total"] == 1
    assert [c["id"] for c in stu["items"]] == [COURSE_A]


def test_student_with_no_enrollments_sees_empty_list(client, db):
    body = client.get("/api/v1/courses", headers=bearer(S2)).json()
    assert body["items"] == [] and body["total"] == 0


def test_lecturer_cannot_open_unassigned_course_AT04(client, db):
    r = client.get(f"/api/v1/courses/{COURSE_B}", headers=bearer(L1))
    assert r.status_code == 404  # 404 not 403: no existence leak


def test_student_cannot_open_unenrolled_course(client, db):
    assert client.get(f"/api/v1/courses/{COURSE_B}", headers=bearer(S1)).status_code == 404
    assert client.get(f"/api/v1/courses/{COURSE_A}", headers=bearer(S2)).status_code == 404


def test_enrolled_student_and_assigned_lecturer_can_open_course(client, db):
    assert client.get(f"/api/v1/courses/{COURSE_A}", headers=bearer(S1)).status_code == 200
    assert client.get(f"/api/v1/courses/{COURSE_A}", headers=bearer(L1)).status_code == 200


def test_student_cannot_use_lecturer_only_endpoint_AT03(client, db):
    r = client.get(f"/api/v1/courses/{COURSE_A}/students", headers=bearer(S1))
    assert r.status_code == 403 and r.json()["code"] == "FORBIDDEN"


def test_lecturer_can_list_students_only_for_assigned_course(client, db):
    assert client.get(f"/api/v1/courses/{COURSE_A}/students", headers=bearer(L1)).status_code == 200
    assert client.get(f"/api/v1/courses/{COURSE_B}/students", headers=bearer(L1)).status_code == 404


def test_withdrawn_enrollment_loses_access(client, db):
    db.tables["course_enrollments"][0]["status"] = "withdrawn"
    assert client.get(f"/api/v1/courses/{COURSE_A}", headers=bearer(S1)).status_code == 404


def test_protected_routes_reject_anonymous(client, db):
    for path in ("/api/v1/me", "/api/v1/courses", f"/api/v1/courses/{COURSE_A}"):
        assert client.get(path).status_code == 401, path
