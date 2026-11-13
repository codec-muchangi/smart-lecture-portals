# Final demonstration script (SRS 20 phase 10, Appendix A)

A 20-minute walkthrough that shows every requirement area on the recommended demo data. Run it on a
**separate demo environment** (a development or staging Supabase project with the API running), never on
production: the demo accounts use a shared password.

## Before the demo (once)
1. Apply all migrations to the demo database (`docs/DEPLOYMENT.md`, step 2).
2. Load the demo data:
   ```powershell
   # backend\.env must hold SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL of the DEMO project
   $env:DEMO_PASSWORD = Read-Host "choose a demo password"
   python scripts/seed_demo.py
   ```
   (`seed_demo.py` refuses to run when `ENVIRONMENT=production`; psql must be installed.)
3. Start the API (`uvicorn app.main:app --reload`, or the deployed demo URL) and sign in with the HTTP
   client you will use on the day: the interactive API page at `/docs` works in development.
4. Have one small PDF ready (any lecture-notes file under 25 MB): it is the "sample PDF lecture notes".

## What the demo data contains (SRS Appendix A)
| Entity | Example |
|---|---|
| Student | Demo Student / STU001, `student@demo.test` |
| Lecturer | Demo Lecturer / LEC001, `lecturer@demo.test` |
| Courses | CIT 3253 - Network Administration, CIT 3254 - Database Systems (both taught by the lecturer, student enrolled in both) |
| Assignment | Assignment 1 - Introduction (CIT 3253, 20 marks, due in 14 days) |
| Assessment | CAT 1 (CIT 3253, 30 marks, weight 15, not yet published) |
| Attendance | Three lecture sessions: present, late, absent (66.67 %) |
| Announcement | "Welcome" (CIT 3253) |
| Timetable | Mondays 08:00-10:00, Lab 2 |
| Material | Uploaded live in step 4 below |

## The walkthrough
| # | Who | Do | Shows (SRS) |
|---|---|---|---|
| 1 | Lecturer | `POST /auth/login`, then `GET /dashboard` | Role-based sign-in, real dashboard data (AT-02) |
| 2 | Lecturer | `GET /courses` | Sees only the two assigned courses |
| 3 | Student | Log in as the student; `GET /dashboard`, `GET /courses`, `GET /timetable` | Student view of the same data (AT-01) |
| 4 | Lecturer | `POST /courses/{CIT 3253}/materials` with the PDF | Material upload (FR-MAT, AT-15 setup) |
| 5 | Student | `GET /courses/{id}/materials`, then `GET /materials/{id}/download` | Signed, short-lived download (AT-15) |
| 6 | Student | Try `GET /courses/{id}/reports/attendance` | Refused: lecturer-only endpoint (AT-03) |
| 7 | Lecturer | `POST /courses/{id}/assignments` for a new assignment | Assignment creation (AT-07) |
| 8 | Student | `POST /assignments/{id}/submissions` with a small PDF, then with a `.exe` renamed to `.pdf` | Valid submit accepted (AT-08); invalid file rejected (AT-09) |
| 9 | Lecturer | `PATCH /submissions/{id}/grade` with a valid mark, then one above the maximum | Grading (AT-10); over-maximum rejected (AT-11) |
| 10 | Student | `GET /assignments/{id}/submissions/me` before and after `POST .../grades/release` | Unreleased mark hidden, released mark visible (AT-12) |
| 11 | Lecturer | `PUT /assessments/{CAT 1}/marks` for the student, then publish CAT 1 | Mark entry, duplicate prevention (AT-19) |
| 12 | Student | `GET /courses/{id}/marks/me` | Only published marks, weighted total (AT-05, AT-12) |
| 13 | Lecturer | `POST /courses/{id}/attendance/sessions`, then `POST .../records` | Attendance (AT-13) |
| 14 | Student | `GET /courses/{id}/attendance/me` | Own attendance percentage (AT-14) |
| 15 | Lecturer | `POST /courses/{id}/announcements` | Announcement publishing (AT-17) |
| 16 | Student | `GET /courses/{id}/announcements`, `GET /notifications` | Announcement visible; new notifications for the announcement, the assignment, the material, the grade, the marks (AT-18) |
| 17 | Lecturer | `GET /courses/{id}/reports/attendance`, `/submissions`, `/performance` | Reports whose totals match the records (AT-20) |
| 18 | Both | `POST /auth/logout`, then reuse the old token | Token revoked: 401 |

## Closing points to make (about 2 minutes)
- Security: every endpoint needs sign-in except login, reset and health probes; students cannot reach lecturer
  data; production refuses to start with an unsafe configuration; limits on login and uploads; logs never hold
  secrets.
- Quality: the automated suite (backend tests, real-PostgreSQL migration checks, container check, secret scan,
  front-end build) must pass before anything is deployed.
- Operations: documented deployment, backups, key rotation, retention, and a one-command live smoke test.
- Honest scope: the browser pages are built in the front-end phase; the demonstration drives the finished
  backend contract (`docs/API.md`), which the pages will use unchanged.

## After the demo
Remove the demo data by discarding the demo project, or leave it for the next presentation. Never copy demo
accounts to production.
