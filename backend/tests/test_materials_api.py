"""Phase 3: FR-MAT-01..05, FR-LEC-04, FR-STU-04, NFR-SEC-03, AT-15, AT-16."""

import pytest

from app.core.config import get_settings
from tests import file_samples as samples
from tests.conftest import COURSE_A, COURSE_B, L1, S1, S2, add_student, bearer, make_material

BASE = f"/api/v1/courses/{COURSE_A}/materials"


def upload(
    client, who=L1, course=COURSE_A, name="notes.pdf", data=None, content_type="application/pdf", **fields
):
    data = samples.pdf() if data is None else data
    form = {"title": "Week 1 Notes", **fields}
    return client.post(
        f"/api/v1/courses/{course}/materials",
        headers=bearer(who),
        data=form,
        files={"file": (name, data, content_type)},
    )


def rows(db):
    return db.tables.get("materials", [])


def set_course_status(db, course_id, status):
    next(c for c in db.tables["courses"] if c["id"] == course_id)["status"] = status


# =============================== upload ===============================
def test_lecturer_uploads_pdf(client, db):
    r = upload(client, description="Intro slides", category="slides")
    assert r.status_code == 201
    m = r.json()
    assert m["title"] == "Week 1 Notes" and m["description"] == "Intro slides" and m["category"] == "slides"
    assert m["file_name"] == "notes.pdf" and m["mime_type"] == "application/pdf"
    assert m["file_size"] == len(samples.pdf()) and m["published"] is True
    assert m["uploaded_by"] == L1 and m["uploader_name"] == "Demo Lecturer" and m["course_id"] == COURSE_A
    assert "storage_path" not in m  # internal path is never exposed


def test_file_lands_in_private_materials_bucket_at_srs_path(client, db):
    m = upload(client).json()
    key = ("materials", f"{COURSE_A}/{m['id']}/notes.pdf")  # SRS 14: {course_id}/{material_id}/{filename}
    assert key in db.objects
    assert db.objects[key]["data"] == samples.pdf() and db.objects[key]["content_type"] == "application/pdf"
    assert rows(db)[0]["storage_path"] == key[1] and rows(db)[0]["uploaded_by"] == L1


def test_upload_is_audited_without_file_content(client, db):
    m = upload(client).json()
    log = db.audit("material.create")
    assert len(log) == 1 and log[0]["actor_user_id"] == L1 and log[0]["entity_id"] == m["id"]
    assert log[0]["new_value"]["file_name"] == "notes.pdf"


def test_defaults_are_published_and_other_category(client, db):
    m = upload(client).json()
    assert m["published"] is True and m["category"] == "other" and m["description"] is None


def test_can_upload_as_draft(client, db):
    assert upload(client, published="false").json()["published"] is False


@pytest.mark.parametrize("ext", ["pdf", "docx", "pptx", "xlsx", "csv", "png", "jpg", "jpeg", "zip"])
def test_every_default_type_is_accepted_and_gets_a_server_side_mime(client, db, ext):
    r = upload(client, name=f"file.{ext}", data=samples.VALID[ext](), content_type="application/octet-stream")
    assert r.status_code == 201, r.text
    from app.utils.files import MIME_BY_EXT

    assert r.json()["mime_type"] == MIME_BY_EXT[ext]  # client Content-Type is ignored
    assert db.objects[("materials", rows(db)[-1]["storage_path"])]["content_type"] == MIME_BY_EXT[ext]


def test_unsafe_client_filename_cannot_escape_its_folder(client, db):
    m = upload(client, name="../../other_course/evil name (1).PDF").json()
    assert m["file_name"] == "evil_name_1.pdf"
    path = rows(db)[0]["storage_path"]
    assert path == f"{COURSE_A}/{m['id']}/evil_name_1.pdf" and ".." not in path


def test_title_and_description_are_trimmed(client, db):
    m = upload(client, title="  Padded Title  ", description="   ").json()
    assert m["title"] == "Padded Title" and m["description"] is None


