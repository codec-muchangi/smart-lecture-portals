"""Fails if any file/dir required by SRS section 8 (plus project additions) is missing."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEATURES = ["courses", "materials", "assignments", "attendance", "marks", "announcements", "notifications", "timetable"]
REQUIRED = [
    "README.md", ".gitignore", "docker-compose.yml",
    "docs/SRS.md", "docs/API.md", "docs/ERD.md", "docs/FRONTEND.md", "docs/PHASE4_BACKEND.md", "docs/PHASE5_BACKEND.md",
    "db/migrations/0001_init_schema.sql", "db/migrations/0002_views.sql", "db/migrations/0003_auth_integrity.sql", "db/migrations/0004_courses_enrollment.sql", "db/migrations/0005_materials.sql", "db/migrations/0006_assignments_submissions.sql", "db/migrations/0007_grading_marks.sql",
    "scripts/verify_database.py",
    "scripts/purge_deleted_materials.py",
    "scripts/create_user.py", "scripts/manage_academic.py", "db/seed/seed_demo.sql",
    ".github/workflows/ci.yml", ".github/workflows/codeql.yml", ".github/workflows/deploy.yml",
    ".github/dependabot.yml", ".github/pull_request_template.md",
    "backend/requirements.txt", "backend/requirements-dev.txt", "backend/.env.example", "backend/pyproject.toml",
    "backend/app/main.py", "backend/tests",
    "frontend/package.json", "frontend/package-lock.json", "frontend/.env.example", "frontend/index.html",
    "frontend/src/main.jsx", "frontend/public", "frontend/tests",
]
REQUIRED += [f"backend/app/{d}" for d in ["api", "core", "db", "models", "schemas", "services", "repositories", "utils"]]
REQUIRED += [f"frontend/src/{d}" for d in ["app", "components", "layouts", "pages/auth", "pages/student", "pages/lecturer",
                                            "features", "services", "hooks", "utils", "types"]]
REQUIRED += [f"frontend/src/features/{f}" for f in FEATURES]

missing = [p for p in REQUIRED if not (ROOT / p).exists()]
if missing:
    print("Missing:\n  " + "\n  ".join(missing))
    sys.exit(1)
print(f"Structure OK ({len(REQUIRED)} required paths present)")
