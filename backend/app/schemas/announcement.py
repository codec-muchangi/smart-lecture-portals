from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

TITLE_MAX = 200
BODY_MAX = 5000


class AnnouncementCreate(BaseModel):
    """FR-NOT-01: title and body are required (SRS 9.2). `published` defaults to false (a draft the
    lecturer can finish later); publishing notifies the enrolled students (FR-NOT-03)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=TITLE_MAX)
    body: str = Field(min_length=1, max_length=BODY_MAX)
    published: StrictBool = False


class AnnouncementUpdate(BaseModel):
    """Any subset of the editable fields; none can be null."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str | None = Field(None, min_length=1, max_length=TITLE_MAX)
    body: str | None = Field(None, min_length=1, max_length=BODY_MAX)
    published: StrictBool | None = None

    @field_validator("title", "body", "published", mode="before")
    @classmethod
    def _not_null(cls, v):
        if v is None:
            raise ValueError("cannot be null")
        return v


class AnnouncementOut(BaseModel):
    id: UUID
    course_id: UUID
    title: str
    body: str
    published: bool
    published_at: datetime | None = None
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    notified: int | None = None  # create/edit responses only: students notified by this call


class NotificationOut(BaseModel):
    id: UUID
    type: str
    title: str
    message: str
    link: str | None = None
    is_read: bool
    created_at: datetime
    read_at: datetime | None = None


class ReadAllResult(BaseModel):
    updated: int
