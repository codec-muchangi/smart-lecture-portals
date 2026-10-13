"""Phase 6 (attendance): FR-ATT-01..06, FR-LEC-09/10, FR-STU-09, workflow 5.4, AT-13, AT-14, AT-19."""

import pytest

from tests.conftest import (
    COURSE_A,
    COURSE_B,
    L1,
    NOW,
    S1,
    S2,
    add_student,
    bearer,
    make_record,
    make_session,
)

SESSION_BODY = {"session_date": "2026-10-05", "start_time": "09:00", "end_time": "11:00", "topic": "Week 6"}


@pytest.fixture(autouse=True)
def _frozen_time(clock):
    """Every test runs at the frozen NOW (2026-10-05 12:00 UTC)."""


def create(client, body=None, course=COURSE_A, who=L1):
    return client.post(
        f"/api/v1/courses/{course}/attendance/sessions", headers=bearer(who), json=body or SESSION_BODY
    )


def mark(client, session, records, who=L1):
    return client.post(
        f"/api/v1/attendance/sessions/{session['id']}/records", headers=bearer(who), json={"records": records}
    )


def rec(student, status="present", note=None):
    row = {"student_id": student, "status": status}
    if note is not None:
        row["note"] = note
    return row


def stored(db, session):
    return [r for r in db.tables.get("attendance_records", []) if r["session_id"] == session["id"]]


def set_course_status(db, course_id, status):
    next(c for c in db.tables["courses"] if c["id"] == course_id)["status"] = status


# =============================== sessions (FR-ATT-01, FR-ATT-06) ===============================
def test_lecturer_creates_a_session_AT_13(client, db):
    r = create(client)
    assert r.status_code == 201
    body = r.json()
    assert body["course_id"] == COURSE_A and body["session_date"] == "2026-10-05"
    assert body["start_time"] == "09:00:00" and body["end_time"] == "11:00:00"
    assert body["topic"] == "Week 6" and body["created_by"] == L1 and body["records_marked"] == 0
    assert len(db.tables["attendance_sessions"]) == 1
    assert not db.tables.get("attendance_records")  # no records are pre-generated


def test_topic_is_optional_and_blank_topic_becomes_null(client, db):
    body = {k: v for k, v in SESSION_BODY.items() if k != "topic"}
    assert create(client, body).json()["topic"] is None
    assert (
        create(client, {**body, "start_time": "13:00", "end_time": "14:00", "topic": "   "}).json()["topic"]
        is None
    )


def test_session_creation_is_audited(client, db):
    sid = create(client).json()["id"]
    log = db.audit("attendance.session_create")
    assert len(log) == 1 and log[0]["actor_user_id"] == L1 and log[0]["entity_id"] == sid
    assert log[0]["new_value"]["session_date"] == "2026-10-05" and log[0]["old_value"] is None


def test_duplicate_session_for_same_course_date_and_start_is_409_FR_ATT_06(client, db):
    assert create(client).status_code == 201
    r = create(client, {**SESSION_BODY, "end_time": "10:00", "topic": "Other"})
    assert r.status_code == 409
    assert len(db.tables["attendance_sessions"]) == 1


def test_a_database_level_duplicate_race_is_also_409(client, db, monkeypatch):
    from app.repositories import attendance_repository

    monkeypatch.setattr(attendance_repository, "find_duplicate", lambda *a: None)  # check missed it
    assert create(client).status_code == 201
    assert create(client).status_code == 409  # the UNIQUE constraint caught it


def test_same_date_different_start_time_is_a_new_session(client, db):
    assert create(client).status_code == 201
    assert create(client, {**SESSION_BODY, "start_time": "14:00", "end_time": "16:00"}).status_code == 201


def test_unexpected_database_failure_is_a_500_not_a_duplicate(client, db):
    db.fail_insert_tables.add("attendance_sessions")
    assert create(client).status_code == 500


@pytest.mark.parametrize(
    "patch",
    [
        {"end_time": "09:00"},  # end == start
        {"end_time": "08:00"},  # end before start
        {"start_time": "9am"},
        {"session_date": "05/10/2026"},
        {"session_date": "1999-12-31"},
        {"session_date": None},
        {"topic": "x" * 201},
        {"start_time": "09:00+03:00", "end_time": "11:00+03:00"},  # no time zones
        {"surprise": 1},
    ],
)
def test_invalid_session_bodies_are_422(client, db, patch):
    assert create(client, {**SESSION_BODY, **patch}).status_code == 422
    assert not db.tables.get("attendance_sessions")


