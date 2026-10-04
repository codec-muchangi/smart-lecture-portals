"""Phase 4 (submissions): FR-ASG-04..07, FR-STU-06/07, FR-LEC-07, AT-06, AT-08, AT-09, AT-16."""

from datetime import timedelta

import pytest

from app.core.config import get_settings
from tests import file_samples as samples
from tests.conftest import (
    COURSE_A,
    COURSE_B,
    L1,
    NOW,
    S1,
    S2,
    add_student,
    bearer,
    make_assignment,
    make_submission,
)


def submit(client, a, who=S1, name="answer.pdf", data=None, content_type="application/pdf"):
    return client.post(
        f"/api/v1/assignments/{a['id']}/submissions",
        headers=bearer(who),
        files={"file": (name, samples.pdf() if data is None else data, content_type)},
    )


def subs(db):
    return db.tables.get("submissions", [])


def set_course_status(db, course_id, status):
    next(c for c in db.tables["courses"] if c["id"] == course_id)["status"] = status


# =============================== submit ===============================
def test_enrolled_student_submits_before_the_deadline_AT08(client, db, clock):
    a = make_assignment(db)
    r = submit(client, a, name="My Answer (final).pdf")
    assert r.status_code == 201
    s = r.json()
    assert s["status"] == "submitted" and s["file_name"] == "My_Answer_final.pdf"
    assert s["mime_type"] == "application/pdf" and s["file_size"] == len(samples.pdf())
    assert s["student_id"] == S1 and s["assignment_id"] == a["id"]
    assert s["submitted_at"].startswith("2026-10-05T12:00:00")  # timestamp recorded (FR-ASG-05)
    assert s["mark"] is None and s["feedback"] is None and s["grade_released"] is False
    assert "storage_path" not in s


def test_file_is_stored_privately_at_the_srs_path(client, db, clock):
    a = make_assignment(db)
    s = submit(client, a).json()
    path = (
        f"{COURSE_A}/{a['id']}/{S1}/{s['id']}/answer.pdf"  # SRS 14: course/assignment/student/submission/file
    )
    assert subs(db)[0]["storage_path"] == path and ("submissions", path) in db.objects
    assert db.objects[("submissions", path)]["content_type"] == "application/pdf"
    assert not any(bucket == "materials" for bucket, _ in db.objects)


def test_submission_is_audited(client, db, clock):
    s = submit(client, make_assignment(db)).json()
    log = db.audit("submission.create")
    assert len(log) == 1 and log[0]["actor_user_id"] == S1 and log[0]["entity_id"] == s["id"]
    assert log[0]["new_value"]["status"] == "submitted"


@pytest.mark.parametrize("ext", ["pdf", "docx", "pptx", "xlsx", "csv", "png", "jpg", "zip"])
def test_all_default_types_are_accepted(client, db, clock, ext):
    a = make_assignment(db)
    assert (
        submit(
            client, a, name=f"work.{ext}", data=samples.VALID[ext](), content_type="application/octet-stream"
        ).status_code
        == 201
    )


# ---------- file validation (AT-09) ----------
@pytest.mark.parametrize(
    "name,data",
    [
        ("virus.exe", samples.WINDOWS_EXE),
        ("page.html", samples.HTML),
        ("fake.pdf", samples.WINDOWS_EXE),
        ("fake.docx", samples.plain_zip()),
        ("fake.png", samples.pdf()),
        ("noextension", samples.pdf()),
    ],
)
def test_invalid_files_are_rejected_and_nothing_is_stored_AT09(client, db, clock, name, data):
    r = submit(client, make_assignment(db), name=name, data=data)
    assert r.status_code == 400 and r.json()["code"] == "FILE_TYPE_NOT_ALLOWED"
    assert subs(db) == [] and db.objects == {} and db.audit("submission.create") == []


