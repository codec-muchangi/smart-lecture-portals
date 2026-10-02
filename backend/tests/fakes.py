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
}


class Result:
    def __init__(self, data, count=None):
        self.data, self.count = data, count


class Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self._op, self._payload = [], "select", None
        self._single, self._limit, self._range, self._count, self._order = False, None, None, None, None

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
        self._order = (col, desc)
        return self

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
        rows = self.db.tables.setdefault(self.table, [])
        if self._op == "insert":
            new = []
            for item in self._payload if isinstance(self._payload, list) else [self._payload]:
                row = (
                    {"id": str(uuid.uuid4()), **item}
                    if "id" not in item and self.table != "profiles"
                    else dict(item)
                )
                self.db.check_unique(self.table, row)
                rows.append(row)
                new.append(copy.deepcopy(row))
            return Result(new)
        if self._op == "update":
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
        if self._order:
            data.sort(key=lambda r: str(r.get(self._order[0])), reverse=self._order[1])
        if self._range:
            data = data[self._range[0] : self._range[1] + 1]
        if self._limit is not None:
            data = data[: self._limit]
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


class Rpc:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        assert self.name == "provision_profile"
        p, snapshot = self.params, copy.deepcopy(self.db.tables)
        try:
            Query(self.db, "profiles").insert(
                {
                    "id": p["p_id"],
                    "role": p["p_role"],
                    "full_name": p["p_full_name"],
                    "email": p["p_email"].lower(),
                    "phone": p.get("p_phone"),
                }
            ).execute()
            if p["p_role"] == "student":
                Query(self.db, "students").insert(
                    {
                        "id": p["p_id"],
                        "registration_number": p["p_registration_number"],
                        "program": p.get("p_program"),
                        "year_of_study": p.get("p_year_of_study"),
                        "status": "active",
                    }
                ).execute()
            else:
                Query(self.db, "lecturers").insert(
                    {
                        "id": p["p_id"],
                        "staff_number": p["p_staff_number"],
                        "department": p.get("p_department"),
                        "title": p.get("p_title"),
                        "status": "active",
                    }
                ).execute()
        except Exception:
            self.db.tables = snapshot  # transaction rollback
            raise
        return Result(None)


class FakeSupabase:
    def __init__(self):
        self.tables, self.auth_users, self.revoked, self.reset_requests = {}, {}, set(), []
        self.auth_down = self.reject_password_updates = False
        self.auth, _ = FakeAuth(self), None

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
