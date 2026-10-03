# Smart Lecture Portal

Academic management and learning-support platform for **students** and **lecturers** (SRS v1.0, no admin role).
React + Vite · FastAPI · Supabase (PostgreSQL, Auth, Storage).

| Doc | Purpose |
|---|---|
| `docs/SRS.md` → `.docx` | Authoritative requirements |
| `docs/ERD.md` | Data model + integrity rules + flagged decisions |
| `docs/API.md` | REST contract, authorization rules |
| `docs/FRONTEND.md` | Routes, pages, workflows |
| `db/migrations` | Versioned schema (apply in order) |

## Repository layout
```
backend/   FastAPI app (api, core, db, models, schemas, services, repositories, utils) + tests
frontend/  React app (app, components, layouts, pages/{auth,student,lecturer}, features/*, services, hooks, utils, types)
db/        migrations + demo seed
docs/      SRS, ERD, API, frontend spec
scripts/   check_structure.py, check_sql.py, seed_demo.py
.github/   CI, CodeQL, release build, Dependabot, PR/issue templates
```

## First-time setup (Windows PowerShell shown; macOS/Linux equivalents work)
1. Create a Supabase project (separate dev and prod). In the SQL editor (or `psql`), run `db/migrations/0001_init_schema.sql` then `0002_views.sql`.
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
4. Demo data (dev only): set `DEMO_PASSWORD`, `DATABASE_URL` in `backend/.env` and run `python scripts/seed_demo.py`.

## Creating accounts (no self-signup in v1.0)
`cd backend` → activate venv → `python ../scripts/create_user.py --role student --email … --name … --registration-number …` (see `docs/PHASE1_BACKEND.md`).

## Courses and enrollment (no admin UI in v1.0)
`cd backend` → activate venv → `python ../scripts/manage_academic.py --help` (create courses, assign lecturers, enroll/withdraw students, bulk CSV enroll, archive courses). See `docs/PHASE2_BACKEND.md`.

## Materials and file storage
Lecturers upload course files through the API (`docs/API.md`, Phase 3). Files live in the private Supabase `materials` bucket and are served by short-lived signed links. Run `python ../scripts/purge_deleted_materials.py` (from `backend`) now and then to remove any file left behind by a failed delete. See `docs/PHASE3_BACKEND.md`.

## Quality gates (same commands CI runs)
```
python scripts/check_structure.py && python scripts/check_sql.py
cd backend  && ruff check . && ruff format --check . && pytest
cd frontend && npm run lint && npm test && npm run build
```

## Git workflow
- Branches: `main` (protected, deployable), `develop` (integration), `feat/<phase>-<topic>`.
- Commit style: `feat:`, `fix:`, `test:`, `refactor:`, `docs:`.
- PR into `develop`; required status check on `main`/`develop`: **CI passed** (Settings → Branches → require status checks). Also enable "Require PR before merging".
- Schema changes = new numbered migration + updates to `docs/ERD.md` and `docs/API.md` in the same PR.

## CI/CD
`.github/workflows/ci.yml` (push/PR): structure + SQL syntax, backend lint/format/tests, frontend lint/tests/build, secret scan → aggregate **CI passed** gate.
`codeql.yml`: weekly + PR security analysis. `deploy.yml`: manual release build that re-runs all tests first; add your host's publish step. Dependabot keeps pip/npm/actions current.
Repo settings to add: Secrets none needed for CI; for release, Environment `production` with vars `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Phases (SRS §20)
Phase 0 (this scaffold: auth guard, `/me`, `/courses`, error model, CI) is complete. Continue with Phase 1 → 10 in order; each phase must pass its acceptance tests (AT-xx) before the next starts.