def test_session_too_far_in_the_future_is_rejected(client, db):
    far = (NOW.date().replace(year=NOW.year + 2)).isoformat()
    r = create(client, {**SESSION_BODY, "session_date": far})
    assert r.status_code == 400 and r.json()["code"] == "VALIDATION_ERROR"
    assert (
        create(client, {**SESSION_BODY, "session_date": "2026-12-01"}).status_code == 201
    )  # planning ahead is fine


def test_sessions_are_listed_newest_first_with_counts(client, db):
    old = make_session(db, on="2026-09-28")
    new = make_session(db, on="2026-10-02", start="14:00:00", end="15:00:00")
    morning = make_session(db, on="2026-10-02")
    make_record(db, new, S1)
    make_record(db, new, S2)
    r = client.get(f"/api/v1/courses/{COURSE_A}/attendance/sessions", headers=bearer(L1))
    assert r.status_code == 200
    body = r.json()
    assert [i["id"] for i in body["items"]] == [new["id"], morning["id"], old["id"]]
    assert [i["records_marked"] for i in body["items"]] == [2, 0, 0]
    assert body["total"] == 3 and body["page"] == 1


def test_session_list_is_paginated(client, db):
    for day in range(1, 6):
        make_session(db, on=f"2026-09-{day:02d}")
    r = client.get(
        f"/api/v1/courses/{COURSE_A}/attendance/sessions?page=2&page_size=2", headers=bearer(L1)
    ).json()
    assert r["total"] == 5 and [i["session_date"] for i in r["items"]] == ["2026-09-03", "2026-09-02"]
    assert (
        client.get(
            f"/api/v1/courses/{COURSE_A}/attendance/sessions?page_size=101", headers=bearer(L1)
        ).status_code
        == 422
    )
    assert (
        client.get(f"/api/v1/courses/{COURSE_A}/attendance/sessions?page=0", headers=bearer(L1)).status_code
        == 422
    )


def test_session_list_only_shows_that_course(client, db):
    make_session(db, course_id=COURSE_B, creator=L1)
    make_session(db)
    r = client.get(f"/api/v1/courses/{COURSE_A}/attendance/sessions", headers=bearer(L1)).json()
    assert r["total"] == 1


# =============================== the roster (workflow 5.4) ===============================
def test_session_detail_lists_active_students_with_their_statuses(client, db):
    other = add_student(db, 1, "Alpha Student", "STU500", enroll_in=COURSE_A)
    withdrawn = add_student(db, 2, "Gone Student", "STU501", enroll_in=COURSE_A)
    next(e for e in db.tables["course_enrollments"] if e["student_id"] == withdrawn)["status"] = "withdrawn"
    s = make_session(db)
    make_record(db, s, S1, "late", "bus")
    r = client.get(f"/api/v1/attendance/sessions/{s['id']}", headers=bearer(L1))
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == s["id"] and body["topic"] == "Introduction"
    roster = {i["student_id"]: i for i in body["roster"]["items"]}
    assert set(roster) == {S1, other}  # the withdrawn student is not on the roster
    assert roster[S1]["status"] == "late" and roster[S1]["note"] == "bus" and roster[S1]["marked_by"] == L1
    assert roster[other]["status"] is None and roster[other]["marked_at"] is None
    assert body["summary"] == {"present": 0, "absent": 0, "late": 1, "excused": 0, "unmarked": 1}
    assert body["records_marked"] == 1 and body["roster"]["total"] == 2


def test_roster_is_alphabetical_searchable_and_paginated(client, db):
    add_student(db, 1, "Zed Student", "STU500", enroll_in=COURSE_A)
    add_student(db, 2, "Amy Student", "STU501", enroll_in=COURSE_A)
    s = make_session(db)
    url = f"/api/v1/attendance/sessions/{s['id']}"
    names = [i["full_name"] for i in client.get(url, headers=bearer(L1)).json()["roster"]["items"]]
    assert names == sorted(names) and len(names) == 3
    page = client.get(f"{url}?page=2&page_size=2", headers=bearer(L1)).json()["roster"]
    assert len(page["items"]) == 1 and page["total"] == 3
    found = client.get(f"{url}?q=STU501", headers=bearer(L1)).json()["roster"]
    assert [i["registration_number"] for i in found["items"]] == ["STU501"]
    assert client.get(f"{url}?page_size=201", headers=bearer(L1)).status_code == 422


