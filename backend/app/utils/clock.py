from datetime import UTC, datetime


def utcnow() -> datetime:
    """Single source of 'now' for deadline rules. Services call `clock.utcnow()` (module attribute) so tests
    can freeze time by patching this one function."""
    return datetime.now(UTC)


def parse_ts(value: str | datetime) -> datetime:
    """Parse a database timestamp into an aware UTC datetime (naive values are taken to be UTC)."""
    dt = value if isinstance(value, datetime) else datetime.fromisoformat(value)
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
