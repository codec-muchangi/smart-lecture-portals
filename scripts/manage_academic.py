"""Academic setup for Smart Lecture Portal v1.0 (no admin role: courses, lecturer assignments and
enrollments are managed here, SRS 1.3 and 24).

Run from the backend folder with the venv active:
  cd backend
  python ../scripts/manage_academic.py create-course --code "CIT 3253" --name "Network Administration" --year 2026/2027 --semester "Semester 1" --credits 3
  python ../scripts/manage_academic.py assign-lecturer --course "CIT 3253" --staff-number LEC001
  python ../scripts/manage_academic.py enroll --course "CIT 3253" --reg STU001
  python ../scripts/manage_academic.py enroll-csv --course "CIT 3253" --file students.csv   (one registration number per line)
  python ../scripts/manage_academic.py withdraw --course "CIT 3253" --reg STU001
  python ../scripts/manage_academic.py set-status --course "CIT 3253" --status archived
  python ../scripts/manage_academic.py list
If a course code exists in several periods, add --year and --semester to pick one.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))

from app.core.errors import AppError  # noqa: E402
from app.db.client import get_supabase  # noqa: E402
from app.services import course_setup_service as svc  # noqa: E402


def add_course_selector(p):
    p.add_argument("--course", required=True, help="course code, e.g. 'CIT 3253'")
    p.add_argument("--year")
    p.add_argument("--semester")


ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = ap.add_subparsers(dest="cmd", required=True)

p = sub.add_parser("create-course")
p.add_argument("--code", required=True)
p.add_argument("--name", required=True)
p.add_argument("--year", required=True, help="academic year, e.g. 2026/2027")
p.add_argument("--semester", required=True)
p.add_argument("--credits", type=int)
p.add_argument("--description")

p = sub.add_parser("assign-lecturer")
add_course_selector(p)
p.add_argument("--staff-number", required=True)

p = sub.add_parser("enroll")
add_course_selector(p)
p.add_argument("--reg", required=True, help="student registration number")

p = sub.add_parser("enroll-csv")
add_course_selector(p)
p.add_argument("--file", required=True)

p = sub.add_parser("withdraw")
add_course_selector(p)
p.add_argument("--reg", required=True)

p = sub.add_parser("set-status")
add_course_selector(p)
p.add_argument("--status", required=True, choices=list(svc.COURSE_STATUSES))

sub.add_parser("list")
a = ap.parse_args()

try:
    if a.cmd == "create-course":
        c = svc.create_course(a.code, a.name, a.year, a.semester, a.credits, a.description)
        print(f"Created {c['course_code']} ({c['academic_year']} / {c['semester']}) id={c['id']}")
    elif a.cmd == "list":
        rows = get_supabase().table("courses").select("*").order("course_code").execute().data
        for r in rows:
            print(f"{r['course_code']:<12} {r['academic_year']:<10} {r['semester']:<12} {r['status']:<9} {r['course_name']}")
        print(f"{len(rows)} course(s)")
    else:
        course = svc.find_course(a.course, a.year, a.semester)
        if a.cmd == "assign-lecturer":
            svc.assign_lecturer(course, a.staff_number)
            print(f"Assigned {a.staff_number} to {course['course_code']}")
        elif a.cmd == "enroll":
            _, outcome = svc.enroll_student(course, a.reg)
            print(f"{a.reg}: {outcome} in {course['course_code']}")
        elif a.cmd == "enroll-csv":
            lines = Path(a.file).read_text(encoding="utf-8").splitlines()
            for reg, outcome in svc.bulk_enroll(course, lines):
                print(f"{reg}: {outcome}")
        elif a.cmd == "withdraw":
            svc.withdraw_student(course, a.reg)
            print(f"{a.reg}: withdrawn from {course['course_code']}")
        elif a.cmd == "set-status":
            svc.set_course_status(course, a.status)
            print(f"{course['course_code']} is now {a.status}")
except AppError as e:
    sys.exit(f"Failed: {e.message} {e.details or ''}")