def test_summary_counts_only_actively_enrolled_students(client, db):
    gone = add_student(db, 2, "Gone Student", "STU501", enroll_in=COURSE_A)
    s = make_session(db)
    make_record(db, s, S1, "present")
    make_record(db, s, gone, "absent")
    next(e for e in db.tables["course_enrollments"] if e["student_id"] == gone)["status"] = "withdrawn"
    body = client.get(f"/api/v1/attendance/sessions/{s['id']}", headers=bearer(L1)).json()
    assert body["summary"] == {"present": 1, "absent": 0, "late": 0, "excused": 0, "unmarked": 0}


def test_unknown_session_is_404(client, db):
    r = client.get("/api/v1/attendance/sessions/00000000-0000-0000-0000-00000000ffff", headers=bearer(L1))
    assert r.status_code == 404 and r.json()["code"] == "NOT_FOUND"


# =============================== marking (FR-ATT-03, FR-LEC-10) ===============================
def test_lecturer_marks_students_AT_13(client, db):
    other = add_student(db, 1, "Second Student", "STU500", enroll_in=COURSE_A)
    s = make_session(db)
    r = mark(client, s, [rec(S1, "present"), rec(other, "absent", "sick")])
    assert r.status_code == 200 and r.json() == {"created": 2, "updated": 0, "unchanged": 0, "total": 2}
    rows = {x["student_id"]: x for x in stored(db, s)}
    assert rows[S1]["status"] == "present" and rows[S1]["marked_by"] == L1 and rows[S1]["note"] is None
    assert rows[other]["status"] == "absent" and rows[other]["note"] == "sick"


@pytest.mark.parametrize("status", ["present", "absent", "late", "excused"])
def test_every_approved_status_is_accepted(client, db, status):
    s = make_session(db)
    assert mark(client, s, [rec(S1, status)]).status_code == 200
    assert stored(db, s)[0]["status"] == status


@pytest.mark.parametrize("status", ["sleeping", "PRESENT", "", None, 1, True])
def test_invalid_status_is_422_and_saves_nothing(client, db, status):
    s = make_session(db)
    assert mark(client, s, [{"student_id": S1, "status": status}]).status_code == 422
    assert not stored(db, s)


def test_every_first_mark_is_audited(client, db):
    s = make_session(db)
    mark(client, s, [rec(S1, "late", "bus")])
    log = db.audit("attendance.mark")
    assert len(log) == 1 and log[0]["actor_user_id"] == L1 and log[0]["entity_id"] == s["id"]
    assert log[0]["old_value"] is None
    assert log[0]["new_value"] == {"student_id": S1, "status": "late", "note": "bus"}


def test_a_correction_records_who_changed_it_and_the_old_value(client, db):
    s = make_session(db)
    mark(client, s, [rec(S1, "absent")])
    stored(db, s)[0]["marked_by"] = "first-lecturer"
    r = mark(client, s, [rec(S1, "excused", "doctor's letter")])
    assert r.json() == {"created": 0, "updated": 1, "unchanged": 0, "total": 1}
    row = stored(db, s)[0]
    assert row["status"] == "excused" and row["note"] == "doctor's letter" and row["marked_by"] == L1
    log = db.audit("attendance.correct")
    assert len(log) == 1
    assert log[0]["old_value"] == {"student_id": S1, "status": "absent", "note": None}
    assert log[0]["new_value"] == {"student_id": S1, "status": "excused", "note": "doctor's letter"}


def test_changing_only_the_note_is_a_correction_too(client, db):
    s = make_session(db)
    mark(client, s, [rec(S1, "late")])
    assert mark(client, s, [rec(S1, "late", "bus broke down")]).json()["updated"] == 1


def test_resubmitting_identical_attendance_changes_and_audits_nothing(client, db):
    s = make_session(db)
    mark(client, s, [rec(S1, "present", "ok")])
    before = len(db.tables["audit_logs"])
    r = mark(client, s, [rec(S1, "present", "ok")])
    assert r.json() == {"created": 0, "updated": 0, "unchanged": 1, "total": 1}
    assert len(db.tables["audit_logs"]) == before


