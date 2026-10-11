"""Simulated receiver protocol tests; not Bluetooth hardware validation."""
import base64
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.models import Attendance, BleCredential, BleSighting
from app.stage5 import rotating_token
from conftest import login


RECEIVER = "11111111-1111-4111-8111-111111111111"
AUTH = {"Authorization": "Bearer test-receiver-only-token"}


def checked_in(client):
    teacher = login(client, "teacher@focuslock.test")
    student = login(client)
    client.post("/sessions/1/start", headers=teacher)
    client.post("/sessions/1/activate", headers=teacher)
    assert client.put("/sessions/1/attendance/3", headers=teacher,
        json={"status": "present", "reason": "Teacher observed the class check-in"}).status_code == 200
    assert client.put("/privacy/consents/bluetooth", headers=student,
        json={"disclosure_version": "test-v1"}).status_code == 200
    return teacher, student


def test_receiver_sighting_and_duplicate(client):
    teacher, student = checked_in(client)
    credential = client.post("/sessions/1/ble-credential", headers=student)
    assert credential.status_code == 200, credential.text
    data = credential.json()
    secret = base64.urlsafe_b64decode(data["secret"] + "==")
    now = datetime.now(timezone.utc)
    token = str(rotating_token(secret, int(now.timestamp()) // 15))
    body = {"session_id": 1, "token": token, "seen_at": now.isoformat()}
    path = f"/receivers/{RECEIVER}/sightings"
    assert client.post(path, headers=AUTH, json=body).status_code == 201
    assert client.post(path, headers=AUTH, json=body).status_code == 409
    assert client.get("/sessions/1/presence", headers=teacher).json()[0]["student_id"] == 3
    assert client.get("/sessions/1/presence", headers=student).status_code == 403
    with client.db_factory() as db:
        assert db.query(BleSighting).count() == 1
        assert db.get(Attendance, (1, 3)).status == "present"
        assert "token" not in BleSighting.__table__.columns.keys()


def test_receiver_rejects_wrong_room_stale_malformed_and_unauthorized(client):
    teacher, student = checked_in(client)
    data = client.post("/sessions/1/ble-credential", headers=student).json()
    secret = base64.urlsafe_b64decode(data["secret"] + "==")
    now = datetime.now(timezone.utc)
    token = str(rotating_token(secret, int(now.timestamp()) // 15))
    body = {"session_id": 1, "token": token, "seen_at": now.isoformat()}
    path = f"/receivers/{RECEIVER}/sightings"
    assert client.post(path, headers={"Authorization": "Bearer wrong"}, json=body).status_code == 401
    assert client.post(path, headers=AUTH, json={**body, "token": "bad"}).status_code == 422
    assert client.post(path, headers=AUTH, json={**body, "seen_at": (now - timedelta(minutes=2)).isoformat()}).status_code == 410
    assert client.post(path, headers=AUTH, json={**body, "session_id": 2}).status_code == 404
    assert client.post(path, headers=AUTH, json={**body, "token": str(uuid4())}).status_code == 422
    assert client.post(f"/receivers/{RECEIVER}/heartbeat", headers=AUTH).status_code == 200
    assert client.get("/sessions/1/receiver-status", headers=student).json()["state"] == "available"
    client.post("/sessions/1/pause", headers=teacher)
    assert client.post(path, headers=AUTH, json=body).status_code == 404
    assert client.post("/sessions/1/ble-credential", headers=student).status_code == 409


def test_offline_cannot_mint_new_secret_and_expiry_rejects(client):
    _, student = checked_in(client)
    with client.db_factory() as db:
        assert db.query(BleCredential).count() == 0
    # The phone's offline fallback has no locally provisioned secret.
    assert client.post(f"/receivers/{RECEIVER}/sightings", headers=AUTH, json={
        "session_id": 1, "token": str(uuid4()), "seen_at": datetime.now(timezone.utc).isoformat()}).status_code == 422
    client.post("/sessions/1/ble-credential", headers=student)
    with client.db_factory() as db:
        row = db.query(BleCredential).one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert client.post(f"/receivers/{RECEIVER}/sightings", headers=AUTH, json={
        "session_id": 1, "token": str(uuid4()), "seen_at": datetime.now(timezone.utc).isoformat()}).status_code == 422
