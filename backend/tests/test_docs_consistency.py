"""Phase 10: documentation stays complete and in step with the code (SRS 21 definition of done)."""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
README = (ROOT / "README.md").read_text(encoding="utf-8")
DOCS = sorted((ROOT / "docs").glob("*.md"))
ALL_DOC_TEXT = "\n".join([README, *(p.read_text(encoding="utf-8") for p in DOCS)])


def test_every_migration_is_described_in_the_erd():
    erd = (ROOT / "docs/ERD.md").read_text(encoding="utf-8")
    for path in sorted((ROOT / "db/migrations").glob("*.sql")):
        number = path.name[:4]
        assert re.search(rf"\b{number}\b", erd), f"docs/ERD.md does not mention migration {number}"


@pytest.mark.parametrize("path", sorted((ROOT / "scripts").glob("*.py")), ids=lambda p: p.name)
def test_every_script_is_documented(path):
    assert path.name in ALL_DOC_TEXT, f"{path.name} is not mentioned in the README or docs"


@pytest.mark.parametrize("path", sorted((ROOT / "db/ops").glob("*.sql")), ids=lambda p: p.name)
def test_every_ops_sql_file_is_documented(path):
    assert path.name in ALL_DOC_TEXT


@pytest.mark.parametrize("path", DOCS, ids=lambda p: p.name)
def test_every_doc_is_linked_from_the_readme(path):
    if re.fullmatch(r"PHASE\d+_BACKEND\.md", path.name):
        assert path.name in README
    else:
        assert f"docs/{path.name}" in README or path.name in README


def test_acceptance_matrix_covers_all_twenty_tests_and_real_files():
    text = (ROOT / "docs/ACCEPTANCE.md").read_text(encoding="utf-8")
    for n in range(1, 21):
        assert re.search(rf"^\| AT-{n:02d} \|", text, flags=re.M), f"AT-{n:02d} missing"
    for name in set(re.findall(r"`(test_\w+\.py)`", text)):
        assert (ROOT / "backend/tests" / name).is_file(), f"{name} does not exist"


def test_acceptance_matrix_matches_the_acceptance_tags_in_the_tests():
    """A test file that says it proves AT-nn must be listed on that row."""
    text = (ROOT / "docs/ACCEPTANCE.md").read_text(encoding="utf-8")
    rows = {m.group(1): m.group(0) for m in re.finditer(r"^\| (AT-\d\d) \|.*$", text, flags=re.M)}
    for test_file in sorted((ROOT / "backend/tests").glob("test_*.py")):
        if test_file.name in {"test_ops_scripts.py", "test_docs_consistency.py"}:
            continue
        head = test_file.read_text(encoding="utf-8").split('"""')[1] if '"""' in test_file.read_text() else ""
        for at in set(re.findall(r"\bAT-\d\d", head)):
            assert test_file.name in rows[at], f"{test_file.name} proves {at} but ACCEPTANCE.md omits it"


def test_demo_script_uses_the_seeded_demo_data():
    demo = (ROOT / "docs/DEMO_SCRIPT.md").read_text(encoding="utf-8")
    seed = (ROOT / "db/seed/seed_demo.sql").read_text(encoding="utf-8")
    for item in ("CIT 3253", "CIT 3254", "STU001", "LEC001", "Assignment 1 - Introduction", "CAT 1"):
        assert item in seed and item in demo, item


def test_deployment_guide_lists_every_migration_in_order():
    guide = (ROOT / "docs/DEPLOYMENT.md").read_text(encoding="utf-8")
    names = [p.name for p in sorted((ROOT / "db/migrations").glob("*.sql"))]
    positions = [guide.find(name) for name in names]
    assert all(pos >= 0 for pos in positions), "DEPLOYMENT.md must name every migration file"
    assert positions == sorted(positions)


def test_schema_status_query_covers_every_migration():
    sql = (ROOT / "db/ops/schema_status.sql").read_text(encoding="utf-8")
    for path in sorted((ROOT / "db/migrations").glob("*.sql")):
        assert f"'{path.stem}'" in sql, path.stem


def test_documented_production_variables_exist_in_env_example():
    example = (ROOT / "backend/.env.example").read_text(encoding="utf-8")
    for name in (
        "ENVIRONMENT",
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "CORS_ORIGINS",
    ):
        assert re.search(rf"^{name}=", example, flags=re.M)
        assert name in README and name in (ROOT / "docs/DEPLOYMENT.md").read_text(encoding="utf-8")
    assert "PASSWORD_RESET_REDIRECT_URL" in README
