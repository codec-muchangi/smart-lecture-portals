"""Phase 10: the deployment helper scripts (preflight, smoke test, backup export) are tested like app code."""

import base64
import importlib.util
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from tests.conftest import COURSE_A, PASSWORD
from tests.fakes import FakeSupabase

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"


def load(name: str):
    spec = importlib.util.spec_from_file_location(f"ops_{name}", SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


preflight = load("check_production_env")
smoke_mod = load("smoke_test")
backup = load("backup_data")


def fake_jwt(role: str) -> str:
    """Built at run time so no key-shaped literal sits in the repository (the secret scan would flag it)."""

    def part(obj) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    return ".".join([part({"alg": "HS256"}), part({"role": role}), "c2ln"])


def good_values(**over) -> dict:
    values = {
        "ENVIRONMENT": "production",
        "SUPABASE_URL": "https://abc.supabase.co",
        "SUPABASE_ANON_KEY": fake_jwt("anon"),
        "SUPABASE_SERVICE_ROLE_KEY": fake_jwt("service_role"),
        "CORS_ORIGINS": "https://portal.example.edu",
        "PASSWORD_RESET_REDIRECT_URL": "https://portal.example.edu/reset-password",
    }
    values.update(over)
    return values


# ---------------------------------------------------------------- check_production_env


def test_env_file_parser_handles_comments_quotes_and_inline_notes():
    text = "# note\n\nA=1\nexport B='two words'\nC=\"x\"  \nD=value   # trailing\nE=\nnot a pair\n"
    assert preflight.parse_env_file(text) == {"A": "1", "B": "two words", "C": "x", "D": "value", "E": ""}


def test_key_kinds_are_recognised_without_exposing_them():
    assert preflight.key_kind(fake_jwt("service_role")) == "service_role"
    assert preflight.key_kind(fake_jwt("anon")) == "anon"
    assert preflight.key_kind("sb_secret_abc") == "secret"
    assert preflight.key_kind("sb_publishable_abc") == "publishable"
    assert preflight.key_kind("plain") == "unknown"
    assert preflight.key_kind("a.b.c") == "unknown"
    assert preflight.key_kind(fake_jwt("other")) == "unknown"


def test_a_correct_production_configuration_is_ready():
    problems, warnings = preflight.check(good_values())
    assert problems == [] and warnings == []


@pytest.mark.parametrize(
    ("over", "needle"),
    [
        ({"ENVIRONMENT": "staging"}, "ENVIRONMENT must be production"),
        ({"CORS_ORIGINS": "*"}, "not *"),
        ({"CORS_ORIGINS": "http://localhost:5173"}, "CORS_ORIGINS entry"),
        ({"SUPABASE_URL": "http://abc.supabase.co"}, "SUPABASE_URL"),
        ({"PASSWORD_RESET_REDIRECT_URL": "http://localhost:5173/x"}, "PASSWORD_RESET_REDIRECT_URL"),
        ({"SUPABASE_SERVICE_ROLE_KEY": ""}, "SERVICE_ROLE_KEY is empty"),
        ({"SUPABASE_SERVICE_ROLE_KEY": fake_jwt("anon")}, "holds an anon"),
        ({"SUPABASE_ANON_KEY": fake_jwt("service_role")}, "holds a service_role"),
        ({"ENVIRONMENT": "prod"}, "ENVIRONMENT"),
    ],
)
def test_unsafe_configurations_are_reported(over, needle):
    problems, _ = preflight.check(good_values(**over))
    assert any(needle in p for p in problems), problems


def test_identical_keys_are_a_problem():
    key = fake_jwt("service_role")
    problems, _ = preflight.check(good_values(SUPABASE_ANON_KEY=key, SUPABASE_SERVICE_ROLE_KEY=key))
    assert any("identical" in p for p in problems)


def test_unknown_key_formats_and_loose_limits_only_warn():
    values = good_values(
        SUPABASE_ANON_KEY="odd", SUPABASE_SERVICE_ROLE_KEY="odd2", LOG_LEVEL="DEBUG", MAX_UPLOAD_MB="80"
    )
    problems, warnings = preflight.check(values)
    assert problems == []
    assert len(warnings) == 4


def test_the_checker_ignores_the_shells_own_settings(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "*")  # must not leak into the checked configuration
    problems, _ = preflight.check(good_values())
    assert problems == []
    import os

    assert os.environ["CORS_ORIGINS"] == "*"  # and is restored afterwards


def test_preflight_cli_exit_codes_and_no_secret_output(tmp_path, capsys):
    secret = fake_jwt("service_role")
    path = tmp_path / "prod.env"
    path.write_text("\n".join(f"{k}={v}" for k, v in good_values().items()), encoding="utf-8")
    assert preflight.main(["--env-file", str(path)]) == 0
    out = capsys.readouterr().out
    assert "READY" in out and secret not in out

    path.write_text("\n".join(f"{k}={v}" for k, v in good_values(CORS_ORIGINS="*").items()), encoding="utf-8")
    assert preflight.main(["--env-file", str(path)]) == 1
    out = capsys.readouterr().out
    assert "NOT READY" in out and secret not in out

    assert preflight.main(["--env-file", str(tmp_path / "missing.env")]) == 1


def test_preflight_can_read_the_process_environment(monkeypatch, capsys):
    for key, value in good_values().items():
        monkeypatch.setenv(key, value)
    assert preflight.main([]) == 0
    assert "READY" in capsys.readouterr().out


# ---------------------------------------------------------------- smoke_test


@pytest.fixture
def local_fetch(client, db):
    """The smoke test's network call, answered in-process by the real app on the fake database."""

    def fetch(method, url, headers=None, body=None):
        r = client.request(method, url, headers=headers or {}, json=body)
        return smoke_mod.Reply(r.status_code, {k.lower(): v for k, v in r.headers.items()}, r.content)

    return fetch


def run_smoke(fetch, *extra):
    return smoke_mod.main(["--api", "http://testserver", *extra], fetch=fetch)


def test_smoke_public_checks_pass_against_the_real_app(local_fetch, capsys):
    assert run_smoke(local_fetch, "--frontend-origin", "http://localhost:5173") == 0
    out = capsys.readouterr().out
    assert "SMOKE TEST PASSED" in out and "FAIL" not in out


def test_smoke_full_journeys_pass_for_the_demo_accounts(local_fetch, monkeypatch, capsys):
    monkeypatch.setenv("SMOKE_STUDENT_PASSWORD", PASSWORD)
    monkeypatch.setenv("SMOKE_LECTURER_PASSWORD", PASSWORD)
    code = run_smoke(
        local_fetch, "--student-email", "student@demo.test", "--lecturer-email", "lecturer@demo.test"
    )
    out = capsys.readouterr().out
    assert code == 0, out
    for label in ("AT-01 student can log in", "AT-02 lecturer can log in", "AT-03 student cannot open"):
        assert label in out


def test_smoke_reports_a_failed_login_and_stops_that_journey(local_fetch, monkeypatch, capsys):
    monkeypatch.setenv("SMOKE_STUDENT_PASSWORD", "wrong-Password-1")
    assert run_smoke(local_fetch, "--student-email", "student@demo.test") == 1
    out = capsys.readouterr().out
    assert "[FAIL] AT-01 student can log in" in out and "SMOKE TEST FAILED" in out
    assert "dashboard" not in out


def test_smoke_a_student_that_can_read_a_lecturer_report_fails(monkeypatch, capsys):
    def leaky(method, url, headers=None, body=None):
        path = url.split("testserver", 1)[1]
        if path == "/api/v1/auth/login":
            return smoke_mod.Reply(
                200, {}, json.dumps({"access_token": "t", "user": {"role": "student"}}).encode()
            )
        if path == "/api/v1/courses":
            return smoke_mod.Reply(200, {}, json.dumps({"items": [{"id": COURSE_A}]}).encode())
        return smoke_mod.Reply(200, {}, b"{}")

    monkeypatch.setenv("SMOKE_STUDENT_PASSWORD", "x")
    smoke = smoke_mod.Smoke("http://testserver", leaky, None, False, out=lambda *_: None)
    smoke.run_student("s@x.test", "x")
    assert smoke.failures >= 1


def test_smoke_production_expectations_detect_published_docs_and_missing_hsts(local_fetch, capsys):
    # The test environment publishes /docs and sends no HSTS: exactly what --expect-production must catch.
    assert run_smoke(local_fetch, "--expect-production") == 1
    out = capsys.readouterr().out
    assert "[FAIL] HSTS is sent in production" in out
    assert "[FAIL] /docs is not published in production" in out


def test_smoke_requires_https_away_from_localhost(capsys):
    def dead(method, url, headers=None, body=None):
        return smoke_mod.Reply(503, {}, b"")

    assert smoke_mod.main(["--api", "http://api.example.com"], fetch=dead) == 1
    assert "[FAIL] API address uses HTTPS" in capsys.readouterr().out


def test_smoke_cors_check_fails_for_an_unlisted_front_end(local_fetch, capsys):
    assert run_smoke(local_fetch, "--frontend-origin", "https://not-allowed.example") == 1
    assert "[FAIL] CORS allows the front-end origin" in capsys.readouterr().out


def test_reply_json_tolerates_a_non_json_body():
    assert smoke_mod.Reply(200, {}, b"<html>").json() is None
    assert smoke_mod.Reply(200, {}, b"").json() is None


def test_http_fetch_returns_error_statuses_instead_of_raising(monkeypatch):
    import io
    import urllib.error

    def boom(request, timeout):
        raise urllib.error.HTTPError(request.full_url, 404, "nf", {"X-A": "b"}, io.BytesIO(b"{}"))

    monkeypatch.setattr(smoke_mod.urllib.request, "urlopen", boom)
    reply = smoke_mod.http_fetch(1)("GET", "http://x.test/y")
    assert reply.status == 404 and reply.headers == {"x-a": "b"}


# ---------------------------------------------------------------- backup_data


def test_backup_tables_match_the_migrations():
    import re

    sql = "\n".join(
        p.read_text(encoding="utf-8") for p in sorted((SCRIPTS.parent / "db/migrations").glob("*.sql"))
    )
    created = set(re.findall(r"create table (?:if not exists )?(?:public\.)?(\w+)", sql, flags=re.I))
    assert set(backup.TABLES) == created
    assert len(backup.TABLES) == len(created) == 17


def test_backup_writes_every_table_with_a_manifest(db, tmp_path):
    now = datetime(2026, 11, 1, 3, 0, tzinfo=UTC)
    result = backup.export_all(db, tmp_path, now=now)
    folder = tmp_path / "20261101T030000Z"
    assert result["path"] == str(folder)
    for table in backup.TABLES:
        assert (folder / f"{table}.jsonl").is_file()
    manifest = json.loads((folder / "manifest.json").read_text())
    assert manifest["total_rows"] == sum(manifest["rows"].values()) > 0
    lines = (folder / "profiles.jsonl").read_text().splitlines()
    assert len(lines) == manifest["rows"]["profiles"] == len(db.tables["profiles"])
    assert {json.loads(line)["email"] for line in lines} >= {"student@demo.test", "lecturer@demo.test"}


def test_backup_never_truncates_at_1000_rows(tmp_path):
    fake = FakeSupabase()
    fake.tables["notifications"] = [{"id": f"{i:05d}", "title": f"n{i}"} for i in range(2500)]
    result = backup.export_all(fake, tmp_path)
    assert result["rows"]["notifications"] == 2500
    folder = Path(result["path"])
    assert len((folder / "notifications.jsonl").read_text().splitlines()) == 2500


def test_backup_refuses_to_overwrite_an_existing_backup(db, tmp_path):
    now = datetime(2026, 11, 1, tzinfo=UTC)
    backup.export_all(db, tmp_path, now=now)
    with pytest.raises(FileExistsError):
        backup.export_all(db, tmp_path, now=now)


def test_backup_cli_prints_a_summary(db, tmp_path, capsys):
    assert backup.main(["--out", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "Backup written to" in out and "TOTAL" in out and "personal data" in out
