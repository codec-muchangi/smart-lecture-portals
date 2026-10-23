"""In-memory stand-in for the Supabase client (tables + auth) so business/authorization rules can be
tested without a network or a real database. Mirrors only the calls the app actually makes."""

import copy
import uuid
from types import SimpleNamespace

from supabase import AuthApiError

UNIQUE = {
    "profiles": [("id",), ("email",)],
    "students": [("id",), ("registration_number",)],
    "lecturers": [("id",), ("staff_number",)],
    "courses": [("course_code", "academic_year", "semester")],
    "course_enrollments": [("course_id", "student_id")],
    "course_lecturers": [("course_id", "lecturer_id")],
    "submissions": [("assignment_id", "student_id")],
    "assessment_marks": [("assessment_id", "student_id")],
    "attendance_sessions": [("course_id", "session_date", "start_time")],
    "attendance_records": [("session_id", "student_id")],
}

# Column defaults the real database applies on insert (tables not listed here have none).
TABLE_DEFAULTS = {
    "materials": {"deleted_at": None, "file_removed_at": None, "description": None, "published": True},
    "assignments": {
        "description": None,
        "instructions": None,
        "allow_late": False,
        "published": False,
        "closed": False,
        "attachment_path": None,
    },
    "assessments": {"weight": None, "published": False},
    "attendance_sessions": {"topic": None},
    "announcements": {"published": False, "published_at": None},
    "notifications": {"link": None, "is_read": False, "read_at": None},
    "submissions": {
        "mark": None,
        "feedback": None,
        "grade_released": False,
        "graded_by": None,
        "graded_at": None,
        "status": "submitted",
    },
}


class Result:
    def __init__(self, data, count=None):
        self.data, self.count = data, count


class _Negated:
    """Supports `.not_.is_(col, "null")`."""

    def __init__(self, query):
        self.query = query

    def is_(self, col, val):
        assert val == "null", "fake supports not_.is_(col, 'null') only"
        self.query.filters.append(lambda r: r.get(col) is not None)
        return self.query


class Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self._op, self._payload = [], "select", None
        self._single, self._limit, self._range, self._count, self._order = False, None, None, None, []

    def select(self, cols="*", count=None):
        self._op, self._count = "select", count
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) == str(val))
        return self

    def in_(self, col, vals):
        sv = {str(v) for v in vals}
        self.filters.append(lambda r: str(r.get(col)) in sv)
        return self

    def is_(self, col, val):
        expected = {"null": None, "true": True, "false": False}[val]
        self.filters.append(lambda r: r.get(col) is expected)
        return self

    @property
    def not_(self):
        return _Negated(self)

    def gte(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and str(r.get(col)) >= str(val))
        return self

    def lte(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and str(r.get(col)) <= str(val))
        return self

    def neq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) != str(val))
        return self

    def or_(self, expr):
        """PostgREST or=(col.ilike.%x%,col2.ilike.%x%): only ilike is used by the app."""
        clauses = []
        for part in expr.split(","):
            col, op, val = part.split(".", 2)
            assert op == "ilike", f"fake supports ilike only, got {op}"
            needle = val.strip("%").lower()
            clauses.append(lambda r, col=col, needle=needle: needle in str(r.get(col) or "").lower())
        self.filters.append(lambda r: any(c(r) for c in clauses))
        return self

    def order(self, col, desc=False):
        self._order.append((col, desc))  # chained .order() calls sort by several columns, like PostgREST
        return self

    @staticmethod
    def _sort_key(col):
        """Natural ordering (numbers as numbers, text as text); NULLs sort last like PostgreSQL ascending."""
        return lambda r: (r.get(col) is None, r.get(col) if r.get(col) is not None else 0)

    def limit(self, n):
        self._limit = n
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def single(self):
        self._single = True
        return self

    def insert(self, payload):
        self._op, self._payload = "insert", payload
        return self

    def update(self, payload):
        self._op, self._payload = "update", payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def _matching(self):
        return [r for r in self.db.rows_for(self.table) if all(f(r) for f in self.filters)]

    def execute(self):
        self.db.query_count += 1
        rows = self.db.tables.setdefault(self.table, [])
        if self._op == "insert":
            if self.table in self.db.fail_insert_tables:
                raise Exception(f"simulated database failure on {self.table}")
            new = []
            for item in self._payload if isinstance(self._payload, list) else [self._payload]:
                row = (
                    {"id": str(uuid.uuid4()), **item}
                    if "id" not in item and self.table != "profiles"
                    else dict(item)
                )
                for key, default in self.db.defaults(self.table).items():
                    row.setdefault(key, default)
                self.db.check_unique(self.table, row)
                rows.append(row)
                new.append(copy.deepcopy(row))
            return Result(new)
        if self._op == "update":
            if self.table in self.db.fail_update_tables:
                raise Exception(f"simulated database failure on {self.table}")
            hit = self._matching()
            for r in hit:
                r.update(self._payload)
            return Result(copy.deepcopy(hit))
        if self._op == "delete":
            hit = self._matching()
            self.db.tables[self.table] = [r for r in rows if r not in hit]
            return Result(copy.deepcopy(hit))
        data = copy.deepcopy(self._matching())
        total = len(data)
        for col, desc in reversed(self._order):  # stable sorts, least significant column first
            data.sort(key=self._sort_key(col), reverse=desc)
        if self._range:
            data = data[self._range[0] : self._range[1] + 1]
        if self._limit is not None:
            data = data[: self._limit]
        data = data[: self.db.max_rows]  # PostgREST never returns more than its max-rows setting
        if self._single:
            if not data:
                raise Exception("No rows found")
            return Result(data[0])
        return Result(data, total if self._count else None)


