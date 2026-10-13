"""Attendance percentage policy (SRS 4.7 FR-ATT-05; ERD note 4). One place, mirrored by the SQL view
`v_student_attendance_summary` (migration 0002), which database checks compare against.

Default policy, until the institution confirms its own: Present and Late count as attended; Absent counts
against the student; Excused sessions are left out of the calculation entirely.

    attendance_pct = (present + late) / (present + late + absent) x 100   (null when nothing counts yet)
"""

from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal

STATUSES = ("present", "absent", "late", "excused")


def summarize(statuses: Iterable[str]) -> dict:
    counts = dict.fromkeys(STATUSES, 0)
    for status in statuses:
        counts[status] += 1
    attended = counts["present"] + counts["late"]
    counted = attended + counts["absent"]
    pct = None
    if counted:
        pct = float((Decimal(attended) * 100 / Decimal(counted)).quantize(Decimal("0.01"), ROUND_HALF_UP))
    return {**counts, "attended": attended, "counted_sessions": counted, "attendance_pct": pct}
