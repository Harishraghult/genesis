import pytest
from fastapi.testclient import TestClient
from app.main import app, STUDENTS_STORE, AUDIT_LOGS, compute_aggregate_metrics

client = TestClient(app)

def test_public_status_contains_only_aggregates_and_no_student_names():
    """
    FERPA / Projector protection test:
    The public status endpoint MUST NOT return the student list or student PII.
    """
    res = client.get("/api/session/status")
    assert res.status_code == 200
    data = res.json()
    
    # 1. No student array or per-student objects
    assert "students" not in data, "Public status must not contain 'students' key"
    
    # 2. Check metrics presence
    metrics = data.get("metrics")
    assert metrics is not None
    assert "total_joined" in metrics
    assert "focused_count" in metrics
    assert "distracted_count" in metrics
    assert "focus_percentage" in metrics
    assert "flagged_count" in metrics
    
    # 3. Text check: no seeded student names or IDs in raw response
    raw_text = res.text
    for student in STUDENTS_STORE.values():
        assert student["student_name"] not in raw_text, f"Leaked student name: {student['student_name']}"
        assert student["student_id"] not in raw_text, f"Leaked student id: {student['student_id']}"

def test_roster_endpoint_requires_instructor_auth():
    """
    Roster endpoint must reject unauthenticated requests.
    """
    # Missing header
    res_no_auth = client.get("/api/session/roster")
    assert res_no_auth.status_code == 401
    
    # Wrong key
    res_bad_auth = client.get("/api/session/roster", headers={"X-Instructor-Key": "wrong-key"})
    assert res_bad_auth.status_code == 401

def test_roster_endpoint_authorized_and_creates_audit_log():
    """
    Roster access with valid instructor key must succeed and produce an audit log.
    """
    initial_log_count = len(AUDIT_LOGS)
    
    res = client.get("/api/session/roster", headers={"X-Instructor-Key": "dev-instructor-key"})
    assert res.status_code == 200
    data = res.json()
    
    assert "students" in data
    assert "audit_id" in data
    assert len(data["students"]) == len(STUDENTS_STORE)
    
    # Verify per-student records do NOT expose a punitive 'DISTRACTED' label
    for student in data["students"]:
        assert student["attendance_status"] in ["VERIFIED_PRESENT", "NETWORK_VERIFICATION_NEEDED", "PROXY_FLAGGED"]
        assert student["attendance_status"] != "DISTRACTED"
    
    # Verify audit log recorded the access
    assert len(AUDIT_LOGS) == initial_log_count + 1
    latest_audit = AUDIT_LOGS[-1]
    assert latest_audit["action"] == "AUDIT_ROSTER_VIEWED"
    assert latest_audit["actor"] == "instructor"

def test_focus_events_update_aggregates_correctly():
    """
    Focus events must update class-wide focus index without individual exposure.
    """
    # Seed known state: all currently joined students focused
    for s in STUDENTS_STORE.values():
        s["is_focused"] = True
        s["status"] = "VERIFIED_PRESENT"
    
    res1 = client.get("/api/session/status")
    assert res1.json()["metrics"]["focus_percentage"] == 100.0
    
    # Simulate focus loss on one student
    res_event = client.post("/api/attendance/focus-event", json={
        "student_id": "21CS042",
        "event_type": "EVENT_FOCUS_LOST",
        "detail": "Tab switched"
    })
    assert res_event.status_code == 200
    
    # Check that aggregate focus percentage dropped
    res2 = client.get("/api/session/status")
    metrics2 = res2.json()["metrics"]
    assert metrics2["distracted_count"] >= 1
    assert metrics2["focus_percentage"] < 100.0
