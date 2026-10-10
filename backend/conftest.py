"""Shared test fixtures: a fake clock, in/out-of-classroom clients and signing helpers."""
import ipaddress
import json
import secrets

import pytest
from fastapi.testclient import TestClient

import main

KEY = {"X-Instructor-Key": "test-key"}
T0 = 1_760_000_000.0


@pytest.fixture(autouse=True)
def env(monkeypatch):
    main.reset()
    monkeypatch.setattr(main, "INSTRUCTOR_KEY", "test-key")
    monkeypatch.setattr(main, "CLASSROOM_NETS", [ipaddress.ip_network("10.0.0.0/8")])
    clock = {"t": T0}
    monkeypatch.setattr(main, "now", lambda: clock["t"])
    yield clock
    main.reset()


@pytest.fixture
def clock(env):
    return env


@pytest.fixture
def api():
    return TestClient(main.app, client=("10.1.2.3", 5000))


@pytest.fixture
def outside():
    # A phone on mobile data or another network: not in FL_CLASSROOM_NETS.
    return TestClient(main.app, client=("100.64.9.9", 5000))


def start(api, **kw):
    r = api.post("/api/session/start", json=kw, headers=KEY)
    assert r.status_code == 200, r.text
    return r.json()


def enroll(api, student="s1"):
    r = api.post("/api/devices", json={"student_id": student}, headers=KEY)
    assert r.status_code == 200, r.text
    return r.json()["device_key"]


def checkin_body(sid, student, code, device_key, ts=None):
    ts = int(main.now()) if ts is None else ts
    return {"session_id": sid, "student_id": student, "code": code, "ts": ts,
            "device_sig": main.device_sig(device_key, sid, student, code, ts)}


def current_code(sid):
    return main.totp(main.SESSIONS[sid].seed, main.now())


def join(api, student="s1", **session_kw):
    """Start a session, enrol a device and check in. Returns a Student helper."""
    s = start(api, **session_kw)
    key = enroll(api, student)
    r = api.post("/api/checkin", json=checkin_body(s["session_id"], student, current_code(s["session_id"]), key))
    assert r.status_code == 200, r.text
    return Student(api, s["session_id"], student, r.json()["secret"], r.json()["policy"])


class Student:
    def __init__(self, api, sid, student, secret, policy):
        self.api, self.sid, self.student, self.secret, self.policy = api, sid, student, secret, policy

    def headers(self, method, pq, body=b"", ts=None, nonce=None, sign_pq=None, sign_body=None):
        ts = str(int(main.now()) if ts is None else ts)
        nonce = nonce or secrets.token_hex(8)
        sig = main.sign(self.secret, method, sign_pq or pq, ts, nonce,
                        body if sign_body is None else sign_body)
        return {"X-FL-Session": self.sid, "X-FL-Student": self.student,
                "X-FL-Ts": ts, "X-FL-Nonce": nonce, "X-FL-Sig": sig}

    def call(self, method, pq, json_body=None, via=None, **kw):
        body = b"" if json_body is None else json.dumps(json_body).encode()
        h = self.headers(method, pq, body, **kw)
        if body:
            h["Content-Type"] = "application/json"
        return (via or self.api).request(method, pq, content=body, headers=h)
