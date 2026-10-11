import base64
import json
import time
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from sqlalchemy import select

from app.config import settings
from app.integrity import request_hash, verify_integrity
from app.models import (AdminAudit, BleCredential, BleSighting, ClassSession, DataRequest,
                        Device, FocusEvent, IntegrityReceipt, User)
from app.oidc import verify_access_token
from app.retention import purge
from conftest import login
from test_stage2 import encode, register


def test_consent_withdrawal_revokes_ble_and_preserves_attendance(client):
    student = login(client)
    assert client.get("/privacy/consents", headers=login(client, "teacher@focuslock.test")).status_code == 403
    assert client.put("/privacy/consents/bluetooth", headers=student, json={"disclosure_version": "v1"}).status_code == 200
    now = datetime.now(timezone.utc)
    with client.db_factory() as db:
        db.add(BleCredential(id="credential-1", session_id=1, student_id=3, issued_at=now,
                             expires_at=now + timedelta(minutes=5)))
        db.commit()
    assert client.delete("/privacy/consents/bluetooth", headers=student).json()["granted"] is False
    with client.db_factory() as db:
        assert db.get(BleCredential, "credential-1").expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc)
    assert client.get("/attendance/me", headers=student).status_code == 200


def test_privacy_requests_are_student_scoped_and_teacher_scoped(client):
    student = login(client)
    other = login(client, "student3@focuslock.test")
    teacher = login(client, "teacher@focuslock.test")
    outsider = login(client, "teacher2@focuslock.test")
    assert client.post("/privacy/requests", headers=other,
        json={"kind": "correction", "session_id": 1, "reason": "Please review this attendance"}).status_code == 404
    response = client.post("/privacy/requests", headers=student,
        json={"kind": "correction", "session_id": 1, "reason": "Please review this attendance"})
    assert response.status_code == 201
    request_id = response.json()["id"]
    assert client.get("/privacy/requests", headers=other).json() == []
    assert client.get("/teacher/privacy/requests", headers=outsider).json() == []
    assert client.put(f"/teacher/privacy/requests/{request_id}", headers=outsider,
        json={"status": "declined", "resolution": "A documented reason for this decision"}).status_code == 404
    assert client.put(f"/teacher/privacy/requests/{request_id}", headers=teacher,
        json={"status": "accepted", "resolution": "Review through the attendance correction workflow"}).status_code == 200
    with client.db_factory() as db:
        assert db.get(DataRequest, request_id).status == "accepted"
        assert db.scalar(select(AdminAudit).where(AdminAudit.action == "privacy_request_review")) is not None


def test_admin_is_restricted_and_receiver_secret_is_one_time(client):
    teacher = login(client, "teacher@focuslock.test")
    admin = login(client, "admin@focuslock.test")
    body = {"course_id": 1, "room_code": "A101", "reason": "Approved classroom receiver installation"}
    assert client.post("/admin/receivers", headers=teacher, json=body).status_code == 403
    response = client.post("/admin/receivers", headers=admin, json=body)
    assert response.status_code == 201
    receiver_id = response.json()["receiver_id"]
    assert "token" in response.json()
    assert response.json()["token"] not in json.dumps(client.get("/admin/audit", headers=admin).json())
    assert client.post(f"/receivers/{receiver_id}/heartbeat",
        headers={"Authorization": "Bearer " + response.json()["token"]}).status_code == 200
    assert client.post(f"/admin/receivers/{receiver_id}/revoke", headers=admin,
        json={"status": "accepted", "resolution": "Receiver retired from this classroom"}).status_code == 200
    assert client.post(f"/receivers/{receiver_id}/heartbeat",
        headers={"Authorization": "Bearer " + response.json()["token"]}).status_code == 401


def test_signed_device_replacement_and_replay(client):
    student, old_key, old_id, _ = register(client)
    challenge = client.post(f"/devices/{old_id}/replacement-challenge", headers=student).json()
    new_key = ec.generate_private_key(ec.SECP256R1())
    public = encode(new_key.public_key().public_bytes(serialization.Encoding.DER,
                  serialization.PublicFormat.SubjectPublicKeyInfo))
    import hashlib
    fingerprint = hashlib.sha256(base64.urlsafe_b64decode(public + "==")).hexdigest()
    canonical = f"FL-REPLACE1\n3\n{old_id}\n{challenge['challenge_id']}\n{challenge['nonce']}\n{fingerprint}"
    body = {"challenge_id": challenge["challenge_id"], "public_key": public,
            "old_signature": encode(old_key.sign(canonical.encode(), ec.ECDSA(hashes.SHA256()))),
            "new_signature": encode(new_key.sign(canonical.encode(), ec.ECDSA(hashes.SHA256())))}
    invalid = {**body, "old_signature": body["new_signature"]}
    assert client.post("/devices/replace", headers=student, json=invalid).status_code == 401
    result = client.post("/devices/replace", headers=student, json=body)
    assert result.status_code == 200, result.text
    assert client.post("/devices/replace", headers=student, json=body).status_code == 409
    with client.db_factory() as db:
        assert db.get(Device, old_id).revoked_at is not None


