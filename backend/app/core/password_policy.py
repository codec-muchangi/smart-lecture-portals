from app.core.errors import ValidationFailed

MIN_LENGTH = 8
MAX_LENGTH = 128


def validate_new_password(new: str, current: str | None = None) -> None:
    """Application-level minimum on top of the provider policy (SRS section 13)."""
    problems: list[str] = []
    if len(new) < MIN_LENGTH:
        problems.append(f"at least {MIN_LENGTH} characters")
    if len(new) > MAX_LENGTH:
        problems.append(f"at most {MAX_LENGTH} characters")
    if not any(c.isalpha() for c in new) or not any(c.isdigit() for c in new):
        problems.append("a mix of letters and numbers")
    if current is not None and new == current:
        problems.append("a value different from the current password")
    if problems:
        raise ValidationFailed(
            "Password does not meet requirements", {"new_password": "Use " + ", ".join(problems)}
        )
