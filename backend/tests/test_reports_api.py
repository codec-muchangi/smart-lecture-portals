"""Phase 8 reports: FR-REP-01..05, FR-LEC-14, AT-20 (totals consistent with source records)."""

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
    make_assignment,
    make_mark,
    make_record,
    make_session,
    make_submission,
)

BASE = f"/api/v1/courses/{COURSE_A}/reports"


@pytest.fixture(autouse=True)
def _frozen_time(clock):
    """Run at the frozen NOW (2026-10-05 12:00 UTC)."""


def get(client, kind, who=L1, course=COURSE_A, **params):
    return client.get(f"/api/v1/courses/{course}/reports/{kind}", headers=bearer(who), params=params)


@pytest.fixture
def class_(db):
    """Course A with S1, S2 (active) and S3 (withdrawn)."""
    s3 = add_student(db, 3, "Withdrawn Wendy", "STU900", enroll_in=COURSE_A)
    next(e for e in db.tables["course_enrollments"] if e["student_id"] == s3)["status"] = "withdrawn"
    db.tables["course_enrollments"].append(
        {"id": "e2", "course_id": COURSE_A, "student_id": S2, "status": "active"}
    )
    return {"s3": s3}


# =============================== scope ===============================
@pytest.mark.parametrize("kind", ["attendance", "submissions", "performance"])
def test_reports_are_lecturer_only_and_scoped(client, db, class_, kind):
    assert client.get(f"{BASE}/{kind}").status_code == 401
    assert get(client, kind, who=S1).status_code == 403
    assert get(client, kind, course=COURSE_B).status_code == 404  # lecturer not assigned
    assert get(client, kind).status_code == 200


def test_unknown_course_is_404(client, db):
    assert get(client, "attendance", course="00000000-0000-0000-0000-0000000000ff").status_code == 404


def test_archived_course_reports_stay_readable(client, db, class_):
    next(c for c in db.tables["courses"] if c["id"] == COURSE_A)["status"] = "archived"
    assert get(client, "attendance").status_code == 200
    assert get(client, "submissions").status_code == 200
    assert get(client, "performance").status_code == 200


# =============================== attendance ===============================
def test_attendance_report_reconciles_AT_20(client, db, class_):
    s1, s2 = make_session(db, on="2026-10-01"), make_session(db, on="2026-10-02")
    make_record(db, s1, S1, "present")
    make_record(db, s1, S2, "absent")
    make_record(db, s1, class_["s3"], "present")  # withdrawn: must not count
    make_record(db, s2, S1, "late")
    make_record(db, s2, S2, "excused")
    body = get(client, "attendance").json()
    assert [r["student_id"] for r in body["students"]] == [S2, S1] or len(body["students"]) == 2
    by = {r["student_id"]: r for r in body["students"]}
    assert by[S1]["present"] == 1 and by[S1]["late"] == 1 and by[S1]["attendance_pct"] == 100.00
    assert by[S2]["absent"] == 1 and by[S2]["excused"] == 1 and by[S2]["attendance_pct"] == 0.00
    assert class_["s3"] not in by
    total_records = sum(r["present"] + r["late"] + r["absent"] + r["excused"] for r in body["students"])
    assert total_records == 4
    # per-session rows add up to the same totals
    assert sum(s["present"] + s["late"] + s["absent"] + s["excused"] for s in body["sessions"]) == 4
    summary = body["summary"]
    assert summary["students"] == 2 and summary["sessions"] == 2
    assert summary["present"] == 1 and summary["late"] == 1 and summary["absent"] == 1
    assert summary["excused"] == 1 and summary["unmarked"] == 0
    assert summary["attendance_pct"] == 66.67


def test_attendance_report_counts_unmarked(client, db, class_):
    s = make_session(db, on="2026-10-01")
    make_record(db, s, S1, "present")
    body = get(client, "attendance").json()
    assert body["summary"]["unmarked"] == 1
    assert body["sessions"][0]["unmarked"] == 1
    assert {r["student_id"]: r["unmarked"] for r in body["students"]} == {S1: 0, S2: 1}


def test_attendance_report_empty_course(client, db):
    body = get(client, "attendance").json()
    assert body["summary"]["sessions"] == 0 and body["sessions"] == [] and len(body["students"]) == 1
    assert body["summary"]["attendance_pct"] is None


def test_attendance_filters(client, db, class_):
    a, b = make_session(db, on="2026-09-20"), make_session(db, on="2026-10-02")
    make_record(db, a, S1, "absent")
    make_record(db, b, S1, "present")
    only = get(client, "attendance", **{"from": "2026-10-01"}).json()
    assert [s["session_date"] for s in only["sessions"]] == ["2026-10-02"]
    assert only["date_from"] == "2026-10-01"
    upto = get(client, "attendance", to="2026-09-30").json()
    assert [s["session_date"] for s in upto["sessions"]] == ["2026-09-20"]
    one = get(client, "attendance", student_id=S1).json()
    assert [r["student_id"] for r in one["students"]] == [S1] and one["student_id"] == S1
    assert one["summary"]["students"] == 1


def test_attendance_bad_filters(client, db, class_):
    assert get(client, "attendance", **{"from": "2026-10-05", "to": "2026-10-01"}).status_code == 400
    assert get(client, "attendance", student_id=class_["s3"]).status_code == 404  # withdrawn
    assert get(client, "attendance", student_id="00000000-0000-0000-0000-0000000000aa").status_code == 404
    assert get(client, "attendance", student_id="nope").status_code == 422


