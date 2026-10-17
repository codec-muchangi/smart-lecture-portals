"""Phase 8 dashboards: FR-STU-01, FR-LEC-01, AT-01, AT-02, NFR-PERF-01 (no hard-coded statistics)."""

from datetime import timedelta

import pytest

from tests.conftest import (
    COURSE_A,
    COURSE_B,
    L1,
    NOW,
    S1,
    S2,
    S_SUSPENDED,
    add_student,
    bearer,
    make_announcement,
    make_assessment,
    make_assignment,
    make_mark,
    make_notification,
    make_record,
    make_session,
    make_submission,
)


@pytest.fixture(autouse=True)
def _frozen_time(clock):
    """Run at the frozen NOW (2026-10-05 12:00 UTC)."""


def dash(client, who):
    r = client.get("/api/v1/dashboard", headers=bearer(who))
    assert r.status_code == 200, r.text
    return r.json()


def test_dashboard_requires_login(client, db):
    assert client.get("/api/v1/dashboard").status_code == 401


# =============================== student ===============================
def test_student_dashboard_AT_01(client, db):
    body = dash(client, S1)
    assert body["role"] == "student"
    assert [c["id"] for c in body["courses"]] == [COURSE_A]
    assert body["upcoming_assignments"] == [] and body["recent_marks"] == []
    assert body["announcements"] == [] and body["unread_notifications"] == 0
    assert body["attendance_summary"][0]["attendance_pct"] is None


def test_student_dashboard_without_courses(client, db):
    body = dash(client, S2)
    assert body["courses"] == [] and body["upcoming_assignments"] == []
    make_notification(db, S2)
    assert dash(client, S2)["unread_notifications"] == 1


def test_student_dashboard_shows_real_data(client, db):
    soon = make_assignment(db, title="Soon", due_in_days=2)
    later = make_assignment(db, title="Later", due_in_days=9)
    make_assignment(db, title="Past", due_in_days=-1)
    make_assignment(db, title="Closed", due_in_days=3, closed=True)
    make_assignment(db, title="Draft", due_in_days=3, published=False)
    make_assignment(db, title="Elsewhere", due_in_days=1, course_id=COURSE_B)
    make_submission(db, soon, S1, "submitted")
    body = dash(client, S1)
    ups = body["upcoming_assignments"]
    assert [u["title"] for u in ups] == ["Soon", "Later"]
    assert ups[0]["submission_status"] == "submitted" and ups[1]["submission_status"] == "not_submitted"
    assert ups[0]["course_code"] == "CIT 3253" and later["id"] == ups[1]["assignment_id"]

    s1, s2 = make_session(db, on="2026-10-01"), make_session(db, on="2026-10-02")
    make_record(db, s1, S1, "present")
    make_record(db, s2, S1, "absent")
    att = dash(client, S1)["attendance_summary"][0]
    assert att["present"] == 1 and att["absent"] == 1 and att["attendance_pct"] == 50.0

    make_announcement(db, title="Hello", body="x" * 300)
    make_announcement(db, title="Hidden", published=False)
    make_announcement(db, title="Not mine", course_id=COURSE_B)
    ann = dash(client, S1)["announcements"]
    assert [a["title"] for a in ann] == ["Hello"] and len(ann[0]["preview"]) == 200

    make_notification(db, S1)
    make_notification(db, S1, is_read=True)
    assert dash(client, S1)["unread_notifications"] == 1


def test_student_recent_marks_only_released_and_published(client, db):
    graded = make_assignment(db, title="Graded", due_in_days=-5, max_marks=20)
    hidden = make_assignment(db, title="Unreleased", due_in_days=-5)
    sub = make_submission(db, graded, S1, "graded", mark=15, grade_released=True)
    sub["graded_at"] = "2026-10-03T10:00:00+00:00"
    h = make_submission(db, hidden, S1, "graded", mark=5, grade_released=False)
    h["graded_at"] = "2026-10-04T10:00:00+00:00"
    pub = make_assessment(db, name="CAT 1", max_marks=30, published=True)
    draft = make_assessment(db, name="CAT 2", published=False)
    make_mark(db, pub, S1, 24)
    make_mark(db, draft, S1, 1)
    other = make_assignment(db, title="Other course", course_id=COURSE_B, due_in_days=-5)
    o = make_submission(db, other, S1, "graded", mark=9, grade_released=True)
    o["graded_at"] = "2026-10-04T11:00:00+00:00"
    marks = dash(client, S1)["recent_marks"]
    # newest first; no unreleased grade, no draft assessment, nothing from other courses
    assert [m["title"] for m in marks] == ["Graded", "CAT 1"]
    assert marks[1]["kind"] == "assessment" and marks[1]["percentage"] == 80.0
    assert marks[0]["kind"] == "assignment" and marks[0]["mark"] == 15 and marks[0]["percentage"] == 75.0


def test_student_recent_marks_are_capped(client, db):
    for i in range(8):
        a = make_assignment(db, title=f"A{i}", due_in_days=-5)
        s = make_submission(db, a, S1, "graded", mark=10, grade_released=True)
        s["graded_at"] = f"2026-10-0{i + 1}T10:00:00+00:00"
    marks = dash(client, S1)["recent_marks"]
    assert len(marks) == 5 and marks[0]["title"] == "A7"


def test_student_dashboard_hides_inactive_courses(client, db):
    next(c for c in db.tables["courses"] if c["id"] == COURSE_A)["status"] = "archived"
    assert dash(client, S1)["courses"] == []


