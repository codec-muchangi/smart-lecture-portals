from collections.abc import Iterator, Sequence
from typing import TypeVar

T = TypeVar("T")


def chunked(items: Sequence[T], size: int = 100) -> Iterator[Sequence[T]]:
    """Split a long id list so each `in.(...)` filter keeps the request URL comfortably short."""
    for start in range(0, len(items), size):
        yield items[start : start + size]
