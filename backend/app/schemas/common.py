from typing import Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel, Field

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    page: int
    page_size: int
    total: int


class PageParams(BaseModel):
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=100)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


class CurrentUser(BaseModel):
    id: UUID
    role: str
    full_name: str
    email: str


class DownloadOut(BaseModel):
    """A short-lived signed link to a stored file."""

    url: str
    expires_in: int
    file_name: str
