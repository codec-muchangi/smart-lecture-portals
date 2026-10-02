# Phase 1 — Authentication, Authorization & Profiles (backend)

Scope: backend only. No pages were built or changed. Requirements covered: FR-AUTH-01…08, FR-STU-12/FR-LEC (profile), NFR-SEC-01/02/05/06.

## How data is collected and saved
| Flow | Input (validated by Pydantic) | Where it is saved | Audit |
|---|---|---|---|
| Account creation | `scripts/create_user.py` → `provision_user()` (no self-signup in v1.0) | Supabase Auth (credentials, hashed by provider) → `profiles` + `students`/`lecturers` via atomic `provision_profile()` | – |
| Login | email + password → provider verifies | Nothing stored by the app; tokens issued by Supabase | `auth.login`, `auth.login_denied` |
| Profile update | `full_name`, `phone`, `avatar_url` only | `profiles` (only changed fields) | `profile.update` with old/new |
| Password change | current + new password | Supabase Auth only (never in app tables) | `auth.password_change` (no secrets) |
| Password reset | email | Provider sends the link | – |
| Logout | bearer token | Refresh tokens revoked at provider | `auth.logout` |

## Authentication → authorization pipeline (`app/core/security.py`)
1. `get_access_token`: bearer header present, else **401**.
2. `get_current_user`: Supabase verifies signature/expiry (**401** if not); identity is then loaded from OUR `profiles` + role table using the token's user id — never from request data.
3. Account must have a profile (**403**), a matching role row, and `status = active` (**403**).
4. `require_role(...)` → **403** for the wrong role. `assert_course_access / assert_course_lecturer` → **404** for courses outside the caller's scope (no existence leak).
5. Defence in depth in the database: role/id immutable, role-row/role consistency triggers, RLS on with no client policies.

## Other security controls
- Same 401 message for wrong password and unknown email; password reset always 202.
- In-memory rate limits on login and reset (`app/core/rate_limit.py`; per-instance — use `--proxy-headers` behind a proxy).
- Password policy enforced server-side (`password_policy.py`) in addition to the provider's.
- Login uses a throw-away anon client; the shared service-role client never holds a user session.
- Auth provider outage → 503, not a misleading 401.

## Apply to your environment
1. Run `db/migrations/0003_auth_integrity.sql` in the Supabase SQL editor (choose **Run and enable RLS** if prompted).
2. Add to `backend/.env` (optional, defaults exist): `PASSWORD_RESET_REDIRECT_URL`, `LOGIN_RATE_LIMIT`, `LOGIN_RATE_WINDOW_SECONDS`.
3. In Supabase → Authentication → URL Configuration, add `http://localhost:5173/reset-password` to Redirect URLs (needed for reset links).
4. `pip install -r requirements.txt` (slowapi was removed; it was unused).
5. Create accounts: `cd backend` then `python ../scripts/create_user.py --role student --email … --name … --registration-number …`

## Tests (`backend/tests`, 70 total)
`test_profile_rules.py` (profile read/update/validation/forbidden fields/audit), `test_auth_endpoints.py` (login, logout, change/reset password, rate limits, outage), `test_authorization.py` (AT-03, AT-04, scope, withdrawn enrollment), `test_provisioning.py` (atomic create + rollback). They run against an in-memory Supabase fake (`tests/fakes.py`); no network or real database needed, so CI works unchanged.
Not covered by automated tests (needs a live Supabase): the SQL triggers and `provision_profile()` themselves — verify manually per the checklist below.

## Manual verification checklist (live Supabase)
- [ ] Migration 0003 applies without error.
- [ ] `update profiles set role='lecturer' where id=…` fails with “immutable”.
- [ ] Inserting into `students` for a lecturer's id fails.
- [ ] `create_user.py` makes a user who can log in; a duplicate registration number leaves no new row in Authentication → Users.
- [ ] Swagger `/docs` → Authorize with a token from `/auth/login`; `/me` works; PATCH `/me` with `{"role":"lecturer"}` returns 422.
