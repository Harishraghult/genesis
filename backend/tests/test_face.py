import math

import pytest

from app import face
from app.config import Settings
from app.models import FaceTemplate
from conftest import login


@pytest.fixture(autouse=True)
def enrolled_face_mode(monkeypatch):
    # Face checks are opt-in; these tests exercise the opted-in "enrolled" deployment.
    monkeypatch.setenv("FACE_CHECK_MODE", "enrolled")


def test_biometric_checks_are_off_by_default(monkeypatch):
    monkeypatch.delenv("FACE_CHECK_MODE", raising=False)
    assert Settings(_env_file=None).face_check_mode == "off"


def unit(seed: int):
    values = [math.sin(seed * (i + 1)) for i in range(128)]
    norm = math.sqrt(sum(v * v for v in values))
    return [v / norm for v in values]


def body(template=None, **extra):
    return {"template": template or unit(1), "model": "sface-2021dec", "consent": True, **extra}


def test_template_round_trip_is_encrypted_and_bound_to_the_student(client):
    from app.config import settings
    template = unit(3)
    sealed = face.seal(3, template)
    assert "AAAA" not in sealed[:8]
    restored = face.unseal(3, sealed)
    assert max(abs(a - b) for a, b in zip(template, restored)) < 1e-6
    try:
        face.unseal(4, sealed)
        raise AssertionError("A template sealed for one student must not open for another")
    except Exception as error:
        assert getattr(error, "status_code", None) == 500
    assert settings().face_template_key


def test_staff_enrollment_permissions_validation_and_deletion(client):
    teacher = login(client, "teacher@focuslock.test")
    other_teacher = login(client, "teacher2@focuslock.test")
    admin = login(client, "admin@focuslock.test")
    student = login(client)
    outsider_of_teacher = 5  # enrolled only in the second teacher's course
    assert client.put("/face/templates/3", headers=student, json=body()).status_code == 403
    assert client.get("/face/roster", headers=student).status_code == 403
    assert client.put("/face/templates/3", headers=other_teacher, json=body()).status_code == 404
    assert client.put(f"/face/templates/{outsider_of_teacher}", headers=teacher, json=body()).status_code == 404
    assert client.put("/face/templates/1", headers=teacher, json=body()).status_code == 404
    assert client.put("/face/templates/3", headers=teacher, json={**body(), "consent": False}).status_code == 422
    assert client.put("/face/templates/3", headers=teacher, json={**body(), "model": "other"}).status_code == 422
    assert client.put("/face/templates/3", headers=teacher, json=body([0.0] * 128)).status_code == 422
    assert client.put("/face/templates/3", headers=teacher, json=body([5.0] * 128)).status_code == 422
    assert client.put("/face/templates/3", headers=teacher, json={**body(), "template": [0.1] * 5}).status_code == 422
    roster = client.get("/face/roster", headers=teacher).json()
    assert {row["id"] for row in roster} == {3, 4}
    assert {row["enrolled"] for row in roster} == {False}
    assert len(client.get("/face/roster", headers=admin).json()) == 3
    assert client.put("/face/templates/3", headers=teacher, json=body()).status_code == 204
    me = client.get("/face/templates/me", headers=student).json()
    assert me["enrolled"] is True and me["mode"] == "enrolled" and "template" not in me  # never leaves the server
    other_student = login(client, "student2@focuslock.test")
    assert client.get("/face/templates/me", headers=other_student).json()["enrolled"] is False
    # The server compares a live template with the stored one and issues a short face pass on a match.
    matched = client.post("/face/verify", headers=student, json={"template": unit(1), "model": "sface-2021dec"}).json()
    assert matched["match"] is True and matched["face_token"].startswith("FV1.")
    assert client.post("/face/verify", headers=student, json={"template": unit(7), "model": "sface-2021dec"}).json() == {"match": False}
    assert client.post("/face/verify", headers=other_student, json={"template": unit(1), "model": "sface-2021dec"}).status_code == 404
    assert client.post("/face/verify", headers=teacher, json={"template": unit(1), "model": "sface-2021dec"}).status_code == 403
    with client.db_factory() as db:
        stored = db.get(FaceTemplate, 3)
        assert stored.ciphertext and "0." not in stored.ciphertext and stored.enrolled_by == 1
    assert next(row for row in client.get("/face/roster", headers=teacher).json() if row["id"] == 3)["enrolled"] is True
    assert client.delete("/face/templates/3", headers=other_teacher).status_code == 404
    assert client.delete("/face/templates/3", headers=teacher).status_code == 204
    assert client.get("/face/templates/me", headers=student).json()["enrolled"] is False


