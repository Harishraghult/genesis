from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import select
from app.config import settings
from app.models import Attendance, ClassSession, DevToken, User
from app.seed import seed
from conftest import login


@pytest.mark.parametrize("path", ["/me", "/courses", "/sessions", "/sessions/1", "/attendance/me", "/courses/1/roster", "/sessions/1/attendance"])
def test_anonymous_denied(client, path):
    assert client.get(path).status_code == 401


def test_student_isolation(client):
    headers = login(client)
    assert [c["id"] for c in client.get("/courses", headers=headers).json()] == [1]
    assert {s["course_id"] for s in client.get("/sessions", headers=headers).json()} == {1}
    assert client.get("/sessions/2", headers=headers).status_code == 404
    assert client.get("/sessions?course_id=2", headers=headers).status_code == 404
    for path in ["/courses/1/roster", "/sessions/1/attendance"]:
        assert client.get(path, headers=headers).status_code == 403
    assert client.put("/sessions/1/attendance/3", headers=headers, json={"status": "present"}).status_code == 403
    history = client.get("/attendance/me?student_id=4", headers=headers).json()
    assert history and all(row["student_id"] == 3 for row in history)
    assert client.get("/attendance/me", headers=login(client, "student2@focuslock.test")).json() == []


def test_teacher_cannot_cross_courses(client):
    headers = login(client, "teacher@focuslock.test")
    assert [c["id"] for c in client.get("/courses", headers=headers).json()] == [1]
    for path in ["/courses/2/roster", "/sessions/2", "/sessions/2/attendance", "/sessions?course_id=2"]:
        assert client.get(path, headers=headers).status_code == 404
    assert client.put("/sessions/2/attendance/5", headers=headers, json={"status": "present"}).status_code == 404
    assert client.put("/sessions/1/attendance/5", headers=headers, json={"status": "present"}).status_code == 404


def test_teacher_can_schedule_only_assigned_course(client):
    now = datetime.now(timezone.utc)
    body = {"course_id": 1, "title": "New workshop", "starts_at": now.isoformat(),
            "ends_at": (now + timedelta(hours=1)).isoformat(), "room_code": "CS-101"}
    assert client.post("/sessions", json=body).status_code == 401
    assert client.post("/sessions", headers=login(client), json=body).status_code == 403
    teacher = login(client, "teacher@focuslock.test")
    assert client.post("/sessions", headers=teacher, json={**body, "course_id": 2}).status_code == 404
    response = client.post("/sessions", headers=teacher, json=body)
    assert response.status_code == 201
    created = response.json()
    assert created["state"] == "ready" and created["course_id"] == 1
    assert client.get(f"/sessions/{created['id']}", headers=login(client, "teacher2@focuslock.test")).status_code == 404
    assert client.get(f"/sessions/{created['id']}", headers=login(client, "student2@focuslock.test")).status_code == 200


