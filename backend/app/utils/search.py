import re

_DISALLOWED = re.compile(r"[^\w @.\-]", re.UNICODE)


def safe_search(q: str | None, max_len: int = 50) -> str | None:
    """Make user text safe to embed in a PostgREST `or=` filter.

    Commas, parentheses, % and * would let a caller add their own filter clauses or wildcards, so only
    letters, digits, space, @, ., - and _ survive.
    """
    if not q:
        return None
    cleaned = _DISALLOWED.sub("", q).strip()[:max_len]
    return cleaned or None
