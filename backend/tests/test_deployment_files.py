"""Phase 10: static checks on the deployment files (SRS 12, 18, 19): no secrets baked in, safe defaults."""

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = (ROOT / "backend/Dockerfile").read_text(encoding="utf-8")
RENDER = (ROOT / "render.yaml").read_text(encoding="utf-8")
SECRET_NAMES = ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_URL", "CORS_ORIGINS")


def test_image_runs_as_a_non_root_user():
    users = re.findall(r"^USER\s+(\S+)", DOCKERFILE, flags=re.M)
    assert users and users[-1] not in {"root", "0"}


def test_image_has_a_healthcheck_on_the_health_endpoint():
    assert "HEALTHCHECK" in DOCKERFILE and "/health" in DOCKERFILE


def test_image_base_is_pinned_to_a_version():
    base = re.search(r"^FROM\s+(\S+)", DOCKERFILE, flags=re.M).group(1)
    assert ":" in base and not base.endswith(":latest")


def test_image_bakes_in_no_secrets_and_no_env_files():
    for name in SECRET_NAMES:
        assert name not in DOCKERFILE, f"{name} must arrive at run time, not in the image"
    assert not re.search(r"^\s*(COPY|ADD)\s+.*\.env", DOCKERFILE, flags=re.M)


def test_image_uses_one_worker_and_trusts_the_platform_proxy():
    assert "--workers" not in DOCKERFILE  # the rate limiter is per process
    assert "--proxy-headers" in DOCKERFILE and "FORWARDED_ALLOW_IPS" in DOCKERFILE


def test_image_installs_only_production_requirements():
    assert "requirements.txt" in DOCKERFILE and "requirements-dev" not in DOCKERFILE


def test_dockerignore_keeps_secrets_and_tests_out_of_the_image():
    lines = (ROOT / "backend/.dockerignore").read_text(encoding="utf-8").split()
    assert {".env", ".env.*", "tests/"} <= set(lines)


def test_render_blueprint_deploys_only_after_ci_passes():
    assert re.search(r"^\s*autoDeployTrigger:\s*checksPass", RENDER, flags=re.M)
    assert "dockerfilePath: ./backend/Dockerfile" in RENDER and "dockerContext: ./backend" in RENDER
    assert re.search(r"healthCheckPath:\s*/health\b", RENDER)


def test_render_blueprint_holds_no_secret_values():
    blocks = re.findall(r"- key: (\w+)\n\s+(\w+): ?(.*)", RENDER)
    keys = {key: (field, value) for key, field, value in blocks}
    assert keys["ENVIRONMENT"] == ("value", "production")
    for name in (*SECRET_NAMES, "PASSWORD_RESET_REDIRECT_URL"):
        assert keys[name][0] == "sync" and keys[name][1].strip() == "false", name
    assert "eyJ" not in RENDER and "sb_secret" not in RENDER


def test_every_setting_the_blueprint_needs_exists_in_env_example():
    example = (ROOT / "backend/.env.example").read_text(encoding="utf-8")
    for key in re.findall(r"- key: (\w+)", RENDER):
        assert re.search(rf"^{key}=", example, flags=re.M), key


def test_vercel_config_is_valid_json_with_the_spa_rewrite_and_headers():
    config = json.loads((ROOT / "frontend/vercel.json").read_text(encoding="utf-8"))
    assert {"source": "/(.*)", "destination": "/index.html"} in config["rewrites"]
    names = {h["key"] for rule in config["headers"] for h in rule["headers"]}
    assert {"X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"} <= names


def test_netlify_style_redirect_file_exists():
    assert "/index.html" in (ROOT / "frontend/public/_redirects").read_text(encoding="utf-8")


def test_backups_and_env_files_are_git_ignored():
    ignore = (ROOT / ".gitignore").read_text(encoding="utf-8").split()
    assert "backups/" in ignore and ".env" in ignore and "!.env.example" in ignore


@pytest.mark.parametrize("name", ["ci.yml", "deploy.yml"])
def test_workflows_build_the_container_image(name):
    text = (ROOT / ".github/workflows" / name).read_text(encoding="utf-8")
    assert "docker build" in text


def test_the_image_check_is_part_of_the_required_ci_gate():
    ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    gate = ci.split("ci-passed:", 1)[1]
    assert "backend-image" in gate


def test_dependabot_watches_the_dockerfile():
    assert "package-ecosystem: docker" in (ROOT / ".github/dependabot.yml").read_text(encoding="utf-8")