@pytest.mark.parametrize("change", [
    {"title": "  "}, {"room_code": "room / 1"},
    {"ends_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()},
    {"extra": "forged"},
])
def test_session_creation_validates_input(client, change):
    now = datetime.now(timezone.utc)
    body = {"course_id": 1, "title": "New workshop", "starts_at": now.isoformat(),
            "ends_at": (now + timedelta(hours=1)).isoformat(), **change}
    assert client.post("/sessions", headers=login(client, "teacher@focuslock.test"), json=body).status_code == 422


def test_confirmation_roundtrip_and_update(client):
    teacher = login(client, "teacher@focuslock.test")
    assert len(client.get("/courses/1/roster", headers=teacher).json()) == 2
    for status in ["present", "excused"]:
        response = client.put("/sessions/1/attendance/3", headers=teacher, json={"status": status, "reason": "Teacher corrected classroom roll"})
        assert response.status_code == 200
        assert response.json()["confirmed_by"] == 1
        assert response.json()["method"] == "teacher_confirmed"
    rows = client.get("/sessions/1/attendance", headers=teacher).json()
    assert len(rows) == 1 and rows[0]["status"] == "excused"
    student = login(client)
    assert client.get("/sessions/1", headers=student).json()["attendance"]["status"] == "excused"
    assert len(client.get("/attendance/me", headers=student).json()) == 2
    with client.db_factory() as db:
        assert len(list(db.scalars(select(Attendance).where(Attendance.session_id == 1)))) == 1


@pytest.mark.parametrize("body", [{"status": "present", "confirmed_by": 2}, {"status": "present", "method": "vpn"}, {"status": "anything"}])
def test_confirmation_rejects_forgery(client, body):
    assert client.put("/sessions/1/attendance/3", headers=login(client, "teacher@focuslock.test"), json=body).status_code == 422


def test_token_expiry_tampering_and_logout(client):
    headers = login(client)
    assert client.get("/me", headers={"Authorization": headers["Authorization"] + "x"}).status_code == 401
    assert client.post("/auth/logout", headers=headers).status_code == 204
    assert client.get("/me", headers=headers).status_code == 401
    headers = login(client)
    with client.db_factory() as db:
        token = db.scalar(select(DevToken))
        token.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert client.get("/me", headers=headers).status_code == 401


def test_role_is_loaded_from_database(client):
    headers = login(client, "teacher@focuslock.test")
    with client.db_factory() as db:
        db.get(User, 1).role = "student"
        db.commit()
    assert client.get("/courses/1/roster", headers=headers).status_code == 403


@pytest.mark.parametrize("environment,enabled", [("production", "true"), ("development", "false"), ("staging", "true")])
def test_dev_auth_fails_closed(client, monkeypatch, environment, enabled):
    headers = login(client)
    monkeypatch.setenv("APP_ENV", environment)
    monkeypatch.setenv("ENABLE_DEV_AUTH", enabled)
    settings.cache_clear()
    assert client.get("/auth/config").json()["development_login"] is False
    assert client.post("/auth/dev-login", json={"email": "student@focuslock.test", "password": "test-password"}).status_code == 404
    assert client.get("/me", headers=headers).status_code == 503
    with client.db_factory() as db, pytest.raises(RuntimeError):
        seed(db)


def test_bad_credentials_and_no_role_injection(client):
    assert client.post("/auth/dev-login", json={"email": "teacher@focuslock.test", "password": "wrong"}).status_code == 401
    assert client.post("/auth/dev-login", json={"email": "student@focuslock.test", "password": "test-password", "role": "teacher"}).status_code == 422


def test_non_demo_account_cannot_login(client):
    with client.db_factory() as db:
        db.get(User, 3).is_demo = False
        db.commit()
    assert client.post("/auth/dev-login", json={"email": "student@focuslock.test", "password": "test-password"}).status_code == 401


def test_future_confirmation_rejected(client):
    headers = login(client, "teacher@focuslock.test")
    with client.db_factory() as db:
        session = db.get(ClassSession, 1)
        session.starts_at = datetime.now(timezone.utc) + timedelta(days=1)
        session.ends_at = session.starts_at + timedelta(hours=1)
        db.commit()
    assert client.put("/sessions/1/attendance/3", headers=headers, json={"status": "present"}).status_code == 409


def test_no_credentials_cannot_write(client):
    assert client.put("/sessions/1/attendance/3", json={"status": "present"}).status_code == 401


def test_seed_is_idempotent_and_does_not_overwrite(client):
    with client.db_factory() as db:
        db.get(User, 3).name = "Edited demo name"
        db.commit()
        assert seed(db) is False
        assert db.get(User, 3).name == "Edited demo name"


def test_health_without_credentials(client):
    assert client.get("/health/live").json() == {"status": "ok"}
    # create_all is not an Alembic upgrade: readiness must reject unversioned schemas.
    assert client.get("/health/ready").status_code == 503