def test_oversized_and_empty_files_are_rejected_AT09(client, db, clock, monkeypatch):
    a = make_assignment(db)
    assert submit(client, a, data=b"").status_code == 400
    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    r = submit(client, a, data=samples.pdf() + b"0" * (1024 * 1024))
    assert r.status_code == 400 and r.json()["code"] == "FILE_TOO_LARGE"
    huge = submit(client, a, data=samples.pdf() + b"0" * (3 * 1024 * 1024))  # stopped before it is even read
    assert huge.status_code == 400 and huge.json()["code"] == "FILE_TOO_LARGE"
    assert subs(db) == [] and db.objects == {}


def test_missing_file_is_422(client, db, clock):
    a = make_assignment(db)
    assert client.post(f"/api/v1/assignments/{a['id']}/submissions", headers=bearer(S1)).status_code == 422


# ---------- deadline policy (FR-ASG-04, FR-ASG-07) ----------
def test_submission_at_the_exact_deadline_is_on_time(client, db, clock):
    a = make_assignment(db, due_in_days=1)
    clock.now = NOW + timedelta(days=1)
    assert submit(client, a).json()["status"] == "submitted"


def test_after_the_deadline_is_refused_by_default(client, db, clock):
    a = make_assignment(db, due_in_days=1)
    clock.now = NOW + timedelta(days=1, seconds=1)
    r = submit(client, a)
    assert r.status_code == 400 and r.json()["code"] == "DEADLINE_PASSED" and "due_at" in r.json()["details"]
    assert subs(db) == [] and db.objects == {}


def test_after_the_deadline_is_accepted_as_late_when_the_lecturer_allows_it(client, db, clock):
    a = make_assignment(db, due_in_days=1, allow_late=True)
    clock.now = NOW + timedelta(days=3)
    r = submit(client, a)
    assert r.status_code == 201 and r.json()["status"] == "late"
    assert db.audit("submission.create")[0]["new_value"]["status"] == "late"


def test_extending_the_deadline_reopens_submissions(client, db, clock):
    a = make_assignment(db, due_in_days=1)
    clock.now = NOW + timedelta(days=2)
    assert submit(client, a).status_code == 400
    client.patch(
        f"/api/v1/assignments/{a['id']}",
        headers=bearer(L1),
        json={"due_at": (clock.now + timedelta(days=2)).isoformat()},
    )
    assert submit(client, a).status_code == 201


def test_closed_assignment_refuses_submissions(client, db, clock):
    r = submit(client, make_assignment(db, closed=True))
    assert r.status_code == 409 and "closed" in r.json()["message"]
    assert subs(db) == [] and db.objects == {}


@pytest.mark.parametrize("status", ["archived", "inactive"])
def test_read_only_course_refuses_submissions(client, db, clock, status):
    a = make_assignment(db)
    set_course_status(db, COURSE_A, status)
    # inactive courses are hidden from students (404); archived ones are visible but read-only (409)
    assert submit(client, a).status_code == (409 if status == "archived" else 404)
    assert subs(db) == []


# ---------- authorization (AT-06, AT-16) ----------
def test_student_not_enrolled_cannot_submit_AT06(client, db, clock):
    a = make_assignment(db)
    r = submit(client, a, who=S2)
    assert r.status_code == 404 and subs(db) == [] and db.objects == {}


def test_withdrawn_student_cannot_submit(client, db, clock):
    a = make_assignment(db)
    db.tables["course_enrollments"][0]["status"] = "withdrawn"
    assert submit(client, a).status_code == 404


def test_cannot_submit_to_another_courses_assignment(client, db, clock):
    other = make_assignment(db, course_id=COURSE_B)
    assert submit(client, other).status_code == 404 and subs(db) == []


def test_cannot_submit_to_a_draft_assignment(client, db, clock):
    assert submit(client, make_assignment(db, published=False)).status_code == 404


