# Smart Lecture Portal

Academic management and learning-support platform for **students** and **lecturers** (SRS v1.0, no admin role).
React + Vite · FastAPI · Supabase (PostgreSQL, Auth, Storage) · Docker · GitHub Actions.

**Status:** the backend (SRS phases 0-10) is complete, tested and deployable. The browser pages are built in the
front-end phase against the finished API contract (`docs/API.md`).

## What it does
| For students | For lecturers |
|---|---|
| Dashboard, courses, timetable | Dashboard, assigned courses, class lists |
| Download course materials | Upload and publish materials |
| Submit assignments, see released grades | Create assignments, grade, release marks |
| See published marks and weighted totals | Record assessment marks (CAT, exam, ...) |
| See own attendance percentage | Take attendance, with audited corrections |
| Read announcements, notifications | Publish announcements; attendance, submission and performance reports |

Task-by-task detail: `docs/USER_GUIDE.md`.

## Architecture
```
React (Vercel) --HTTPS--> FastAPI (Render, Docker) --service key--> Supabase (Postgres, Auth, Storage)
routes -> services -> repositories -> Supabase        errors {code,message,details}; pages {items,page,page_size,total}
```
Authorization is enforced on the server (role + course assignment/enrolment), backed by database constraints,
triggers, row-level security and least-privilege roles.

## Documentation index
| Document | Purpose |
|---|---|
| `docs/SRS.md` -> `.docx` | Authoritative requirements |
| `docs/ERD.md` | Data model, integrity rules, flagged decisions |
| `docs/API.md` | REST contract and authorization rules |
| `docs/FRONTEND.md` | Planned routes, pages and workflows |
| `docs/USER_GUIDE.md` | What each role can do, and the rules |
| `docs/DEPLOYMENT.md` | Production deployment, step by step |
| `docs/OPERATIONS.md` | Backups, restore, key rotation, retention, troubleshooting |
| `docs/ACCEPTANCE.md` | AT-01..AT-20 traceability and the live checklist |
| `docs/DEMO_SCRIPT.md` | Final demonstration walkthrough |
| `docs/PHASE1_BACKEND.md` ... `docs/PHASE10_BACKEND.md` | What each phase added, its setup steps and live checks |
| `CHANGELOG.md`, `SECURITY.md` | Release notes, security policy |
| `db/migrations`, `db/ops`, `db/seed` | Versioned schema, operations SQL, demo data |

## Repository layout
```
backend/   FastAPI app (api, core, db, models, schemas, services, repositories, utils), tests, Dockerfile
frontend/  React app, vercel.json (router rewrite + headers), public/_redirects
db/        migrations (apply in order), ops (status, schedules), seed (demo data)
docs/      all documentation above
scripts/   operations and quality scripts (table below)
.github/   CI, CodeQL, security audit, release build, Dependabot, templates
render.yaml  API hosting blueprint
```

## Quick start for development (Windows PowerShell; macOS/Linux equivalents work)
1. Create a Supabase **development** project. In the SQL Editor run every file of `db/migrations` in order
   (`0001` ... `0011`), then `db/ops/schema_status.sql` (all rows `applied = true`).
2. Backend:
   ```powershell
   cd backend
   python -m venv venv
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned   # once
   venv\Scripts\activate
   pip install -r requirements-dev.txt
   copy .env.example .env      # fill in values
   uvicorn app.main:app --reload   # http://localhost:8000/docs
   ```
3. Frontend:
   ```powershell
   cd frontend
   copy .env.example .env      # fill in values (anon key only)
   npm install
   npm run dev                  # http://localhost:5173
   ```
4. Demo data (development only): set `DEMO_PASSWORD` and `DATABASE_URL`, then `python scripts/seed_demo.py`
   (`docs/DEMO_SCRIPT.md`).

## Environment variables
All are listed, with defaults, in `backend/.env.example` (a test fails if one is missing). In production set at
least these six on the host (`render.yaml` asks for them; **never commit values**):

| Variable | Production value |
|---|---|
| `ENVIRONMENT` | `production` |
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service key: backend only, never the front end |
| `CORS_ORIGINS` | exact front-end origin(s), https |
| `PASSWORD_RESET_REDIRECT_URL` | `https://<front end>/reset-password` |

