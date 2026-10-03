import pytest

from app.core.config import Settings
from app.utils import files
from tests import file_samples as samples


# ---------- sanitize_filename ----------
@pytest.mark.parametrize(
    "raw,expected",
    [
        ("notes.pdf", "notes.pdf"),
        ("../../etc/passwd.pdf", "passwd.pdf"),
        ("..\\..\\win\\system.xlsx", "system.xlsx"),
        ("/abs/path/lecture 1 (final).PDF", "lecture_1_final.pdf"),
        ("résumé.docx", "resume.docx"),
        ("a&b=c?d.png", "a_b_c_d.png"),
        ("evil.pdf.exe", "evil_pdf.exe"),
        ("report.final.v2.pdf", "report_final_v2.pdf"),
        ("my\x00file.pdf", "my_file.pdf"),
        ("   spaced   .csv", "spaced.csv"),
        ("noextension", "noextension"),
        ("", "file"),
        (None, "file"),
        ("日本語.pdf", "file.pdf"),
        ("___.pdf", "file.pdf"),
    ],
)
def test_sanitize_filename(raw, expected):
    assert files.sanitize_filename(raw) == expected


def test_sanitized_names_are_storage_and_url_safe():
    for raw in ["a b&c=d?e#f%g'h\"i<j>k.pdf", "x" * 400 + ".pdf", "../../..", "CON.pdf", "\n\r\t.zip"]:
        out = files.sanitize_filename(raw)
        assert len(out) <= 100
        assert all(c.isalnum() or c in "_-." for c in out), out
        assert "/" not in out and "\\" not in out and ".." not in out and not out.startswith(".")


def test_long_name_keeps_its_extension():
    assert files.sanitize_filename("x" * 400 + ".pdf").endswith(".pdf")


def test_split_extension():
    assert files.split_extension("a.PDF") == "pdf"
    assert files.split_extension("archive.tar.gz") == "gz"
    assert files.split_extension("noext") == ""


# ---------- content verification ----------
@pytest.mark.parametrize("ext", sorted(files.SUPPORTED_EXTENSIONS))
def test_valid_sample_matches_its_own_extension(ext):
    assert files.content_matches_extension(ext, samples.VALID[ext]()) is True


@pytest.mark.parametrize(
    "ext,data",
    [
        ("pdf", samples.WINDOWS_EXE),
        ("pdf", samples.HTML),
        ("pdf", samples.png()),
        ("png", samples.jpg()),
        ("png", samples.pdf()),
        ("jpg", samples.png()),
        ("jpeg", samples.pdf()),
        ("docx", samples.plain_zip()),  # a zip, but not a Word document
        ("docx", samples.xlsx()),  # wrong Office type
        ("xlsx", samples.docx()),
        ("pptx", samples.docx()),
        ("docx", samples.pdf()),
        ("docx", b"PK\x03\x04 this is not really a zip"),
        ("zip", samples.pdf()),
        ("zip", b"PK\x03\x04 truncated"),
        ("zip", b"PK\x05\x06" + b"\x00" * 18),  # valid but empty archive
        ("csv", samples.WINDOWS_EXE),
        ("csv", b"a,b\n\x00\x01\x02"),
        ("csv", samples.png()),
        ("exe", samples.WINDOWS_EXE),  # unknown extension never matches
    ],
)
def test_disguised_or_corrupt_files_are_rejected(ext, data):
    assert files.content_matches_extension(ext, data) is False


def test_pdf_with_leading_junk_is_still_accepted():
    assert files.content_matches_extension("pdf", b"\n\n" + samples.pdf()) is True


def test_csv_with_utf8_bom_and_tabs_is_accepted():
    assert files.content_matches_extension("csv", b"\xef\xbb\xbfa\tb\r\n1\t2\r\n") is True


def test_mime_types_are_server_defined_for_every_supported_extension():
    assert set(files.MIME_BY_EXT) == files.SUPPORTED_EXTENSIONS
    assert files.MIME_BY_EXT["jpg"] == files.MIME_BY_EXT["jpeg"] == "image/jpeg"


# ---------- configuration ----------
def test_default_allowed_types_are_the_srs_defaults():
    assert Settings(_env_file=None).allowed_extensions == {
        "pdf",
        "docx",
        "pptx",
        "xlsx",
        "csv",
        "png",
        "jpg",
        "jpeg",
        "zip",
    }
    assert Settings(_env_file=None).max_upload_mb == 25


def test_configured_list_cannot_enable_unverifiable_types():
    s = Settings(_env_file=None, allowed_file_extensions=".PDF, exe, html ,svg, png")
    assert s.allowed_extensions == {"pdf", "png"}
