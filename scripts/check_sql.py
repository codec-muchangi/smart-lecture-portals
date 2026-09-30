"""Parses every migration with the real PostgreSQL grammar (pglast) to catch syntax errors in CI."""
import sys
from pathlib import Path

import pglast

bad = 0
for f in sorted(Path(__file__).resolve().parent.parent.glob("db/migrations/*.sql")):
    try:
        stmts = pglast.parse_sql(f.read_text(encoding="utf-8"))
        print(f"{f.name}: OK ({len(stmts)} statements)")
    except pglast.parser.ParseError as e:
        print(f"{f.name}: {e}")
        bad = 1
sys.exit(bad)