def test_lecturers_and_anonymous_users_cannot_submit(client, db, clock):
    a = make_assignment(db)
    assert submit(client, a, who=L1).status_code == 403
    assert (
        client.post(
            f"/api/v1/assignments/{a['id']}/submissions", files={"file": ("a.pdf", samples.pdf())}
        ).status_code
        == 401
    )
    assert subs(db) == []


def test_unknown_and_malformed_assignment_ids(client, db, clock):
    assert (
        client.post(
            "/api/v1/assignments/00000000-0000-0000-0000-00000000ffff/submissions",
            headers=bearer(S1),
            files={"file": ("a.pdf", samples.pdf())},
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/v1/assignments/not-a-uuid/submissions",
            headers=bearer(S1),
            files={"file": ("a.pdf", samples.pdf())},
        ).status_code
        == 422
    )


# ---------- resubmission ----------
def test_resubmitting_replaces_the_file_and_keeps_one_row(client, db, clock):
    a = make_assignment(db)
    first = submit(client, a, name="v1.pdf").json()
    first_path = subs(db)[0]["storage_path"]
    clock.advance(timedelta(hours=2))
    r = submit(client, a, name="v2.png", data=samples.png(), content_type="image/png")
    assert r.status_code == 200  # replaced, not created
    second = r.json()
    assert (
        second["id"] == first["id"] and second["file_name"] == "v2.png" and second["mime_type"] == "image/png"
    )
    assert second["submitted_at"].startswith("2026-10-05T14:00:00") and len(subs(db)) == 1
    assert ("submissions", first_path) not in db.objects and len(db.objects) == 1  # old file removed
    log = db.audit("submission.replace")[0]
    assert log["old_value"]["file_name"] == "v1.pdf" and log["new_value"]["old_file_removed"] is True


def test_resubmitting_a_file_with_the_same_name_does_not_collide(client, db, clock):
    a = make_assignment(db)
    submit(client, a, name="same.pdf")
    first = subs(db)[0]["storage_path"]
    assert submit(client, a, name="same.pdf").status_code == 200
    assert subs(db)[0]["storage_path"] != first and len(db.objects) == 1


def test_resubmitting_after_the_deadline_is_refused_unless_late_is_allowed(client, db, clock):
    strict = make_assignment(db, due_in_days=1)
    lenient = make_assignment(db, title="Lenient", due_in_days=1, allow_late=True)
    submit(client, strict)
    submit(client, lenient)
    clock.now = NOW + timedelta(days=2)
    assert submit(client, strict).status_code == 400  # cannot replace after the deadline
    assert subs(db)[0]["status"] == "submitted"
    r = submit(client, lenient)
    assert r.status_code == 200 and r.json()["status"] == "late"  # on-time work resubmitted late becomes late


def test_graded_submission_cannot_be_replaced(client, db, clock):
    a = make_assignment(db)
    make_submission(db, a, S1, status="graded", mark=15)
    r = submit(client, a)
    assert r.status_code == 409 and "graded" in r.json()["message"]
    assert subs(db)[0]["mark"] == 15 and len(db.objects) == 1


def test_returned_submission_can_be_resubmitted(client, db, clock):
    a = make_assignment(db)
    make_submission(db, a, S1, status="returned")
    r = submit(client, a)
    assert r.status_code == 200 and r.json()["status"] == "submitted"


def test_a_failed_replacement_keeps_the_original_submission(client, db, clock):
    a = make_assignment(db)
    submit(client, a, name="v1.pdf")
    original = dict(subs(db)[0])
    db.storage_fail_upload = True
    assert submit(client, a, name="v2.pdf").status_code == 503
    assert subs(db)[0] == original and len(db.objects) == 1


def test_each_student_has_their_own_submission(client, db, clock):
    a = make_assignment(db)
    other = add_student(db, 1, "Second Student", "STU700", enroll_in=COURSE_A)
    submit(client, a, who=S1)
    submit(client, a, who=other)
    assert len(subs(db)) == 2 and {s["student_id"] for s in subs(db)} == {S1, other}


