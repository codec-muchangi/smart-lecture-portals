# Operations runbook (SRS 12, 15, 23)

Everything you do after launch. Commands run from the `backend` folder with the venv active unless stated.

## Quick reference
| Task | How |
|---|---|
| Is it alive? | `GET /health` (process) and `GET /health/ready` (database) |
| Full live check | `python scripts/smoke_test.py ...` (`docs/DEPLOYMENT.md`, step 9) |
| Check production settings | `python ../scripts/check_production_env.py --env-file .env.production` |
| Which migrations are applied? | run `db/ops/schema_status.sql` in the Supabase SQL Editor |
| Backup the data | `python ../scripts/backup_data.py` |
| New course, lecturer or enrolment | `python ../scripts/manage_academic.py --help` |
| New account | `python ../scripts/create_user.py --help` |
| Remove files left by a failed delete | `python ../scripts/purge_deleted_materials.py` |

For anything that touches production from your computer, set the production variables **in that PowerShell
window only** (see `docs/DEPLOYMENT.md`, step 4) and clear them afterwards.

## Backups
**Two layers: use both.**
1. **Supabase backups** (plan dependent; enable them in Project Settings → Database → Backups). These restore the
   whole database, and are the right tool for a disaster.
2. **Your own export**, works on every plan:
   ```powershell
   python ../scripts/backup_data.py                 # writes ..\backups\<date-time>\
   ```
   It writes one `<table>.jsonl` per table (17 tables) and `manifest.json` with row counts (the counts include
   the audit log). It pages through every row, so nothing is cut off at 1000 rows.

The export contains **personal data**: store it privately (an encrypted drive), never in Git (`backups/` is
ignored) and delete old copies on a schedule. It does **not** include files in Supabase Storage
(`materials` and `submissions` buckets): download those from the dashboard or with the Supabase CLI when you
need a full copy.

**When to back up**: before every migration, before each semester change, and weekly while the system is used.

### Restoring from an export
Restoring replaces data, so rehearse it first on a **throw-away Supabase project**.
1. Create an empty project and apply all migrations (`docs/DEPLOYMENT.md`, step 2).
2. Auth users are not part of the export (they live in Supabase Auth). Restore users first, with the Supabase
   dashboard's backup restore, or recreate the accounts with `create_user.py`: the `profiles` rows reference
   them by id.
3. In the SQL Editor, load each file in dependency order (profiles, students, lecturers, courses,
   course_lecturers, course_enrollments, materials, assignments, submissions, attendance_sessions,
   attendance_records, assessments, assessment_marks, announcements, notifications, timetable_entries,
   audit_logs), for example with `jsonb_populate_recordset` (this is the exact recipe the database checks prove
   for all 17 tables):
   ```sql
   -- paste the file's lines into the array, one JSON object per element
   insert into courses
   select * from jsonb_populate_recordset(null::courses, '[ ...rows... ]'::jsonb);
   ```
   Triggers that protect the data (for example the audit log, enrolment and grading rules) also run during a
   restore. If one blocks a legitimate historical row, run that single insert in a session with
   `set session_replication_role = replica;` and set it back to `origin` afterwards.
4. `TRUNCATE` is blocked on the academic tables by migration 0011, so you cannot accidentally wipe a table to
   "start again": restore into a fresh project instead.
5. Run `db/ops/schema_status.sql`, then the smoke test, then compare row counts with `manifest.json`.

For a whole-database restore prefer Supabase's own backup restore or `pg_dump`/`pg_restore`.

## Rotating a leaked or old key
If the `service_role` key may have been exposed (a screenshot, a commit, a chat):
1. Supabase → Project Settings → API → regenerate the key (or rotate the JWT secret).
2. Put the new value into Render → Environment → `SUPABASE_SERVICE_ROLE_KEY` and into `.env.production`.
3. If it ever reached Git: remove it from the history too, and treat it as public (it is already rotated).
4. Run the preflight and the smoke test.

## Troubleshooting a user's problem
1. Ask for the **request id** (the `X-Request-ID` header, repeated in `details.request_id` for server errors).
2. Search the Render logs for it: you see the access line, the user's role, timing and any warning.
3. Logs never contain passwords, tokens or keys (redacted), so sharing a log excerpt is safe.
4. Lines starting `SLOW` mean a request took longer than `SLOW_REQUEST_SECONDS` (target: under 2 s).

## Retention
| Data | Rule | How |
|---|---|---|
| Read notifications | deleted after 90 days; unread are never deleted | weekly `pg_cron` job from `db/ops/schedule_notification_purge.sql`; manual alternative `python ../scripts/purge_old_notifications.py` |
| Deleted materials' files | removed when deleted; leftovers cleaned on demand | `python ../scripts/purge_deleted_materials.py` |
| Audit log | kept; cannot be edited or truncated | migration 0011 |

Check the job: `select jobname, schedule, active from cron.job;` and
`select * from cron.job_run_details order by start_time desc limit 10;`.

## Starting a new semester
1. Take a backup.
2. With `manage_academic.py` create the new courses, assign lecturers and enrol students; archive finished
   courses (their data stays and stays readable; archived courses leave dashboards and timetables).
3. Run the smoke test and open the lecturer dashboard of one account.

## Updating the system
1. Branch, change, open a pull request; CI must say **CI passed** (backend tests, real-database checks,
   container image check, front-end, secret scan).
2. Merge to `main`: Render deploys automatically only after the checks pass; Vercel builds the front end.
3. Schema change = new numbered migration (applied by hand after a backup) plus updated `docs/ERD.md` and
   `docs/API.md` in the same pull request.
4. Dependabot opens update pull requests weekly (pip, npm, GitHub Actions, Docker): review and merge them
   like any change. The weekly `security-audit` workflow reports known vulnerabilities.
