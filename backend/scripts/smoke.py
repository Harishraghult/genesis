"""Run against a migrated, seeded development database, including PostgreSQL in CI."""
from fastapi.testclient import TestClient
from base64 import urlsafe_b64encode
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from app.config import settings
from app.main import app
from app.qr_security import checkin_payload, register_payload
from uuid import uuid4

def encode(value):
    return urlsafe_b64encode(value).decode().rstrip("=")

with TestClient(app) as client:
    assert client.get("/health/ready").status_code == 200
    def login(email):
        result = client.post("/auth/dev-login", json={"email": email, "password": settings().dev_password})
        assert result.status_code == 200, result.text
        return {"Authorization": "Bearer " + result.json()["access_token"]}
    teacher = login("teacher@focuslock.test")
    student = login("student@focuslock.test")
    assert client.get("/courses/2/roster", headers=teacher).status_code == 404
    assert client.get("/courses/1/roster", headers=student).status_code == 403
    assert client.post("/sessions/1/start", headers=teacher).status_code == 200
    assert client.post("/sessions/1/resources", headers=teacher, json={"title": "College notes", "url": "https://docs.college.example.edu/notes.pdf", "kind": "pdf", "downloadable": True}).status_code == 201
    assert len(client.get("/sessions/1/resources", headers=student).json()) == 1
    key = ec.generate_private_key(ec.SECP256R1())
    challenge = client.post("/devices/challenge", headers=student).json()
    signature = encode(key.sign(register_payload(3, challenge["challenge_id"], challenge["nonce"]).encode(), ec.ECDSA(hashes.SHA256())))
    public = encode(key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))
    device = client.post("/devices/register", headers=student, json={"challenge_id": challenge["challenge_id"], "public_key": public, "signature": signature}).json()["device_id"]
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    proof = client.post("/check-ins/challenge", headers=student, json={"device_id": device, "qr": qr, "focus_disclosure": "accepted"}).json()
    signed = encode(key.sign(checkin_payload(3, device, proof["challenge_id"], proof["nonce"], qr).encode(), ec.ECDSA(hashes.SHA256())))
    body = {"device_id": device, "qr": qr, "challenge_id": proof["challenge_id"], "signature": signed, "focus_disclosure": "accepted"}
    assert client.post("/check-ins", headers=student, json=body).json()["duplicate"] is False
    assert client.post("/check-ins", headers=student, json=body).json()["duplicate"] is True
    assert client.get("/sessions/1", headers=student).json()["attendance"]["status"] == "present"
    assert client.put("/sessions/1/attendance/3", headers=teacher, json={"status": "excused", "reason": "Teacher reviewed the classroom roster"}).status_code == 200
    assert len(client.get("/sessions/1/audit", headers=teacher).json()) >= 2
    assert client.post("/sessions/1/activate", headers=teacher).status_code == 200
    policy = client.get(f"/sessions/1/focus-policy?nonce={uuid4()}", headers=student)
    assert policy.status_code == 200, policy.text
    event = {"id": str(uuid4()), "policy": policy.json()["policy"], "action": "started"}
    assert client.post("/sessions/1/focus-events", headers=student, json=event).status_code == 201
    assert client.post("/sessions/1/pause", headers=teacher).status_code == 200
    assert client.post("/sessions/1/resume", headers=teacher).status_code == 200
    assert client.post("/sessions/1/end", headers=teacher).status_code == 200
    print("Database health, scope, QR/device check-in, resources, focus policy, replay, correction and session end passed.")
