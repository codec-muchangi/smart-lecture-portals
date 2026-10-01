import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

PHONE_RE = re.compile(r"^\+?[0-9 ()\-]{7,20}$")


def _no_control_chars(v: str) -> str:
    if any(ord(c) < 32 or ord(c) == 127 for c in v):
        raise ValueError("must not contain control characters")
    return v


class ProfileUpdate(BaseModel):
    """Only fields users may change themselves (SRS section 13, Profile).

    Role, email, id and registration/staff numbers are NOT updatable; unknown fields are rejected.
    A null phone/avatar_url clears the value; a null full_name is invalid.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    full_name: str | None = Field(None, min_length=2, max_length=120)
    phone: str | None = Field(None, max_length=32)
    avatar_url: str | None = Field(None, max_length=500)

    @field_validator("full_name", mode="before")
    @classmethod
    def _name(cls, v):
        if v is None:
            raise ValueError("full_name cannot be null")
        return _no_control_chars(v) if isinstance(v, str) else v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        if v is None or v == "":
            return None
        if not PHONE_RE.match(v):
            raise ValueError("must be a valid phone number (digits, spaces, +, -, parentheses; 7-20 chars)")
        return v

    @field_validator("avatar_url")
    @classmethod
    def _avatar(cls, v):
        if v is None or v == "":
            return None
        if not v.startswith("https://"):
            raise ValueError("must be an https:// URL")
        return _no_control_chars(v)


class StudentDetails(BaseModel):
    registration_number: str
    program: str | None = None
    year_of_study: int | None = None
    status: str


class LecturerDetails(BaseModel):
    staff_number: str
    department: str | None = None
    title: str | None = None
    status: str


class ProfileOut(BaseModel):
    id: UUID
    role: str
    full_name: str
    email: str
    phone: str | None = None
    avatar_url: str | None = None
    created_at: datetime
    updated_at: datetime
    details: StudentDetails | LecturerDetails | None = None