def test_marking_twice_never_duplicates_a_record_AT_19(client, db):
    s = make_session(db)
    mark(client, s, [rec(S1, "present")])
    mark(client, s, [rec(S1, "absent")])
    mark(client, s, [rec(S1, "late")])
    assert len(stored(db, s)) == 1 and stored(db, s)[0]["status"] == "late"


def test_partial_marking_is_allowed_and_later_batches_add_to_it(client, db):
    other = add_student(db, 1, "Second Student", "STU500", enroll_in=COURSE_A)
    s = make_session(db)
    assert mark(client, s, [rec(S1)]).json()["created"] == 1
    assert mark(client, s, [rec(other, "late")]).json()["created"] == 1
    assert len(stored(db, s)) == 2


def test_a_blank_note_is_stored_as_null(client, db):
    s = make_session(db)
    mark(client, s, [rec(S1, "present", "   ")])
    assert stored(db, s)[0]["note"] is None


def test_unenrolled_student_is_rejected_and_nothing_is_saved(client, db):
    s = make_session(db)
    r = mark(client, s, [rec(S1, "present"), rec(S2, "present")])  # S2 is not in course A
    assert r.status_code == 400 and r.json()["code"] == "VALIDATION_ERROR"
    rows = r.json()["details"]["rows"]
    assert rows == [
        {"index": 1, "student_id": S2, "message": "This student is not actively enrolled in the course"}
    ]
    assert not stored(db, s) and not db.audit("attendance.mark")


def test_withdrawn_student_cannot_be_marked(client, db):
    gone = add_student(db, 2, "Gone Student", "STU501", enroll_in=COURSE_A)
    next(e for e in db.tables["course_enrollments"] if e["student_id"] == gone)["status"] = "withdrawn"
    s = make_session(db)
    assert mark(client, s, [rec(gone, "absent")]).status_code == 400
    assert not stored(db, s)


def test_duplicate_student_in_one_request_is_rejected(client, db):
    s = make_session(db)
    r = mark(client, s, [rec(S1, "present"), rec(S1, "absent")])
    assert r.status_code == 400
    assert r.json()["details"]["rows"] == [
        {"index": 1, "student_id": S1, "message": "This student appears more than once in the request"}
    ]
    assert not stored(db, s)


def test_all_row_problems_are_reported_together(client, db):
    s = make_session(db)
    r = mark(client, s, [rec(S2), rec(S1), rec(S1), rec(S2)])
    assert [(x["index"], x["student_id"]) for x in r.json()["details"]["rows"]] == [
        (0, S2),
        (2, S1),
        (3, S2),
        (3, S2),
    ]


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"records": []},
        {"records": "x"},
        {"records": [{"status": "present"}]},  # no student
        {"records": [{"student_id": "not-a-uuid", "status": "present"}]},
        {"records": [{"student_id": S1, "status": "present", "extra": 1}]},
        {"records": [{"student_id": S1, "status": "present", "note": "x" * 501}]},
        {"records": [{"student_id": S1, "status": "present"}], "surprise": 1},
    ],
)
def test_malformed_marking_requests_are_422(client, db, payload):
    s = make_session(db)
    r = client.post(f"/api/v1/attendance/sessions/{s['id']}/records", headers=bearer(L1), json=payload)
    assert r.status_code == 422 and not stored(db, s)


def test_more_than_500_rows_per_request_is_rejected(client, db):
    s = make_session(db)
    rows = [rec(f"00000000-0000-0000-0000-{i:012d}") for i in range(501)]
    assert mark(client, s, rows).status_code == 422


def test_a_failure_inside_the_transaction_rolls_everything_back(client, db):
    other = add_student(db, 1, "Second Student", "STU500", enroll_in=COURSE_A)
    s = make_session(db)
    db.fail_rpc_after.add("upsert_attendance_records")  # fails AFTER the rows and audit rows were written
    r = mark(client, s, [rec(S1), rec(other, "absent")])
    assert r.status_code == 500
    assert not stored(db, s) and not db.audit(
        "attendance.mark"
    )  # no record without its audit row, or vice versa


def test_a_database_rule_rejection_is_a_409_asking_to_reload(client, db, monkeypatch):
    from app.repositories import attendance_repository

    s = make_session(db)
    monkeypatch.setattr(attendance_repository, "active_student_ids", lambda cid: {S1, S2})  # stale roster
    r = mark(client, s, [rec(S2)])  # S2 was withdrawn meanwhile; the database trigger says no
    assert r.status_code == 409 and not stored(db, s)