class FakeAuthAdmin:
    def __init__(self, db):
        self.db = db

    def update_user_by_id(self, uid, attrs):
        if self.db.reject_password_updates:
            raise AuthApiError("Password is too weak", 422, "weak_password")
        if self.db.auth_down:
            raise RuntimeError("provider down")
        self.db.auth_users[str(uid)]["password"] = attrs["password"]
        return SimpleNamespace(user=SimpleNamespace(id=str(uid)))

    def sign_out(self, jwt, scope="global"):
        self.db.revoked.add(jwt)

    def create_user(self, attrs):
        uid = str(uuid.uuid4())
        self.db.auth_users[uid] = {"email": attrs["email"], "password": attrs["password"]}
        return SimpleNamespace(user=SimpleNamespace(id=uid, email=attrs["email"]))

    def delete_user(self, uid):
        self.db.auth_users.pop(str(uid), None)


class FakeAuth:
    def __init__(self, db):
        self.db, self.admin = db, FakeAuthAdmin(db)

    def sign_in_with_password(self, creds):
        if self.db.auth_down:
            raise RuntimeError("provider down")
        for uid, u in self.db.auth_users.items():
            if u["email"] == creds["email"] and u["password"] == creds["password"]:
                return SimpleNamespace(
                    session=SimpleNamespace(
                        access_token=f"tok-{uid}", refresh_token=f"ref-{uid}", expires_in=3600
                    ),
                    user=SimpleNamespace(id=uid, email=u["email"]),
                )
        raise AuthApiError("Invalid login credentials", 400, "invalid_credentials")

    def get_user(self, jwt):
        uid = jwt.removeprefix("tok-")
        if not jwt.startswith("tok-") or jwt in self.db.revoked or uid not in self.db.auth_users:
            raise AuthApiError("invalid JWT", 401, "bad_jwt")
        return SimpleNamespace(user=SimpleNamespace(id=uid, email=self.db.auth_users[uid]["email"]))

    def reset_password_for_email(self, email, options=None):
        if self.db.auth_down:
            raise RuntimeError("provider down")
        self.db.reset_requests.append((email, options))


def _rpc_provision_profile(db, p):
    Query(db, "profiles").insert(
        {
            "id": p["p_id"],
            "role": p["p_role"],
            "full_name": p["p_full_name"],
            "email": p["p_email"].lower(),
            "phone": p.get("p_phone"),
        }
    ).execute()
    if p["p_role"] == "student":
        Query(db, "students").insert(
            {
                "id": p["p_id"],
                "registration_number": p["p_registration_number"],
                "program": p.get("p_program"),
                "year_of_study": p.get("p_year_of_study"),
                "status": "active",
            }
        ).execute()
    else:
        Query(db, "lecturers").insert(
            {
                "id": p["p_id"],
                "staff_number": p["p_staff_number"],
                "department": p.get("p_department"),
                "title": p.get("p_title"),
                "status": "active",
            }
        ).execute()


