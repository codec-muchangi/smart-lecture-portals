"""Tiny but structurally valid files for each supported type."""

import io
import zipfile


def _zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in entries.items():
            zf.writestr(name, content)
    return buf.getvalue()


def pdf() -> bytes:
    return b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def png() -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def jpg() -> bytes:
    return b"\xff\xd8\xff\xe0" + b"\x00" * 32


def csv() -> bytes:
    return b"name,score\nAmy,90\nBob,85\n"


def docx() -> bytes:
    return _zip({"[Content_Types].xml": b"<Types/>", "word/document.xml": b"<w:document/>"})


def pptx() -> bytes:
    return _zip({"[Content_Types].xml": b"<Types/>", "ppt/presentation.xml": b"<p:presentation/>"})


def xlsx() -> bytes:
    return _zip({"[Content_Types].xml": b"<Types/>", "xl/workbook.xml": b"<workbook/>"})


def plain_zip() -> bytes:
    return _zip({"readme.txt": b"hello"})


VALID = {
    "pdf": pdf,
    "png": png,
    "jpg": jpg,
    "jpeg": jpg,
    "csv": csv,
    "docx": docx,
    "pptx": pptx,
    "xlsx": xlsx,
    "zip": plain_zip,
}
WINDOWS_EXE = b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 64
HTML = b"<html><script>alert(1)</script></html>"
