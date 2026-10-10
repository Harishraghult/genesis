import time
import pytest
from fastapi.testclient import TestClient
from app.main import app, STUDENTS_STORE, AUDIT_LOGS, cleanup_expired_records
from app.config import settings

client = TestClient(app)

def test_retention_policy_purges_expired_records():
    """
    ITEM 7:
    Verification results and student records older than N days (default 30)
    must be deleted by the retention cleanup job.
    """
    now = time.time()
    day_seconds = 86400

    # Old record from 45 days ago
    STUDENTS_STORE["OLD_STUDENT_45D"] = {
        "student_id": "OLD_STUDENT_45D",
        "student_name": "Past Student",
        "seat": "Row 1, #01",
        "status": "VERIFIED_PRESENT",
        "joined_at": now - (45 * day_seconds),
        "last_seen": now - (45 * day_seconds),
        "network_attested": True
    }

    # Recent record from 2 days ago
    STUDENTS_STORE["RECENT_STUDENT_2D"] = {
        "student_id": "RECENT_STUDENT_2D",
        "student_name": "Active Student",
        "seat": "Row 2, #02",
        "status": "VERIFIED_PRESENT",
        "joined_at": now - (2 * day_seconds),
        "last_seen": now - (2 * day_seconds),
        "network_attested": True
    }

    # Old audit log from 40 days ago
    AUDIT_LOGS.append({
        "id": "aud_old_40d",
        "action": "AUDIT_ROSTER_VIEWED",
        "actor": "instructor",
        "timestamp": now - (40 * day_seconds),
        "detail": "Historical roster access"
    })

    # Recent audit log from today
    AUDIT_LOGS.append({
        "id": "aud_recent_today",
        "action": "AUDIT_ROSTER_VIEWED",
        "actor": "instructor",
        "timestamp": now - 3600,
        "detail": "Today's roster access"
    })

    # Execute retention cleanup with 30-day policy
    result = cleanup_expired_records(retention_days=30)
    assert result["ok"] is True
    assert result["retention_days"] == 30
    assert result["students_purged"] >= 1
    assert result["audit_logs_purged"] >= 1

    # Verify old student is deleted, recent student is retained
    assert "OLD_STUDENT_45D" not in STUDENTS_STORE
    assert "RECENT_STUDENT_2D" in STUDENTS_STORE

    # Verify old audit log is deleted, recent audit log is retained
    audit_ids = [a["id"] for a in AUDIT_LOGS]
    assert "aud_old_40d" not in audit_ids
    assert "aud_recent_today" in audit_ids

def test_retention_endpoint_requires_auth():
    """
    Retention cleanup endpoint requires instructor authorization.
    """
    res_no_auth = client.post("/api/session/retention/cleanup")
    assert res_no_auth.status_code == 401

    res_auth = client.post(
        "/api/session/retention/cleanup",
        headers={"X-Instructor-Key": "dev-instructor-key"}
    )
    assert res_auth.status_code == 200
    assert res_auth.json()["ok"] is True