Front end (`frontend/.env.example`): `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Scripts
| Script | Purpose | Guide |
|---|---|---|
| `scripts/check_structure.py`, `check_sql.py` | Repository structure and SQL syntax (run by CI) | below |
| `scripts/verify_database.py` | Applies all migrations to a throw-away PostgreSQL and checks the rules (`pip install pgserver`) | `docs/PHASE5_BACKEND.md` |
| `scripts/create_user.py` | Create a student or lecturer account | `docs/PHASE1_BACKEND.md` |
| `scripts/manage_academic.py` | Courses, lecturers, enrolments | `docs/PHASE2_BACKEND.md` |
| `scripts/seed_demo.py` | Demo data (never production) | `docs/DEMO_SCRIPT.md` |
| `scripts/purge_deleted_materials.py` | Remove leftover files of deleted materials | `docs/PHASE3_BACKEND.md` |
| `scripts/purge_old_notifications.py` | Manual notification retention | `docs/PHASE9_BACKEND.md` |
| `scripts/check_production_env.py` | Pre-flight of production settings | `docs/DEPLOYMENT.md` |
| `scripts/smoke_test.py` | Post-deploy live check | `docs/DEPLOYMENT.md` |
| `scripts/backup_data.py` | Export all tables to JSON Lines | `docs/OPERATIONS.md` |

## Quality gates (same commands CI runs)
```
python scripts/check_structure.py && python scripts/check_sql.py
python scripts/verify_database.py
cd backend  && ruff check . && ruff format --check . && pytest --cov=app
cd frontend && npm run lint && npm test && npm run build
docker build -t slp-api backend
```
Backend tests need `ENVIRONMENT=test SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=ci-placeholder`
only when your own `.env` points elsewhere; CI sets them.

## CI/CD
`ci.yml` (push and pull request): structure + SQL syntax, real-PostgreSQL migration checks, backend lint/format/
tests, **container image build and start-up check**, front-end lint/tests/build, secret scan, then the single
required gate **CI passed**. `codeql.yml` and `security-audit.yml` run weekly. `deploy.yml` is a manual release
build that re-runs every test first. Dependabot keeps pip, npm, GitHub Actions and Docker current.

Deployment (`docs/DEPLOYMENT.md`): the API deploys on Render only after the GitHub checks pass
(`autoDeployTrigger: checksPass`); the front end on Vercel. Database changes are applied by hand after a backup.

## Git workflow
- Branches: `main` (protected, deployable), `develop` (integration), `feat/<phase>-<topic>`.
- Commit style: `feat:`, `fix:`, `test:`, `refactor:`, `docs:`.
- Pull request into `develop`; require the status check **CI passed** and a pull request before merging.
- Schema change = new numbered migration + updates to `docs/ERD.md` and `docs/API.md` in the same pull request.

## Security
Role- and course-scoped authorization on every endpoint, validated and signed file handling, rate limits,
security headers, redacted logs, production fail-fast configuration, least-privilege database roles and an
append-only audit trail. Policy and known limitations: `SECURITY.md`. Never commit `.env` files or keys.

## Phases (SRS section 20)
| Phase | Delivered | Guide |
|---|---|---|
| 0 | Scaffold, error model, CI, schema | - |
| 1 | Authentication and profiles | `docs/PHASE1_BACKEND.md` |
| 2 | Courses and enrolment | `docs/PHASE2_BACKEND.md` |
| 3 | Materials and storage | `docs/PHASE3_BACKEND.md` |
| 4 | Assignments and submissions | `docs/PHASE4_BACKEND.md` |
| 5 | Grading and marks | `docs/PHASE5_BACKEND.md` |
| 6 | Attendance | `docs/PHASE6_BACKEND.md` |
| 7 | Announcements and notifications | `docs/PHASE7_BACKEND.md` |
| 8 | Dashboards, timetable, reports | `docs/PHASE8_BACKEND.md` |
| 9 | Hardening | `docs/PHASE9_BACKEND.md` |
| 10 | Deployment and documentation | `docs/PHASE10_BACKEND.md` |