def _audit(db, actor, action, entity_type, entity_id, old, new):
    Query(db, "audit_logs").insert(
        {
            "actor_user_id": actor,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "old_value": old,
            "new_value": new,
        }
    ).execute()


def _rpc_apply_grade(db, p):
    """Mirrors apply_grade() in migration 0007: update + audit row, one transaction."""
    sub = next((s for s in db.tables.get("submissions", []) if s["id"] == p["p_submission"]), None)
    if sub is None:
        raise Exception("submission not found (P0002)")
    old = {k: sub[k] for k in ("status", "mark", "feedback", "grade_released")}
    sub.update(
        status=p["p_status"], mark=p["p_mark"], feedback=p["p_feedback"], grade_released=p["p_release"]
    )
    if p["p_status"] != "graded":
        sub.update(graded_by=None, graded_at=None)
    elif p["p_regrade"]:
        sub.update(graded_by=p["p_actor"], graded_at="2026-10-05T12:00:00+00:00")
    new = {
        "status": p["p_status"],
        "mark": p["p_mark"],
        "feedback": p["p_feedback"],
        "grade_released": p["p_release"],
    }
    _audit(db, p["p_actor"], p["p_action"], "submission", p["p_submission"], old, new)


def _rpc_release_grades(db, p):
    """Mirrors release_grades(): returns the number of rows changed."""
    n = 0
    for s in db.tables.get("submissions", []):
        if (
            s["assignment_id"] == p["p_assignment"]
            and s["status"] == "graded"
            and bool(s["grade_released"]) != p["p_released"]
        ):
            s["grade_released"] = p["p_released"]
            n += 1
    action = "grades.release_all" if p["p_released"] else "grades.hide_all"
    _audit(db, p["p_actor"], action, "assignment", p["p_assignment"], None, {"count": n})
    return n


def _rpc_upsert_assessment_marks(db, p):
    """Mirrors upsert_assessment_marks(): per-row create/update with audit, all or nothing."""
    assessment = next((a for a in db.tables.get("assessments", []) if a["id"] == p["p_assessment"]), None)
    if assessment is None:
        raise Exception("assessment not found (P0002)")
    created = updated = unchanged = 0
    marks = db.tables.setdefault("assessment_marks", [])
    for r in p["p_rows"]:
        enrolled = any(
            e["course_id"] == assessment["course_id"]
            and e["student_id"] == r["student_id"]
            and e["status"] == "active"
            for e in db.tables.get("course_enrollments", [])
        )
        if not enrolled:
            raise Exception("student is not actively enrolled in this course (23514)")
        if float(r["mark"]) > float(assessment["max_marks"]) or float(r["mark"]) < 0:
            raise Exception("mark exceeds max_marks (23514)")
        feedback = r.get("feedback") or None
        existing = next(
            (
                m
                for m in marks
                if m["assessment_id"] == p["p_assessment"] and m["student_id"] == r["student_id"]
            ),
            None,
        )
        new = {"student_id": r["student_id"], "mark": r["mark"], "feedback": feedback}
        if existing is None:
            marks.append(
                {
                    "id": f"m{len(marks) + 1}",
                    "assessment_id": p["p_assessment"],
                    "student_id": r["student_id"],
                    "mark": r["mark"],
                    "feedback": feedback,
                    "entered_by": p["p_actor"],
                    "entered_at": "2026-10-05T12:00:00+00:00",
                    "updated_at": "2026-10-05T12:00:00+00:00",
                }
            )
            _audit(db, p["p_actor"], "mark.create", "assessment", p["p_assessment"], None, new)
            created += 1
        elif existing["mark"] != r["mark"] or existing["feedback"] != feedback:
            old = {"student_id": r["student_id"], "mark": existing["mark"], "feedback": existing["feedback"]}
            existing.update(
                mark=r["mark"],
                feedback=feedback,
                entered_by=p["p_actor"],
                updated_at="2026-10-05T12:30:00+00:00",
            )
            _audit(db, p["p_actor"], "mark.update", "assessment", p["p_assessment"], old, new)
            updated += 1
        else:
            unchanged += 1
    return {"created": created, "updated": updated, "unchanged": unchanged}