def test_checkin_requires_a_face_claim_only_when_enrolled_or_required(client, monkeypatch):
    from app.config import settings
    from app.face import require_face
    from app.models import AttendanceEvent, User
    from sqlalchemy import select
    from test_stage2 import checkin_request, encode, register, start
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from app.qr_security import checkin_payload

    teacher = start(client)
    assert client.put("/face/templates/3", headers=teacher, json=body()).status_code == 204
    student, key, device_id, _ = register(client)
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    plain = {"device_id": device_id, "qr": qr, "focus_disclosure": "accepted"}
    assert client.post("/check-ins/challenge", headers=student, json=plain).status_code == 409
    assert client.post("/check-ins/challenge", headers=student, json={**plain, "face_verified": False}).status_code == 409

    assert client.post("/check-ins/challenge", headers=student, json={**plain, "face_verified": True}).status_code == 409  # bare claim
    forged = {**plain, "face_verified": True, "face_token": "FV1.3.9999999999." + "0" * 64}
    assert client.post("/check-ins/challenge", headers=student, json=forged).status_code == 409
    other_pass = face.issue_pass(4)
    assert client.post("/check-ins/challenge", headers=student, json={**plain, "face_verified": True, "face_token": other_pass}).status_code == 409
    token = client.post("/face/verify", headers=student, json={"template": unit(1), "model": "sface-2021dec"}).json()["face_token"]
    plain["face_token"] = token
    challenge = client.post("/check-ins/challenge", headers=student, json={**plain, "face_verified": True}).json()
    unsigned_face = checkin_payload(3, device_id, challenge["challenge_id"], challenge["nonce"], qr)
    signature = encode(key.sign(unsigned_face.encode(), ec.ECDSA(hashes.SHA256())))
    submit = {**plain, "challenge_id": challenge["challenge_id"], "signature": signature, "face_verified": True}
    assert client.post("/check-ins", headers=student, json=submit).status_code == 401  # signature must cover the face claim
    assert client.post("/check-ins", headers=student, json={**submit, "face_verified": False}).status_code == 409

    signed = checkin_payload(3, device_id, challenge["challenge_id"], challenge["nonce"], qr, True)
    submit["signature"] = encode(key.sign(signed.encode(), ec.ECDSA(hashes.SHA256())))
    response = client.post("/check-ins", headers=student, json=submit)
    assert response.status_code == 200, response.text
    assert response.json()["duplicate"] is False
    with client.db_factory() as db:
        reasons = [e.reason for e in db.scalars(select(AttendanceEvent).where(AttendanceEvent.session_id == 1))]
        assert any("face match" in r for r in reasons)
        user, other = db.get(User, 3), db.get(User, 4)
        require_face(db, other, False)  # not enrolled while mode is 'enrolled'
        require_face(db, user, True, token)  # a fresh server pass
        monkeypatch.setattr(settings(), "face_check_mode", "required")
        try:
            require_face(db, other, True)
            raise AssertionError("Required mode must block students without a template")
        except Exception as error:
            assert getattr(error, "status_code", None) == 409
        monkeypatch.setattr(settings(), "face_check_mode", "off")
        require_face(db, user, False)


