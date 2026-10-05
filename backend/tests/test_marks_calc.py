"""Weighted results (FR-MARK-04): exact Decimal arithmetic, half-up rounding."""

import pytest

from app.services import marks_calc as calc


def item(mark, max_marks, weight=None):
    return {"mark": mark, "max_marks": max_marks, "weight": weight}


def test_single_weighted_assessment():
    t = calc.compute_totals([item(17, 30, 15)])
    assert t == {
        "weighted_total": 8.5,
        "weight_graded": 15.0,
        "weight_published": 15.0,
        "weighted_percent": 56.67,
        "marks_total": 17.0,
        "max_total": 30.0,
    }


def test_several_assessments_with_one_not_marked_yet():
    t = calc.compute_totals([item(24, 30, 15), item(40, 50, 25), item(None, 100, 60)])
    assert t["weighted_total"] == 32.0  # 12 + 20
    assert t["weight_graded"] == 40.0 and t["weight_published"] == 100.0
    assert t["weighted_percent"] == 80.0
    assert t["marks_total"] == 64.0 and t["max_total"] == 80.0  # the unmarked exam is not in the raw totals


def test_unweighted_assessments_count_only_in_raw_totals():
    t = calc.compute_totals([item(8, 10, None), item(15, 30, 10)])
    assert t["weighted_total"] == 5.0 and t["weight_graded"] == 10.0 and t["weight_published"] == 10.0
    assert t["marks_total"] == 23.0 and t["max_total"] == 40.0


def test_a_zero_mark_is_a_mark():
    t = calc.compute_totals([item(0, 30, 15)])
    assert t["weighted_total"] == 0.0 and t["weight_graded"] == 15.0 and t["weighted_percent"] == 0.0


def test_nothing_marked_yet():
    t = calc.compute_totals([item(None, 30, 15), item(None, 50, 25)])
    assert t["weighted_total"] == 0.0 and t["weight_graded"] == 0.0 and t["weight_published"] == 40.0
    assert t["weighted_percent"] is None


def test_no_assessments_at_all():
    assert calc.compute_totals([]) == {
        "weighted_total": 0.0,
        "weight_graded": 0.0,
        "weight_published": 0.0,
        "weighted_percent": None,
        "marks_total": 0.0,
        "max_total": 0.0,
    }


def test_full_marks_everywhere_is_exactly_the_total_weight():
    t = calc.compute_totals([item(30, 30, 40), item(100, 100, 60)])
    assert t["weighted_total"] == 100.0 and t["weighted_percent"] == 100.0


@pytest.mark.parametrize(
    "mark,maximum,expected",
    [
        (17, 30, 56.67),
        (1, 3, 33.33),
        (2, 3, 66.67),
        (1, 32, 3.13),
        (1, 16, 6.25),
        (0, 10, 0.0),
        (None, 10, None),
    ],
)
def test_percentage_rounds_half_up(mark, maximum, expected):
    assert (
        calc.percentage(mark, maximum) == expected
    )  # 1/32 = 3.125 -> 3.13 (banker's rounding would give 3.12)


def test_decimal_inputs_are_exact():
    # 0.1 + 0.2 style float noise must not leak into results
    t = calc.compute_totals([item(0.1, 0.3, 30), item(0.2, 0.3, 30)])
    assert t["weighted_total"] == 30.0 and t["marks_total"] == 0.3
