"""Upload safety helpers (SRS 4.5 FR-MAT-04, 12, 14): filename sanitising and content verification.

The server never trusts the client's filename extension or Content-Type. A file is accepted only if its
extension is on the allow-list AND its leading bytes / internal structure match that extension.
Verification is pure Python (no libmagic), so it behaves identically on Windows, Linux and CI.
"""

import io
import re
import unicodedata
import zipfile

MIME_BY_EXT: dict[str, str] = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv": "text/csv",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "zip": "application/zip",
}
SUPPORTED_EXTENSIONS = frozenset(MIME_BY_EXT)

_OOXML_PART = {"docx": "word/", "pptx": "ppt/", "xlsx": "xl/"}
_PNG = b"\x89PNG\r\n\x1a\n"
_JPEG = b"\xff\xd8\xff"
_ZIP = b"PK\x03\x04"
_CSV_FORBIDDEN = bytes(set(range(32)) - {9, 10, 13})  # control bytes that never occur in real text files
_NON_SAFE = re.compile(r"[^A-Za-z0-9_-]+")


def split_extension(filename: str) -> str:
    """Lower-case extension without the dot ('' if none)."""
    _, dot, ext = filename.rpartition(".")
    return ext.lower() if dot else ""


def sanitize_filename(name: str | None, max_len: int = 100) -> str:
    """Return a storage- and URL-safe file name.

    Keeps only A-Z a-z 0-9 _ - in the stem and a lower-case alphanumeric extension, so the result can never
    contain path separators, dots (no hidden double extensions), spaces, '&', quotes or control characters.
    """
    base = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode("ascii")
    base = re.split(r"[\\/]", base)[-1]  # drop any client-supplied path, e.g. ../../x.pdf
    stem, dot, ext = base.rpartition(".")
    if not dot:
        stem, ext = base, ""
    ext = re.sub(r"[^a-z0-9]", "", ext.lower())[:10]
    stem = _NON_SAFE.sub("_", stem).strip("_-")
    stem = (stem or "file")[: max(1, max_len - len(ext) - 1)].strip("_-") or "file"
    return f"{stem}.{ext}" if ext else stem


def _zip_names(data: bytes) -> list[str] | None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:  # reads only the central directory
            return zf.namelist()
    except (zipfile.BadZipFile, ValueError, RuntimeError, NotImplementedError):
        return None


def content_matches_extension(ext: str, data: bytes) -> bool:
    """True when `data` really is the kind of file `ext` claims."""
    if ext == "pdf":
        return b"%PDF-" in data[:1024]
    if ext == "png":
        return data.startswith(_PNG)
    if ext in ("jpg", "jpeg"):
        return data.startswith(_JPEG)
    if ext == "zip":
        return data.startswith(_ZIP) and _zip_names(data) is not None
    if ext in _OOXML_PART:
        names = _zip_names(data) if data.startswith(_ZIP) else None
        return (
            names is not None
            and "[Content_Types].xml" in names
            and any(n.startswith(_OOXML_PART[ext]) for n in names)
        )
    if ext == "csv":
        sample = data[:65536]
        return len(sample.translate(None, _CSV_FORBIDDEN)) == len(sample)
    return False
