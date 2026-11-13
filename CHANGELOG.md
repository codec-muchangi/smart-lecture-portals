# Changelog

All notable changes. The project follows the phases of the SRS (section 20).

## 1.0.0 - Backend release (Phases 0-10)

### Phase 10 - Deployment and documentation
- Production container image (`backend/Dockerfile`): non-root, health check, secrets only at run time.
- Hosting configuration: Render blueprint (`render.yaml`, deploys only after CI passes) and Vercel
  configuration for the React router (`frontend/vercel.json`, `frontend/public/_redirects`).
- Operations scripts: `check_production_env.py` (pre-flight), `smoke_test.py` (post-deploy), `backup_data.py`
  (portable export), SQL `db/ops/schema_status.sql` and `db/ops/schedule_notification_purge.sql`.
- CI: container image job added to the required **CI passed** gate; Dependabot watches the Dockerfile.
- Documentation: README rewritten, `DEPLOYMENT`, `OPERATIONS`, `USER_GUIDE`, `DEMO_SCRIPT`, `ACCEPTANCE`,
  `SECURITY.md`, this changelog.

### Phase 9 - Hardening
Security headers, request ids, rate limits, production fail-fast configuration, log redaction, timeouts and
503 handling, least-privilege database roles, TRUNCATE guard, notification retention, dependency upgrades,
whole-API inventory tests.

### Phase 8 - Dashboards, timetable, reports
Role dashboards, read-only timetable, attendance/submission/performance reports.

### Phase 7 - Announcements and notifications
Course announcements and in-app notifications for important events.

### Phase 6 - Attendance
Sessions, bulk marking with audited corrections, student percentage.

### Phase 5 - Grading and marks
Submission grading with release control, assessments and marks (all-or-nothing entry), weighted totals.

### Phase 4 - Assignments and submissions
Assignments with deadlines and attachments, validated file submissions.

### Phase 3 - Materials and file storage
Course materials in private storage with signed short-lived downloads.

### Phase 2 - Courses and enrolment
Course, lecturer assignment and enrolment management with integrity rules.

### Phase 1 - Authentication and profiles
Login, logout, password change and reset, profiles, role-based access.

### Phase 0 - Scaffold
Repository structure, error model, CI, schema 0001-0002.
