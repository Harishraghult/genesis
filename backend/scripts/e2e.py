"""End-to-end check of a running deployment over HTTP, as a teacher and two students would use it.

Usage (PowerShell):  $env:DEV_PASSWORD = "..."; python -m scripts.e2e https://your-app.onrender.com/api
Creates a new session on the demo data. Use only against development/demo deployments.
"""
import os
import sys
from base64 import urlsafe_b64encode
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.qr_security import checkin_payload, register_payload


def encode(value):
    return urlsafe_b64encode(value).decode().rstrip("=")


def check(label, response, status):
    ok = response.status_code == status
    print(f"{'PASS' if ok else 'FAIL'}  {label}  [{response.status_code}]")
    if not ok:
        print("      " + response.text[:300])
        sys.exit(1)
    return response.json() if response.content and response.headers.get("content-type", "").startswith("application/json") else None


def main(base, password):
    client = httpx.Client(base_url=base.rstrip("/"), timeout=90)
    check("API ready", client.get("/health/ready"), 200)

    def login(email):
        token = check(f"sign in {email}", client.post("/auth/dev-login", json={"email": email, "password": password}), 200)["access_token"]
        return {"Authorization": "Bearer " + token}

    teacher, student, student2 = login("teacher@focuslock.test"), login("student@focuslock.test"), login("student2@focuslock.test")
    me = check("student profile", client.get("/me", headers=student), 200)

    courses = check("teacher sees assigned course", client.get("/courses", headers=teacher), 200)
    assert [c["code"] for c in courses] == ["CS101"], courses
    roster = check("teacher sees roster", client.get("/courses/1/roster", headers=teacher), 200)
    check("teacher blocked from another teacher's course", client.get("/courses/2/roster", headers=teacher), 404)
    check("student blocked from roster", client.get("/courses/1/roster", headers=student), 403)

    now = datetime.now(timezone.utc)
    check("past start time rejected with a message", client.post("/sessions", headers=teacher, json={"course_id": 1, "title": "Too late", "starts_at": (now - timedelta(hours=2)).isoformat(), "ends_at": now.isoformat()}), 422)
    session = check("teacher creates session", client.post("/sessions", headers=teacher, json={"course_id": 1, "title": "End-to-end check", "room_code": "A101", "starts_at": now.isoformat(), "ends_at": (now + timedelta(hours=1)).isoformat()}), 201)
    sid = session["id"]
    check("student sees the new session", client.get(f"/sessions/{sid}", headers=student), 200)
    check("teacher opens check-in", client.post(f"/sessions/{sid}/start", headers=teacher), 200)
    check("teacher attaches resource", client.post(f"/sessions/{sid}/resources", headers=teacher, json={"title": "Lecture notes", "url": "https://college.example.edu/notes.pdf", "kind": "pdf", "downloadable": False}), 201)
    check("resource outside allowed hosts rejected", client.post(f"/sessions/{sid}/resources", headers=teacher, json={"title": "Elsewhere", "url": "https://example.com/x.pdf", "kind": "pdf", "downloadable": False}), 422)
    resources = check("student sees resource", client.get(f"/sessions/{sid}/resources", headers=student), 200)
    assert len(resources) == 1, resources

    key = ec.generate_private_key(ec.SECP256R1())
    challenge = check("device challenge", client.post("/devices/challenge", headers=student), 200)
    signature = encode(key.sign(register_payload(me["id"], challenge["challenge_id"], challenge["nonce"]).encode(), ec.ECDSA(hashes.SHA256())))
    public = encode(key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))
    device = check("student registers device key", client.post("/devices/register", headers=student, json={"challenge_id": challenge["challenge_id"], "public_key": public, "signature": signature}), 200)["device_id"]

    qr = check("teacher shows rotating QR", client.get(f"/sessions/{sid}/qr", headers=teacher), 200)["qr"]
    proof = check("check-in challenge", client.post("/check-ins/challenge", headers=student, json={"device_id": device, "qr": qr, "focus_disclosure": "accepted"}), 200)
    signed = encode(key.sign(checkin_payload(me["id"], device, proof["challenge_id"], proof["nonce"], qr).encode(), ec.ECDSA(hashes.SHA256())))
    body = {"device_id": device, "qr": qr, "challenge_id": proof["challenge_id"], "signature": signed, "focus_disclosure": "accepted"}
    first = check("student QR check-in", client.post("/check-ins", headers=student, json=body), 200)
    assert first["duplicate"] is False, first
    again = check("duplicate check-in is idempotent", client.post("/check-ins", headers=student, json=body), 200)
    assert again["duplicate"] is True, again
    tampered = dict(body, qr=qr[:-2] + ("AA" if not qr.endswith("AA") else "BB"))
    client.post("/check-ins", headers=student, json=tampered).status_code in (400, 401, 403, 409, 422) or sys.exit("FAIL  tampered QR accepted")
    print("PASS  tampered QR rejected")

    attendance = check("teacher sees check-in", client.get(f"/sessions/{sid}/attendance", headers=teacher), 200)
    assert any(a["student_id"] == me["id"] and a["status"] == "present" for a in attendance), attendance
    assert check("student sees own attendance", client.get(f"/sessions/{sid}", headers=student), 200)["attendance"]["status"] == "present"

    check("teacher starts active class", client.post(f"/sessions/{sid}/activate", headers=teacher), 200)
    policy = check("student gets signed focus policy", client.get(f"/sessions/{sid}/focus-policy?nonce={uuid4()}", headers=student), 200)
    check("student focus event recorded", client.post(f"/sessions/{sid}/focus-events", headers=student, json={"id": str(uuid4()), "policy": policy["policy"], "action": "started"}), 201)
    events = check("teacher sees focus events", client.get(f"/sessions/{sid}/focus-events", headers=teacher), 200)
    assert events, "no focus events visible to teacher"

    other = next(p for p in roster if p["email"] == "student2@focuslock.test")
    check("teacher confirms student without phone", client.put(f"/sessions/{sid}/attendance/{other['id']}", headers=teacher, json={"status": "present"}), 200)
    check("correction without reason rejected", client.put(f"/sessions/{sid}/attendance/{other['id']}", headers=teacher, json={"status": "absent"}), 422)
    check("correction with reason accepted", client.put(f"/sessions/{sid}/attendance/{other['id']}", headers=teacher, json={"status": "absent", "reason": "Left before the class began"}), 200)
    check("student2 cannot change attendance", client.put(f"/sessions/{sid}/attendance/{other['id']}", headers=student2, json={"status": "present", "reason": "Trying to mark myself"}), 403)
    audit = check("audit trail recorded", client.get(f"/sessions/{sid}/audit", headers=teacher), 200)
    assert audit, "audit trail empty"

    check("teacher pauses", client.post(f"/sessions/{sid}/pause", headers=teacher), 200)
    check("teacher resumes", client.post(f"/sessions/{sid}/resume", headers=teacher), 200)
    check("teacher ends session", client.post(f"/sessions/{sid}/end", headers=teacher), 200)
    check("ended session refuses new resources", client.post(f"/sessions/{sid}/resources", headers=teacher, json={"title": "Late", "url": "https://college.example.edu/late.pdf", "kind": "pdf", "downloadable": False}), 409)
    history = check("student attendance history", client.get("/attendance/me", headers=student), 200)
    assert any(row["session_id"] == sid for row in history), history
    print("\nEnd-to-end flow passed against " + base)


if __name__ == "__main__":
    if len(sys.argv) != 2 or not os.environ.get("DEV_PASSWORD"):
        sys.exit("Usage: set DEV_PASSWORD, then: python -m scripts.e2e https://your-app/api")
    main(sys.argv[1], os.environ["DEV_PASSWORD"])
