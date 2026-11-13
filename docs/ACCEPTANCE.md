# Acceptance traceability (SRS section 17.3, acceptance tests AT-01 to AT-20)

Each acceptance test of the SRS is proven twice: **automatically** on every push (the test files below, plus
the real-PostgreSQL checks in `scripts/verify_database.py` for database-level rules), and **by hand** on the
deployed system during the final demonstration (`docs/DEMO_SCRIPT.md`, step numbers in the last column).

| AT | SRS requirement | Automated proof (backend/tests) | Demo step |
|---|---|---|---|
| AT-01 | Student can log in and reach the student dashboard | `test_dashboard_api.py`, `test_auth_endpoints.py` | 3 |
| AT-02 | Lecturer can log in and reach the lecturer dashboard | `test_dashboard_api.py`, `test_auth_endpoints.py` | 1 |
| AT-03 | Student cannot access a lecturer-only endpoint | `test_authorization.py`, `test_auth_boundaries.py` | 6 |
| AT-04 | Lecturer cannot access a course not assigned to them | `test_authorization.py`, `test_auth_boundaries.py`, `test_courses_api.py` | 2 |
| AT-05 | Student cannot view another student's marks | `test_assessments_api.py`, `test_marks_entry_api.py` | 12 |
| AT-06 | Student cannot submit to a course they are not enrolled in | `test_submissions_api.py` | 8 |
| AT-07 | Lecturer can create an assignment for an assigned course | `test_assignments_api.py` | 7 |
| AT-08 | Student can submit a valid assignment before the deadline | `test_submissions_api.py` | 8 |
| AT-09 | Invalid or oversized submission is rejected | `test_submissions_api.py`, `test_files_util.py` | 8 |
| AT-10 | Lecturer can grade a submission with a valid mark | `test_grading_api.py` | 9 |
| AT-11 | Mark above the maximum is rejected | `test_grading_api.py`, `test_marks_entry_api.py` | 9 |
| AT-12 | Student sees a released mark but not an unpublished one | `test_grading_api.py`, `test_marks_entry_api.py` | 10, 12 |
| AT-13 | Lecturer can create an attendance session and mark students | `test_attendance_api.py` | 13 |
| AT-14 | Student can view their attendance percentage | `test_attendance_api.py`, `test_attendance_calc.py` | 14 |
| AT-15 | Student can download authorized course material | `test_materials_api.py` | 5 |
| AT-16 | Student cannot access another course's private material | `test_materials_api.py`, `test_submissions_api.py` | 5 |
| AT-17 | Lecturer can publish an announcement; enrolled students see it | `test_announcements_api.py` | 15, 16 |
| AT-18 | Important events generate notifications | `test_notification_events.py`, `test_notifications_api.py` | 16 |
| AT-19 | Duplicate enrolment, attendance and mark records are prevented | `test_assessments_api.py`, `test_marks_entry_api.py`, `test_attendance_api.py`, `scripts/verify_database.py` | 11, 13 |
| AT-20 | Core reports show totals consistent with the source records | `test_reports_api.py` | 17 |

## Beyond the 20 tests: non-functional proof
| Area (SRS) | Proof |
|---|---|
| Security: RBAC, no public endpoints, headers, rate limits, redaction (12) | `test_hardening_*.py` (auth, http, ratelimit, logging, inventory, config) |
| Production fails fast on unsafe configuration (12, 18.1) | `test_hardening_config.py`, `test_ops_scripts.py` (preflight), CI job "Backend container image" |
| Database integrity, privileges, RLS, no bulk deletes (9, 15) | `scripts/verify_database.py` (migrations on a real PostgreSQL) |
| API documentation matches the implementation (21) | `test_hardening_inventory.py` (every route documented, no ghost routes, `.env.example` complete) |
| Documentation completeness (21) | `test_docs_consistency.py` |
| Deployment files safe (18, 19) | `test_deployment_files.py`, CI job "Backend container image" |
| Pagination, performance smoke (17.1) | `test_hardening_inventory.py`; live `scripts/smoke_test.py` |
| Secrets never committed (12) | CI job "Secret scan" (gitleaks) |

## Manual live checklist (after each production deployment)
- [ ] `python scripts/smoke_test.py --api https://<api> --frontend-origin https://<front end> --expect-production` ends with `SMOKE TEST PASSED`.
- [ ] `/docs` and `/openapi.json` return 404 on production.
- [ ] A lecturer and a student signed in with real accounts see only their own courses (smoke test with `--student-email` / `--lecturer-email`).
- [ ] `db/ops/schema_status.sql` shows 11 of 11 `applied`.
- [ ] A backup (`scripts/backup_data.py`) was taken and its `manifest.json` row counts look right.
- [ ] The `pg_cron` job exists: `select jobname, active from cron.job;`.
- [ ] Branch protection requires **CI passed** on `main`.
- [ ] Walk the demo script (`docs/DEMO_SCRIPT.md`) once on the demo environment.

## SRS Definition of Done (section 21)
| Item | Where it is met |
|---|---|
| Required features implemented; acceptance tests pass | Phases 1-9; table above |
| Security rules and RBAC verified | Phase 9 tests, `docs/PHASE9_BACKEND.md` |
| Documented production environment variables and deployment instructions | `docs/DEPLOYMENT.md`, `backend/.env.example`, `render.yaml` |
| Schema and API docs synchronized with the implementation | `docs/ERD.md`, `docs/API.md` (tests enforce the API side) |
| Seed/demo data for the final presentation | `db/seed/seed_demo.sql`, `scripts/seed_demo.py`, `docs/DEMO_SCRIPT.md` |
| README, user guide, deployment steps | `README.md`, `docs/USER_GUIDE.md`, `docs/DEPLOYMENT.md` |
| Browser pages | Front-end phase (outside this backend delivery; see `docs/FRONTEND.md`) |
