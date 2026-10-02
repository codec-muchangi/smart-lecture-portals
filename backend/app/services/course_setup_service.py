"""Controlled academic setup (SRS 1.3/24: no admin role in v1.0, so courses, lecturer assignments and
enrollments are created by the project owner through scripts/manage_academic.py, which calls this service).

Rules enforced here AND by database triggers/constraints (migration 0004): no duplicate offerings or
enrollments, only active students enroll, only into active courses, only active lecturers are assigned.
Every change is audited (actor is null because there is no signed-in user in a setup script).
"""

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.db.client import get_supabase
from app.services import audit_service

COURSE_STATUSES = ("active", "archived", "inactive")


def _is_duplicate(exc: Exception) -> bool:
    text = str(exc).lower()
    return "duplicate" in text or "23505" in text


def find_course(code: str, academic_year: str | None = None, semester: str | None = None) -> dict:
    q = get_supabase().table("courses").select("*").eq("course_code", code.strip())
    if academic_year:
        q = q.eq("academic_year", academic_year.strip())
    if semester:
        q = q.eq("semester", semester.strip())
    rows = q.execute().data
    if not rows:
        raise NotFound(f"No course matches '{code}'")
    if len(rows) > 1:
        offerings = sorted(f"{r['academic_year']} / {r['semester']}" for r in rows)
        raise ValidationFailed(
            f"'{code}' has several offerings; add --year and --semester", {"offerings": offerings}
        )
    return rows[0]


def create_course(
    code: str,
    name: str,
    academic_year: str,
    semester: str,
    credit_hours: int | None = None,
    description: str | None = None,
) -> dict:
    code, name, academic_year, semester = code.strip(), name.strip(), academic_year.strip(), semester.strip()
    if not (2 <= len(code) <= 30):
        raise ValidationFailed("course code must be 2-30 characters")
    if not (2 <= len(name) <= 200):
        raise ValidationFailed("course name must be 2-200 characters")
    if not academic_year or not semester:
        raise ValidationFailed("academic year and semester are required")
    if credit_hours is not None and not (1 <= credit_hours <= 30):
        raise ValidationFailed("credit hours must be between 1 and 30")
    sb = get_supabase()
    existing = (
        sb.table("courses")
        .select("id")
        .eq("course_code", code)
        .eq("academic_year", academic_year)
        .eq("semester", semester)
        .execute()
        .data
    )
    if existing:
        raise Conflict(f"{code} already exists for {academic_year} / {semester}")
    row = {
        "course_code": code,
        "course_name": name,
        "academic_year": academic_year,
        "semester": semester,
        "credit_hours": credit_hours,
        "description": description,
        "status": "active",
    }
    try:
        created = sb.table("courses").insert(row).execute().data[0]
    except Exception as exc:
        if _is_duplicate(exc):
            raise Conflict(f"{code} already exists for {academic_year} / {semester}") from exc
        raise
    audit_service.record(None, "course.create", "course", created["id"], new=row)
    return created


def set_course_status(course: dict, status: str) -> dict:
    if status not in COURSE_STATUSES:
        raise ValidationFailed(f"status must be one of {COURSE_STATUSES}")
    if course["status"] == status:
        return course
    updated = (
        get_supabase().table("courses").update({"status": status}).eq("id", course["id"]).execute().data[0]
    )
    audit_service.record(
        None,
        "course.status",
        "course",
        course["id"],
        old={"status": course["status"]},
        new={"status": status},
    )
    return updated


def _find_person(table: str, number_col: str, number: str, label: str) -> dict:
    rows = get_supabase().table(table).select("*").eq(number_col, number.strip()).limit(1).execute().data
    if not rows:
        raise NotFound(f"No {label} with number '{number}'")
    return rows[0]