def test_marking_a_session_that_has_not_happened_yet_is_409(client, db):
    future = make_session(db, on="2026-10-20")
    r = mark(client, future, [rec(S1)])
    assert r.status_code == 409 and not stored(db, future)


def test_a_session_dated_tomorrow_in_utc_can_be_marked_time_zone_grace(client, db):
    tomorrow = make_session(db, on="2026-10-06")
    assert mark(client, tomorrow, [rec(S1)]).status_code == 200
    day_after = make_session(db, on="2026-10-07", start="08:00:00")
    assert mark(client, day_after, [rec(S1)]).status_code == 409


def test_marking_an_old_session_still_works_and_corrections_stay_possible(client, db):
    old = make_session(db, on="2026-01-15")
    assert mark(client, old, [rec(S1, "absent")]).status_code == 200
    assert mark(client, old, [rec(S1, "excused")]).json()["updated"] == 1


@pytest.mark.parametrize("status", ["archived", "inactive"])
def test_a_read_only_course_cannot_get_new_sessions_or_marks(client, db, status):
    s = make_session(db)
    set_course_status(db, COURSE_A, status)
    assert create(client).status_code == 409
    assert mark(client, s, [rec(S1)]).status_code == 409
    assert not stored(db, s) and len(db.tables["attendance_sessions"]) == 1


def test_an_archived_course_still_shows_attendance_history_to_the_lecturer(client, db):
    s = make_session(db)
    make_record(db, s, S1)
    set_course_status(db, COURSE_A, "archived")
    assert client.get(f"/api/v1/attendance/sessions/{s['id']}", headers=bearer(L1)).status_code == 200
    assert (
        client.get(f"/api/v1/courses/{COURSE_A}/attendance/sessions", headers=bearer(L1)).status_code == 200
    )


# =============================== the student's own view (FR-ATT-04, AT-14) ===============================
def me(client, course=COURSE_A, who=S1):
    return client.get(f"/api/v1/courses/{course}/attendance/me", headers=bearer(who))


def test_student_sees_own_history_and_percentage_AT_14(client, db):
    s1 = make_session(db, on="2026-09-28")
    s2 = make_session(db, on="2026-10-01")
    s3 = make_session(db, on="2026-10-02")
    s4 = make_session(db, on="2026-10-03")
    make_record(db, s1, S1, "present")
    make_record(db, s2, S1, "late", "bus")
    make_record(db, s3, S1, "absent")
    make_record(db, s4, S1, "excused")
    r = me(client)
    assert r.status_code == 200
    body = r.json()
    assert body["course_id"] == COURSE_A
    assert [i["session_date"] for i in body["items"]] == [
        "2026-10-03",
        "2026-10-02",
        "2026-10-01",
        "2026-09-28",
    ]
    assert body["items"][2]["status"] == "late" and body["items"][2]["note"] == "bus"
    assert body["items"][0]["topic"] == "Introduction" and body["items"][0]["start_time"] == "09:00:00"
    assert body["summary"] == {
        "present": 1,
        "absent": 1,
        "late": 1,
        "excused": 1,
        "attended": 2,
        "counted_sessions": 3,
        "attendance_pct": 66.67,
    }


def test_student_with_no_records_has_an_empty_history_and_no_percentage(client, db):
    make_session(db)  # a session exists, but nothing was marked for S1
    body = me(client).json()
    assert body["items"] == [] and body["summary"]["attendance_pct"] is None
    assert body["summary"]["counted_sessions"] == 0


def test_student_never_sees_other_students_records(client, db):
    other = add_student(db, 1, "Second Student", "STU500", enroll_in=COURSE_A)
    s = make_session(db)
    make_record(db, s, other, "absent")
    make_record(db, s, S1, "present")
    body = me(client).json()
    assert len(body["items"]) == 1 and body["items"][0]["status"] == "present"
    assert body["summary"]["attendance_pct"] == 100.0
    assert me(client, who=other).json()["items"][0]["status"] == "absent"


