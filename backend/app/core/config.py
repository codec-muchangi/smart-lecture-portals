from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    cors_origins: str = "http://localhost:5173"
    max_upload_mb: int = 25
    allowed_file_extensions: str = "pdf,docx,pptx,xlsx,csv,png,jpg,jpeg,zip"
    password_reset_redirect_url: str = "http://localhost:5173/reset-password"
    login_rate_limit: int = 10  # attempts per window, per client IP
    login_rate_window_seconds: int = 60
    reset_rate_limit: int = 5
    reset_rate_window_seconds: int = 900

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def allowed_extensions(self) -> set[str]:
        return {e.strip().lower() for e in self.allowed_file_extensions.split(",") if e.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
