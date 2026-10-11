from datetime import datetime, timedelta, timezone
from base64 import urlsafe_b64encode
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import select
from app.models import Attendance, AttendanceEvent, DeviceChallenge, PendingAttendance
from app.qr_security import checkin_payload, qr_token, register_payload
from conftest import login


def encode(value):
    return urlsafe_b64encode(value).decode().rstrip("=")


def start(client, session=1, email="teacher@focuslock.test"):
    headers = login(client, email)
    response = client.post(f"/sessions/{session}/start", headers=headers)
    assert response.status_code == 200, response.text
    return headers


def register(client, student=None, key=None):
    student = student or login(client)
    key = key or ec.generate_private_key(ec.SECP256R1())
    challenge = client.post("/devices/challenge", headers=student).json()
    me = client.get("/me", headers=student).json()
    payload = register_payload(me["id"], challenge["challenge_id"], challenge["nonce"])
    signature = encode(key.sign(payload.encode(), ec.ECDSA(hashes.SHA256())))
    public = encode(key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))
    response = client.post("/devices/register", headers=student, json={"challenge_id": challenge["challenge_id"], "public_key": public, "signature": signature})
    assert response.status_code == 200, response.text
    return student, key, response.json()["device_id"], challenge


def checkin_request(client, student, key, device_id, qr):
    response = client.post("/check-ins/challenge", headers=student, json={"device_id": device_id, "qr": qr, "focus_disclosure": "accepted"})
    assert response.status_code == 200, response.text
    challenge = response.json()
    student_id = client.get("/me", headers=student).json()["id"]
    payload = checkin_payload(student_id, device_id, challenge["challenge_id"], challenge["nonce"], qr)
    return {"device_id": device_id, "qr": qr, "challenge_id": challenge["challenge_id"], "signature": encode(key.sign(payload.encode(), ec.ECDSA(hashes.SHA256()))), "focus_disclosure": "accepted"}


def test_lifecycle_qr_and_device_checkin(client):
    teacher = start(client)
    assert client.post("/sessions/1/start", headers=teacher).status_code == 200
    student, key, device_id, _ = register(client)
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    body = checkin_request(client, student, key, device_id, qr)
    response = client.post("/check-ins", headers=student, json=body)
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "present", "method": "qr", "duplicate": False, "session_id": 1}
    assert client.get("/sessions/1", headers=student).json()["attendance"]["method"] == "qr"
    assert client.get("/sessions/1/attendance", headers=teacher).json()[0]["status"] == "present"
    with client.db_factory() as db:
        assert len(list(db.scalars(select(AttendanceEvent).where(AttendanceEvent.session_id == 1)))) == 1
    assert client.post("/sessions/1/end", headers=teacher).json()["state"] == "ended"
    assert client.post("/sessions/1/end", headers=teacher).json()["state"] == "ended"
    assert client.get("/sessions/1/qr", headers=teacher).status_code == 409


def test_replay_and_duplicate_are_idempotent(client):
    teacher = start(client)
    student, key, device_id, _ = register(client)
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    body = checkin_request(client, student, key, device_id, qr)
    assert client.post("/check-ins", headers=student, json=body).json()["duplicate"] is False
    assert client.post("/check-ins", headers=student, json=body).json()["duplicate"] is True
    # A second valid ECDSA signature over the same signed bytes is still a replay of the spent challenge.
    with client.db_factory() as db:
        challenge = db.get(DeviceChallenge, body["challenge_id"])
        canonical = checkin_payload(3, device_id, challenge.id, challenge.nonce, qr)
    altered = {**body, "signature": encode(key.sign(canonical.encode(), ec.ECDSA(hashes.SHA256())))}
    assert client.post("/check-ins", headers=student, json=altered).status_code == 409
    second = checkin_request(client, student, key, device_id, qr)
    assert client.post("/check-ins", headers=student, json=second).json()["duplicate"] is True
    with client.db_factory() as db:
        assert len(list(db.scalars(select(Attendance).where(Attendance.session_id == 1)))) == 1
        assert len(list(db.scalars(select(AttendanceEvent).where(AttendanceEvent.session_id == 1)))) == 1


