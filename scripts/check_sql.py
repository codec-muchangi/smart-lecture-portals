"""Parses every migration with the real PostgreSQL grammar (pglast) to catch syntax errors in CI."""
import sys
from pathlib import Path

import pglast

bad = 0
ROOT = Path(__file__).resolve().parent.parent
for f in sorted([*ROOT.glob("db/migrations/*.sql"), *ROOT.glob("db/ops/*.sql")]):
    try:
        stmts = pglast.parse_sql(f.read_text(encoding="utf-8"))
        print(f"{f.parent.name}/{f.name}: OK ({len(stmts)} statements)")
    except pglast.parser.ParseError as e:
        print(f"{f.parent.name}/{f.name}: {e}")
        bad = 1
sys.exit(bad)