def _rpc_upsert_attendance_records(db, p):
    """Mirrors upsert_attendance_records(): per-row create/correct with audit, all or nothing."""
    session = next((x for x in db.tables.get("attendance_sessions", []) if x["id"] == p["p_session"]), None)
    if session is None:
        raise Exception("attendance session not found (P0002)")
    if not any(
        cl["course_id"] == session["course_id"] and cl["lecturer_id"] == p["p_actor"]
        for cl in db.tables.get("course_lecturers", [])
    ):
        raise Exception("attendance may only be marked by a lecturer assigned to this course (23514)")
    created = updated = unchanged = 0
    records = db.tables.setdefault("attendance_records", [])
    for r in p["p_rows"]:
        if r["status"] not in ("present", "absent", "late", "excused"):
            raise Exception(f'invalid input value for enum attendance_status: "{r["status"]}"')
        enrolled = any(
            e["course_id"] == session["course_id"]
            and e["student_id"] == r["student_id"]
            and e["status"] == "active"
            for e in db.tables.get("course_enrollments", [])
        )
        if not enrolled:
            raise Exception("student is not actively enrolled in this course (23514)")
        note = r.get("note") or None
        existing = next(
            (x for x in records if x["session_id"] == p["p_session"] and x["student_id"] == r["student_id"]),
            None,
        )
        new = {"student_id": r["student_id"], "status": r["status"], "note": note}
        if existing is None:
            records.append(
                {
                    "id": f"a{len(records) + 1}",
                    "session_id": p["p_session"],
                    "student_id": r["student_id"],
                    "status": r["status"],
                    "marked_at": "2026-10-05T12:00:00+00:00",
                    "marked_by": p["p_actor"],
                    "note": note,
                }
            )
            _audit(db, p["p_actor"], "attendance.mark", "attendance_session", p["p_session"], None, new)
            created += 1
        elif existing["status"] != r["status"] or existing["note"] != note:
            old = {"student_id": r["student_id"], "status": existing["status"], "note": existing["note"]}
            existing.update(
                status=r["status"], note=note, marked_by=p["p_actor"], marked_at="2026-10-05T12:30:00+00:00"
            )
            _audit(db, p["p_actor"], "attendance.correct", "attendance_session", p["p_session"], old, new)
            updated += 1
        else:
            unchanged += 1
    return {"created": created, "updated": updated, "unchanged": unchanged}


FAKE_NOW = "2026-10-05T12:00:00+00:00"


def _rpc_notify_course_students(db, p):
    """Mirrors notify_course_students(): one notification per ACTIVELY enrolled student."""
    n = 0
    for e in list(db.tables.get("course_enrollments", [])):
        if e["course_id"] == p["p_course"] and e["status"] == "active":
            Query(db, "notifications").insert(
                {
                    "user_id": e["student_id"],
                    "type": p["p_type"],
                    "title": p["p_title"],
                    "message": p["p_message"],
                    "link": p["p_link"],
                }
            ).execute()
            n += 1
    return n


def _rpc_purge_read_notifications(db, p):
    """Mirrors purge_read_notifications(): old READ notifications only, minimum 30 days, one audit row."""
    from datetime import timedelta

    from app.utils import clock

    days = p["p_days"]
    if days is None or days < 30:
        raise Exception("retention must be at least 30 days (22023)")
    cutoff = (clock.utcnow() - timedelta(days=days)).isoformat()
    rows = db.tables.get("notifications", [])
    keep = [r for r in rows if not (r["is_read"] and r["read_at"] < cutoff)]
    deleted = len(rows) - len(keep)
    db.tables["notifications"] = keep
    db.tables.setdefault("audit_logs", []).append(
        {
            "actor_user_id": None,
            "action": "notifications.purge",
            "entity_type": "notifications",
            "entity_id": None,
            "old_value": None,
            "new_value": {"older_than_days": days, "deleted": deleted},
        }
    )
    return deleted


