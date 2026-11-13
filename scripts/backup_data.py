"""Portable export of every table to JSON Lines files: a safety copy you control (SRS 23: backups against
lost work). Works on any Supabase plan, including ones without automatic backups.

Run from the backend folder with the venv active and the SERVICE ROLE key in backend/.env:
  cd backend
  python ../scripts/backup_data.py                 # writes ../backups/<UTC date-time>/
  python ../scripts/backup_data.py --out D:\\slp-backups

Each table becomes <table>.jsonl (one row per line) and manifest.json lists the row counts. The files hold
PERSONAL DATA (names, emails, marks): keep them private, never commit them (backups/ is in .gitignore).
Files stored in Supabase Storage are NOT included: see docs/OPERATIONS.md for those and for restoring.
"""

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))

# Every table of the schema. A test fails if this list and the migrations ever differ.
TABLES = [
    "profiles", "students", "lecturers", "courses", "course_lecturers", "course_enrollments", "materials",
    "assignments", "submissions", "attendance_sessions", "attendance_records", "assessments",
    "assessment_marks", "announcements", "notifications", "timetable_entries", "audit_logs",
]  # fmt: skip


def export_all(sb, out_dir: Path, now: datetime | None = None) -> dict:
    """Writes every table into `out_dir/<timestamp>/` and returns the manifest."""
    from app.utils.paging import fetch_all  # imported here so the module loads without a configured env

    stamp = (now or datetime.now(UTC)).strftime("%Y%m%dT%H%M%SZ")
    target = out_dir / stamp
    target.mkdir(parents=True, exist_ok=False)
    counts: dict[str, int] = {}
    for table in TABLES:
        rows = fetch_all(lambda table=table: sb.table(table).select("*").order("id"))
        path = target / f"{table}.jsonl"
        with path.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True, default=str) + "\n")
        try:
            os.chmod(path, 0o600)  # owner only (ignored where POSIX permissions do not exist)
        except OSError:
            pass
        counts[table] = len(rows)
    manifest = {
        "created_at_utc": stamp,
        "format": "jsonl, one row per line",
        "rows": counts,
        "total_rows": sum(counts.values()),
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return {**manifest, "path": str(target)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Export every table to JSON Lines files.")
    default_out = Path(__file__).resolve().parent.parent / "backups"
    ap.add_argument("--out", default=str(default_out), help=f"folder to write into (default {default_out})")
    args = ap.parse_args(argv)

    from app.db.client import get_supabase

    result = export_all(get_supabase(), Path(args.out))
    print(f"Backup written to {result['path']}")
    for table, n in result["rows"].items():
        print(f"  {table:<22}{n:>8}")
    print(f"  {'TOTAL':<22}{result['total_rows']:>8}")
    print("Keep this folder private: it contains personal data. Files in Storage are not included.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
