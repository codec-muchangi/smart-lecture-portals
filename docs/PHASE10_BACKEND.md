# Phase 10 — Deployment and documentation (backend)

Scope: backend and operations only; no pages built or changed. Requirements: SRS phase 10 ("production
deployment, README, API docs, user guide, final demonstration"), section 18 (deployment), 19 (deployment
rules: separate environments, versioned migrations, no deployment when critical tests fail, documented steps),
21 (definition of done) and the risk table (backups).

## What was added
| Area | Files | Purpose |
|---|---|---|
| Container | `backend/Dockerfile`, `backend/.dockerignore` | Production image: pinned Python 3.12, non-root user, health check, one worker, no secrets or `.env` inside |
| API hosting | `render.yaml` | Render blueprint; secrets are `sync: false` (typed in the dashboard); `autoDeployTrigger: checksPass` = never deploy while CI fails (SRS 19) |
| Front-end hosting | `frontend/vercel.json`, `frontend/public/_redirects` | Router rewrite so deep links work, plus browser security headers |
| Pre-flight | `scripts/check_production_env.py` | Checks the six production settings, key types and HTTPS rules before deploying; never prints a secret |
| Smoke test | `scripts/smoke_test.py` | After deploying: health, headers, HSTS, hidden docs, CORS, refused anonymous access, optional login journeys (AT-01/02/03) |
| Backup | `scripts/backup_data.py` | Exports all 17 tables to JSON Lines with a manifest; never truncates at 1000 rows |
| Database ops | `db/ops/schema_status.sql`, `db/ops/schedule_notification_purge.sql` | "Which migrations are applied?" and the weekly `pg_cron` retention job |
| CI | `ci.yml` job **Backend container image**, in the **CI passed** gate; `deploy.yml` builds the image; Dependabot watches Docker | The image is built, started and probed on every push |
| Tests | `test_ops_scripts.py`, `test_deployment_files.py`, `test_docs_consistency.py`; extra real-database checks | 87 new tests and 18 new real-PostgreSQL checks |
| Documentation | `README.md` (rewritten), `docs/DEPLOYMENT.md`, `OPERATIONS.md`, `USER_GUIDE.md`, `DEMO_SCRIPT.md`, `ACCEPTANCE.md`, `CHANGELOG.md`, `SECURITY.md`; `ERD.md` and `API.md` notes | The full SRS-21 documentation set |

No endpoint and no migration changed in this phase.

## Rules enforced by tests (so they cannot silently regress)
| Rule | Where |
|---|---|
| The image runs as non-root, has a health check, a pinned base, and no secret names or `.env` copies | `test_deployment_files.py`, CI image job |
| The Render blueprint holds no secret values and deploys only after checks pass | `test_deployment_files.py` |
| Production fails fast on unsafe settings, in the app, the preflight and the built image | `test_hardening_config.py`, `test_ops_scripts.py`, CI image job |
| The backup lists exactly the tables the migrations create | `test_ops_scripts.py` |
| A backup can be restored: the recipe round-trips every table on a real PostgreSQL | `scripts/verify_database.py` |
| All 11 migrations are detected by `schema_status.sql` | `scripts/verify_database.py`, `test_docs_consistency.py` |
| Every script, doc and migration is documented; AT-01..AT-20 are mapped to real test files | `test_docs_consistency.py` |

## Setup steps (apply Phase 10 to your project)
Work in your project folder (the one that contains `backend`, `db`, `docs`). Extract `phase10-backend.zip` to a
temporary folder first, call that folder `$src`, then copy over.

1. **Create a branch**: `git checkout -b feat/phase-10-deployment`.
2. **Copy the files** (PowerShell, from the project root; adjust `$src`):
   ```powershell
   $src = "C:\path\to\phase10-backend"
   robocopy "$src\.github" ".github" /E
   robocopy "$src\backend" "backend" /E
   robocopy "$src\db" "db" /E
   robocopy "$src\docs" "docs" /E
   robocopy "$src\scripts" "scripts" /E
   robocopy "$src\frontend" "frontend" /E
   Copy-Item "$src\render.yaml","$src\README.md","$src\CHANGELOG.md","$src\SECURITY.md","$src\.gitignore" . -Force
   ```
   (`robocopy` prints exit codes 0-7 for success; only 8 and above are errors.)
3. **Check nothing secret is staged**: `git status`. No `.env` file or `backups` folder may appear.
4. **Run the quality gates locally**:
   ```powershell
   python scripts/check_structure.py
   python scripts/check_sql.py
   cd backend
   venv\Scripts\activate
   ruff check .
   ruff format --check .
   pytest --cov=app -q
   cd ..
   ```
   Expect: `Structure OK (94 required paths present)`, all SQL files OK, ruff clean and **1086 passed**.
   (`scripts/verify_database.py` needs Linux/macOS; GitHub CI runs it for you.)
5. **Try the new tools on your development project** (from `backend`, venv active):
   ```powershell
   python ../scripts/backup_data.py        # creates ..\backups\<time>\ with 17 .jsonl files + manifest.json
   python ../scripts/check_production_env.py   # reports NOT READY in development: that is correct
   ```
   In the Supabase **development** SQL Editor run `db/ops/schema_status.sql`: 11 rows, all `applied = true`.
6. **Push and watch CI**: `git add -A`, `git commit -m "feat: phase 10 deployment and documentation"`,
   `git push -u origin feat/phase-10-deployment`, open a pull request into `develop`. All jobs must be green,
   including the new **Backend container image** job and **CI passed**.
7. **Deploy when you are ready to go live**: follow `docs/DEPLOYMENT.md` from step 1 (new production Supabase
   project, migrations, accounts, preflight, Render, Vercel, connect, smoke test, protections).
8. **Rehearse the demo** on a development or demo environment with `docs/DEMO_SCRIPT.md`.

## Manual live checklist
- [ ] CI on the pull request is fully green (image job included).
- [ ] `schema_status.sql` shows 11/11 on the target database.
- [ ] Preflight says **READY** for the production values.
- [ ] After deploying: `smoke_test.py ... --expect-production` says **SMOKE TEST PASSED**.
- [ ] `/docs` returns 404 on production; `/health/ready` returns 200.
- [ ] First backup taken; `pg_cron` job scheduled; branch protection requires **CI passed**.
- [ ] Demo script rehearsed once end to end.

## Decisions to confirm
1. **Hosts**: Render (API) and Vercel (front end) are the documented default; SRS section 18 allows others.
   Tell me if you want a different host and I will adapt the config.
2. **Free plan sleeps**: a free Render service sleeps when idle (slow first request). Use a paid instance for
   real teaching use.
3. **One API instance**: rate limits are kept in memory per process. Several instances would need a shared store.
4. **`FORWARDED_ALLOW_IPS=*`**: the container trusts the platform proxy's client-address header, as it is only
   reachable through it. Narrow it on any host where the container is directly exposed.
5. **Notification clean-up** uses Supabase `pg_cron` (enable the extension), so no service key is stored in
   GitHub. The manual script remains as a fallback.
6. **Backup export** is a portable JSON Lines copy for any plan. It excludes Supabase Storage files and Auth
   users; use Supabase's own backups or `pg_dump` for a full restore.
7. **User guide** is task-based with the matching API operation, because the browser pages are not built yet.
8. **Not done, by design**: malware scanning of uploads (SRS future item), accessibility (front end), the
   front-end `react-router` advisories (upgrade with the pages), a licence file (your choice), the final
   domain names (yours to pick).