def _assigned(db, course_id, lecturer_id):
    return any(
        cl["course_id"] == course_id and cl["lecturer_id"] == lecturer_id
        for cl in db.tables.get("course_lecturers", [])
    )


def _announcement_notice(db, a):
    return _rpc_notify_course_students(
        db,
        {
            "p_course": a["course_id"],
            "p_type": "announcement",
            "p_title": "New announcement: " + a["title"],
            "p_message": a["body"][:200],
            "p_link": "/student/courses/" + a["course_id"],
        },
    )


def _rpc_create_announcement(db, p):
    """Mirrors create_announcement(): row + audit + (when published) notifications, one transaction."""
    if not _assigned(db, p["p_course"], p["p_actor"]):
        raise Exception("author is not assigned to this course (23514)")
    row = (
        Query(db, "announcements")
        .insert(
            {
                "course_id": p["p_course"],
                "title": p["p_title"],
                "body": p["p_body"],
                "published": p["p_publish"],
                "published_at": FAKE_NOW if p["p_publish"] else None,
                "created_by": p["p_actor"],
            }
        )
        .execute()
        .data[0]
    )
    action = "announcement.publish" if p["p_publish"] else "announcement.create"
    new = {"course_id": p["p_course"], "title": p["p_title"], "published": p["p_publish"]}
    _audit(db, p["p_actor"], action, "announcement", row["id"], None, new)
    n = _announcement_notice(db, row) if p["p_publish"] else 0
    return {"announcement": row, "notified": n}


def _rpc_update_announcement(db, p):
    """Mirrors update_announcement(): changes + audit + first-publication notifications."""
    row = next((a for a in db.tables.get("announcements", []) if a["id"] == p["p_id"]), None)
    if row is None:
        raise Exception("announcement not found (P0002)")
    if not _assigned(db, row["course_id"], p["p_actor"]):
        raise Exception("author is not assigned to this course (23514)")
    old_v, new_v, action = {}, {}, "announcement.update"
    for key in ("title", "body", "published"):
        if key in p["p_changes"] and p["p_changes"][key] != row[key]:
            old_v[key], new_v[key] = row[key], p["p_changes"][key]
    if "published" in new_v:
        action = "announcement.publish" if new_v["published"] else "announcement.unpublish"
    if not new_v:
        return {"announcement": dict(row), "notified": 0}
    first_publish = new_v.get("published") is True and row["published_at"] is None
    row.update(new_v)
    row["updated_at"] = "2026-10-05T12:30:00+00:00"
    if first_publish:
        row["published_at"] = FAKE_NOW
    _audit(db, p["p_actor"], action, "announcement", row["id"], old_v, new_v)
    n = _announcement_notice(db, row) if first_publish else 0
    return {"announcement": dict(row), "notified": n}


RPC_HANDLERS = {
    "provision_profile": _rpc_provision_profile,
    "apply_grade": _rpc_apply_grade,
    "release_grades": _rpc_release_grades,
    "upsert_assessment_marks": _rpc_upsert_assessment_marks,
    "upsert_attendance_records": _rpc_upsert_attendance_records,
    "notify_course_students": _rpc_notify_course_students,
    "create_announcement": _rpc_create_announcement,
    "update_announcement": _rpc_update_announcement,
    "purge_read_notifications": _rpc_purge_read_notifications,
}


class Rpc:
    """A database function call. Like a real transaction, a failure anywhere (including the simulated
    `fail_rpc_after` hook, which fires AFTER the work was done) rolls every change back."""

    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        self.db.query_count += 1
        snapshot = copy.deepcopy(self.db.tables)
        try:
            result = RPC_HANDLERS[self.name](self.db, self.params)
            if self.name in self.db.fail_rpc_after:
                raise Exception(f"simulated failure inside {self.name}")
        except Exception:
            self.db.tables = snapshot  # transaction rollback
            raise
        return Result(result)