# ---------- failure handling ----------
def test_database_failure_removes_the_stored_file(client, db, clock):
    db.fail_insert_tables.add("submissions")
    r = submit(client, make_assignment(db))
    assert r.status_code == 500 and r.json()["code"] == "INTERNAL_ERROR" and "simulated" not in r.text
    assert db.objects == {} and subs(db) == [] and db.audit("submission.create") == []


def test_storage_outage_returns_503_and_saves_nothing(client, db, clock):
    db.storage_fail_upload = True
    r = submit(client, make_assignment(db))
    assert r.status_code == 503 and r.json()["code"] == "SERVICE_UNAVAILABLE" and subs(db) == []


def test_a_lost_race_is_a_clean_conflict_and_leaves_no_orphan(client, db, clock, monkeypatch):
    from app.repositories import submission_repository

    a = make_assignment(db)
    monkeypatch.setattr(
        submission_repository, "get_for_student", lambda *args: None
    )  # both requests saw "no row"
    make_submission(db, a, S1, with_object=False)  # ...but the other one inserted first
    r = submit(client, a)
    assert r.status_code == 409 and len(subs(db)) == 1 and db.objects == {}


def test_failed_cleanup_of_the_replaced_file_is_audited_not_fatal(client, db, clock):
    a = make_assignment(db)
    submit(client, a)
    db.storage_fail_remove = True
    assert submit(client, a, name="v2.pdf").status_code == 200
    assert db.audit("submission.replace")[0]["new_value"]["old_file_removed"] is False


# =============================== my submission ===============================
def test_student_reads_own_submission_status(client, db, clock):
    a = make_assignment(db)
    assert client.get(f"/api/v1/assignments/{a['id']}/submissions/me", headers=bearer(S1)).status_code == 404
    submit(client, a)
    r = client.get(f"/api/v1/assignments/{a['id']}/submissions/me", headers=bearer(S1))
    assert r.status_code == 200 and r.json()["status"] == "submitted"
    detail = client.get(f"/api/v1/assignments/{a['id']}", headers=bearer(S1)).json()
    assert detail["my_submission"]["status"] == "submitted"  # FR-STU-07


def test_grade_stays_hidden_until_released(client, db, clock):
    a = make_assignment(db)
    make_submission(db, a, S1, status="graded", mark=18, feedback="Well done", grade_released=False)
    url = f"/api/v1/assignments/{a['id']}/submissions/me"
    hidden = client.get(url, headers=bearer(S1)).json()
    assert hidden["status"] == "graded" and hidden["mark"] is None and hidden["feedback"] is None
    subs(db)[0]["grade_released"] = True
    shown = client.get(url, headers=bearer(S1)).json()
    assert shown["mark"] == 18 and shown["feedback"] == "Well done" and shown["grade_released"] is True


def test_my_submission_access_rules(client, db, clock):
    a = make_assignment(db)
    draft = make_assignment(db, published=False)
    make_submission(db, a, S1)
    assert client.get(f"/api/v1/assignments/{a['id']}/submissions/me").status_code == 401
    assert client.get(f"/api/v1/assignments/{a['id']}/submissions/me", headers=bearer(L1)).status_code == 403
    assert client.get(f"/api/v1/assignments/{a['id']}/submissions/me", headers=bearer(S2)).status_code == 404
    assert (
        client.get(f"/api/v1/assignments/{draft['id']}/submissions/me", headers=bearer(S1)).status_code == 404
    )


# =============================== lecturer list ===============================
def lecturer_list(client, a, qs="", who=L1):
    return client.get(f"/api/v1/assignments/{a['id']}/submissions{qs}", headers=bearer(who))


def test_lecturer_lists_submissions_with_student_identity(client, db, clock):
    a = make_assignment(db)
    make_submission(db, a, S1, status="late", mark=12, feedback="ok")
    body = lecturer_list(client, a).json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["student_name"] == "Demo Student" and item["registration_number"] == "STU001"
    assert item["email"] == "student@demo.test" and item["status"] == "late"
    assert item["mark"] == 12 and item["feedback"] == "ok"  # lecturers always see marks
    assert "storage_path" not in item