def test_attendance_past_the_1000_row_cap(client, db):
    ids = [add_student(db, 100 + i, f"Student {i:03d}", f"R{i:04d}", enroll_in=COURSE_A) for i in range(60)]
    sessions = [make_session(db, on=f"2026-09-{d:02d}") for d in range(1, 21)]
    for s in sessions:
        for sid in ids:
            make_record(db, s, sid, "present")  # 1200 records
    body = get(client, "attendance").json()
    assert body["summary"]["present"] == 1200 and body["summary"]["unmarked"] == 20  # S1 not marked


# =============================== submissions ===============================
def test_submissions_report_reconciles_AT_20(client, db, class_):
    a1 = make_assignment(db, due_in_days=-1, max_marks=20)  # deadline passed
    a2 = make_assignment(db, due_in_days=5, title="Later")
    make_assignment(db, due_in_days=-3, title="Draft", published=False)
    make_submission(db, a1, S1, "graded", mark=10, grade_released=True)
    make_submission(db, a1, S2, "late")
    make_submission(db, a1, class_["s3"], "submitted")  # withdrawn
    make_submission(db, a2, S1, "returned")
    body = get(client, "submissions").json()
    rows = {r["assignment_id"]: r for r in body["assignments"]}
    assert set(rows) == {a1["id"], a2["id"]}  # drafts excluded
    r1, r2 = rows[a1["id"]], rows[a2["id"]]
    assert r1["graded"] == 1 and r1["late"] == 1 and r1["submitted"] == 0 and r1["not_submitted"] == 0
    assert r1["missing"] == 0 and r1["average_mark"] == 10.00
    assert r2["returned"] == 1 and r2["not_submitted"] == 1 and r2["missing"] == 0  # not due yet
    s = body["summary"]
    assert s["assignments"] == 2 and s["students"] == 2
    assert s["total_submissions"] == 3 and s["not_submitted"] == 1
    assert s["total_submissions"] == sum(
        r["submitted"] + r["late"] + r["graded"] + r["returned"] for r in body["assignments"]
    )
    assert s["total_submissions"] + s["not_submitted"] == s["assignments"] * s["students"]


def test_submissions_report_missing_after_deadline(client, db, class_):
    a = make_assignment(db, due_in_days=-1)
    make_submission(db, a, S1, "submitted")
    body = get(client, "submissions").json()
    assert body["assignments"][0]["not_submitted"] == 1 and body["assignments"][0]["missing"] == 1
    assert body["summary"]["missing"] == 1


def test_submissions_report_filters(client, db, class_):
    a1, a2 = make_assignment(db, title="One"), make_assignment(db, title="Two")
    make_submission(db, a1, S1, "submitted")
    make_submission(db, a2, S2, "submitted")
    by_assignment = get(client, "submissions", assignment_id=a1["id"]).json()
    assert len(by_assignment["assignments"]) == 1 and by_assignment["summary"]["total_submissions"] == 1
    by_student = get(client, "submissions", student_id=S2).json()
    assert by_student["summary"]["students"] == 1 and by_student["summary"]["total_submissions"] == 1
    assert get(client, "submissions", assignment_id="00000000-0000-0000-0000-0000000000bb").status_code == 404
    other = make_assignment(db, course_id=COURSE_B)
    assert get(client, "submissions", assignment_id=other["id"]).status_code == 404  # other course
    assert get(client, "submissions", student_id=class_["s3"]).status_code == 404


def test_submissions_report_empty(client, db):
    body = get(client, "submissions").json()
    assert body["assignments"] == [] and body["summary"]["total_submissions"] == 0


# =============================== performance ===============================
def test_performance_report_uses_published_assessments(client, db, class_):
    cat = make_assessment(db, name="CAT", max_marks=30, weight=40, published=True)
    exam = make_assessment(db, name="Exam", type_="exam", max_marks=100, weight=60, published=True)
    hidden = make_assessment(db, name="Draft", max_marks=10, weight=0, published=False)
    make_mark(db, cat, S1, 30)
    make_mark(db, exam, S1, 50)
    make_mark(db, hidden, S1, 1)
    make_mark(db, cat, S2, 15)
    make_mark(db, cat, class_["s3"], 1)  # withdrawn
    body = get(client, "performance").json()
    by = {r["student_id"]: r for r in body["students"]}
    assert set(by) == {S1, S2}
    assert by[S1]["marks_entered"] == 2 and by[S1]["weighted_percent"] == 70.00
    assert by[S2]["marks_entered"] == 1
    assets = {a["name"]: a for a in body["assessments"]}
    assert assets["Draft"]["published"] is False and assets["CAT"]["published"] is True
    assert assets["CAT"]["marks_entered"] == 2 and assets["CAT"]["average"] is not None
    s = body["summary"]
    assert s["students"] == 2 and s["students_without_marks"] == 0
    assert s["highest_weighted_percent"] == 70.00


def test_performance_report_filters_and_empty(client, db, class_):
    body = get(client, "performance").json()
    assert body["assessments"] == [] and body["summary"]["students_without_marks"] == 2
    a = make_assessment(db, weight=100, published=True)
    make_mark(db, a, S1, 15)
    one = get(client, "performance", student_id=S1).json()
    assert [r["student_id"] for r in one["students"]] == [S1] and one["student_id"] == S1
    assert get(client, "performance", student_id=class_["s3"]).status_code == 404
