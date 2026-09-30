"""Creates demo auth users via the Supabase Admin API, then loads db/seed/seed_demo.sql through psql.
Usage (after migrations):  python scripts/seed_demo.py
Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL in backend/.env; psql on PATH.
Demo passwords are read from DEMO_PASSWORD (never hard-coded). Do not run against production."""
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "backend" / ".env")
if os.getenv("ENVIRONMENT") == "production":
    sys.exit("Refusing to seed demo data in production")
pw = os.environ["DEMO_PASSWORD"]
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def make(email: str) -> str:
    return sb.auth.admin.create_user({"email": email, "password": pw, "email_confirm": True}).user.id


student_id, lecturer_id = make("student@demo.test"), make("lecturer@demo.test")
subprocess.run(
    ["psql", os.environ["DATABASE_URL"], "-v", f"student_id={student_id}", "-v", f"lecturer_id={lecturer_id}",
     "-f", str(ROOT / "db" / "seed" / "seed_demo.sql")],
    check=True,
)
print("Demo data loaded: student@demo.test / lecturer@demo.test")
