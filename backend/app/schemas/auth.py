import re
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _check_email(v: str) -> str:
    """Shape check only. EmailStr is avoided on purpose: it rejects special-use domains such as
    .test, which our demo accounts use. The auth provider is the authority on whether an account exists."""
    v = v.strip().lower()
    if len(v) > 254 or not _EMAIL_RE.match(v):
        raise ValueError("must be a valid email address")
    return v


Email = Annotated[str, AfterValidator(_check_email)]


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    email: Email
    password: str = Field(min_length=1, max_length=128)


class LoginUser(BaseModel):
    id: UUID
    role: str
    full_name: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: LoginUser


class PasswordChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=256)  # real rules live in password_policy


class PasswordResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    email: Email
