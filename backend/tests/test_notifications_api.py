"""Phase 7 (notifications): FR-NOT-03/04, FR-STU-10, AT-18. Reading and marking own notifications."""

import pytest

from tests.conftest import L1, NOW, S1, S2, bearer, make_notification

URL = "/api/v1/notifications"


def get(client, who=S1, query=""):
    return client.get(f"{URL}{query}", headers=bearer(who))


def read(client, n, who=S1):
    return client.patch(f"{URL}/{n['id']}/read", headers=bearer(who))


def read_all(client, who=S1):
    return client.post(f"{URL}/read-all", headers=bearer(who))


# =============================== listing ===============================
def test_user_sees_only_their_own_notifications_newest_first(client, db):
    old = make_notification(db, S1, "Old", created="2026-10-01T00:00:00+00:00")
    new = make_notification(db, S1, "New", created="2026-10-03T00:00:00+00:00")
    make_notification(db, S2, "Not mine")
    r = get(client)
    assert r.status_code == 200
    body = r.json()
    assert [i["id"] for i in body["items"]] == [new["id"], old["id"]] and body["total"] == 2
    assert body["page"] == 1 and body["page_size"] == 20


def test_item_fields_and_no_user_id_leak(client, db):
    n = make_notification(db, S1, "Hello", type_="marks_released")
    n["link"] = "/student/marks"
    item = get(client).json()["items"][0]
    assert set(item) == {"id", "type", "title", "message", "link", "is_read", "created_at", "read_at"}
    assert item["type"] == "marks_released" and item["link"] == "/student/marks"
    assert item["is_read"] is False and item["read_at"] is None


def test_unread_count_header_counts_all_unread_not_just_this_page(client, db):
    for i in range(5):
        make_notification(db, S1, f"U{i}")
    make_notification(db, S1, "Read", is_read=True)
    make_notification(db, S2, "Someone else's")
    r = get(client, query="?page_size=2")
    assert r.headers["X-Unread-Count"] == "5" and len(r.json()["items"]) == 2 and r.json()["total"] == 6


def test_unread_count_is_zero_with_no_notifications(client, db):
    r = get(client)
    assert r.json() == {"items": [], "page": 1, "page_size": 20, "total": 0}
    assert r.headers["X-Unread-Count"] == "0"


def test_filter_by_read_state(client, db):
    make_notification(db, S1, "Unread")
    make_notification(db, S1, "Read", is_read=True)
    unread = get(client, query="?is_read=false").json()
    assert [i["title"] for i in unread["items"]] == ["Unread"] and unread["total"] == 1
    done = get(client, query="?is_read=true").json()
    assert [i["title"] for i in done["items"]] == ["Read"] and done["total"] == 1
    assert get(client, query="?is_read=true").headers["X-Unread-Count"] == "1"  # independent of the filter
    assert get(client, query="?is_read=maybe").status_code == 422


def test_pagination(client, db):
    for i in range(5):
        make_notification(db, S1, f"N{i}", created=f"2026-10-0{i + 1}T00:00:00+00:00")
    r = get(client, query="?page=2&page_size=2").json()
    assert [i["title"] for i in r["items"]] == ["N2", "N1"] and r["total"] == 5
    assert get(client, query="?page_size=101").status_code == 422
    assert get(client, query="?page=0").status_code == 422


def test_lecturers_have_their_own_inbox_too(client, db):
    make_notification(db, L1, "For the lecturer")
    make_notification(db, S1, "For the student")
    assert [i["title"] for i in get(client, who=L1).json()["items"]] == ["For the lecturer"]


def test_the_unread_count_header_is_exposed_to_browsers(client, db):
    r = client.options(
        URL,
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Authorization": "Bearer x",
        },
    )
    assert r.status_code == 200
    r = client.get(URL, headers={**bearer(S1), "Origin": "http://localhost:5173"})
    assert "x-unread-count" in r.headers.get("access-control-expose-headers", "").lower()


# =============================== mark read (FR-NOT-04) ===============================
def test_user_marks_a_notification_read(client, db, clock):
    n = make_notification(db, S1)
    r = read(client, n)
    assert (
        r.status_code == 200
        and r.json()["is_read"] is True
        and r.json()["read_at"] == NOW.isoformat().replace("+00:00", "Z")
    )
    assert n["is_read"] is True and n["read_at"] == NOW.isoformat()
    assert get(client).headers["X-Unread-Count"] == "0"


def test_marking_an_already_read_notification_keeps_the_original_time(client, db, clock):
    n = make_notification(db, S1, is_read=True)
    r = read(client, n)
    assert r.status_code == 200 and r.json()["read_at"] == "2026-10-02T09:00:00Z"
    assert n["read_at"] == "2026-10-02T09:00:00+00:00"


def test_you_cannot_read_someone_elses_notification_404(client, db):
    n = make_notification(db, S2, "Private")
    assert read(client, n).status_code == 404
    assert n["is_read"] is False  # untouched
    assert read(client, n, who=L1).status_code == 404


def test_unknown_notification_is_404_and_malformed_id_422(client, db):
    r = client.patch(f"{URL}/00000000-0000-0000-0000-00000000ffff/read", headers=bearer(S1))
    assert r.status_code == 404 and r.json()["code"] == "NOT_FOUND"
    assert client.patch(f"{URL}/nope/read", headers=bearer(S1)).status_code == 422


def test_notifications_cannot_be_edited_or_deleted_through_the_api(client, db):
    n = make_notification(db, S1)
    h = bearer(S1)
    assert client.delete(f"{URL}/{n['id']}", headers=h).status_code in (404, 405)
    assert client.patch(f"{URL}/{n['id']}", headers=h, json={"title": "x"}).status_code in (404, 405)
    assert client.put(f"{URL}/{n['id']}/read", headers=h).status_code == 405
    assert n["title"] == "Hello"


# =============================== read all ===============================
def test_read_all_marks_only_the_callers_unread_notifications(client, db, clock):
    mine = [make_notification(db, S1, f"U{i}") for i in range(3)]
    already = make_notification(db, S1, "Done", is_read=True)
    theirs = make_notification(db, S2, "Not mine")
    r = read_all(client)
    assert r.status_code == 200 and r.json() == {"updated": 3}
    assert all(n["is_read"] and n["read_at"] == NOW.isoformat() for n in mine)
    assert already["read_at"] == "2026-10-02T09:00:00+00:00"  # not rewritten
    assert theirs["is_read"] is False
    assert get(client).headers["X-Unread-Count"] == "0"


def test_read_all_with_nothing_unread_updates_zero(client, db):
    assert read_all(client).json() == {"updated": 0}


def test_read_all_route_is_not_swallowed_by_the_id_route(client, db):
    assert client.patch(f"{URL}/read-all", headers=bearer(S1)).status_code in (405, 422)


# =============================== authentication ===============================
@pytest.mark.parametrize(
    "method,path",
    [
        ("get", URL),
        ("post", f"{URL}/read-all"),
        ("patch", f"{URL}/00000000-0000-0000-0000-000000000001/read"),
    ],
)
def test_every_notification_endpoint_needs_a_login_401(client, db, method, path):
    assert getattr(client, method)(path).status_code == 401
    assert getattr(client, method)(path, headers={"Authorization": "Bearer nonsense"}).status_code == 401
