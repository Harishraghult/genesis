"""In-process demo (no server needed). It walks through a class session with the VPN restriction.

    python demo.py
"""
import json

from fastapi.testclient import TestClient

import main
from sim_client import checkin

IK = {"X-Instructor-Key": main.INSTRUCTOR_KEY}


def step(msg):
    print(f"\n== {msg}")


def run():
    main.reset()
    with TestClient(main.app, client=("192.168.1.50", 40000)) as http:
        step("Instructor enrols two devices and starts a 50-minute session")
        keys = {s: http.post("/api/devices", json={"student_id": s}, headers=IK).json()["device_key"]
                for s in ("asha", "ravi")}
        s = http.post("/api/session/start", json={"duration_min": 50, "allowed_hosts": ["192.168.1.10"]},
                      headers=IK).json()
        code = http.get(f"/api/session/{s['session_id']}/code", headers=IK).json()["code"]
        print("session", s["session_id"], "code", code)

        step("Both students check in from the classroom Wi-Fi")
        asha = checkin(http, s["session_id"], "asha", code, keys["asha"])
        ravi = checkin(http, s["session_id"], "ravi", code, keys["ravi"])

        step("Asha accepts the VPN restriction; Ravi declines (portal-only mode)")
        asha.event("vpn_started"); asha.heartbeat(True)
        ravi.event("vpn_declined"); ravi.heartbeat(False)

        step("Asha later switches the VPN off in Settings, and the app reports it")
        asha.event("vpn_revoked"); asha.heartbeat(False)

        step("Signed portal request works, and the unsigned one is rejected")
        print("signed portal:", asha.call("GET", "/portal/").status_code,
              "| unsigned portal:", http.get("/portal/").status_code)

        step("Instructor ends the session; the next heartbeat returns 410, so the apps unlock and stop the VPN")
        http.post(f"/api/session/{s['session_id']}/end", headers=IK)
        print("asha heartbeat:", asha.heartbeat(False).status_code)

        step("Report")
        rep = http.get(f"/api/session/{s['session_id']}/report", headers=IK).json()
        for row in rep["students"]:
            print(json.dumps({k: row[k] for k in ("student_id", "vpn_active", "vpn_last_change",
                                                  "present_seconds", "event_counts")}))


if __name__ == "__main__":
    run()
