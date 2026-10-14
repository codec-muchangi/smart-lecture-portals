"""Attendance percentage policy (FR-ATT-05): (present+late) / (present+late+absent), excused left out."""

from app.services.attendance_calc import summarize


def test_no_records_has_no_percentage():
    s = summarize([])
    assert s["attendance_pct"] is None and s["counted_sessions"] == 0 and s["attended"] == 0


def test_present_and_late_count_as_attended():
    s = summarize(["present", "late", "absent", "present"])
    assert (s["present"], s["late"], s["absent"], s["attended"], s["counted_sessions"]) == (2, 1, 1, 3, 4)
    assert s["attendance_pct"] == 75.0


def test_excused_sessions_are_left_out_of_the_calculation():
    s = summarize(["present", "excused", "excused", "absent"])
    assert s["excused"] == 2 and s["counted_sessions"] == 2 and s["attendance_pct"] == 50.0


def test_only_excused_means_nothing_counts_yet():
    assert summarize(["excused"])["attendance_pct"] is None


def test_rounds_half_up_to_two_decimals():
    assert summarize(["present", "absent", "absent"])["attendance_pct"] == 33.33
    assert summarize(["present"] * 2 + ["absent"])["attendance_pct"] == 66.67
    assert summarize(["present"] * 1 + ["absent"] * 7)["attendance_pct"] == 12.5
    assert summarize(["present"] * 1 + ["absent"] * 15)["attendance_pct"] == 6.25
    assert summarize(["present"] * 5 + ["absent"] * 3)["attendance_pct"] == 62.5
