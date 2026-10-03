from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

MaterialCategory = Literal["lecture_notes", "slides", "reading", "lab", "past_paper", "other"]
TITLE_MIN, TITLE_MAX, DESCRIPTION_MAX = 2, 200, 2000


class MaterialOut(BaseModel):
    """Public view of a material. The internal storage path is deliberately NOT exposed."""

    id: UUID
    course_id: UUID
    title: str
    description: str | None = None
    category: str
    file_name: str
    mime_type: str
    file_size: int
    published: bool
    uploaded_by: UUID
    uploader_name: str | None = None
    created_at: datetime
    updated_at: datetime


class DownloadOut(BaseModel):
    url: str
    expires_in: int
    file_name: str


class MaterialUpdate(BaseModel):
    """Editable metadata only. File name/path/size/type, course and uploader are fixed at upload.
    description may be null/blank (clears it); title, category and published may not be null."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str | None = Field(None, min_length=TITLE_MIN, max_length=TITLE_MAX)
    description: str | None = Field(None, max_length=DESCRIPTION_MAX)
    category: MaterialCategory | None = None
    published: bool | None = None

    @field_validator("title", "category", "published", mode="before")
    @classmethod
    def _not_null(cls, v):
        if v is None:
            raise ValueError("cannot be null")
        return v

    @field_validator("description")
    @classmethod
    def _blank_to_none(cls, v):
        return v or None
