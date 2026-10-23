from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.utils.files import SUPPORTED_EXTENSIONS


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "test", "staging", "production"] = "development"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    cors_origins: str = "http://localhost:5173"
    max_upload_mb: int = 25
    signed_url_ttl_seconds: int = 120  # how long a download link stays valid
    assignment_max_due_days: int = 366  # a deadline may be at most this far in the future (typo guard)
    allowed_file_extensions: str = "pdf,docx,pptx,xlsx,csv,png,jpg,jpeg,zip"
    password_reset_redirect_url: str = "http://localhost:5173/reset-password"
    login_rate_limit: int = 10  # attempts per window, per client IP
    login_rate_window_seconds: int = 60
    reset_rate_limit: int = 5
    reset_rate_window_seconds: int = 900
    password_change_rate_limit: int = 5  # per signed-in session (stops guessing the current password)
    password_change_rate_window_seconds: int = 900
    upload_rate_limit: int = 30  # file uploads per window, per signed-in session
    upload_rate_window_seconds: int = 60
    report_rate_limit: int = 60  # report requests per window, per signed-in session
    report_rate_window_seconds: int = 60
    max_json_kb: int = 512  # largest accepted non-file request body
    slow_request_seconds: float = 2.0  # SRS NFR-PERF-01: slower requests are logged as warnings
    hsts_max_age_seconds: int = 31536000  # Strict-Transport-Security, production only
    log_level: str = "INFO"
    database_timeout_seconds: int = 15  # a stuck database call fails fast instead of hanging for minutes
    storage_timeout_seconds: int = 60  # file transfers may legitimately take longer

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def max_json_bytes(self) -> int:
        return self.max_json_kb * 1024

    def problems(self) -> list[str]:
        """Configuration mistakes that are dangerous in production (SRS 12, 18.1). Empty list = fine."""
        found: list[str] = []
        if not self.supabase_url.startswith("https://"):
            found.append("SUPABASE_URL must be an https:// URL")
        if not self.supabase_service_role_key:
            found.append("SUPABASE_SERVICE_ROLE_KEY is empty")
        if not self.supabase_anon_key:
            found.append("SUPABASE_ANON_KEY is empty")
        if not self.cors_origin_list:
            found.append("CORS_ORIGINS is empty")
        for origin in self.cors_origin_list:
            if origin == "*":
                found.append("CORS_ORIGINS must list exact origins, not *")
            elif not origin.startswith("https://") or _is_local(origin):
                found.append(f"CORS_ORIGINS entry {origin!r} must be a public https:// origin")
        if not self.password_reset_redirect_url.startswith("https://") or _is_local(
            self.password_reset_redirect_url
        ):
            found.append("PASSWORD_RESET_REDIRECT_URL must be a public https:// URL")
        return found

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def allowed_extensions(self) -> set[str]:
        """Configured list, limited to types the server can actually verify by content."""
        configured = {
            e.strip().lower().lstrip(".") for e in self.allowed_file_extensions.split(",") if e.strip()
        }
        return configured & SUPPORTED_EXTENSIONS


def _is_local(url: str) -> bool:
    host = url.split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0].lower()
    return host in {"localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"} or host.endswith(".local")


@lru_cache
def get_settings() -> Settings:
    return Settings()
