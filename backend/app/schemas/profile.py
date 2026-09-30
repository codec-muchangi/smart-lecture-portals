from pydantic import BaseModel, ConfigDict, Field


class ProfileUpdate(BaseModel):
    """Only fields users may change themselves (SRS section 13, Profile)."""

    model_config = ConfigDict(extra="forbid")
    full_name: str | None = Field(None, min_length=1, max_length=120)
    phone: str | None = Field(None, max_length=32)
    avatar_url: str | None = Field(None, max_length=500)
