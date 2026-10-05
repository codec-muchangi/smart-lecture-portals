"""How a submission is shown to the person looking at it."""

from app.utils.files import MIME_BY_EXT, split_extension


def mime_for(file_name: str) -> str:
    return MIME_BY_EXT.get(split_extension(file_name), "application/octet-stream")


def _base(row: dict) -> dict:
    return {
        "id": row["id"],
        "assignment_id": row["assignment_id"],
        "student_id": row["student_id"],
        "file_name": row["file_name"],
        "mime_type": mime_for(row["file_name"]),
        "file_size": row["file_size"],
        "status": row["status"],
        "submitted_at": row["submitted_at"],
        "grade_released": bool(row.get("grade_released")),
    }


def student_view(row: dict) -> dict:
    """What the owning student may see (SRS 5.3, FR-ASG-10).

    The mark and the feedback of a graded submission stay hidden until the lecturer releases the grade. A
    submission returned for revision is the exception for feedback only: it is useless unless the student can
    read what to fix. A returned submission never has a mark.
    """
    released = bool(row.get("grade_released"))
    returned = row.get("status") == "returned"
    return {
        **_base(row),
        "mark": row.get("mark") if released else None,
        "feedback": row.get("feedback") if released or returned else None,
    }


def lecturer_view(row: dict) -> dict:
    return {
        **_base(row),
        "mark": row.get("mark"),
        "feedback": row.get("feedback"),
        "student_name": row["full_name"],
        "registration_number": row["registration_number"],
        "email": row["email"],
    }
