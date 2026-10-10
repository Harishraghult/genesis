import pytest
from fastapi.testclient import TestClient
from app.main import app, STUDENTS_STORE
from app.config import settings
from app.security import get_current_totp
from app.anomaly import compute_salted_bssid_hash

client = TestClient(app)

def test_multi_ap_room_support():
    """
    Classrooms with multiple APs (roaming, 2.4G vs 5G bands) must all be accepted
    without generating false positives.
    """
    token, _, _ = get_current_totp()
    for i, ap in enumerate(settings.TARGET_ROOM_BSSIDS):
        student_id = f"TEST_MULTI_AP_{i}"
        payload = {
            "student_id": student_id,
            "student_name": f"Student AP {i}",
            "totp_token": token,
            "reported_bssid": ap,
            "is_simulation": False
        }
        res = client.post("/api/attendance/punch-in", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "FOCUSED", f"Failed for valid room AP: {ap}"
        assert data["network_attested"] is True

def test_on_device_bssid_match_without_raw_identifier():
    """
    Client performs on-device match against room AP list and sends pass/fail (bssid_match=True).
    The backend verifies presence without ever requiring or transmitting raw BSSID.
    """
    token, _, _ = get_current_totp()
    payload = {
        "student_id": "TEST_ONDEVICE_01",
        "student_name": "Device Match Student",
        "totp_token": token,
        "bssid_match": True,
        "is_simulation": False
    }
    res = client.post("/api/attendance/punch-in", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "FOCUSED"
    assert data["network_attested"] is True

    # Failed on-device match raises advisory verification needed
    payload_fail = {
        "student_id": "TEST_ONDEVICE_FAIL",
        "student_name": "Off Campus Student",
        "totp_token": token,
        "bssid_match": False,
        "is_simulation": False
    }
    res_fail = client.post("/api/attendance/punch-in", json=payload_fail)
    assert res_fail.status_code == 200
    assert res_fail.json()["status"] == "NETWORK_VERIFICATION_NEEDED"

def test_salted_bssid_hmac_attestation():
    """
    Client sends a per-session salted HMAC rather than a raw BSSID.
    Backend verifies hash against allowed room AP hashes with the session salt.
    """
    token, _, _ = get_current_totp()
    valid_hash = compute_salted_bssid_hash(settings.TARGET_ROOM_BSSIDS[0], settings.SESSION_SALT)
    
    payload = {
        "student_id": "TEST_SALTED_HMAC_01",
        "student_name": "Salted HMAC Student",
        "totp_token": token,
        "salted_bssid_hmac": valid_hash,
        "is_simulation": False
    }
    res = client.post("/api/attendance/punch-in", json=payload)
    assert res.status_code == 200
    assert res.json()["status"] == "FOCUSED"

    # Rogue AP hash
    bad_hash = compute_salted_bssid_hash("EXTERNAL_COFFEE_SHOP_AP", settings.SESSION_SALT)
    payload_bad = {
        "student_id": "TEST_SALTED_HMAC_BAD",
        "student_name": "Remote Student",
        "totp_token": token,
        "salted_bssid_hmac": bad_hash,
        "is_simulation": False
    }
    res_bad = client.post("/api/attendance/punch-in", json=payload_bad)
    assert res_bad.status_code == 200
    assert res_bad.json()["status"] == "NETWORK_VERIFICATION_NEEDED"

def test_data_minimization_never_stores_raw_bssid_or_device_id():
    """
    GLOBAL RULE & ITEM 4:
    Never persist raw BSSIDs or device identifiers. Store result only.
    """
    token, _, _ = get_current_totp()
    student_id = "TEST_DATAMIN_01"
    payload = {
        "student_id": student_id,
        "student_name": "Privacy Student",
        "totp_token": token,
        "reported_bssid": settings.TARGET_ROOM_BSSIDS[0],
        "device_fingerprint": "sensitive_hardware_id_12345",
        "is_simulation": False
    }
    res = client.post("/api/attendance/punch-in", json=payload)
    assert res.status_code == 200

    student = STUDENTS_STORE[student_id]
    assert "reported_bssid" not in student, "Raw BSSID must NEVER be persisted in student store"
    assert "device_fingerprint" not in student, "Raw device fingerprint must NEVER be persisted in student store"
    assert student.get("network_attested") is True, "Must persist pass/fail result only"

def test_device_fingerprint_collisions_are_not_fraud():
    """
    ITEM 5:
    Stop using device fingerprints as proof of fraud.
    Multiple students sharing a device (e.g. library tablet) or having identical
    browser canvas fingerprints must NOT be rejected or flagged as fraud.
    Randomized MACs and Private DNS are treated as standard privacy behavior.
    """
    token, _, _ = get_current_totp()
    shared_fingerprint = "shared_lab_tablet_canvas_hash"

    # Student A punches in
    res_a = client.post("/api/attendance/punch-in", json={
        "student_id": "TEST_SHARED_A",
        "student_name": "Student A",
        "totp_token": token,
        "bssid_match": True,
        "device_fingerprint": shared_fingerprint
    })
    assert res_a.status_code == 200
    assert res_a.json()["status"] == "FOCUSED"

    # Student B punches in with the SAME fingerprint (e.g. same shared tablet / lab computer)
    res_b = client.post("/api/attendance/punch-in", json={
        "student_id": "TEST_SHARED_B",
        "student_name": "Student B",
        "totp_token": token,
        "bssid_match": True,
        "device_fingerprint": shared_fingerprint
    })
    assert res_b.status_code == 200
    # Must NOT be flagged as fraud/collision
    assert res_b.json()["status"] == "FOCUSED"
    assert STUDENTS_STORE["TEST_SHARED_B"]["status"] == "FOCUSED"