class FakeBucket:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def upload(self, path, file, file_options=None):
        if self.db.storage_fail_upload:
            raise Exception("simulated storage outage")
        key = (self.name, path)
        if key in self.db.objects:
            raise Exception("The resource already exists")
        self.db.objects[key] = {"data": bytes(file), "content_type": (file_options or {}).get("content-type")}

    def remove(self, paths):
        if self.db.storage_fail_remove:
            raise Exception("simulated storage outage")
        for p in paths:
            self.db.objects.pop((self.name, p), None)

    def create_signed_url(self, path, expires_in, options=None):
        if (self.name, path) not in self.db.objects:
            raise Exception("Object not found")
        url = f"https://storage.test/{self.name}/{path}?token=t&expires={expires_in}"
        if (options or {}).get("download"):
            url += f"&download={options['download']}"
        self.db.signed_urls.append((self.name, path, expires_in))
        return {"signedURL": url, "signedUrl": url}


class FakeStorage:
    def __init__(self, db):
        self.db = db

    def from_(self, name):
        return FakeBucket(self.db, name)


class FakeSupabase:
    def __init__(self):
        self.tables, self.auth_users, self.revoked, self.reset_requests = {}, {}, set(), []
        self.auth_down = self.reject_password_updates = False
        self.auth = FakeAuth(self)
        self.storage = FakeStorage(self)
        self.objects, self.signed_urls = {}, []  # stored files: {(bucket, path): {data, content_type}}
        self.storage_fail_upload = self.storage_fail_remove = False
        self.fail_insert_tables: set[str] = set()
        self.fail_update_tables: set[str] = set()
        self.fail_rpc_after: set[str] = set()
        self.max_rows = 1000  # Supabase's default API row cap
        self.query_count = 0  # every table query and rpc, for the "no N+1" performance smoke tests
        self._clock = 0

    def defaults(self, table):
        """Column defaults the real database would apply on insert."""
        if table not in TABLE_DEFAULTS:
            return {}
        self._clock += 1
        stamp = f"2026-09-01T00:{self._clock // 60:02d}:{self._clock % 60:02d}+00:00"  # strictly increasing
        return {"created_at": stamp, "updated_at": stamp, **TABLE_DEFAULTS[table]}

    def table(self, name):
        return Query(self, name)

    def rows_for(self, name):
        if name == "v_course_roster":  # mirrors the SQL view in migration 0004
            students = {r["id"]: r for r in self.tables.get("students", [])}
            profiles = {r["id"]: r for r in self.tables.get("profiles", [])}
            return [
                {
                    "course_id": e["course_id"],
                    "student_id": e["student_id"],
                    "enrollment_status": e["status"],
                    "enrolled_at": e.get("enrolled_at", "2026-09-01T00:00:00+00:00"),
                    "registration_number": students[e["student_id"]]["registration_number"],
                    "program": students[e["student_id"]]["program"],
                    "year_of_study": students[e["student_id"]]["year_of_study"],
                    "full_name": profiles[e["student_id"]]["full_name"],
                    "email": profiles[e["student_id"]]["email"],
                }
                for e in self.tables.get("course_enrollments", [])
                if e["student_id"] in students and e["student_id"] in profiles
            ]
        if name == "v_submission_overview":  # mirrors the SQL view in migration 0006
            students = {r["id"]: r for r in self.tables.get("students", [])}
            profiles = {r["id"]: r for r in self.tables.get("profiles", [])}
            return [
                {
                    **{k: v for k, v in sub.items() if k != "storage_path"},
                    "registration_number": students[sub["student_id"]]["registration_number"],
                    "full_name": profiles[sub["student_id"]]["full_name"],
                    "email": profiles[sub["student_id"]]["email"],
                }
                for sub in self.tables.get("submissions", [])
                if sub["student_id"] in students and sub["student_id"] in profiles
            ]
        return self.tables.setdefault(name, [])

    def rpc(self, name, params):
        return Rpc(self, name, params)

    def check_unique(self, table, row):
        for cols in UNIQUE.get(table, []):
            for existing in self.tables.get(table, []):
                if all(existing.get(c) is not None and str(existing.get(c)) == str(row.get(c)) for c in cols):
                    raise Exception(
                        f"duplicate key value violates unique constraint on {table}{cols} (23505)"
                    )

    def audit(self, action=None):
        rows = self.tables.get("audit_logs", [])
        return [r for r in rows if action is None or r["action"] == action]
