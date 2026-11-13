"""Pre-flight check of your PRODUCTION settings, before you deploy (SRS 12, 18.1). It never starts the
server, never contacts Supabase and never prints a secret value.

Run from the backend folder with the venv active:
  cd backend
  python ../scripts/check_production_env.py --env-file .env.production   # a file you keep OUT of Git
  python ../scripts/check_production_env.py                              # or check this shell's variables

(`.env.production` is ignored by .gitignore. Never commit it.)
It applies the same rules the API enforces at start-up, plus checks the API cannot make: that the
service-role key really is a service key, that the anon key is not the service key, and so on.
Exit status 0 = ready to deploy, 1 = fix the listed problems.
"""

import argparse
import base64
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))

from pydantic import ValidationError  # noqa: E402

from app.core.config import Settings  # noqa: E402


def parse_env_file(text: str) -> dict[str, str]:
    """KEY=VALUE lines. Comments, blank lines, `export`, quotes and trailing ` # comment` are handled."""
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] in {'"', "'"} and value.endswith(value[0]):
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].strip()
        values[key.strip().upper()] = value
    return values


def key_kind(value: str) -> str:
    """Recognise a Supabase key without printing it: service_role, anon, secret, publishable or unknown."""
    if value.startswith("sb_secret_"):
        return "secret"
    if value.startswith("sb_publishable_"):
        return "publishable"
    parts = value.split(".")
    if len(parts) == 3:
        try:
            payload = parts[1] + "=" * (-len(parts[1]) % 4)
            role = json.loads(base64.urlsafe_b64decode(payload)).get("role")
        except (ValueError, TypeError, AttributeError):
            return "unknown"
        return role if role in {"service_role", "anon"} else "unknown"
    return "unknown"


def build_settings(values: dict[str, str]) -> Settings:
    """Settings built ONLY from `values` (the shell's own variables are set aside while doing it)."""
    names = {name.upper() for name in Settings.model_fields}
    saved = {key: os.environ.pop(key) for key in names if key in os.environ}
    try:
        os.environ.update({k: v for k, v in values.items() if k in names})
        return Settings(_env_file=None)
    finally:
        for key in names:
            os.environ.pop(key, None)
        os.environ.update(saved)


def check(values: dict[str, str]) -> tuple[list[str], list[str]]:
    """Returns (problems, warnings). Problems block the deployment."""
    problems: list[str] = []
    warnings: list[str] = []
    try:
        settings = build_settings(values)
    except ValidationError as exc:
        found = [f"{'.'.join(str(p) for p in e['loc']).upper()}: {e['msg']}" for e in exc.errors()]
        return found, warnings
    if settings.environment != "production":
        problems.append("ENVIRONMENT must be production (it switches the safety rules on)")
    problems += settings.problems()

    service, anon = values.get("SUPABASE_SERVICE_ROLE_KEY", ""), values.get("SUPABASE_ANON_KEY", "")
    if service and service == anon:
        problems.append("SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are identical")
    service_kind = key_kind(service) if service else ""
    anon_kind = key_kind(anon) if anon else ""
    if service_kind in {"anon", "publishable"}:
        problems.append("SUPABASE_SERVICE_ROLE_KEY holds an anon/publishable key: use the service_role key")
    if anon_kind in {"service_role", "secret"}:
        problems.append("SUPABASE_ANON_KEY holds a service_role/secret key: it must be the anon key")
    if service_kind == "unknown":
        warnings.append("SUPABASE_SERVICE_ROLE_KEY has an unrecognised format: double-check it in Supabase")
    if anon_kind == "unknown":
        warnings.append("SUPABASE_ANON_KEY has an unrecognised format: double-check it in Supabase")

    if settings.slow_request_seconds > 5:
        warnings.append("SLOW_REQUEST_SECONDS is above 5: the SRS target is under 2 seconds")
    if settings.max_upload_mb > 50:
        warnings.append("MAX_UPLOAD_MB is above 50: large uploads are slow and costly")
    if settings.log_level.upper() == "DEBUG":
        warnings.append("LOG_LEVEL=DEBUG is noisy in production: use INFO")
    return problems, warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check production settings before deploying.")
    parser.add_argument("--env-file", help="a KEY=VALUE file (kept out of Git); default: shell variables")
    args = parser.parse_args(argv)
    if args.env_file:
        path = Path(args.env_file)
        if not path.is_file():
            print(f"File not found: {path}")
            return 1
        values = parse_env_file(path.read_text(encoding="utf-8"))
        print(f"Checking {path.name} ({len(values)} settings read; values are never shown)")
    else:
        values = {k.upper(): v for k, v in os.environ.items()}
        print("Checking this shell's environment variables (values are never shown)")
    problems, warnings = check(values)
    for item in problems:
        print(f"  [PROBLEM] {item}")
    for item in warnings:
        print(f"  [warning] {item}")
    if problems:
        print(f"NOT READY: {len(problems)} problem(s) to fix before deploying.")
        return 1
    extra = f" ({len(warnings)} warning(s))" if warnings else ""
    print("READY: the production settings pass every check." + extra)
    return 0


if __name__ == "__main__":
    sys.exit(main())