# ---------- upload rejections ----------
@pytest.mark.parametrize(
    "name,data",
    [
        ("virus.exe", samples.WINDOWS_EXE),
        ("page.html", samples.HTML),
        ("image.svg", b"<svg onload='alert(1)'/>"),
        ("old.doc", samples.docx()),
        ("noextension", samples.pdf()),
        ("archive.tar.gz", samples.plain_zip()),
        ("evil.pdf.exe", samples.pdf()),
    ],
)
def test_disallowed_types_are_rejected_with_the_allowed_list(client, db, name, data):
    r = upload(client, name=name, data=data)
    assert r.status_code == 400 and r.json()["code"] == "FILE_TYPE_NOT_ALLOWED"
    assert "pdf" in r.json()["details"]["allowed_types"]
    assert rows(db) == [] and db.objects == {}


@pytest.mark.parametrize(
    "name,data",
    [
        ("fake.pdf", samples.WINDOWS_EXE),
        ("fake.pdf", samples.HTML),
        ("fake.png", samples.pdf()),
        ("fake.jpg", samples.png()),
        ("fake.docx", samples.plain_zip()),
        ("fake.xlsx", samples.docx()),
        ("fake.zip", b"not a zip"),
        ("fake.csv", samples.WINDOWS_EXE),
    ],
)
def test_files_disguised_with_a_valid_extension_are_rejected(client, db, name, data):
    r = upload(client, name=name, data=data)
    assert r.status_code == 400 and r.json()["code"] == "FILE_TYPE_NOT_ALLOWED"
    assert rows(db) == [] and db.objects == {} and db.audit("material.create") == []


def test_empty_file_is_rejected(client, db):
    r = upload(client, data=b"")
    assert r.status_code == 400 and r.json()["code"] == "VALIDATION_ERROR"
    assert rows(db) == []


