# Deployment guide (SRS 18, 19, 21)

This is the one document to follow to put the Smart Lecture Portal on the internet. Follow the steps in
order. **Never skip the backup, the preflight or the smoke test.**

| Part | Where it runs | Config file |
|---|---|---|
| Database, accounts, file storage | Supabase (a **separate production project**) | `db/migrations`, `db/ops` |
| API (FastAPI) | Render, as a Docker service | `render.yaml`, `backend/Dockerfile` |
| Web front end (React) | Vercel | `frontend/vercel.json` |

SRS section 18 allows any compatible host. These three are the documented, tested default. If you choose
another host, keep the same rules: HTTPS only, secrets only in the host's settings, deploy only after CI passes.

## 0. What you need
- A GitHub repository with this project, and the CI workflow green on `main`.
- Accounts on Supabase, Render and Vercel (all have a free tier; see "Free plan limits" below).
- Python 3.12 and the project's `backend` virtual environment on your computer (for the helper scripts).

## 1. Create the production Supabase project
1. In Supabase create a **new project** just for production (never reuse the development one; SRS 19).
2. Keep the database password in a password manager.
3. In **Project Settings → API** note three values: the project URL, the `anon` key and the `service_role` key.
   The `service_role` key bypasses every security rule: it goes **only** into the Render settings and your
   own `.env.production`. Never into GitHub, the front end, chat or e-mail.

## 2. Apply the database migrations, in order
In **SQL Editor**, open and run each file of `db/migrations` in this exact order, one at a time, waiting for
"Success" each time: `0001_init_schema.sql`, `0002_views.sql`, `0003_auth_integrity.sql`,
`0004_courses_enrollment.sql`, `0005_materials.sql`, `0006_assignments_submissions.sql`,
`0007_grading_marks.sql`, `0008_attendance.sql`, `0009_announcements_notifications.sql`,
`0010_timetable_reporting.sql`, `0011_hardening.sql`.

Then run `db/ops/schema_status.sql`. **All 11 rows must say `applied = true`.** Do **not** run
`db/seed/seed_demo.sql` on production (see `docs/DEMO_SCRIPT.md` for a separate demo environment).

Later schema changes are new numbered migrations: take a backup first (step 9), apply the new file, re-run
`schema_status.sql`.

## 3. Configure sign-in
In **Authentication** (wording differs slightly between dashboard versions):
- Turn **off** "Allow new users to sign up": the portal has no self-registration (SRS v1.0).
- **URL Configuration → Site URL**: your front-end address (you get it in step 7; come back and set it).
- **Redirect URLs**: add `https://<your-front-end>/reset-password` (the address password-reset e-mails open).
- Consider custom SMTP (Authentication → SMTP) before real use: the built-in mailer is rate limited.

## 4. Create the real accounts
Accounts are created by a script (no sign-up page). From the `backend` folder with the venv active, point the
script at **production for this PowerShell window only**:
```powershell
cd backend
venv\Scripts\activate
$env:SUPABASE_URL = "https://<project>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = Read-Host "service role key"
$env:SUPABASE_ANON_KEY = Read-Host "anon key"
python ../scripts/create_user.py --role lecturer --email lecturer@example.edu --name "Full Name" --staff-number LEC001
python ../scripts/manage_academic.py --help      # create courses, assign lecturers, enrol students
Remove-Item Env:SUPABASE_URL, Env:SUPABASE_SERVICE_ROLE_KEY, Env:SUPABASE_ANON_KEY
```
(`python ../scripts/create_user.py --help` shows the exact options. Variables set in the window override
`backend/.env`, so your development file is untouched.)

## 5. Preflight the production settings
Make a file `backend/.env.production` (already git-ignored; **never commit it**) with the six production
values, then run the checker:
```powershell
cd backend
copy .env.example .env.production      # then edit: ENVIRONMENT=production and the real values
python ../scripts/check_production_env.py --env-file .env.production
```
| Setting | Production value |
|---|---|
| `ENVIRONMENT` | `production` (switches on every safety rule; the API refuses to start unsafely) |
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_ANON_KEY` | the anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key |
| `CORS_ORIGINS` | the exact front-end origin, e.g. `https://portal.example.edu` (https only, never `*`) |
| `PASSWORD_RESET_REDIRECT_URL` | `https://<front end>/reset-password` |

All other settings have safe defaults (see `backend/.env.example`: rate limits, upload size, timeouts, log
level). The checker never prints a secret and must say **READY** before you continue.

## 6. Deploy the API on Render
1. Push the repository to GitHub (`git status` first: no `.env` file may be listed).
2. Render dashboard → **New → Blueprint** → choose the repository. Render reads `render.yaml`.
3. Render asks for the five values marked `sync: false`: paste them from `.env.production`. For
   `CORS_ORIGINS` use your planned front-end address (you can correct it after step 7).
