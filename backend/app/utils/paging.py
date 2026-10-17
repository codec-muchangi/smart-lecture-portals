from collections.abc import Callable

PAGE = 1000  # Supabase/PostgREST returns at most 1000 rows per request, however large a limit is asked for


def fetch_all(build: Callable[[], object], page_size: int = PAGE) -> list[dict]:
    """Read EVERY row of a query, page by page.

    `build()` must return a fresh, ordered query (an unstable order could skip or repeat rows between pages).
    A plain `.limit(100000)` would silently stop at 1000 rows, which would make a report's totals disagree
    with the source records (SRS AT-20); this helper never truncates.
    """
    rows: list[dict] = []
    start = 0
    while True:
        page = build().range(start, start + page_size - 1).execute().data
        rows.extend(page)
        if len(page) < page_size:
            return rows
        start += page_size