def test_oidc_signature_claims_and_database_roles(client, monkeypatch):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    numbers = private.public_key().public_numbers()
    def b64int(value):
        return encode(value.to_bytes((value.bit_length() + 7) // 8, "big"))
    import app.oidc as oidc
    monkeypatch.setattr(oidc, "jwks", lambda url, bucket: {"keys": [{"kid": "k1", "kty": "RSA", "use": "sig",
        "n": b64int(numbers.n), "e": b64int(numbers.e)}]})
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("OIDC_ISSUER", "https://college.example.edu")
    monkeypatch.setenv("OIDC_AUDIENCE", "focuslock-api")
    monkeypatch.setenv("OIDC_JWKS_URL", "https://college.example.edu/keys")
    settings.cache_clear()
    def token(aud="focuslock-api", exp=None):
        header = encode(json.dumps({"alg": "RS256", "kid": "k1"}).encode())
        payload = encode(json.dumps({"iss": "https://college.example.edu", "aud": aud, "sub": "student-sub-3",
            "iat": int(time.time()), "exp": exp or int(time.time()) + 300}).encode())
        signed = f"{header}.{payload}".encode()
        return f"{header}.{payload}.{encode(private.sign(signed, padding.PKCS1v15(), hashes.SHA256()))}"
    with client.db_factory() as db:
        user = db.get(User, 3)
        user.is_demo = False
        user.oidc_subject = "student-sub-3"
        db.commit()
    headers = {"Authorization": "Bearer " + token()}
    assert client.get("/me", headers=headers).json()["role"] == "student"
    assert client.get("/courses/2/roster", headers=headers).status_code == 403
    assert client.get("/me", headers={"Authorization": "Bearer " + token(aud="wrong")}).status_code == 401
    assert client.get("/me", headers={"Authorization": "Bearer " + token(exp=int(time.time()) - 1)}).status_code == 401
    assert client.post("/auth/dev-login", json={"email": "student@focuslock.test", "password": "test-password"}).status_code == 404


def test_integrity_request_binding_and_replay(client, monkeypatch):
    import app.integrity as integrity
    monkeypatch.setenv("PLAY_INTEGRITY_MODE", "required")
    monkeypatch.setenv("PLAY_INTEGRITY_PACKAGE", "org.focuslock.app")
    settings.cache_clear()
    expected = request_hash("checkin", "signed-canonical")
    verdict = {"requestDetails": {"requestPackageName": "org.focuslock.app", "requestHash": expected,
        "timestampMillis": str(int(time.time() * 1000))},
        "appIntegrity": {"appRecognitionVerdict": "PLAY_RECOGNIZED"},
        "deviceIntegrity": {"deviceRecognitionVerdict": ["MEETS_DEVICE_INTEGRITY"]}}
    monkeypatch.setattr(integrity, "decode_google_token", lambda token: verdict)
    with client.db_factory() as db:
        assert verify_integrity(db, "checkin", "signed-canonical", "opaque-token") == "verified"
        db.commit()
    from fastapi import HTTPException
    with client.db_factory() as db:
        with pytest.raises(HTTPException) as replay:
            verify_integrity(db, "checkin", "signed-canonical", "opaque-token")
        assert replay.value.status_code == 409
        with pytest.raises(HTTPException) as mismatch:
            verify_integrity(db, "checkin", "different-payload", "fresh-token")
        assert mismatch.value.status_code == 403
        with pytest.raises(HTTPException) as missing:
            verify_integrity(db, "checkin", "signed-canonical", None)
        assert missing.value.status_code == 403


def test_retention_removes_raw_events_and_expired_credentials(client):
    old = datetime.now(timezone.utc) - timedelta(days=40)
    with client.db_factory() as db:
        db.add(FocusEvent(id="old-event", session_id=1, student_id=3, action="started", recorded_at=old))
        db.add(BleCredential(id="old-credential", session_id=1, student_id=3,
                             issued_at=old, expires_at=old + timedelta(minutes=5)))
        db.commit()
        counts = purge(db)
        assert counts["focus_events"] == 1
        assert counts["ble_credentials"] == 1
        assert db.get(FocusEvent, "old-event") is None
        assert db.get(BleCredential, "old-credential") is None


def test_retention_endpoint_requires_secret(client, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "test-cron-secret-at-least-16")
    settings.cache_clear()
    assert client.get("/internal/retention").status_code == 401
    assert client.get("/internal/retention", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/internal/retention", headers={"Authorization": "Bearer test-cron-secret-at-least-16"}).status_code == 200


def test_admin_provisioning_is_restricted_and_audited(client):
    body = {"oidc_subject": "college-sub-7", "email": "new@college.example.edu", "name": "New Student",
            "role": "student", "reason": "Registrar approved this enrollment"}
    assert client.post("/admin/users", headers=login(client, "teacher@focuslock.test"), json=body).status_code == 403
    admin = login(client, "admin@focuslock.test")
    result = client.post("/admin/users", headers=admin, json=body)
    assert result.status_code == 201
    assert client.post("/admin/users", headers=admin, json=body).status_code == 409
    with client.db_factory() as db:
        row = db.get(User, result.json()["id"])
        assert row.oidc_subject == "college-sub-7" and not row.is_demo
        assert db.scalar(select(AdminAudit).where(AdminAudit.action == "user_provisioned")) is not None
