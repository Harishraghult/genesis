"""Core gate tests: sessions, TOTP check-in, request signing, replay and subnet checks, and 410."""
import main
from conftest import KEY, checkin_body, current_code, enroll, join, start


# ---- instructor / session ---------------------------------------------------------------

def test_health(api):
    assert api.get("/api/health").json()["ok"] is True


def test_start_requires_instructor_key(api):
    assert api.post("/api/session/start", json={}).status_code == 401
    assert api.post("/api/session/start", json={}, headers={"X-Instructor-Key": "nope"}).status_code == 401


def test_start_session(api, clock):
    s = start(api, duration_min=30, heartbeat_s=10)
    assert s["ends_at"] == clock["t"] + 30 * 60
    assert s["heartbeat_s"] == 10


def test_code_is_six_digits_and_requires_key(api):
    s = start(api)
    assert api.get(f"/api/session/{s['session_id']}/code").status_code == 401
    r = api.get(f"/api/session/{s['session_id']}/code", headers=KEY).json()
    assert len(r["code"]) == 6 and r["code"].isdigit() and r["step"] == 15


def test_totp_rotates_every_step():
    seed = b"x" * 20
    t = 1_760_000_010.0  # mid-step
    assert main.totp(seed, t) == main.totp(seed, t - (t % 15))
    assert len({main.totp(seed, t + 15 * i) for i in range(10)}) > 1


def test_enroll_requires_key(api):
    assert api.post("/api/devices", json={"student_id": "s1"}).status_code == 401


# ---- check-in ---------------------------------------------------------------------------

def test_checkin_ok_returns_secret_and_policy(api):
    st = join(api, allowed_hosts=["Portal.example.edu"])
    assert len(st.secret) == 64
    assert st.policy["allowed_hosts"] == ["portal.example.edu"]
    assert {"ends_at", "heartbeat_s"} <= st.policy.keys()


def test_checkin_wrong_code(api):
    s = start(api); key = enroll(api)
    code = "000000" if current_code(s["session_id"]) != "000000" else "111111"
    r = api.post("/api/checkin", json=checkin_body(s["session_id"], "s1", code, key))
    assert r.status_code == 401


def test_checkin_accepts_previous_step_code(api, clock):
    s = start(api); key = enroll(api)
    code = current_code(s["session_id"])
    clock["t"] += 15
    r = api.post("/api/checkin", json=checkin_body(s["session_id"], "s1", code, key))
    assert r.status_code == 200


def test_checkin_rejects_code_two_steps_old(api, clock):
    s = start(api); key = enroll(api)
    code = current_code(s["session_id"])
    clock["t"] += 31
    if main.totp_ok(main.SESSIONS[s["session_id"]].seed, code, clock["t"]):
        return  # astronomically unlikely collision
    r = api.post("/api/checkin", json=checkin_body(s["session_id"], "s1", code, key))
    assert r.status_code == 401


def test_checkin_outside_subnet(api, outside):
    s = start(api); key = enroll(api)
    r = outside.post("/api/checkin", json=checkin_body(s["session_id"], "s1", current_code(s["session_id"]), key))
    assert r.status_code == 403


def test_checkin_unenrolled_device(api):
    s = start(api)
    r = api.post("/api/checkin", json=checkin_body(s["session_id"], "ghost", current_code(s["session_id"]), "ab" * 32))
    assert r.status_code == 403


def test_checkin_bad_device_signature(api):
    s = start(api); enroll(api)
    r = api.post("/api/checkin", json=checkin_body(s["session_id"], "s1", current_code(s["session_id"]), "cd" * 32))
    assert r.status_code == 401


def test_checkin_unknown_session(api):
    key = enroll(api)
    r = api.post("/api/checkin", json=checkin_body("deadbeef", "s1", "123456", key))
    assert r.status_code == 404


def test_checkin_ended_session(api):
    s = start(api); key = enroll(api)
    code = current_code(s["session_id"])
    api.post(f"/api/session/{s['session_id']}/end", headers=KEY)
    r = api.post("/api/checkin", json=checkin_body(s["session_id"], "s1", code, key))
    assert r.status_code == 410


# ---- signed gate ------------------------------------------------------------------------

def test_signed_heartbeat_ok(api):
    st = join(api)
    r = st.call("GET", "/api/client/heartbeat")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_missing_signature_headers(api):
    join(api)
    assert api.get("/api/client/heartbeat").status_code == 401


def test_stale_timestamp(api, clock):
    st = join(api)
    r = st.call("GET", "/api/client/heartbeat", ts=int(clock["t"]) - 31)
    assert r.status_code == 401


def test_replayed_nonce(api):
    st = join(api)
    assert st.call("GET", "/api/client/heartbeat", nonce="n-1").status_code == 200
    assert st.call("GET", "/api/client/heartbeat", nonce="n-1").status_code == 401


def test_wrong_path_signature(api):
    st = join(api)
    r = st.call("POST", "/api/client/leave", sign_pq="/api/client/heartbeat")
    assert r.status_code == 401


def test_wrong_body_signature(api):
    st = join(api)
    r = st.call("POST", "/api/client/event", json_body={"type": "pause"}, sign_body=b'{"type":"resume"}')
    assert r.status_code == 401


def test_signed_request_from_outside_subnet(api, outside):
    st = join(api)
    assert st.call("GET", "/api/client/heartbeat", via=outside).status_code == 403


def test_session_end_returns_410(api):
    st = join(api)
    api.post(f"/api/session/{st.sid}/end", headers=KEY)
    assert st.call("GET", "/api/client/heartbeat").status_code == 410


def test_ends_at_passed_returns_410(api, clock):
    st = join(api, duration_min=1)
    clock["t"] += 61
    assert st.call("GET", "/api/client/heartbeat").status_code == 410


def test_leave_then_410(api):
    st = join(api)
    assert st.call("POST", "/api/client/leave").status_code == 200
    assert st.call("GET", "/api/client/heartbeat").status_code == 410


def test_portal_signed_only(api):
    st = join(api)
    assert api.get("/portal/").status_code == 401
    r = st.call("GET", "/portal/notes")
    assert r.status_code == 200 and "Lecture notes" in r.text
