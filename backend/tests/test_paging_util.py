"""fetch_all reads past Supabase's 1000-rows-per-request cap."""

from app.utils.paging import fetch_all
from tests.fakes import FakeSupabase


def test_fetch_all_returns_every_row_past_the_cap():
    fake = FakeSupabase()
    fake.tables["t"] = [{"id": f"{i:05d}"} for i in range(2350)]
    rows = fetch_all(lambda: fake.table("t").select("id").order("id"))
    assert len(rows) == 2350 and rows[0]["id"] == "00000" and rows[-1]["id"] == "02349"


def test_fetch_all_handles_empty_and_exact_multiples():
    fake = FakeSupabase()
    fake.tables["t"] = []
    assert fetch_all(lambda: fake.table("t").select("id").order("id")) == []
    fake.tables["t"] = [{"id": f"{i:03d}"} for i in range(1000)]
    assert len(fetch_all(lambda: fake.table("t").select("id").order("id"))) == 1000
