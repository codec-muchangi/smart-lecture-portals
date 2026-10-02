"""Controlled academic setup: duplicates, active-only rules, history-preserving withdrawal, audit."""

import pytest

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.services import course_setup_service as svc
from tests.conftest import COURSE_A, COURSE_B, L1, S1, S2, add_student


def course(db, cid=COURSE_A):
    return next(c for c in db.tables["courses"] if c["id"] == cid)


def enrollments(db, student_id=None):
    return [e for e in db.tables["course_enrollments"] if student_id is None or e["student_id"] == student_id]


# ---------- courses ----------
def test_create_course_stores_and_audits(db):
    c = svc.create_course("  CIT 4000 ", "Compilers", "2026/2027", "Semester 2", 4, "Parsing")
    assert c["course_code"] == "CIT 4000" and c["status"] == "active"
    assert len(db.audit("course.create")) == 1


def test_same_code_in_another_period_is_allowed_but_same_period_is_conflict(db):
    svc.create_course("CIT 3253", "Network Administration", "2027/2028", "Semester 1")
    with pytest.raises(Conflict):
        svc.create_course("CIT 3253", "Duplicate", "2026/2027", "Semester 1")


@pytest.mark.parametrize(
    "kwargs",
    [{"code": "X"}, {"name": "Y"}, {"year": ""}, {"semester": " "}, {"credits": 0}, {"credits": 31}],
)
def test_course_validation(db, kwargs):
    args = {
        "code": "CIT 9999",
        "name": "Valid Name",
        "year": "2026/2027",
        "semester": "Semester 1",
        "credits": 3,
    }
    args.update(kwargs)
    with pytest.raises(ValidationFailed):
        svc.create_course(args["code"], args["name"], args["year"], args["semester"], args["credits"])


def test_find_course_ambiguity_requires_period(db):
    svc.create_course("CIT 3253", "Network Administration", "2027/2028", "Semester 1")
    with pytest.raises(ValidationFailed) as e:
        svc.find_course("CIT 3253")
    assert len(e.value.details["offerings"]) == 2
    assert svc.find_course("CIT 3253", "2027/2028")["academic_year"] == "2027/2028"
    with pytest.raises(NotFound):
        svc.find_course("NOPE 1")


def test_set_course_status(db):
    svc.set_course_status(course(db), "archived")
    assert course(db)["status"] == "archived" and len(db.audit("course.status")) == 1
    with pytest.raises(ValidationFailed):
        svc.set_course_status(course(db), "deleted")


# ---------- lecturers ----------
def test_assign_lecturer_and_reject_duplicate(db):
    svc.assign_lecturer(course(db, COURSE_B), "LEC001")
    assert any(r["course_id"] == COURSE_B and r["lecturer_id"] == L1 for r in db.tables["course_lecturers"])
    with pytest.raises(Conflict):
        svc.assign_lecturer(course(db, COURSE_B), "LEC001")
    with pytest.raises(NotFound):
        svc.assign_lecturer(course(db, COURSE_B), "LEC999")


def test_inactive_lecturer_cannot_be_assigned(db):
    db.tables["lecturers"][0]["status"] = "inactive"
    with pytest.raises(ValidationFailed):
        svc.assign_lecturer(course(db, COURSE_B), "LEC001")


# ---------- enrollment ----------
def test_enroll_student(db):
    _, outcome = svc.enroll_student(course(db), "STU002")
    assert outcome == "enrolled" and enrollments(db, S2)[0]["status"] == "active"
    assert len(db.audit("enrollment.create")) == 1


def test_duplicate_enrollment_is_prevented_FR_COURSE_04(db):
    with pytest.raises(Conflict):
        svc.enroll_student(course(db), "STU001")  # S1 already enrolled in A
    assert len(enrollments(db, S1)) == 1


def test_enrollment_requires_known_active_student_and_active_course(db):
    with pytest.raises(NotFound):
        svc.enroll_student(course(db), "STU999")
    with pytest.raises(ValidationFailed):
        svc.enroll_student(course(db), "STU003")  # suspended student
    course(db)["status"] = "archived"
    with pytest.raises(ValidationFailed):
        svc.enroll_student(course(db), "STU002")
    assert enrollments(db, S2) == []


def test_withdraw_keeps_the_row_and_reenroll_reactivates_it(db):
    svc.withdraw_student(course(db), "STU001")
    rows = enrollments(db, S1)
    assert len(rows) == 1 and rows[0]["status"] == "withdrawn"  # history preserved, nothing deleted
    _, outcome = svc.enroll_student(course(db), "STU001")
    rows = enrollments(db, S1)
    assert outcome == "reactivated" and len(rows) == 1 and rows[0]["status"] == "active"
    assert len(db.audit("enrollment.withdraw")) == 1 and len(db.audit("enrollment.reactivate")) == 1


def test_withdraw_unenrolled_student_is_not_found(db):
    with pytest.raises(NotFound):
        svc.withdraw_student(course(db), "STU002")


def test_completed_enrollment_is_not_silently_changed(db):
    db.tables["course_enrollments"][0]["status"] = "completed"
    with pytest.raises(Conflict):
        svc.enroll_student(course(db), "STU001")


def test_bulk_enroll_reports_each_row_and_never_aborts(db):
    uid = add_student(db, 1, "Bulk One", "STU501")
    lines = ["registration_number", "STU501", "", "STU501", "STU001", "STU999", "STU003"]
    results = svc.bulk_enroll(course(db), lines)
    assert results[0] == ("STU501", "enrolled")
    assert results[1] == ("STU501", "skipped: duplicate line in file")
    assert results[2][0] == "STU001" and "already enrolled" in results[2][1]
    assert results[3][0] == "STU999" and results[3][1].startswith("skipped")
    assert results[4][0] == "STU003" and results[4][1].startswith("skipped")  # suspended student
    assert len(results) == 5  # header and blank line ignored
    assert len(enrollments(db, uid)) == 1  # enrolled exactly once
