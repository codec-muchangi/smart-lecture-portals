"""Weighted results (SRS FR-MARK-04). Pure functions on Decimal so rounding is exact and testable.

Scheme: every weighted assessment contributes mark / max_marks x weight points. Weights are percentages of the
course total and (enforced elsewhere) never add up to more than 100. Only published assessments count for
students. Assessments without a weight are shown but do not enter the weighted total.
"""

from decimal import ROUND_HALF_UP, Decimal

TWO_PLACES = Decimal("0.01")


def d(value) -> Decimal:
    """Database numbers arrive as int/float/str; go through str() so 0.1 stays 0.1."""
    return Decimal(str(value))


def q2(value: Decimal) -> Decimal:
    return value.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def percentage(mark, max_marks) -> float | None:
    if mark is None:
        return None
    return float(q2(d(mark) / d(max_marks) * 100))


def compute_totals(items: list[dict]) -> dict:
    """`items`: published assessments as dicts with max_marks, weight (or None) and mark (or None)."""
    weighted_total = weight_graded = weight_published = marks_total = max_total = Decimal(0)
    for item in items:
        weight = None if item.get("weight") is None else d(item["weight"])
        if weight is not None:
            weight_published += weight
        if item.get("mark") is None:
            continue
        mark, maximum = d(item["mark"]), d(item["max_marks"])
        marks_total += mark
        max_total += maximum
        if weight is not None:
            weighted_total += mark / maximum * weight
            weight_graded += weight
    return {
        "weighted_total": float(q2(weighted_total)),
        "weight_graded": float(q2(weight_graded)),
        "weight_published": float(q2(weight_published)),
        "weighted_percent": float(q2(weighted_total / weight_graded * 100)) if weight_graded else None,
        "marks_total": float(q2(marks_total)),
        "max_total": float(q2(max_total)),
    }