def test_student_dashboard_is_isolated(client, db):
    a = make_assignment(db, title="Mine", due_in_days=2)
    make_submission(db, a, S1, "graded", mark=10, grade_released=True)
    db.tables["course_enrollments"].append(
        {"id": "e9", "course_id": COURSE_A, "student_id": S2, "status": "active"}
    )
    body = dash(client, S2)
    assert body["upcoming_assignments"][0]["submission_status"] == "not_submitted"
    assert body["recent_marks"] == []


# =============================== lecturer ===============================
def test_lecturer_dashboard_AT_02(client, db):
    body = dash(client, L1)
    assert body["role"] == "lecturer"
    assert [c["id"] for c in body["courses"]] == [COURSE_A] and body["courses"][0]["enrolled_count"] == 1
    assert body["pending_grading"] == {"total": 0, "items": []} and body["upcoming_deadlines"] == []
    assert body["attendance_summary"][0]["sessions"] == 0
    assert body["performance_summary"][0]["published_assessments"] == 0


def test_lecturer_without_courses(client, db):
    db.tables["course_lecturers"].clear()
    body = dash(client, L1)
    assert body["courses"] == [] and body["pending_grading"]["total"] == 0


def test_lecturer_dashboard_shows_real_data(client, db):
    db.tables["course_enrollments"].append(
        {"id": "e2", "course_id": COURSE_A, "student_id": S2, "status": "active"}
    )
    gone = add_student(db, 3, "Gone", "STU900", enroll_in=COURSE_A)
    next(e for e in db.tables["course_enrollments"] if e["student_id"] == gone)["status"] = "withdrawn"
    a = make_assignment(db, title="Lab", due_in_days=3)
    make_submission(db, a, S1, "submitted")
    make_submission(db, a, S2, "late")
    make_submission(db, a, gone, "submitted")  # withdrawn: not counted
    done = make_assignment(db, title="Done", due_in_days=-2)
    make_submission(db, done, S1, "graded", mark=10)
    make_assignment(db, title="Draft", due_in_days=1, published=False)
    make_assignment(db, title="Elsewhere", due_in_days=1, course_id=COURSE_B)
    body = dash(client, L1)
    assert body["courses"][0]["enrolled_count"] == 2
    assert body["pending_grading"]["total"] == 2
    assert [(i["title"], i["pending"]) for i in body["pending_grading"]["items"]] == [("Lab", 2)]
    dl = body["upcoming_deadlines"]
    assert [(d["title"], d["enrolled"], d["submitted"]) for d in dl] == [("Lab", 2, 2)]

    s1, s2 = make_session(db, on="2026-10-01"), make_session(db, on="2026-10-09")  # second is in the future
    make_record(db, s1, S1, "present")
    make_record(db, s1, S2, "absent")
    att = body_att = dash(client, L1)["attendance_summary"][0]
    assert att["sessions"] == 2 and att["last_session_date"] == "2026-10-01" and att["attendance_pct"] == 50.0
    assert body_att["course_code"] == "CIT 3253" and s2["course_id"] == COURSE_A

    cat = make_assessment(db, name="CAT", max_marks=30, weight=100, published=True)
    make_assessment(db, name="Draft", published=False)
    make_mark(db, cat, S1, 24)
    perf = dash(client, L1)["performance_summary"][0]
    assert perf["published_assessments"] == 1 and perf["students_without_marks"] == 1
    assert perf["average_weighted_percent"] == 80.0


def test_lecturer_pending_grading_items_are_capped(client, db):
    for i in range(12):
        make_submission(db, make_assignment(db, title=f"A{i}", due_in_days=i + 1), S1, "submitted")
    body = dash(client, L1)
    assert body["pending_grading"]["total"] == 12 and len(body["pending_grading"]["items"]) == 10
    assert len(body["upcoming_deadlines"]) == 10


def test_lecturer_dashboard_hides_inactive_and_unassigned_courses(client, db):
    make_assignment(db, course_id=COURSE_B, due_in_days=1)
    assert [c["id"] for c in dash(client, L1)["courses"]] == [COURSE_A]
    next(c for c in db.tables["courses"] if c["id"] == COURSE_A)["status"] = "archived"
    assert dash(client, L1)["courses"] == []


def test_suspended_student_cannot_load_dashboard(client, db):
    assert client.get("/api/v1/dashboard", headers=bearer(S_SUSPENDED)).status_code in (401, 403)


# =============================== performance (NFR-PERF-01) ===============================
def test_dashboard_query_count_does_not_grow_with_class_size(client, db):
    def lecturer_queries():
        before = db.query_count
        dash(client, L1)
        return db.query_count - before

    a = make_assignment(db, due_in_days=2)
    cat = make_assessment(db, weight=100, published=True)
    s = make_session(db, on="2026-10-01")
    small = lecturer_queries()
    for i in range(40):
        sid = add_student(db, 200 + i, f"Kid {i:02d}", f"K{i:04d}", enroll_in=COURSE_A)
        make_submission(db, a, sid, "submitted")
        make_mark(db, cat, sid, 10)
        make_record(db, s, sid, "present")
    assert lecturer_queries() == small

    def student_queries():
        before = db.query_count
        dash(client, S1)
        return db.query_count - before

    base = student_queries()
    for i in range(10):
        make_submission(db, make_assignment(db, title=f"X{i}", due_in_days=i + 1), S1, "submitted")
    assert student_queries() == base
    assert NOW + timedelta(days=1) > NOW
