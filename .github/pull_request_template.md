## What & why
Link the SRS requirement IDs (e.g. FR-ASG-09) this change implements.

## Checklist
- [ ] Server-side authorization enforced and tested (role + course scope)
- [ ] Validation on backend (and frontend where applicable)
- [ ] Tests added for business rules / auth boundary
- [ ] Docs updated if schema or API contract changed (docs/ERD.md, docs/API.md, new migration)
- [ ] No secrets committed; `.env.example` updated
- [ ] No scope beyond SRS v1.0 (no admin role, no unapproved modules)