def test_expired_qr_and_server_challenge(client, monkeypatch):
    teacher = start(client)
    student, key, device_id, _ = register(client)
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    import app.stage2 as stage2
    later = datetime.now(timezone.utc) + timedelta(seconds=60)
    monkeypatch.setattr(stage2, "now_utc", lambda: later)
    assert client.post("/check-ins/challenge", headers=student, json={"device_id": device_id, "qr": qr, "focus_disclosure": "accepted"}).status_code == 410
    monkeypatch.undo()
    body = checkin_request(client, student, key, device_id, qr)
    monkeypatch.setattr(stage2, "now_utc", lambda: later)
    assert client.post("/check-ins", headers=student, json=body).status_code == 410
    assert client.get("/sessions/1", headers=student).json()["attendance"] is None


def test_wrong_course_and_unauthorized_teacher(client):
    teacher = login(client, "teacher@focuslock.test")
    assert client.post("/sessions/2/start", headers=teacher).status_code == 404
    assert client.post("/sessions/2/end", headers=teacher).status_code == 404
    assert client.get("/sessions/2/qr", headers=teacher).status_code == 404
    teacher2 = start(client, 2, "teacher2@focuslock.test")
    qr = client.get("/sessions/2/qr", headers=teacher2).json()["qr"]
    student, _, device_id, _ = register(client)
    assert client.post("/check-ins/challenge", headers=student, json={"device_id": device_id, "qr": qr, "focus_disclosure": "accepted"}).status_code == 404
    assert client.post("/sessions/1/start", headers=student).status_code == 403
    assert client.get("/sessions/2/pending", headers=teacher).status_code == 404
    assert client.get("/sessions/2/audit", headers=teacher).status_code == 404


def test_ended_session_blocks_new_checkin(client):
    teacher = start(client)
    student, key, device_id, _ = register(client)
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    body = checkin_request(client, student, key, device_id, qr)
    client.post("/sessions/1/end", headers=teacher)
    assert client.post("/check-ins", headers=student, json=body).status_code == 409
    assert client.post("/sessions/1/start", headers=teacher).status_code == 409


def test_registration_proof_and_student_binding(client):
    student = login(client)
    challenge = client.post("/devices/challenge", headers=student).json()
    key = ec.generate_private_key(ec.SECP256R1())
    public = encode(key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))
    bad = {"challenge_id": challenge["challenge_id"], "public_key": public, "signature": encode(key.sign(b"wrong", ec.ECDSA(hashes.SHA256())))}
    assert client.post("/devices/register", headers=student, json=bad).status_code == 401
    student, key, device_id, challenge = register(client, student, key)
    used_body = {"challenge_id": challenge["challenge_id"], "public_key": public, "signature": encode(key.sign(register_payload(3, challenge["challenge_id"], challenge["nonce"]).encode(), ec.ECDSA(hashes.SHA256())))}
    assert client.post("/devices/register", headers=student, json=used_body).status_code == 409
    other = login(client, "student2@focuslock.test")
    assert client.post("/check-ins/challenge", headers=other, json={"device_id": device_id, "qr": "x", "focus_disclosure": "accepted"}).status_code == 404
    assert client.post(f"/devices/{device_id}/revoke", headers=other).status_code == 404
    assert client.post(f"/devices/{device_id}/revoke", headers=student).json()["revoked"] is True
    assert client.get("/devices", headers=student).json() == []


def test_correction_requires_reason_and_audits(client):
    teacher = start(client)
    student, key, device_id, _ = register(client)
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    body = checkin_request(client, student, key, device_id, qr)
    assert client.post("/check-ins", headers=student, json=body).status_code == 200
    assert client.put("/sessions/1/attendance/3", headers=teacher, json={"status": "absent"}).status_code == 422
    response = client.put("/sessions/1/attendance/3", headers=teacher, json={"status": "excused", "reason": "Student left early for appointment"})
    assert response.status_code == 200, response.text
    assert response.json()["method"] == "teacher_confirmed"
    events = client.get("/sessions/1/audit", headers=teacher).json()
    assert [event["action"] for event in events] == ["qr_checkin", "correction"]
    assert events[-1]["previous_status"] == "present" and events[-1]["reason"] == "Student left early for appointment"
    assert client.get("/sessions/1", headers=student).json()["attendance"]["status"] == "excused"