def test_a_percentage_is_per_course(client, db):
    db.tables["course_enrollments"].append(
        {"id": "e9", "course_id": COURSE_B, "student_id": S1, "status": "active"}
    )
    make_record(db, make_session(db), S1, "present")
    make_record(db, make_session(db, course_id=COURSE_B, creator=L1), S1, "absent")
    assert me(client).json()["summary"]["attendance_pct"] == 100.0
    assert me(client, COURSE_B).json()["summary"]["attendance_pct"] == 0.0


def test_a_percentage_matches_the_source_records_AT_20(client, db):
    statuses = ["present"] * 7 + ["late"] * 2 + ["absent"] * 3 + ["excused"] * 2
    for i, status in enumerate(statuses):
        make_record(db, make_session(db, on=f"2026-09-{i + 1:02d}"), S1, status)
    s = me(client).json()["summary"]
    assert (s["attended"], s["counted_sessions"], s["attendance_pct"]) == (9, 12, 75.0)
    assert s["present"] + s["absent"] + s["late"] + s["excused"] == len(statuses)


def test_a_student_cannot_see_attendance_of_a_course_they_are_not_in(client, db):
    assert me(client, COURSE_B).status_code == 404


def test_a_student_who_withdrew_loses_access_to_the_course(client, db):
    next(e for e in db.tables["course_enrollments"] if e["student_id"] == S1)["status"] = "withdrawn"
    assert me(client).status_code == 404


def test_the_student_endpoint_has_no_write_methods_FR_ATT_04(client, db):
    s = make_session(db)
    h = bearer(S1)
    url = f"/api/v1/courses/{COURSE_A}/attendance/me"
    assert client.post(url, headers=h, json={}).status_code == 405
    assert client.put(url, headers=h, json={}).status_code == 405
    assert client.patch(url, headers=h, json={}).status_code == 405
    assert client.delete(url, headers=h).status_code == 405
    assert client.delete(f"/api/v1/attendance/sessions/{s['id']}", headers=h).status_code == 405


# =============================== authorization ===============================
def test_students_cannot_use_lecturer_attendance_endpoints_403(client, db):
    s = make_session(db)
    h = bearer(S1)
    assert (
        client.post(
            f"/api/v1/courses/{COURSE_A}/attendance/sessions", headers=h, json=SESSION_BODY
        ).status_code
        == 403
    )
    assert client.get(f"/api/v1/courses/{COURSE_A}/attendance/sessions", headers=h).status_code == 403
    assert client.get(f"/api/v1/attendance/sessions/{s['id']}", headers=h).status_code == 403
    assert mark(client, s, [rec(S1)], who=S1).status_code == 403
    assert not stored(db, s)


def test_a_lecturer_cannot_use_the_student_endpoint_403(client, db):
    assert me(client, who=L1).status_code == 403


def test_lecturer_not_assigned_to_the_course_gets_404(client, db):
    other_course_session = make_session(db, course_id=COURSE_B, creator=L1)
    assert create(client, course=COURSE_B).status_code == 404
    assert (
        client.get(f"/api/v1/courses/{COURSE_B}/attendance/sessions", headers=bearer(L1)).status_code == 404
    )
    assert (
        client.get(
            f"/api/v1/attendance/sessions/{other_course_session['id']}", headers=bearer(L1)
        ).status_code
        == 404
    )
    assert mark(client, other_course_session, [rec(S1)]).status_code == 404
    assert len(db.tables["attendance_sessions"]) == 1


def test_unknown_course_is_404(client, db):
    assert create(client, course="00000000-0000-0000-0000-00000000ffff").status_code == 404


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", f"/api/v1/courses/{COURSE_A}/attendance/sessions"),
        ("get", f"/api/v1/courses/{COURSE_A}/attendance/sessions"),
        ("get", f"/api/v1/courses/{COURSE_A}/attendance/me"),
        ("get", "/api/v1/attendance/sessions/00000000-0000-0000-0000-000000000001"),
        ("post", "/api/v1/attendance/sessions/00000000-0000-0000-0000-000000000001/records"),
    ],
)
def test_every_attendance_endpoint_needs_a_login_401(client, db, method, path):
    assert getattr(client, method)(path).status_code == 401
    assert getattr(client, method)(path, headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_malformed_ids_are_422_not_500(client, db):
    assert client.get("/api/v1/attendance/sessions/not-a-uuid", headers=bearer(L1)).status_code == 422
    assert client.get("/api/v1/courses/not-a-uuid/attendance/me", headers=bearer(S1)).status_code == 422
