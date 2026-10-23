# Phase 9 — Hardening (backend)

Scope: backend only; no pages built or changed. Requirements: SRS section 12 (security), 15 (audit and data integrity), 16 (error handling), NFR-SEC-01…06, NFR-PERF-01/02, NFR-REL-01/02, NFR-MAIN-02/03 and phase 9 of the plan ("security review, tests, validation, performance"). Accessibility (NFR-A11Y-01) is a front-end matter and is listed under "Left for the front end" below.

## What the review found, and what was done
| # | Finding (SRS) | Fix |
|---|---|---|
| 1 | The pinned web framework (Starlette via FastAPI) and `python-multipart` had **known security advisories** (section 12: scan for vulnerabilities) | Upgraded `fastapi 0.159.1`, `starlette 1.9.0`, `python-multipart 0.0.32`, `uvicorn 0.54.0`, `pytest 9.1.1`, `python-dotenv 1.2.4`. `pip-audit` now reports **no known vulnerabilities**. A weekly audit workflow keeps watching |
| 2 | The new FastAPI turns a **missing** boolean form field into `false`, which would have silently made new materials unpublished | The `published` flag of material upload is parsed explicitly (default `true`, strict values, `422` otherwise), so behaviour is the same on every version |
| 3 | No browser-hardening headers (NFR-SEC-05) | Security headers on every response, errors included (list in `docs/API.md`) |
| 4 | `/openapi.json` and `/redoc` stayed public in production | Not served in production |
| 5 | A typo such as `ENVIRONMENT=prod`, or `CORS_ORIGINS=*`, would have run production unsafely | `ENVIRONMENT` must be a known name, and in production the API **refuses to start** with an unsafe configuration (http URLs, localhost, `*`, missing keys) |
| 6 | CORS allowed all headers and methods, with credentials | Exact methods and headers, no credentials (tokens are sent in a header, not cookies) |
| 7 | Rate limits covered only login and password reset | Added: password change, file uploads and reports, **per signed-in session** so a class on one campus address does not lock itself out; the limiter table cannot grow without bound |
| 8 | A huge JSON body could be buffered | Non-file bodies are capped (`MAX_JSON_KB`, 413) |
| 9 | An unexpected error gave no way to trace it, and a 500 skipped the headers and CORS | Every response has `X-Request-ID`; a 500 repeats it in `details.request_id`, is logged with it, and carries the security and CORS headers |
| 10 | Security events were not logged (section 12) and the HTTP client logs database filters (emails, ids) at INFO | Access log, a WARNING per refused request (401/403/429), SLOW warnings above 2 s (NFR-PERF-01), a **redaction filter** for tokens, JWTs and passwords, and the client's URL logging switched off |
| 11 | A hung database call would freeze a request for minutes; a lost database gave a generic 500 | Database and storage **timeouts**, and an unreachable service now answers **503** with `Retry-After` (NFR-REL-02); `GET /health/ready` for the deployment platform |
| 12 | Browser database roles still held table privileges (RLS already blocked them) | Migration 0011 removes them (least privilege, section 12) |
| 13 | `TRUNCATE` skips the "never hard-delete" row triggers (section 15) | Migration 0011 blocks it on the academic tables and the audit log |
| 14 | Phase 7 decision 8: notifications grew forever | `scripts/purge_old_notifications.py` and `purge_read_notifications()` (read only, older than N days, minimum 30, audited) |
| 15 | Rules that only held by convention | Whole-API tests: every endpoint except login, reset and health probes needs a valid token; every list is paginated or explicitly bounded; every route is in `docs/API.md` and nothing in it is a ghost; `.env.example` lists every setting (NFR-MAIN-02) |