def test_pending_requires_explicit_teacher_review(client):
    student = login(client)
    teacher = login(client, "teacher@focuslock.test")
    response = client.post("/sessions/1/pending", headers=student, json={"reason": "Camera was unavailable during class"})
    assert response.json()["state"] == "pending_teacher_review"
    assert client.get("/sessions/1", headers=student).json()["attendance"] is None
    assert client.get("/sessions/1", headers=student).json()["pending_review"] is True
    assert client.get("/sessions/1/pending", headers=teacher).json()[0]["student_id"] == 3
    assert client.put("/sessions/1/attendance/3", headers=teacher, json={"status": "present"}).status_code == 422
    assert client.put("/sessions/1/attendance/3", headers=teacher, json={"status": "present", "reason": "Teacher checked the roster in class"}).status_code == 200
    assert client.get("/sessions/1", headers=student).json()["pending_review"] is False
    assert client.get("/sessions/1/pending", headers=teacher).json() == []
    with client.db_factory() as db:
        assert db.scalar(select(PendingAttendance).where(PendingAttendance.session_id == 1)).resolved_by == 1


def test_declined_focus_disclosure_requires_teacher_review(client):
    teacher = start(client)
    student, key, device_id, _ = register(client)
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    assert client.post("/check-ins/challenge", headers=student,
                       json={"device_id": device_id, "qr": qr}).status_code == 422
    assert client.post("/check-ins/challenge", headers=student,
                       json={"device_id": device_id, "qr": qr, "focus_disclosure": "declined"}).status_code == 422
    body = checkin_request(client, student, key, device_id, qr)
    assert client.post("/check-ins", headers=student,
                       json={key: value for key, value in body.items() if key != "focus_disclosure"}).status_code == 422
    assert client.post("/check-ins", headers=student,
                       json={**body, "focus_disclosure": "declined"}).status_code == 422
    assert client.get("/sessions/1", headers=student).json()["attendance"] is None
    assert client.post("/sessions/1/pending", headers=student,
                       json={"reason": "I declined the optional focus disclosure"}).status_code == 200
    assert client.get("/sessions/1", headers=student).json()["pending_review"] is True
    assert client.get("/sessions/1/attendance", headers=teacher).json() == []


def test_qr_tampering_and_device_signature_rejected(client):
    teacher = start(client)
    student, key, device_id, _ = register(client)
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    invalid = qr[:-1] + ("A" if qr[-1] != "A" else "B")
    assert client.post("/check-ins/challenge", headers=student, json={"device_id": device_id, "qr": invalid, "focus_disclosure": "accepted"}).status_code == 422
    assert client.post("/check-ins/challenge", headers=student, json={"device_id": device_id, "qr": "FL2.A.A", "focus_disclosure": "accepted"}).status_code == 422
    assert client.post("/check-ins/challenge", headers=student, json={"device_id": device_id, "qr": "FL2.é.A", "focus_disclosure": "accepted"}).status_code == 422
    body = checkin_request(client, student, key, device_id, qr)
    body["signature"] = encode(key.sign(b"different request", ec.ECDSA(hashes.SHA256())))
    assert client.post("/check-ins", headers=student, json=body).status_code == 401
    assert client.get("/sessions/1", headers=student).json()["attendance"] is None


def test_qr_reconciles_existing_pending_request(client):
    teacher = start(client)
    student, key, device_id, _ = register(client)
    assert client.post("/sessions/1/pending", headers=student, json={"reason": "Camera failed earlier but is working now"}).status_code == 200
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    body = checkin_request(client, student, key, device_id, qr)
    assert client.post("/check-ins", headers=student, json=body).status_code == 200
    assert client.get("/sessions/1", headers=student).json()["pending_review"] is False
    assert client.get("/sessions/1/pending", headers=teacher).json() == []


def test_qr_rotates_and_is_short_lived():
    start_time = datetime.fromtimestamp(1_700_000_000, timezone.utc)
    end_time = start_time + timedelta(minutes=5)
    first, first_expiry = qr_token(1, 1, start_time, end_time, start_time)
    same, _ = qr_token(1, 1, start_time, end_time, start_time + timedelta(seconds=1))
    second, second_expiry = qr_token(1, 1, start_time, end_time, start_time + timedelta(seconds=25))
    assert first == same
    assert first != second
    assert first_expiry - int(start_time.timestamp()) <= 30
    assert second_expiry - int((start_time + timedelta(seconds=25)).timestamp()) <= 30
