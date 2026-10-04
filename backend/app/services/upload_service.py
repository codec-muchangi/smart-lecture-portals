"""One place that decides whether an uploaded file is acceptable.

Used by materials, assignment attachments and student submissions, so the rules (SRS 14) cannot drift apart.
"""

from dataclasses import dataclass
from typing import BinaryIO

from app.core.config import get_settings
from app.core.errors import FileTooLarge, FileTypeNotAllowed, ValidationFailed
from app.utils.files import MIME_BY_EXT, content_matches_extension, sanitize_filename, split_extension


@dataclass(frozen=True)
class ValidatedUpload:
    data: bytes
    safe_name: str
    extension: str
    mime_type: str


def read_and_validate(file_obj: BinaryIO, original_name: str | None) -> ValidatedUpload:
    """Return the verified file, or raise FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE / VALIDATION_ERROR (400).

    Order matters: the cheap extension check runs before any bytes are read, and at most limit+1 are read.
    """
    settings = get_settings()
    allowed = sorted(settings.allowed_extensions)
    safe_name = sanitize_filename(original_name)
    ext = split_extension(safe_name)
    if ext not in settings.allowed_extensions:
        raise FileTypeNotAllowed("This file type is not allowed", {"allowed_types": allowed})
    data = file_obj.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise FileTooLarge(
            f"File is larger than {settings.max_upload_mb} MB", {"max_mb": settings.max_upload_mb}
        )
    if not data:
        raise ValidationFailed("The uploaded file is empty", {"file": "Empty file"})
    if not content_matches_extension(ext, data):
        raise FileTypeNotAllowed(
            "The file content does not match its type",
            {"allowed_types": allowed, "file": f"Not a valid .{ext} file"},
        )
    return ValidatedUpload(data, safe_name, ext, MIME_BY_EXT[ext])
