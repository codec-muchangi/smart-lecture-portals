"""Phase 8 timetable: FR-TIME-01..03, FR-STU-11, FR-LEC-15."""

import pytest

from tests.conftest import COURSE_A, COURSE_B, L1, S1, S2, bearer, make_timetable_entry


@pytest.fixture(autouse=True)
def _frozen_time(clock):
    """NOW is Monday 2026-10-05 12:00 UTC."""


def tt(client, who=S1, **params):
    return client.get("/api/v1/timetable", headers=bearer(who), params=params)


def test_requires_login(client, db):
    assert client.get("/api/v1/timetable").status_code == 401


def test_default_window_is_seven_days_from_today(client, db):
    make_timetable_entry(db, day=1)  # Mondays
    body = tt(client).json()
    assert body["date_from"] == "2026-10-05" and body["date_to"] == "2026-10-11"
    assert [i["date"] for i in body["items"]] == ["2026-10-05"]
    item = body["items"][0]
    assert item["course_code"] == "CIT 3253" and item["day_of_week"] == 1 and item["recurring"] is True
    assert item["start_time"] == "08:00:00" and item["room"] == "Lab 2"


def test_weekly_entry_repeats_each_week(client, db):
    make_timetable_entry(db, day=3)
    body = tt(client, **{"from": "2026-10-01", "to": "2026-10-21"}).json()
    assert [i["date"] for i in body["items"]] == ["2026-10-07", "2026-10-14", "2026-10-21"]


def test_recurrence_bounds_and_malformed_values(client, db):
    make_timetable_entry(db, day=1, recurrence={"from": "2026-10-12", "until": "2026-10-19"})
    make_timetable_entry(db, day=2, recurrence={"from": "garbage", "until": None}, start="09:00:00")
    body = tt(client, **{"from": "2026-10-01", "to": "2026-10-28"}).json()
    mondays = [i["date"] for i in body["items"] if i["day_of_week"] == 1]
    assert mondays == ["2026-10-12", "2026-10-19"]
    assert len([i for i in body["items"] if i["day_of_week"] == 2]) == 4  # malformed bound ignored


def test_one_off_entries(client, db):
    make_timetable_entry(db, on="2026-10-08", start="14:00:00", end="16:00:00", notes="Makeup class")
    make_timetable_entry(db, on="2026-11-30")
    body = tt(client).json()
    assert len(body["items"]) == 1
    one = body["items"][0]
    assert one["date"] == "2026-10-08" and one["recurring"] is False and one["day_of_week"] == 4
    assert one["notes"] == "Makeup class"


def test_items_sorted_by_date_then_time(client, db):
    make_timetable_entry(db, day=1, start="13:00:00", end="14:00:00")
    make_timetable_entry(db, day=1, start="08:00:00", end="09:00:00")
    make_timetable_entry(db, on="2026-10-05", start="10:00:00", end="11:00:00")
    times = [i["start_time"] for i in tt(client).json()["items"]]
    assert times == ["08:00:00", "10:00:00", "13:00:00"]


def test_only_own_active_courses(client, db):
    make_timetable_entry(db, course_id=COURSE_B, day=1)
    assert tt(client).json()["items"] == []  # S1 not enrolled in B
    assert tt(client, who=L1).json()["items"] == []  # L1 not assigned to B
    assert tt(client, who=S2).json()["items"] == []
    make_timetable_entry(db, day=1)
    assert len(tt(client).json()["items"]) == 1 and len(tt(client, who=L1).json()["items"]) == 1
    next(c for c in db.tables["courses"] if c["id"] == COURSE_A)["status"] = "archived"
    assert tt(client).json()["items"] == []


def test_window_validation(client, db):
    assert tt(client, **{"from": "2026-10-10", "to": "2026-10-01"}).status_code == 400
    assert tt(client, **{"from": "2026-01-01", "to": "2026-12-31"}).status_code == 400
    assert tt(client, **{"from": "2026-10-01", "to": "2026-12-02"}).status_code == 200  # exactly 93 days
    assert tt(client, **{"from": "notadate"}).status_code == 422


def test_only_from_or_only_to(client, db):
    make_timetable_entry(db, day=1)
    assert tt(client, **{"from": "2026-10-12"}).json()["date_to"] == "2026-10-18"
    body = tt(client, to="2026-10-12").json()
    assert body["date_from"] == "2026-10-06" and [i["date"] for i in body["items"]] == ["2026-10-12"]
