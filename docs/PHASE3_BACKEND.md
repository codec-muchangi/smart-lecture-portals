# Phase 3 — Materials & Secure File Storage (backend)

Scope: backend only; no pages built or changed. Requirements: FR-MAT-01…05, FR-LEC-04, FR-STU-04, NFR-SEC-03/04/05/06, acceptance tests AT-15 and AT-16, SRS sections 12 and 14.
Defaults used (confirmed): PDF, DOCX, PPTX, XLSX, CSV, PNG, JPG/JPEG, ZIP; 25 MB maximum.

## How data is collected and saved
| Step | What happens | Where it ends up |
|---|---|---|
| Upload | Lecturer sends `multipart/form-data` (file + title, description, category, published) | The **file** in private bucket `materials` at `{course_id}/{material_id}/{safe_name}`; the **metadata** (title, description, category, file name, MIME type, size, uploader, published) in table `materials` |
| Validation | Role, course assignment, course active, title/description, extension allow-list, size, content check | Rejected requests store nothing |
| Download | Course-access check, then a signed URL (default 120 s, forced download) | Nothing stored; the bucket URL is never exposed |
| Edit | Title, description, category, published only | `materials` (changed fields only) + audit row with old/new values |
| Delete | Row soft-deleted, file removed, `file_removed_at` stamped | Row kept for history; file gone; audit row |
| Audit | `material.create`, `material.update`, `material.delete` | `audit_logs` |

## Safety rules and where they are enforced
| Rule | API/service | Database / storage |
|---|---|---|
| Only an assigned lecturer uploads/edits/deletes (FR-MAT-01, FR-LEC-04) | `LecturerDep` (403) + `assert_course_lecturer` (404) | `trg_materials_guard`: uploader must be assigned |
| Students only reach materials of their enrolled courses (FR-MAT-03, AT-16) | `assert_course_access` before any lookup result or URL | RLS on, no client policies |
| Students never see drafts | filter + 404 | – |
| Type and size validated (FR-MAT-04) | extension allow-list + content check + size ×3 | Bucket: 25 MB and 8 MIME types |
| No path traversal / unsafe names | `sanitize_filename`; server-generated path; client name never used in a path | `UNIQUE(storage_path)` |
| Private bucket, no permanent URLs (NFR-SEC-03) | signed URLs, short TTL, attachment disposition | `public = false` |
| File identity cannot change | `MaterialUpdate` forbids extra fields | immutability trigger |
| Consistent storage + database (NFR-REL-01) | upload: file then row, compensating delete on failure; delete: row then file, retry job | `file_removed_at`, no hard deletes |
| Read-only history | `ensure_course_writable` → 409 for archived/inactive courses | – |
| No internals in errors (NFR-SEC-05) | generic 500/503 messages; details logged server-side | – |

## Endpoints
`GET|POST /courses/{id}/materials`, `GET /materials/{id}/download`, `PATCH|DELETE /materials/{id}` — details in `docs/API.md`.

## Apply to your environment
1. Back up and branch **first**: `git checkout -b feat/phase3-backend`.
2. Extract `phase3-backend.zip` into the project root and replace files (use the temporary-folder + `robocopy` method from before).
3. Run `db/migrations/0005_materials.sql` once in the Supabase SQL editor (choose **Run and enable RLS** if prompted).
4. `cd backend`, activate the venv, `pip install -r requirements.txt` (the unused `python-magic` packages and `slowapi` are gone), then `pytest -q` → **276 passed**.
5. Optional `.env` additions (defaults exist): `SIGNED_URL_TTL_SECONDS=120`, `MAX_UPLOAD_MB=25`, `ALLOWED_FILE_EXTENSIONS=...`.
6. Work through the checklist below.
7. Commit, push, open a pull request, wait for **CI passed**, merge.

## Manual checklist (live Supabase — the automated tests use an in-memory fake, so these cover the real services)
**Database and bucket**
- [ ] Migration 0005 runs without error.
- [ ] `select public, file_size_limit, array_length(allowed_mime_types,1) from storage.buckets where id='materials';` → `false`, `26214400`, `8`.
- [ ] `delete from materials;` fails with "materials are soft-deleted" (run it only when the table is empty or inside a rolled-back test).

**Swagger (log in as the lecturer, Authorize, use a course id from `GET /courses`)**
- [ ] `POST /courses/{id}/materials`: choose a real PDF, title "Test notes" → **201**; the response has no `storage_path`.
- [ ] Supabase → Storage → `materials`: the file is at `{course_id}/{material_id}/{name}.pdf`.
- [ ] Upload a text file renamed to `fake.pdf` → **400** `FILE_TYPE_NOT_ALLOWED`. Upload an `.exe` → **400**. Upload a file over 25 MB → **400** `FILE_TOO_LARGE`.
- [ ] `PATCH /materials/{id}` with `{"published": false}` → 200; `{"file_name":"x.pdf"}` → **422**.
- [ ] `GET /courses/{id}/materials` as lecturer shows the draft.

**Swagger (log in as the student, Authorize)**
- [ ] The draft does **not** appear in the list; `GET /materials/{id}/download` on it → **404**.
- [ ] After the lecturer re-publishes: the student sees it and `GET /materials/{id}/download` → **200**; open the returned `url` in the browser: the file downloads. Wait longer than `expires_in` and open it again → it must be refused.
- [ ] `POST` as the student → **403**. A material of a course the student isn't enrolled in → **404**.

**Delete and retention (lecturer)**
- [ ] `DELETE /materials/{id}` → **204**; the file disappears from Storage; the row remains in `materials` with `deleted_at` and `file_removed_at` set; `audit_logs` has `material.create`, `material.update`, `material.delete`.
- [ ] `python ..\scripts\purge_deleted_materials.py` → `Removed 0 leftover file(s); 0 still failing.`

## Decisions to confirm (SRS §22: flag, don't invent)
1. **Notifications for new materials (FR-NOT-03) are Phase 7**, as in the roadmap. The hook point is `material_service.create_material` (and publish in `update_material`).
2. **Retention:** delete removes the file and keeps the metadata row. If you prefer to keep files for a grace period, say so and the purge job gains an age threshold.
3. **Uploads default to published** (SRS 5.5: "becomes visible to authorized students"); lecturers can upload drafts with `published=false`.
4. **Errors use HTTP 400** for file problems because SRS 10.1 lists 400 for validation and no 413/415.
5. **Malware scanning** is not included (SRS 14: "consider before production").
