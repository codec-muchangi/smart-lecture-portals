# Security policy

## Reporting a vulnerability
Please do **not** open a public issue for a security problem. Report it privately to the project owner (use
GitHub's "Report a vulnerability" under the repository's Security tab, or contact the maintainers directly)
with the steps to reproduce it. You will get an acknowledgement, and a fix or a plan, as soon as practical.

## What is protected, and how
Details and the evidence for each rule are in `docs/PHASE9_BACKEND.md` and `docs/API.md`.
- Every endpoint except login, password reset and health probes needs a valid token; roles and course
  assignment are enforced on the server; other users' data answers like missing data.
- Files: type, size and content are checked; downloads are short-lived signed links from private storage.
- Production refuses to start with an unsafe configuration (`scripts/check_production_env.py` checks it first).
- Rate limits on login, reset, password change, uploads and reports; security headers on every response.
- Logs redact tokens, keys and passwords; every response carries a request id.
- The database enforces integrity, least privilege and a tamper-resistant audit log.
- Dependencies are pinned, watched by Dependabot and audited weekly; CI runs a secret scan and CodeQL.

## Rules for contributors and operators
- Never commit `.env` files, keys, passwords or database dumps (`backups/` is ignored).
- The Supabase `service_role` key lives only in the API host's settings: never in the front end, GitHub,
  chat or e-mail. If it leaks, rotate it at once (`docs/OPERATIONS.md`).
- Use a separate Supabase project for production; never load demo data there.

## Known limitations (tracked, not hidden)
- Uploaded files are validated but not malware-scanned.
- Rate limits are per process (one API instance); a shared store is needed before running several.
- The front end currently reports two moderate `react-router` advisories in `npm audit`; upgrade it when the
  pages are built.