def test_file_over_the_limit_is_rejected_after_reading(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    r = upload(client, data=samples.pdf() + b"0" * (1024 * 1024))  # 1 MB + a few bytes
    assert (
        r.status_code == 400 and r.json()["code"] == "FILE_TOO_LARGE" and r.json()["details"]["max_mb"] == 1
    )
    assert rows(db) == [] and db.objects == {}


def test_file_exactly_at_the_limit_is_accepted(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    data = samples.pdf()
    data += b"0" * (1024 * 1024 - len(data))
    assert upload(client, data=data).status_code == 201


def test_huge_request_is_stopped_before_it_is_read(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    r = upload(client, data=samples.pdf() + b"0" * (3 * 1024 * 1024))  # 3 MB > 1 MB limit + 1 MB overhead
    assert r.status_code == 400 and r.json()["code"] == "FILE_TOO_LARGE"
    assert rows(db) == [] and db.objects == {}


def test_configured_type_list_is_honoured(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "allowed_file_extensions", "pdf")
    assert upload(client, name="a.png", data=samples.png()).status_code == 400
    assert upload(client).status_code == 201


@pytest.mark.parametrize(
    "fields,status",
    [
        ({"title": ""}, 422),
        ({"title": "x" * 201}, 422),
        ({"title": "   "}, 400),
        ({"title": "A"}, 400),
        ({"category": "homework"}, 422),
        ({"description": "x" * 2001}, 422),
        ({"published": "maybe"}, 422),
    ],
)
def test_invalid_metadata_is_rejected_and_nothing_is_stored(client, db, fields, status):
    r = upload(client, **fields)
    assert r.status_code == status, r.text
    assert rows(db) == [] and db.objects == {}


def test_missing_file_or_title_is_422(client, db):
    assert client.post(BASE, headers=bearer(L1), data={"title": "No file"}).status_code == 422
    r = client.post(BASE, headers=bearer(L1), files={"file": ("a.pdf", samples.pdf(), "application/pdf")})
    assert r.status_code == 422


# ---------- upload authorization (AT-03/04 style) ----------
def test_student_cannot_upload(client, db):
    assert upload(client, who=S1).status_code == 403
    assert rows(db) == [] and db.objects == {}


def test_anonymous_cannot_upload(client, db):
    r = client.post(BASE, data={"title": "x y"}, files={"file": ("a.pdf", samples.pdf(), "application/pdf")})
    assert r.status_code == 401


def test_lecturer_cannot_upload_to_unassigned_course(client, db):
    r = upload(client, course=COURSE_B)
    assert r.status_code == 404 and rows(db) == [] and db.objects == {}


@pytest.mark.parametrize("status", ["archived", "inactive"])
def test_cannot_upload_to_a_non_active_course(client, db, status):
    set_course_status(db, COURSE_A, status)
    r = upload(client)
    assert r.status_code == 409 and r.json()["code"] == "CONFLICT"
    assert rows(db) == [] and db.objects == {}


# ---------- upload failure handling ----------
def test_database_failure_removes_the_stored_file(client, db):
    db.fail_insert_tables.add("materials")
    r = upload(client)
    assert r.status_code == 500 and r.json()["code"] == "INTERNAL_ERROR"
    assert "simulated" not in r.text  # internals are not leaked
    assert db.objects == {} and rows(db) == [] and db.audit("material.create") == []


def test_storage_outage_returns_503_and_saves_nothing(client, db):
    db.storage_fail_upload = True
    r = upload(client)
    assert r.status_code == 503 and r.json()["code"] == "SERVICE_UNAVAILABLE"
    assert rows(db) == [] and db.audit("material.create") == []


# =============================== list ===============================
def test_lecturer_sees_drafts_student_sees_only_published(client, db):
    make_material(db, title="Published", published=True)
    make_material(db, title="Draft", published=False)
    lec = client.get(BASE, headers=bearer(L1)).json()
    stu = client.get(BASE, headers=bearer(S1)).json()
    assert {m["title"] for m in lec["items"]} == {"Published", "Draft"} and lec["total"] == 2
    assert [m["title"] for m in stu["items"]] == ["Published"] and stu["total"] == 1


def test_list_hides_deleted_and_never_exposes_storage_paths(client, db):
    make_material(db, title="Live")
    make_material(db, title="Gone", deleted=True)
    body = client.get(BASE, headers=bearer(L1)).json()
    assert [m["title"] for m in body["items"]] == ["Live"]
    assert "storage_path" not in body["items"][0] and "deleted_at" not in body["items"][0]


def test_list_is_newest_first_with_pagination_and_uploader_name(client, db):
    for n in range(3):
        make_material(db, title=f"Item {n}")
    p1 = client.get(f"{BASE}?page=1&page_size=2", headers=bearer(L1)).json()
    p2 = client.get(f"{BASE}?page=2&page_size=2", headers=bearer(L1)).json()
    assert p1["total"] == 3 and [m["title"] for m in p1["items"]] == ["Item 2", "Item 1"]
    assert [m["title"] for m in p2["items"]] == ["Item 0"]
    assert p1["items"][0]["uploader_name"] == "Demo Lecturer"


def test_search_and_category_filter(client, db):
    make_material(db, title="Networking Basics", category="lecture_notes")
    make_material(db, title="Lab Sheet 1", category="lab")
    assert [m["title"] for m in client.get(f"{BASE}?q=networking", headers=bearer(S1)).json()["items"]] == [
        "Networking Basics"
    ]
    assert [m["title"] for m in client.get(f"{BASE}?category=lab", headers=bearer(S1)).json()["items"]] == [
        "Lab Sheet 1"
    ]
    assert (
        client.get(f"{BASE}?q=zzz,id.neq.0", headers=bearer(S1)).json()["total"] == 0
    )  # filter injection stripped


@pytest.mark.parametrize("qs", ["category=homework", "page=0", "page_size=101"])
def test_bad_list_params_are_422(client, db, qs):
    assert client.get(f"{BASE}?{qs}", headers=bearer(L1)).status_code == 422


def test_materials_of_one_course_never_appear_in_another(client, db):
    make_material(db, course_id=COURSE_B, title="Other course")
    assert client.get(BASE, headers=bearer(L1)).json()["total"] == 0


def test_list_access_rules_AT16(client, db):
    assert client.get(BASE).status_code == 401
    assert (
        client.get(f"/api/v1/courses/{COURSE_B}/materials", headers=bearer(S1)).status_code == 404
    )  # not enrolled
    assert (
        client.get(f"/api/v1/courses/{COURSE_B}/materials", headers=bearer(L1)).status_code == 404
    )  # not assigned
    assert client.get(BASE, headers=bearer(S2)).status_code == 404  # student with no enrollment


def test_inactive_course_materials_hidden_from_students_but_archived_stay_readable(client, db):
    make_material(db)
    set_course_status(db, COURSE_A, "archived")
    assert client.get(BASE, headers=bearer(S1)).json()["total"] == 1
    set_course_status(db, COURSE_A, "inactive")
    assert client.get(BASE, headers=bearer(S1)).status_code == 404
    assert client.get(BASE, headers=bearer(L1)).status_code == 200


def test_withdrawn_student_loses_access(client, db):
    make_material(db)
    db.tables["course_enrollments"][0]["status"] = "withdrawn"
    assert client.get(BASE, headers=bearer(S1)).status_code == 404


# =============================== download ===============================
def test_student_downloads_via_short_lived_signed_url_AT15(client, db):
    m = make_material(db, file_name="week_1.pdf")
    r = client.get(f"/api/v1/materials/{m['id']}/download", headers=bearer(S1))
    assert r.status_code == 200
    body = r.json()
    assert body["expires_in"] == get_settings().signed_url_ttl_seconds == 120
    assert body["file_name"] == "week_1.pdf"
    assert body["url"].startswith("https://storage.test/materials/") and "download=week_1.pdf" in body["url"]
    assert db.signed_urls == [("materials", m["storage_path"], 120)]


def test_signed_url_lifetime_is_configurable(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "signed_url_ttl_seconds", 30)
    m = make_material(db)
    assert client.get(f"/api/v1/materials/{m['id']}/download", headers=bearer(S1)).json()["expires_in"] == 30


def test_lecturer_can_download_drafts_but_students_cannot(client, db):
    m = make_material(db, published=False)
    assert client.get(f"/api/v1/materials/{m['id']}/download", headers=bearer(L1)).status_code == 200
    r = client.get(f"/api/v1/materials/{m['id']}/download", headers=bearer(S1))
    assert r.status_code == 404 and db.signed_urls == [
        ("materials", m["storage_path"], 120)
    ]  # only the lecturer's


def test_no_url_is_issued_without_authorization_AT16(client, db):
    m = make_material(db, course_id=COURSE_B)
    url = f"/api/v1/materials/{m['id']}/download"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=bearer(S1)).status_code == 404  # student not enrolled in B
    assert client.get(url, headers=bearer(L1)).status_code == 404  # lecturer not assigned to B
    assert db.signed_urls == []


def test_withdrawn_or_unenrolled_student_cannot_download(client, db):
    m = make_material(db)
    assert client.get(f"/api/v1/materials/{m['id']}/download", headers=bearer(S2)).status_code == 404
    db.tables["course_enrollments"][0]["status"] = "withdrawn"
    assert client.get(f"/api/v1/materials/{m['id']}/download", headers=bearer(S1)).status_code == 404


def test_deleted_unknown_and_malformed_ids(client, db):
    gone = make_material(db, deleted=True)
    assert client.get(f"/api/v1/materials/{gone['id']}/download", headers=bearer(L1)).status_code == 404
    assert (
        client.get(
            "/api/v1/materials/00000000-0000-0000-0000-00000000ffff/download", headers=bearer(L1)
        ).status_code
        == 404
    )
    assert client.get("/api/v1/materials/not-a-uuid/download", headers=bearer(L1)).status_code == 422


def test_missing_stored_file_is_404_and_storage_outage_is_503(client, db):
    m = make_material(db, with_object=False)
    r = client.get(f"/api/v1/materials/{m['id']}/download", headers=bearer(S1))
    assert r.status_code == 404 and r.json()["message"] == "The file is no longer available"


def test_archived_course_materials_remain_downloadable(client, db):
    m = make_material(db)
    set_course_status(db, COURSE_A, "archived")
    assert client.get(f"/api/v1/materials/{m['id']}/download", headers=bearer(S1)).status_code == 200


# =============================== update ===============================
def test_lecturer_updates_metadata_and_it_is_audited(client, db):
    m = make_material(db, title="Old Title", published=False)
    r = client.patch(
        f"/api/v1/materials/{m['id']}",
        headers=bearer(L1),
        json={"title": "  New Title ", "category": "reading", "published": True, "description": "Chapter 2"},
    )
    assert r.status_code == 200
    body = r.json()
    assert (body["title"], body["category"], body["published"], body["description"]) == (
        "New Title",
        "reading",
        True,
        "Chapter 2",
    )
    log = db.audit("material.update")[0]
    assert log["old_value"]["title"] == "Old Title" and log["new_value"]["title"] == "New Title"
    assert log["old_value"]["published"] is False and log["new_value"]["published"] is True


def test_unpublishing_hides_the_material_from_students_immediately(client, db):
    m = make_material(db)
    client.patch(f"/api/v1/materials/{m['id']}", headers=bearer(L1), json={"published": False})
    assert client.get(BASE, headers=bearer(S1)).json()["total"] == 0
    assert client.get(f"/api/v1/materials/{m['id']}/download", headers=bearer(S1)).status_code == 404


def test_no_op_and_blank_description_behaviour(client, db):
    m = make_material(db, title="Same")
    client.patch(f"/api/v1/materials/{m['id']}", headers=bearer(L1), json={"title": "Same"})
    assert db.audit("material.update") == []
    client.patch(f"/api/v1/materials/{m['id']}", headers=bearer(L1), json={"description": "x"})
    r = client.patch(f"/api/v1/materials/{m['id']}", headers=bearer(L1), json={"description": "  "})
    assert r.json()["description"] is None


@pytest.mark.parametrize(
    "payload",
    [
        {"file_name": "x.pdf"},
        {"storage_path": "a/b"},
        {"course_id": COURSE_B},
        {"uploaded_by": S1},
        {"mime_type": "text/html"},
        {"file_size": 1},
        {"id": "x"},
        {"deleted_at": "2026-01-01"},
    ],
)
def test_file_identity_and_ownership_cannot_be_edited(client, db, payload):
    m = make_material(db)
    before = dict(rows(db)[0])
    assert client.patch(f"/api/v1/materials/{m['id']}", headers=bearer(L1), json=payload).status_code == 422
    assert rows(db)[0] == before


@pytest.mark.parametrize(
    "payload,status",
    [
        ({}, 400),
        ({"title": None}, 422),
        ({"title": "A"}, 422),
        ({"category": None}, 422),
        ({"category": "x"}, 422),
        ({"published": None}, 422),
        ({"description": "x" * 2001}, 422),
    ],
)
def test_invalid_updates(client, db, payload, status):
    m = make_material(db)
    assert (
        client.patch(f"/api/v1/materials/{m['id']}", headers=bearer(L1), json=payload).status_code == status
    )


def test_update_authorization_and_read_only_courses(client, db):
    m = make_material(db)
    other = make_material(db, course_id=COURSE_B)
    url = f"/api/v1/materials/{m['id']}"
    assert client.patch(url, json={"title": "Hacked"}).status_code == 401
    assert client.patch(url, headers=bearer(S1), json={"title": "Hacked"}).status_code == 403
    assert (
        client.patch(
            f"/api/v1/materials/{other['id']}", headers=bearer(L1), json={"title": "Hacked"}
        ).status_code
        == 404
    )
    assert (
        client.patch(
            "/api/v1/materials/00000000-0000-0000-0000-00000000ffff",
            headers=bearer(L1),
            json={"title": "Hacked"},
        ).status_code
        == 404
    )
    set_course_status(db, COURSE_A, "archived")
    assert client.patch(url, headers=bearer(L1), json={"title": "Too late"}).status_code == 409
    assert rows(db)[0]["title"] == "Week 1 Notes"


# =============================== delete ===============================
def test_delete_soft_deletes_row_removes_file_and_audits(client, db):
    m = make_material(db)
    assert client.delete(f"/api/v1/materials/{m['id']}", headers=bearer(L1)).status_code == 204
    row = rows(db)[0]
    assert row["deleted_at"] is not None and row["published"] is False and row["file_removed_at"] is not None
    assert db.objects == {}  # stored file is gone
    log = db.audit("material.delete")[0]
    assert log["new_value"] == {"storage_removed": True} and log["old_value"]["title"] == "Week 1 Notes"


def test_deleted_material_disappears_everywhere_and_cannot_be_deleted_twice(client, db):
    m = make_material(db)
    url = f"/api/v1/materials/{m['id']}"
    client.delete(url, headers=bearer(L1))
    assert client.get(BASE, headers=bearer(L1)).json()["total"] == 0
    assert client.get(f"{url}/download", headers=bearer(L1)).status_code == 404
    assert client.delete(url, headers=bearer(L1)).status_code == 404
    assert client.patch(url, headers=bearer(L1), json={"title": "Zombie"}).status_code == 404


def test_delete_authorization_and_read_only_courses(client, db):
    m = make_material(db)
    other = make_material(db, course_id=COURSE_B)
    url = f"/api/v1/materials/{m['id']}"
    assert client.delete(url).status_code == 401
    assert client.delete(url, headers=bearer(S1)).status_code == 403
    assert client.delete(f"/api/v1/materials/{other['id']}", headers=bearer(L1)).status_code == 404
    set_course_status(db, COURSE_A, "archived")
    assert client.delete(url, headers=bearer(L1)).status_code == 409
    assert rows(db)[0]["deleted_at"] is None and len(db.objects) == 2  # nothing changed


def test_other_students_materials_are_unaffected_by_a_delete(client, db):
    keep, drop = make_material(db, title="Keep"), make_material(db, title="Drop")
    client.delete(f"/api/v1/materials/{drop['id']}", headers=bearer(L1))
    assert [m["title"] for m in client.get(BASE, headers=bearer(S1)).json()["items"]] == ["Keep"]
    assert ("materials", keep["storage_path"]) in db.objects


# ---------- retention: failed file removal is recoverable ----------
def test_failed_file_removal_keeps_the_delete_and_is_retried(client, db):
    from app.services import material_service

    m = make_material(db)
    db.storage_fail_remove = True
    assert client.delete(f"/api/v1/materials/{m['id']}", headers=bearer(L1)).status_code == 204
    row = rows(db)[0]
    assert row["deleted_at"] is not None and row["file_removed_at"] is None  # pending
    assert ("materials", m["storage_path"]) in db.objects
    assert db.audit("material.delete")[0]["new_value"] == {"storage_removed": False}
    assert client.get(BASE, headers=bearer(L1)).json()["total"] == 0  # already invisible

    assert material_service.purge_removed_files() == (0, 1)  # storage still down
    db.storage_fail_remove = False
    assert material_service.purge_removed_files() == (1, 0)
    assert db.objects == {} and rows(db)[0]["file_removed_at"] is not None
    assert material_service.purge_removed_files() == (0, 0)  # nothing left to do


def test_purge_ignores_live_materials(db):
    from app.services import material_service

    make_material(db)
    assert material_service.purge_removed_files() == (0, 0) and len(db.objects) == 1


# ---------- end to end ----------
def test_full_lifecycle_upload_list_download_edit_delete(client, db):
    m = upload(client, title="Lecture 1", category="slides", name="lecture 1.pdf").json()
    assert client.get(BASE, headers=bearer(S1)).json()["items"][0]["file_name"] == "lecture_1.pdf"
    assert client.get(f"/api/v1/materials/{m['id']}/download", headers=bearer(S1)).status_code == 200
    client.patch(f"/api/v1/materials/{m['id']}", headers=bearer(L1), json={"title": "Lecture 1 (updated)"})
    assert client.get(BASE, headers=bearer(S1)).json()["items"][0]["title"] == "Lecture 1 (updated)"
    assert client.delete(f"/api/v1/materials/{m['id']}", headers=bearer(L1)).status_code == 204
    assert client.get(BASE, headers=bearer(S1)).json()["total"] == 0 and db.objects == {}
    assert [a["action"] for a in db.tables["audit_logs"] if a["action"].startswith("material.")] == [
        "material.create",
        "material.update",
        "material.delete",
    ]


def test_extra_student_added_later_sees_published_materials(client, db):
    make_material(db, title="For everyone")
    sid = add_student(db, 1, "Late Joiner", "STU900", enroll_in=COURSE_A)
    assert client.get(BASE, headers=bearer(sid)).json()["total"] == 1


# ---------- remaining failure paths ----------
def test_storage_outage_while_issuing_a_download_link_is_503(client, db, monkeypatch):
    m = make_material(db)

    def boom(*a, **k):
        raise Exception("simulated storage outage")

    monkeypatch.setattr(type(db.storage.from_("materials")), "create_signed_url", boom)
    r = client.get(f"/api/v1/materials/{m['id']}/download", headers=bearer(S1))
    assert r.status_code == 503 and r.json()["code"] == "SERVICE_UNAVAILABLE"
    assert "simulated" not in r.text


def test_failed_cleanup_after_failed_insert_does_not_mask_the_original_error(client, db):
    db.fail_insert_tables.add("materials")
    db.storage_fail_remove = True  # the compensating delete fails too
    r = upload(client)
    assert r.status_code == 500 and r.json()["code"] == "INTERNAL_ERROR"
    assert (
        len(db.objects) == 1
    )  # orphan remains but the failure is logged, and the client still gets a clean error


def test_lecturer_cannot_reach_a_material_whose_course_they_lost(client, db):
    m = make_material(db)
    db.tables["course_lecturers"].clear()  # lecturer unassigned
    url = f"/api/v1/materials/{m['id']}"
    assert client.patch(url, headers=bearer(L1), json={"title": "Nope"}).status_code == 404
    assert client.delete(url, headers=bearer(L1)).status_code == 404


def test_service_level_validation_does_not_depend_on_the_route_layer():
    import pytest as _pytest

    from app.core.errors import ValidationFailed
    from app.services import material_service

    with _pytest.raises(ValidationFailed):
        material_service._clean_description("x" * 2001)
    with _pytest.raises(ValidationFailed):
        material_service._clean_title(" a ")
    assert material_service._clean_title("  ok title ") == "ok title"


def test_early_oversize_rejection_still_carries_cors_headers(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    r = client.post(
        BASE,
        headers={**bearer(L1), "Origin": "http://localhost:5173"},
        data={"title": "Big file"},
        files={"file": ("big.pdf", samples.pdf() + b"0" * (3 * 1024 * 1024), "application/pdf")},
    )
    assert r.status_code == 400 and r.json()["code"] == "FILE_TOO_LARGE"
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
