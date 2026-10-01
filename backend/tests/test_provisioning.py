import pytest

from app.core.errors import Conflict, ValidationFailed
from app.services.provisioning_service import provision_user
from tests.conftest import PASSWORD


def test_student_is_created_in_auth_profile_and_role_table(db):
    before = len(db.auth_users)
    uid = provision_user(
        "student",
        "New.Student@Uni.test",
        PASSWORD,
        "New Student",
        "0700123456",
        registration_number="STU100",
        program="BSc CS",
        year_of_study=1,
    )
    assert len(db.auth_users) == before + 1
    profile = next(p for p in db.tables["profiles"] if p["id"] == uid)
    assert profile["role"] == "student" and profile["email"] == "new.student@uni.test"
    assert next(s for s in db.tables["students"] if s["id"] == uid)["registration_number"] == "STU100"


def test_lecturer_is_created(db):
    uid = provision_user(
        "lecturer", "new.lec@uni.test", PASSWORD, "Dr New", staff_number="LEC100", department="CS"
    )
    assert next(x for x in db.tables["lecturers"] if x["id"] == uid)["staff_number"] == "LEC100"


def test_duplicate_registration_number_rolls_back_auth_user_and_profile(db):
    auth_before, profiles_before = len(db.auth_users), len(db.tables["profiles"])
    with pytest.raises(Conflict):
        provision_user("student", "dup@uni.test", PASSWORD, "Dup Student", registration_number="STU001")
    assert len(db.auth_users) == auth_before  # no orphaned login
    assert len(db.tables["profiles"]) == profiles_before  # no half-created profile


def test_duplicate_email_is_a_conflict_and_rolls_back(db):
    auth_before = len(db.auth_users)
    with pytest.raises(Conflict):
        provision_user("student", "student@demo.test", PASSWORD, "Same Email", registration_number="STU777")
    assert len(db.auth_users) == auth_before


@pytest.mark.parametrize(
    "role,fields,pw",
    [
        ("admin", {"registration_number": "X"}, PASSWORD),
        ("student", {}, PASSWORD),
        ("lecturer", {"registration_number": "X"}, PASSWORD),
        ("student", {"registration_number": "X"}, "weak"),
    ],
)
def test_invalid_requests_are_rejected_before_any_write(db, role, fields, pw):
    before = len(db.auth_users)
    with pytest.raises(ValidationFailed):
        provision_user(role, "x@uni.test", pw, "Some Name", **fields)
    assert len(db.auth_users) == before
