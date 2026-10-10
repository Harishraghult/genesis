import pytest
from fastapi.testclient import TestClient
from app.main import app, STUDENTS_STORE, AUDIT_LOGS, compute_aggregate_metrics
from app.security import get_current_totp

client = TestClient(app)

def test_anomaly_sets_network_verification_needed():
    """
    When an anomaly occurs (e.g. rogue BSSID or simulation),
    status is marked as 'NETWORK_VERIFICATION_NEEDED' rather than a punitive grade-affecting flag.
    """
    token, _, _ = get_current_totp()
    payload = {
        "student_id": "TEST_STUDENT_OVR_01",
        "student_name": "Jordan Smith",
        "totp_token": token,
        "reported_bssid": "SIMULATED_ROGUE_BSSID",
        "device_fingerprint": "fp_test_ovr_01",
        "is_simulation": True
    }
    res = client.post("/api/attendance/punch-in", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "NETWORK_VERIFICATION_NEEDED"

    # Verify backend student record
    student = STUDENTS_STORE["TEST_STUDENT_OVR_01"]
    assert student["status"] == "NETWORK_VERIFICATION_NEEDED"
    assert "NETWORK_VERIFICATION_NEEDED" in student["anomaly_flag"]

def test_override_requires_instructor_auth():
    """
    Manual override endpoint MUST require instructor authentication.
    """
    res_no_auth = client.post(
        "/api/attendance/override",
        json={"student_id": "TEST_STUDENT_OVR_01", "reason": "Visual check", "new_status": "VERIFIED_PRESENT"}
    )
    assert res_no_auth.status_code == 401

    res_bad_auth = client.post(
        "/api/attendance/override",
        headers={"X-Instructor-Key": "invalid_key"},
        json={"student_id": "TEST_STUDENT_OVR_01", "reason": "Visual check", "new_status": "VERIFIED_PRESENT"}
    )
    assert res_bad_auth.status_code == 401

def test_instructor_override_clears_flag_and_creates_audit_log():
    """
    Instructor can manually override an advisory flag to VERIFIED_PRESENT,
    which clears the anomaly flag and writes an audit log entry.
    """
    initial_log_count = len(AUDIT_LOGS)

    res = client.post(
        "/api/attendance/override",
        headers={"X-Instructor-Key": "dev-instructor-key"},
        json={
            "student_id": "TEST_STUDENT_OVR_01",
            "reason": "Student verified seated in Row 3 with physical ID badge",
            "new_status": "VERIFIED_PRESENT"
        }
    )
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["attendance_status"] == "VERIFIED_PRESENT"
    assert "audit_id" in data

    # Verify student store in backend
    student = STUDENTS_STORE["TEST_STUDENT_OVR_01"]
    assert student["status"] == "VERIFIED_PRESENT"
    assert student["anomaly_flag"] is None
    assert "OVERRIDDEN_BY_INSTRUCTOR" in student["last_event"]

    # Verify audit log was recorded
    assert len(AUDIT_LOGS) == initial_log_count + 1
    audit = AUDIT_LOGS[-1]
    assert audit["action"] == "MANUAL_OVERRIDE_RECORDED"
    assert audit["actor"] == "instructor"
    assert "TEST_STUDENT_OVR_01" in audit["detail"]

def test_override_nonexistent_student_returns_404():
    """
    Attempting to override a student who has not joined returns 404.
    """
    res = client.post(
        "/api/attendance/override",
        headers={"X-Instructor-Key": "dev-instructor-key"},
        json={"student_id": "NONEXISTENT_STUDENT", "reason": "N/A", "new_status": "VERIFIED_PRESENT"}
    )
    assert res.status_code == 404

def test_session_status_provides_configurable_emergency_number():
    """
    Session status endpoint provides the configured regional emergency number.
    """
    res = client.get("/api/session/status")
    assert res.status_code == 200
    data = res.json()
    assert "emergency_number" in data
    assert data["emergency_number"] in ["112", "911", "999"]

