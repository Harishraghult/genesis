"""Simulated student client. It behaves like the Android app, against a running server.

    uvicorn main:app --host 0.0.0.0 --port 8000
    python sim_client.py --url http://127.0.0.1:8000 --key dev-instructor-key

It enrols a device, starts a session, checks in, sends heartbeats with the
VPN state, logs vpn_* events, reads the report and leaves.
"""
from __future__ import annotations

import argparse
import json
import secrets
import time

import httpx

from main import device_sig, sign


class SimStudent:
    def __init__(self, http: httpx.Client, sid: str, student: str, secret: str, policy: dict):
        self.http, self.sid, self.student, self.secret, self.policy = http, sid, student, secret, policy

    def call(self, method: str, pq: str, payload: dict | None = None) -> httpx.Response:
        body = b"" if payload is None else json.dumps(payload, separators=(",", ":")).encode()
        ts, nonce = str(int(time.time())), secrets.token_hex(8)
        headers = {"X-FL-Session": self.sid, "X-FL-Student": self.student, "X-FL-Ts": ts,
                   "X-FL-Nonce": nonce, "X-FL-Sig": sign(self.secret, method, pq, ts, nonce, body)}
        if body:
            headers["Content-Type"] = "application/json"
        return self.http.request(method, pq, content=body, headers=headers)

    def heartbeat(self, vpn: bool | None = None) -> httpx.Response:
        return self.call("GET", "/api/client/heartbeat" + ("" if vpn is None else f"?vpn={int(vpn)}"))

    def event(self, etype: str, detail: str | None = None) -> httpx.Response:
        return self.call("POST", "/api/client/event", {"type": etype, "detail": detail})

    def leave(self) -> httpx.Response:
        return self.call("POST", "/api/client/leave")


def checkin(http: httpx.Client, sid: str, student: str, code: str, device_key: str) -> SimStudent:
    ts = int(time.time())
    r = http.post("/api/checkin", json={"session_id": sid, "student_id": student, "code": code, "ts": ts,
                                        "device_sig": device_sig(device_key, sid, student, code, ts)})
    r.raise_for_status()
    return SimStudent(http, sid, student, r.json()["secret"], r.json()["policy"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--key", default="dev-instructor-key")
    ap.add_argument("--student", default="stu-001")
    a = ap.parse_args()
    ik = {"X-Instructor-Key": a.key}
    with httpx.Client(base_url=a.url, timeout=5) as http:
        dk = http.post("/api/devices", json={"student_id": a.student}, headers=ik).json()["device_key"]
        s = http.post("/api/session/start", json={"duration_min": 5, "allowed_hosts": ["127.0.0.1"]},
                      headers=ik).json()
        code = http.get(f"/api/session/{s['session_id']}/code", headers=ik).json()["code"]
        st = checkin(http, s["session_id"], a.student, code, dk)
        print("checked in, policy:", st.policy)
        print("vpn_started:", st.event("vpn_started").status_code)
        for _ in range(3):
            print("heartbeat vpn=1:", st.heartbeat(True).status_code)
            time.sleep(1)
        print("leave:", st.leave().status_code)
        print(json.dumps(http.get(f"/api/session/{s['session_id']}/report", headers=ik).json(), indent=2))


if __name__ == "__main__":
    main()
