"""Session lifecycle, enrolled-roster gate, and teacher manual marking."""
from fastapi.testclient import TestClient

import app.main as appmain
from app.main import app, STUDENTS_STORE, AUDIT_LOGS
from app.security import get_current_totp

client = TestClient(app)
KEY = {"X-Instructor-Key": "dev-instructor-key"}


def _punch(sid, name):
    token, _, _ = get_current_totp()
    return client.post("/api/attendance/punch-in", json={
        "student_id": sid, "student_name": name, "totp_token": token, "bssid_match": True,
    }).json()


def test_qr_hidden_and_punch_rejected_until_session_started(monkeypatch):
    monkeypatch.setitem(appmain.ACTIVE_SESSION, "is_active", False)
    qr = client.get("/api/session/current-qr").json()
    assert qr["is_active"] is False and qr["totp_token"] == ""
    data = _punch("21CS074", "Rohan Iyer")
    assert data["status"] == "ERROR"
    assert "not started" in data["message"]


def test_start_session_resets_roster_and_shows_qr(monkeypatch):
    monkeypatch.setitem(appmain.ACTIVE_SESSION, "is_active", False)
    res = client.post("/api/session/start", json={})
    assert res.status_code == 200
    assert all(s["status"] == "ABSENT" for s in STUDENTS_STORE.values())
    qr = client.get("/api/session/current-qr").json()
    assert qr["is_active"] is True and len(qr["totp_token"]) == 6


def test_enrolled_student_admitted(monkeypatch):
    monkeypatch.setattr(appmain, "ENFORCE_ENROLLMENT", True)
    data = _punch("21cs074", "rohan iyer")  # case-insensitive
    assert data["status"] == "FOCUSED"
    assert data["student_id"] == "21CS074"
    assert STUDENTS_STORE["21CS074"]["status"] == "FOCUSED"


def test_unenrolled_student_rejected(monkeypatch):
    monkeypatch.setattr(appmain, "ENFORCE_ENROLLMENT", True)
    data = _punch("99XX999", "Random Person")
    assert data["status"] == "ERROR"
    assert "not enrolled" in data["message"]
    assert "99XX999" not in STUDENTS_STORE


def test_name_mismatch_rejected(monkeypatch):
    monkeypatch.setattr(appmain, "ENFORCE_ENROLLMENT", True)
    data = _punch("21CS074", "Someone Else")
    assert data["status"] == "ERROR"


def test_teacher_mark_requires_auth():
    res = client.post("/api/attendance/mark", json={"student_id": "21CS150", "status": "PRESENT"})
    assert res.status_code == 401


def test_teacher_can_mark_present_and_absent_with_audit():
    n = len(AUDIT_LOGS)
    res = client.post("/api/attendance/mark", headers=KEY,
                      json={"student_id": "21CS150", "status": "PRESENT", "reason": "Phone dead"})
    assert res.status_code == 200
    assert STUDENTS_STORE["21CS150"]["status"] == "VERIFIED_PRESENT"
    assert STUDENTS_STORE["21CS150"]["marked_by"] == "instructor"
    assert AUDIT_LOGS[-1]["action"] == "MANUAL_ATTENDANCE_MARKED"

    res = client.post("/api/attendance/mark", headers=KEY,
                      json={"student_id": "21CS150", "status": "ABSENT"})
    assert res.status_code == 200
    assert STUDENTS_STORE["21CS150"]["status"] == "ABSENT"
    assert len(AUDIT_LOGS) == n + 2


def test_mark_unknown_student_404():
    res = client.post("/api/attendance/mark", headers=KEY, json={"student_id": "NOPE", "status": "PRESENT"})
    assert res.status_code == 404


def test_absent_students_excluded_from_aggregates():
    appmain.seed_students()
    m = appmain.compute_aggregate_metrics()
    assert m["total_joined"] == 0