4. Create. The first build takes a few minutes. The service address looks like
   `https://smart-lecture-portal-api.onrender.com`.
5. `autoDeployTrigger: checksPass` means Render deploys a new commit **only after the GitHub checks pass**
   (SRS 19: do not deploy if critical tests fail). Branch protection (below) makes this stricter.
6. Open `https://<api>/health` (should show `{"status":"ok"}`) and `https://<api>/health/ready`.

## 7. Deploy the front end on Vercel
1. Vercel → **Add New → Project** → import the same repository.
2. **Root Directory: `frontend`**. Framework preset: Vite (build `npm run build`, output `dist`).
3. Environment variables: `VITE_API_BASE_URL` = `https://<api>/api/v1`, `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY` (the **anon** key only; the service key must never be here).
4. Deploy. `frontend/vercel.json` makes every route open `index.html` (needed by the React router) and adds
   browser security headers.

## 8. Connect the two sides
1. Render → the API service → Environment: set `CORS_ORIGINS` and `PASSWORD_RESET_REDIRECT_URL` to the final
   Vercel address (and `https://<front end>/reset-password`). Save: Render redeploys.
2. Supabase → Authentication → URL Configuration: Site URL and redirect URL as in step 3.
3. If you later add a custom domain, repeat steps 1 and 2 with the new address.

## 9. Verify the live system (smoke test)
```powershell
python scripts/smoke_test.py --api https://<api> --frontend-origin https://<front end> --expect-production
```
All lines must be `[PASS]`. The first call may take about a minute on a free plan (cold start). To also prove
the sign-in journeys with a real account that exists on that server:
```powershell
$env:SMOKE_STUDENT_PASSWORD = Read-Host "password"
python scripts/smoke_test.py --api https://<api> --frontend-origin https://<front end> --expect-production --student-email <student e-mail>
```
Then work through the manual checklist in `docs/ACCEPTANCE.md` and the walkthrough in `docs/DEMO_SCRIPT.md`.

## 10. Switch on the protections
- **Branch protection** (GitHub → Settings → Branches → `main`): require a pull request and the status check
  **CI passed**.
- **Notification clean-up**: run `db/ops/schedule_notification_purge.sql` once in the SQL Editor (after
  enabling the `pg_cron` extension). See `docs/OPERATIONS.md`.
- **Backups**: take the first backup now (`docs/OPERATIONS.md`, "Backups") and turn on Supabase's own
  backups if your plan has them.
- **Uptime monitor**: point a free monitor (for example UptimeRobot) at `https://<api>/health/ready`.

## If something fails
| Symptom | Likely cause and fix |
|---|---|
| Render build fails | Open the build log. Usually a typo in `render.yaml` paths or a failed dependency install |
| Service starts, then stops: "Unsafe production configuration" | A production setting is wrong. Run the preflight (step 5); the message names the setting |
| `/health/ready` is 503 | Wrong `SUPABASE_URL`/service key, or Supabase paused. Check the Render logs for the `request_id` |
| Browser says "CORS error" | `CORS_ORIGINS` does not match the front-end address exactly (scheme, no trailing slash) |
| Login works on the API but the front end says "network error" | `VITE_API_BASE_URL` wrong, or the API is asleep (free plan): retry after a minute |
| Password-reset link opens a wrong page | Supabase Site URL / redirect URL (step 3) or `PASSWORD_RESET_REDIRECT_URL` |
| Every user shares one rate limit | The platform proxy header was not trusted; the image sets `FORWARDED_ALLOW_IPS=*`. Check you did not override the start command |
| Refresh on `/student/...` gives 404 on the front end | `frontend/vercel.json` was not deployed (Root Directory must be `frontend`) |

Every API error response carries `X-Request-ID` and the same id is in the server log, so a screenshot of the
error is enough to find the exact log line.

## Rollback
- **API**: Render → the service → Deploys → pick the last good deploy → Rollback. (Or revert the commit; the
  checks run again.)
- **Front end**: Vercel → Deployments → previous deployment → Promote to production.
- **Database**: migrations are forward-only. Restore from the backup taken before the migration
  (`docs/OPERATIONS.md`). That is why the backup comes first.

## Free plan limits and scaling (read before launch day)
- A free Render service **sleeps when idle**; the first request afterwards is slow. Use a paid instance for
  real teaching use; nothing else changes.
- Rate limits are counted **in memory per process**, so the image runs one worker. If you later run several
  instances, move the limiter to a shared store first (a documented future item, not needed for one instance).
- The image trusts the platform's proxy (`FORWARDED_ALLOW_IPS=*`) because the container is reachable only
  through it. Do not expose the container directly to the internet on another host without narrowing that.
- Uploads are not malware-scanned (SRS lists scanning as a future improvement).