Already in place from earlier phases and re-checked: server-side validation, ownership checks (404 for other courses' data), signed short-lived download links, upload type and size checks, append-only audit log, transactional academic writes, no secrets in responses.

## How hardening is enforced
| Rule | Where |
|---|---|
| Security headers, request id, access log, 500 handling | `app/core/middleware.py` |
| Redaction of secrets in logs | `app/core/logging_config.py` |
| Rate limits (login, reset, password change, uploads, reports) | `app/core/rate_limit.py`, `app/core/limits.py` |
| Unsafe production configuration stops start-up | `Settings.problems()` in `app/core/config.py`, checked in `app/main.py` |
| Error shapes (401/403/404/405/413/429/503) | `app/core/errors.py` |
| Database privileges, TRUNCATE guard, retention | `db/migrations/0011_hardening.sql` |
| No regression | `tests/test_hardening_*.py`, `tests/test_notification_retention.py` |

## Settings added (all in `backend/.env.example`)
`MAX_JSON_KB`, `PASSWORD_CHANGE_RATE_LIMIT` / `_WINDOW_SECONDS`, `UPLOAD_RATE_LIMIT` / `_WINDOW_SECONDS`, `REPORT_RATE_LIMIT` / `_WINDOW_SECONDS`, `RESET_RATE_LIMIT` / `_WINDOW_SECONDS` (were missing from the file), `SLOW_REQUEST_SECONDS`, `HSTS_MAX_AGE_SECONDS`, `LOG_LEVEL`, `DATABASE_TIMEOUT_SECONDS`, `STORAGE_TIMEOUT_SECONDS`. Your existing `backend\.env` keeps working unchanged (every new setting has a safe default).

## Set up Phase 9 (step by step)
Run the commands in PowerShell from the project folder (`C:\Users\USER\OneDrive\Desktop\projects\smart-lecture-portal`).

**1. Save your work and start a branch** (do this before copying any file)
```powershell
git status
git checkout main
git pull
git checkout -b feat/phase9-backend
```
`git status` should be clean; if not, commit first (`git add .` then `git commit -m "chore: save work"`). Stop `uvicorn` and `npm run dev` with `Ctrl+C`. (Phase 8 should already be merged; `git pull` brings it in.)

**2. Extract the zip to a temporary folder and copy it in**
```powershell
$zip = "C:\Users\USER\Downloads\phase9-backend.zip"
$tmp = "$env:TEMP\phase9"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Expand-Archive -Path $zip -DestinationPath $tmp
$src = $tmp
if (-not (Test-Path "$src\backend")) { $src = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName }
dir $src
```
`dir $src` must list `.github`, `backend`, `db`, `docs`, `scripts` and `README.md`. Then copy:
```powershell
robocopy "$src\backend" "backend" /E
robocopy "$src\db" "db" /E
robocopy "$src\docs" "docs" /E
robocopy "$src\scripts" "scripts" /E
robocopy "$src\.github" ".github" /E
Copy-Item -Force "$src\README.md" "README.md"
Remove-Item -Recurse -Force $tmp
```
`robocopy` prints summary tables; exit codes 0 to 7 mean success. Your `backend\.env` and `venv` are not in the zip, so they are untouched. This phase adds one workflow file, `.github\workflows\security-audit.yml`, so it is copied too (the other workflow files are not in the zip, so they are untouched).

**3. Check the files are in place** (all lines must print `True`)
```powershell
Test-Path db\migrations\0011_hardening.sql
Test-Path backend\app\core\middleware.py
Test-Path backend\app\core\logging_config.py
Test-Path backend\app\core\limits.py
Test-Path backend\app\core\rate_limit.py
Test-Path backend\app\core\config.py
Test-Path backend\app\main.py
Test-Path backend\app\api\v1\routes\health.py
Test-Path backend\tests\test_hardening_http.py
Test-Path backend\tests\test_hardening_config.py
Test-Path backend\tests\test_hardening_logging.py
Test-Path backend\tests\test_hardening_ratelimit.py
Test-Path backend\tests\test_hardening_inventory.py
Test-Path backend\tests\test_hardening_health.py
Test-Path backend\tests\test_hardening_audit.py
Test-Path backend\tests\test_hardening_auth.py
Test-Path backend\tests\test_notification_retention.py
Test-Path scripts\purge_old_notifications.py
Test-Path .github\workflows\security-audit.yml
Test-Path docs\PHASE9_BACKEND.md
git status
```
`git status` must not list a `.env` file or a stray `app`/`tests` folder at the project root.

**4. Install and run the tests**
```powershell
cd backend
venv\Scripts\activate
pip install -r requirements.txt
pytest -q
```
Expect **999 passed**. This phase upgrades packages, so `pip install -r requirements.txt` (run just before) downloads new versions: let it finish. If `pytest` complains about a missing module, you are not inside the activated `venv`.

**5. Run the new migration in Supabase**
```powershell
cd ..
Get-Content db\migrations\0011_hardening.sql -Raw | Set-Clipboard
```
In Supabase: **SQL Editor → New query**, paste (`Ctrl+V`), **Run** (choose **Run and enable RLS** if prompted). It must say **Success**. Run it only once.
It does three things: removes the browser roles' (`anon`, `authenticated`) access to your tables, blocks `TRUNCATE` on the academic tables and the audit log, and adds the notification-retention function. It changes no rows. The backend is not affected because it uses the service role. If it fails, send me the exact message and do not run it again.

**6. (Optional, Linux/macOS or CI) prove the SQL on a real database**
`python scripts/verify_database.py` (after `pip install pgserver`) applies all eleven migrations to a throw-away PostgreSQL 16, loads the demo seed and runs 209 checks. It is part of CI (job "Database migrations"); it does not run on Windows, so skip it locally.

**7. Start the backend and do the live checks**
```powershell
cd backend
uvicorn app.main:app --reload
```
Open http://127.0.0.1:8000/docs and follow the checklist below. Stop the server with `Ctrl+C` when done.

**8. Commit, push, merge**
```powershell
cd ..
git add .
git commit -m "feat: phase 9 hardening backend"
git push -u origin feat/phase9-backend
```
On GitHub open the pull request into `main`, wait for **CI passed**, merge, then `git checkout main` and `git pull`.

## Manual checklist (live Supabase)
Use a lecturer token and a student token as in earlier phases.

**Database**
- [ ] Migration 0011 runs without error and says **Success**.
- [ ] `select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema='public';` returns **0**.
- [ ] `truncate audit_logs;` fails with "TRUNCATE is not allowed" (it deletes nothing).
- [ ] `select has_function_privilege('anon','purge_read_notifications(integer)','execute');` returns `false`.

**Backend behaviour**
- [ ] `GET /health` and `GET /health/ready` both return 200 (open http://127.0.0.1:8000/health/ready).
- [ ] In the browser developer tools (Network tab) any API response shows `x-request-id`, `x-content-type-options: nosniff`, `x-frame-options: DENY` and `cache-control: no-store`.
- [ ] The front end still logs in and loads the dashboard (CORS still works). If the browser reports a CORS error, send me the message.
- [ ] `POST /auth/login` with a wrong password 11 times in a minute: the 11th is **429** with a `Retry-After` header.
- [ ] Upload 31 small files within a minute as a lecturer: the 31st is **429** (wait a minute, it works again).
- [ ] `POST /auth/password/change` with a wrong current password 6 times: the 6th is **429**.
- [ ] Look at the terminal running `uvicorn`: each request prints one line `GET /api/v1/... -> 200 in 12 ms [request_id=...]`, and refused requests print `refused ... -> 401 ...`. No tokens, passwords or query strings appear.
- [ ] Production start-up check (optional): in a throw-away terminal run `$env:ENVIRONMENT="production"; uvicorn app.main:app` with your normal `.env`. It must **refuse to start** and name what is unsafe (localhost addresses). Close that terminal afterwards so the setting does not stay.

**Retention**
- [ ] `cd backend` then `python ..\scripts\purge_old_notifications.py --days 7` prints "Keep notifications for at least 30 days" and exits (a safety minimum).
- [ ] `python ..\scripts\purge_old_notifications.py` prints how many notifications were deleted (0 on a new project). Run it weekly if you like.

**Dependencies**
- [ ] `pip install pip-audit` then `pip-audit` (inside `backend` with the venv active) prints "No known vulnerabilities found".

## Left for the front end (not part of this backend-only phase)
- **Accessibility (NFR-A11Y-01):** labels, focus states, keyboard use and semantic structure of the pages are checked when the pages are built (Phase 9 of the front end: run an automated check such as axe or Lighthouse and fix what it reports).
- **`npm audit`** reports two *moderate* advisories in `react-router` (fixed in `react-router-dom` 7.18.x, a major upgrade). They do not fail the weekly audit (threshold: high) but should be upgraded when the front end is next touched.
- Add `X-Request-ID` to the error screen so a user can quote it when something goes wrong.

## Decisions to confirm (SRS §22: flag, don't invent)
1. **Rate limits are per API process** (in memory). Fine for one server; if you run several instances later, move them to a shared store or the platform's edge rules. Behind a proxy start `uvicorn` with `--proxy-headers` so addresses are real (Phase 10).
2. **`CORS` credentials are off.** The front end sends the token in an `Authorization` header and never uses cookies. Say if you plan cookie sessions: CSRF protection would then be required (SRS 12).
3. **Production refuses to start with an unsafe configuration.** Staging may run with warnings only.
4. **Notification retention is manual** (a script you run, default 90 days, minimum 30). A scheduled job belongs in Phase 10 (deployment).
5. **Reports and the dashboard are not paginated** on purpose (bounded, listed in the inventory test); every other list is paginated with a ceiling of 100 or 200.
6. **Dependency audit is a separate weekly workflow**, not part of "CI passed", so a newly published advisory cannot block an unrelated pull request.
7. **No malware scanning of uploads yet** (SRS 14 says to consider it before going live): add a scanner such as ClamAV in Phase 10.
8. **Next:** Phase 10 is deployment and documentation (production hosting, README, API docs, user guide, final demonstration).
