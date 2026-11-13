# User guide (SRS 21: user guide)

Who can do what in the Smart Lecture Portal, and the rules the system enforces for you. There are two roles:
**students** and **lecturers**. There is no administrator role in version 1.0: accounts, courses and
enrolments are set up by the institution's technical staff with the scripts in `docs/OPERATIONS.md`.

> **About the screens.** The backend is complete and tested; the browser pages are built in the front-end
> phase (planned screens and routes: `docs/FRONTEND.md`). This guide therefore describes each task in plain
> words **and** names the matching operation in `docs/API.md`, so it stays correct when the pages arrive:
> every page task is exactly one of these operations.

## Everyone
| Task | What to know | Operation |
|---|---|---|
| Sign in | Use the e-mail and password you were given. There is no self-registration. Too many wrong attempts pause sign-in for a minute | `POST /auth/login` |
| Sign out | Your session stops working immediately | `POST /auth/logout` |
| See and edit my profile | You can change your name, phone and picture link; role, e-mail and registration/staff number are fixed | `GET`/`PATCH /me` |
| Change my password | Needs the current password. New password: at least 8 characters with a letter and a digit | `POST /auth/password/change` |
| Forgot my password | Enter your e-mail. The reply is always the same, so nobody can find out which e-mails exist. Follow the link in the message | `POST /auth/password/reset` |
| Read my notifications | New announcements, assignments, materials, released marks and grades. Mark one or all as read | `GET /notifications`, `PATCH /notifications/{id}/read`, `POST /notifications/read-all` |
| See my timetable | Classes of your active courses only | `GET /timetable` |
| Home overview | A dashboard built from live records, only your own active courses | `GET /dashboard` |

## Students
| Task | Rules the system applies | Operation |
|---|---|---|
| See my courses and course details | Only courses you are enrolled in. Archived courses are hidden from the dashboard | `GET /courses`, `GET /courses/{id}` |
| Read and download course materials | Published materials of your courses only. Downloads are time-limited links (about 2 minutes): request a new one if it expires | `GET /courses/{id}/materials`, `GET /materials/{id}/download` |
| See assignments | Published assignments of your courses. A lecturer's attached brief downloads the same way | `GET /courses/{id}/assignments`, `GET /assignments/{id}` |
| Submit an assignment | One file per assignment; allowed types pdf, docx, pptx, xlsx, csv, png, jpg, zip; maximum size 25 MB; the file's content must match its type. Before the deadline (after it only if the lecturer allowed late work). You can replace your file until it is graded | `POST /assignments/{id}/submissions` |
| See my submission and grade | Mark and feedback appear **only after the lecturer releases them** | `GET /assignments/{id}/submissions/me` |
| See my marks | Only published assessments, with the weighted course total | `GET /courses/{id}/marks/me` |
| See my attendance | Your own records and percentage (present and late count as attended; excused sessions are not counted) | `GET /courses/{id}/attendance/me` |
| Read announcements | Published announcements of your courses | `GET /courses/{id}/announcements` |

You can never see another student's marks, submissions or attendance, or another course's private materials.
Asking for them looks the same as asking for something that does not exist.

## Lecturers
| Task | Rules the system applies | Operation |
|---|---|---|
| See my courses and student list | Only courses assigned to you. The list shows actively enrolled students (filter withdrawn/completed) | `GET /courses`, `GET /courses/{id}/students` |
| Edit a course description | Description only; code, name, credits and period are managed by the institution | `PATCH /courses/{id}` |
| Upload and manage materials | Same file rules as above; draft (unpublished) materials are hidden from students; deleting hides the material and removes the file | `POST /courses/{id}/materials`, `PATCH`/`DELETE /materials/{id}` |
| Create an assignment | Title, deadline, maximum marks, optional late submissions and attachment; publish when ready (students are notified); close to stop submissions | `POST /courses/{id}/assignments`, `PATCH /assignments/{id}`, `PUT /assignments/{id}/attachment` |
| Review submissions | See who submitted, late, graded; download any submission of your course | `GET /assignments/{id}/submissions`, `GET /submissions/{id}/download` |
| Grade work | Mark from 0 to the assignment maximum, with feedback; or return for revision. Students see nothing until you release | `PATCH /submissions/{id}/grade`, `POST /assignments/{id}/grades/release` |
| Record assessment marks (CAT, exam...) | Create the assessment, enter marks for the whole class in one save: **all or nothing**, so one invalid row changes nothing. A mark above the maximum is rejected. Publish when students may see them | `POST /courses/{id}/assessments`, `PUT /assessments/{id}/marks`, `PATCH /assessments/{id}` |
| Take attendance | Create a lecture session, then mark each enrolled student present, absent, late or excused in one save. Corrections are recorded in the audit log | `POST /courses/{id}/attendance/sessions`, `POST /attendance/sessions/{id}/records` |
| Publish announcements | Students are notified when it is first published | `POST /courses/{id}/announcements`, `PATCH /announcements/{id}` |
| Reports | Attendance, submissions and performance per course; totals always equal the underlying records | `GET /courses/{id}/reports/attendance`, `/submissions`, `/performance` |

You can only work with courses assigned to you; anything else behaves as if it does not exist.

## Messages you may see
Every refusal explains itself in `message`, with a stable `code` and field `details` (`docs/API.md`,
conventions). The common ones:

| You see | Meaning | What to do |
|---|---|---|
| 401 `UNAUTHENTICATED` | Not signed in, or the session ended | Sign in again |
| 403 `FORBIDDEN` | Your role may not do this | Use the account that may |
| 404 `NOT_FOUND` | Does not exist, or is not yours | Check the course/item |
| 422 `VALIDATION_ERROR` | A field is wrong; `details` names it | Correct the field |
| 429 `RATE_LIMITED` | Too many attempts | Wait for the time shown in `Retry-After` |
| 503 | The service is busy or starting | Try again in a minute; quote the `request_id` if it persists |

## Privacy
Personal data (names, e-mails, marks, attendance) is visible only to the people who need it for teaching, is
never written to the logs, and every change to marks, attendance, grades and profiles is kept in an audit log.
Exports for backup are kept private by the operators (`docs/OPERATIONS.md`).