def test_focus_needs_the_face_check_when_a_face_is_recorded(client):
    from test_stage2 import checkin_request, register, start
    from test_stage3 import checked_in
    from uuid import uuid4
    teacher = start(client)
    assert client.post("/sessions/1/activate", headers=teacher).status_code == 200
    url = lambda: f"/sessions/1/focus-policy?nonce={uuid4()}"
    # A student without a recorded face needs only the QR check-in.
    plain = checked_in(client, teacher, login(client, "student2@focuslock.test"))
    assert client.get(url(), headers=plain).status_code == 200
    # A student with a recorded face who checked in without the face claim is refused.
    student = login(client)
    assert client.get(url(), headers=student).status_code == 409
    with client.db_factory() as db:
        from app.models import Attendance
        from datetime import datetime, timezone
        db.add(Attendance(session_id=1, student_id=3, course_id=1, status="present", method="qr", face_verified=False,
                          updated_at=datetime.now(timezone.utc)))
        db.commit()
    assert client.put("/face/templates/3", headers=teacher, json=body()).status_code == 204
    assert client.get(url(), headers=student).status_code == 409
    with client.db_factory() as db:
        db.get(Attendance, (1, 3)).face_verified = True
        db.commit()
    assert client.get(url(), headers=student).status_code == 200
    # Teacher-confirmed attendance does not unlock focus.
    other = login(client, "student3@focuslock.test")
    assert client.get("/sessions/2/focus-policy?nonce=" + str(uuid4()), headers=other).status_code == 409


def test_rejoining_after_quitting_needs_a_new_face_check(client):
    from uuid import uuid4
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from app.qr_security import checkin_payload
    from test_stage2 import encode, register, start

    teacher = start(client)
    assert client.post("/sessions/1/activate", headers=teacher).status_code == 200
    assert client.put("/face/templates/3", headers=teacher, json=body()).status_code == 204
    student, key, device_id, _ = register(client)

    def scan(face):
        qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
        request = {"device_id": device_id, "qr": qr, "focus_disclosure": "accepted", "face_verified": face}
        if face:
            request["face_token"] = client.post("/face/verify", headers=student, json={"template": unit(1), "model": "sface-2021dec"}).json()["face_token"]
        challenge = client.post("/check-ins/challenge", headers=student, json=request)
        if challenge.status_code != 200:
            return challenge
        proof = challenge.json()
        signature = encode(key.sign(checkin_payload(3, device_id, proof["challenge_id"], proof["nonce"], qr, face).encode(), ec.ECDSA(hashes.SHA256())))
        return client.post("/check-ins", headers=student, json={**request, "challenge_id": proof["challenge_id"], "signature": signature})

    policy = lambda: client.get(f"/sessions/1/focus-policy?nonce={uuid4()}", headers=student).status_code
    assert scan(False).status_code == 409           # a face-enrolled student cannot check in without the face claim
    assert scan(True).json()["duplicate"] is False
    assert policy() == 200

    # Quit with the teacher's QR: focus cannot restart until a new face-checked scan.
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    assert client.post("/sessions/1/focus-exit/qr", headers=student, json={"qr": qr}).json() == {"approved": True}
    assert policy() == 409
    assert scan(False).status_code == 409
    assert policy() == 409
    assert scan(True).json()["duplicate"] is True
    assert policy() == 200

    # Quit with the teacher's approval: same rule.
    request = client.post("/sessions/1/focus-exit-requests", headers=student).json()
    assert client.post(f"/sessions/1/focus-exit-requests/{request['id']}", headers=teacher, json={"decision": "approve"}).status_code == 200
    assert policy() == 409
    assert scan(True).json()["duplicate"] is True
    assert policy() == 200

    # Being let back in after leaving the app (resume) does not clear the face check.
    resume = client.post("/sessions/1/focus-resume-requests", headers=student).json()
    assert client.post(f"/sessions/1/focus-exit-requests/{resume['id']}", headers=teacher, json={"decision": "approve"}).status_code == 200
    assert policy() == 200

