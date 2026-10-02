"""Create a student or lecturer account (Version 1.0 has no admin UI / self-registration).

Run from the backend folder with the venv active, so the app package and .env are found:
  python ../scripts/create_user.py --role student  --email s@uni.ac.ke --name "Jane Doe" --registration-number STU002 --program "BSc CS" --year 3
  python ../scripts/create_user.py --role lecturer --email l@uni.ac.ke --name "Dr. Doe" --staff-number LEC002 --department "Computer Science" --title "Dr."
The password is prompted for (never passed on the command line, so it stays out of shell history).
"""
import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))

from app.core.errors import AppError  # noqa: E402
from app.services.provisioning_service import provision_user  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--role", required=True, choices=["student", "lecturer"])
ap.add_argument("--email", required=True)
ap.add_argument("--name", required=True)
ap.add_argument("--phone")
ap.add_argument("--registration-number")
ap.add_argument("--program")
ap.add_argument("--year", type=int)
ap.add_argument("--staff-number")
ap.add_argument("--department")
ap.add_argument("--title")
a = ap.parse_args()

password = getpass.getpass("Password for the new account: ")
if password != getpass.getpass("Repeat password: "):
    sys.exit("Passwords do not match")

fields = (
    {"registration_number": a.registration_number, "program": a.program, "year_of_study": a.year}
    if a.role == "student"
    else {"staff_number": a.staff_number, "department": a.department, "title": a.title}
)
fields = {k: v for k, v in fields.items() if v is not None}
try:
    uid = provision_user(a.role, a.email, password, a.name, a.phone, **fields)
except AppError as e:
    sys.exit(f"Failed: {e.message} {e.details or ''}")
print(f"Created {a.role} {a.email} (id {uid})")