def test_list_filters_search_and_pagination(client, db, clock):
    a = make_assignment(db)
    ids = [add_student(db, n, f"Student {n}", f"STU80{n}", enroll_in=COURSE_A) for n in range(1, 4)]
    make_submission(db, a, ids[0], status="submitted")
    make_submission(db, a, ids[1], status="late")
    make_submission(db, a, ids[2], status="graded", mark=10)
    assert {i["student_id"] for i in lecturer_list(client, a, "?status=late").json()["items"]} == {ids[1]}
    assert lecturer_list(client, a, "?status=all").json()["total"] == 3
    assert [i["registration_number"] for i in lecturer_list(client, a, "?q=STU803").json()["items"]] == [
        "STU803"
    ]
    assert [i["student_name"] for i in lecturer_list(client, a, "?q=student 2").json()["items"]] == [
        "Student 2"
    ]
    assert lecturer_list(client, a, "?q=zzz,id.neq.0").json()["total"] == 0
    p1 = lecturer_list(client, a, "?page=1&page_size=2").json()
    p2 = lecturer_list(client, a, "?page=2&page_size=2").json()
    assert p1["total"] == 3 and len(p1["items"]) == 2 and len(p2["items"]) == 1


@pytest.mark.parametrize("qs", ["?status=bogus", "?page=0", "?page_size=101"])
def test_bad_list_params_are_422(client, db, clock, qs):
    assert lecturer_list(client, make_assignment(db), qs).status_code == 422


def test_list_keeps_withdrawn_students_history(client, db, clock):
    a = make_assignment(db)
    make_submission(db, a, S1)
    db.tables["course_enrollments"][0]["status"] = "withdrawn"
    assert lecturer_list(client, a).json()["total"] == 1


def test_list_authorization(client, db, clock):
    a = make_assignment(db)
    other = make_assignment(db, course_id=COURSE_B)
    make_submission(db, other, S1)
    assert lecturer_list(client, a, who=S1).status_code == 403
    assert client.get(f"/api/v1/assignments/{a['id']}/submissions").status_code == 401
    assert lecturer_list(client, other).status_code == 404  # lecturer not assigned to that course
    assert lecturer_list(client, a).json()["total"] == 0  # other course's submissions never leak


# =============================== download ===============================
def dl(client, sub, who):
    return client.get(f"/api/v1/submissions/{sub['id']}/download", headers=bearer(who))


def test_lecturer_downloads_a_students_submission(client, db, clock):
    sub = make_submission(db, make_assignment(db), S1, file_name="essay.pdf")
    r = dl(client, sub, L1)
    assert r.status_code == 200
    body = r.json()
    assert body["file_name"] == "essay.pdf" and body["expires_in"] == get_settings().signed_url_ttl_seconds
    assert body["url"].startswith("https://storage.test/submissions/") and "download=essay.pdf" in body["url"]
    assert db.signed_urls == [("submissions", sub["storage_path"], 120)]


def test_student_downloads_only_their_own_submission_AT16(client, db, clock):
    a = make_assignment(db)
    mine, theirs = make_submission(db, a, S1), make_submission(db, a, S2)
    assert dl(client, mine, S1).status_code == 200
    r = dl(client, theirs, S1)
    assert r.status_code == 404  # another student's work is invisible, not forbidden
    assert db.signed_urls == [("submissions", mine["storage_path"], 120)]