def assign_lecturer(course: dict, staff_number: str) -> dict:
    lecturer = _find_person("lecturers", "staff_number", staff_number, "lecturer")
    if lecturer["status"] != "active":
        raise ValidationFailed("That lecturer account is not active")
    sb = get_supabase()
    dup = (
        sb.table("course_lecturers")
        .select("id")
        .eq("course_id", course["id"])
        .eq("lecturer_id", lecturer["id"])
        .execute()
        .data
    )
    if dup:
        raise Conflict("That lecturer is already assigned to this course")
    row = {"course_id": course["id"], "lecturer_id": lecturer["id"]}
    try:
        created = sb.table("course_lecturers").insert(row).execute().data[0]
    except Exception as exc:
        if _is_duplicate(exc):
            raise Conflict("That lecturer is already assigned to this course") from exc
        raise
    audit_service.record(None, "course.assign_lecturer", "course", course["id"], new=row)
    return created


def enroll_student(course: dict, registration_number: str) -> tuple[dict, str]:
    """Returns (enrollment, outcome) where outcome is 'enrolled' or 'reactivated'."""
    if course["status"] != "active":
        raise ValidationFailed("Students can only be enrolled in an active course")
    student = _find_person("students", "registration_number", registration_number, "student")
    if student["status"] != "active":
        raise ValidationFailed("That student account is not active")
    sb = get_supabase()
    existing = (
        sb.table("course_enrollments")
        .select("*")
        .eq("course_id", course["id"])
        .eq("student_id", student["id"])
        .limit(1)
        .execute()
        .data
    )
    if existing:
        row = existing[0]
        if row["status"] == "withdrawn":  # re-enrol the same row: UNIQUE(course, student) allows only one
            updated = (
                sb.table("course_enrollments")
                .update({"status": "active"})
                .eq("id", row["id"])
                .execute()
                .data[0]
            )
            audit_service.record(
                None,
                "enrollment.reactivate",
                "course",
                course["id"],
                old={"student_id": student["id"], "status": "withdrawn"},
                new={"student_id": student["id"], "status": "active"},
            )
            return updated, "reactivated"
        raise Conflict(f"{registration_number} is already enrolled in this course (status: {row['status']})")
    row = {"course_id": course["id"], "student_id": student["id"], "status": "active"}
    try:
        created = sb.table("course_enrollments").insert(row).execute().data[0]
    except Exception as exc:
        if _is_duplicate(exc):
            raise Conflict(f"{registration_number} is already enrolled in this course") from exc
        raise
    audit_service.record(None, "enrollment.create", "course", course["id"], new=row)
    return created, "enrolled"


def withdraw_student(course: dict, registration_number: str) -> dict:
    """Soft change: the row stays, so academic history (marks, attendance, submissions) is never orphaned."""
    student = _find_person("students", "registration_number", registration_number, "student")
    sb = get_supabase()
    rows = (
        sb.table("course_enrollments")
        .select("*")
        .eq("course_id", course["id"])
        .eq("student_id", student["id"])
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise NotFound(f"{registration_number} is not enrolled in this course")
    if rows[0]["status"] == "withdrawn":
        return rows[0]
    updated = (
        sb.table("course_enrollments")
        .update({"status": "withdrawn"})
        .eq("id", rows[0]["id"])
        .execute()
        .data[0]
    )
    audit_service.record(
        None,
        "enrollment.withdraw",
        "course",
        course["id"],
        old={"student_id": student["id"], "status": rows[0]["status"]},
        new={"student_id": student["id"], "status": "withdrawn"},
    )
    return updated


def bulk_enroll(course: dict, registration_numbers: list[str]) -> list[tuple[str, str]]:
    """Per-row results; one bad row never blocks the others. Blank lines and a 'registration_number'
    header are ignored."""
    results: list[tuple[str, str]] = []
    seen: set[str] = set()
    for raw in registration_numbers:
        reg = raw.strip()
        if not reg or reg.lower() in ("registration_number", "registration number"):
            continue
        if reg in seen:
            results.append((reg, "skipped: duplicate line in file"))
            continue
        seen.add(reg)
        try:
            _, outcome = enroll_student(course, reg)
            results.append((reg, outcome))
        except (Conflict, NotFound, ValidationFailed) as exc:
            results.append((reg, f"skipped: {exc.message}"))
    return results