def test_download_authorization(client, db, clock):
    other = make_submission(db, make_assignment(db, course_id=COURSE_B), S1)
    mine = make_submission(db, make_assignment(db), S1)
    assert client.get(f"/api/v1/submissions/{mine['id']}/download").status_code == 401
    assert dl(client, other, L1).status_code == 404  # lecturer not assigned to that course
    assert dl(client, mine, S2).status_code == 404
    assert (
        client.get(
            "/api/v1/submissions/00000000-0000-0000-0000-00000000ffff/download", headers=bearer(L1)
        ).status_code
        == 404
    )
    assert client.get("/api/v1/submissions/not-a-uuid/download", headers=bearer(L1)).status_code == 422
    db.tables["course_enrollments"][0]["status"] = "withdrawn"
    assert dl(client, mine, S1).status_code == 404  # a withdrawn student has lost course access


def test_missing_stored_file_is_404_and_signed_url_outage_is_503(client, db, clock, monkeypatch):
    sub = make_submission(db, make_assignment(db), S1, with_object=False)
    r = dl(client, sub, L1)
    assert r.status_code == 404 and r.json()["message"] == "The file is no longer available"
    ok = make_submission(db, make_assignment(db, title="Other"), S1)
    monkeypatch.setattr(type(db.storage.from_("submissions")), "create_signed_url", lambda *a, **k: 1 / 0)
    assert dl(client, ok, L1).status_code == 503


# =============================== end to end ===============================
def test_full_student_journey(client, db, clock):
    created = client.post(
        f"/api/v1/courses/{COURSE_A}/assignments",
        headers=bearer(L1),
        json={
            "title": "Essay",
            "due_at": (NOW + timedelta(days=3)).isoformat(),
            "max_marks": 50,
            "published": True,
        },
    ).json()
    listed = client.get(f"/api/v1/courses/{COURSE_A}/assignments", headers=bearer(S1)).json()["items"][0]
    assert (
        listed["id"] == created["id"]
        and listed["my_submission"] is None
        and listed["submissions_open"] is True
    )
    assert submit(client, created).status_code == 201
    assert (
        client.get(f"/api/v1/assignments/{created['id']}", headers=bearer(S1)).json()["my_submission"][
            "status"
        ]
        == "submitted"
    )
    assert (
        client.get(f"/api/v1/assignments/{created['id']}/submissions", headers=bearer(L1)).json()["total"]
        == 1
    )
    sid = client.get(f"/api/v1/assignments/{created['id']}/submissions", headers=bearer(L1)).json()["items"][
        0
    ]["id"]
    assert client.get(f"/api/v1/submissions/{sid}/download", headers=bearer(L1)).status_code == 200
    assert (
        client.get(f"/api/v1/assignments/{created['id']}", headers=bearer(L1)).json()["submission_counts"][
            "total"
        ]
        == 1
    )


# =============================== remaining failure paths ===============================
def test_database_failure_during_replacement_keeps_the_old_file_and_removes_the_new_one(client, db, clock):
    a = make_assignment(db)
    submit(client, a, name="v1.pdf")
    original = dict(subs(db)[0])
    db.fail_update_tables.add("submissions")
    r = submit(client, a, name="v2.pdf")
    assert r.status_code == 500 and r.json()["code"] == "INTERNAL_ERROR"
    assert subs(db)[0] == original
    assert list(db.objects) == [
        ("submissions", original["storage_path"])
    ]  # new upload cleaned up, old one intact


def test_download_of_a_submission_whose_assignment_is_gone_is_404(client, db, clock):
    sub = make_submission(db, {"id": "00000000-0000-0000-0000-0000000000aa", "course_id": COURSE_A})
    assert dl(client, sub, L1).status_code == 404


def test_clock_returns_aware_utc_and_parses_database_timestamps():
    from datetime import UTC, datetime

    from app.utils import clock as real_clock

    assert real_clock.utcnow().tzinfo is not None
    assert real_clock.parse_ts("2026-10-05T12:00:00") == datetime(2026, 10, 5, 12, tzinfo=UTC)  # naive = UTC
    assert real_clock.parse_ts("2026-10-05T15:00:00+03:00") == datetime(2026, 10, 5, 12, tzinfo=UTC)
    assert real_clock.parse_ts("2026-10-05T12:00:00.123456Z").microsecond == 123456
